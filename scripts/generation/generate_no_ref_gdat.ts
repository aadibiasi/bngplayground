/**
 * Generate missing BNG2.pl reference outputs (GDAT/CDAT/NET) for models that
 * exist in the web gallery but are missing in bng_test_output/.
 *
 * This is intended to unblock strict parity comparisons of browser-exported CSV
 * outputs (web_output/) against canonical BNG2.pl outputs.
 *
 * Usage:
 *   npx -y tsx scripts/generate_no_ref_gdat.ts
 *
 * Environment:
 *   - BNG2_PL or BNG2_PATH: path to BNG2.pl
 *   - PERL: perl executable (default: perl)
 *   - BNG2_TIMEOUT_MS: per-model timeout (default: 300000)
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(THIS_DIR, '..');
const BNG_TEST_OUTPUT_DIR = path.join(PROJECT_ROOT, 'bng_test_output');

const SESSION_DIR = path.join(PROJECT_ROOT, 'artifacts', 'SESSION_2026_01_05_web_output_parity');
const WORK_ROOT = path.join(SESSION_DIR, 'bng2_work');
const LOG_ROOT = path.join(SESSION_DIR, 'bng2_logs');

const DEFAULT_BNG2_PL =
	'C:\\Users\\Achyudhan\\anaconda3\\envs\\Research\\Lib\\site-packages\\bionetgen\\bng-win\\BNG2.pl';

const BNG2_PL = process.env.BNG2_PL || process.env.BNG2_PATH || DEFAULT_BNG2_PL;
const PERL = process.env.PERL || 'perl';
const TIMEOUT_MS = Number(process.env.BNG2_TIMEOUT_MS || 300_000);

const NO_REF_SAFE_NAMES = [
	'abc',
	'abp',
	'abp_approx',
	'ab_tutorial',
	'bab',
	'bab_coop',
	'birth_death',
	'fceri_ji',
	'fceri_viz',
	'gk',
	'lisman',
	'lr',
	'lrr_comp',
	'lr_comp',
	'lv',
	'organelle_transport',
	'organelle_transport_struct',
	'repressilator',
	'sir',
] as const;

type NoRefName = (typeof NO_REF_SAFE_NAMES)[number];

type GenerationResult = {
	safeName: NoRefName;
	source: 'published-models' | 'public/models' | 'example-models' | 'missing';
	sourceId?: string;
	status: 'generated' | 'skipped_exists' | 'bng2_failed' | 'source_missing';
	elapsedMs?: number;
	exitStatus?: number | null;
	timedOut?: boolean;
	producedFiles?: string[];
	copiedFiles?: string[];
	logFile?: string;
	error?: string;
};

function normalizeKey(input: string): string {
	return input.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function ensureDir(dir: string) {
	fs.mkdirSync(dir, { recursive: true });
}

function tail(str: string, maxChars = 4000): string {
	if (str.length <= maxChars) return str;
	return str.slice(-maxChars);
}

function sanitizeActionsKeepFirstOdeSimulateOnly(code: string): string {
	// Copied from scripts/verify_published_models_with_bng2.cjs (kept in TS form).
	// Keep only the first ODE simulate call in the actions block; comment out all others.
	const beginRe = /\bbegin\s+actions\b/i;
	const endRe = /\bend\s+actions\b/i;

	const beginMatch = beginRe.exec(code);
	if (!beginMatch) return code;
	const beginIdx = beginMatch.index;

	const afterBeginIdx = beginIdx + beginMatch[0].length;
	const endMatch = endRe.exec(code.slice(afterBeginIdx));
	if (!endMatch) return code;
	const endIdx = afterBeginIdx + endMatch.index;

	const before = code.slice(0, afterBeginIdx);
	const actionsBody = code.slice(afterBeginIdx, endIdx);
	const after = code.slice(endIdx);

	let seenOdeSim = false;
	const lines = actionsBody.split(/\r?\n/);
	const outLines = lines.map((line) => {
		const trimmed = line.trimStart();
		if (trimmed.startsWith('#')) return line;
		if (!/\b(simulate|simulate_ode)\s*\(/i.test(line)) return line;

		const isOde = /\bsimulate_ode\s*\(/i.test(line) || /\bmethod\s*=>\s*["']ode["']/i.test(line);
		if (isOde && !seenOdeSim) {
			seenOdeSim = true;
			return line;
		}

		return `# [auto-disabled] ${line}`;
	});

	return `${before}\n${outLines.join('\n')}\n${after}`;
}

type ModelSource = Exclude<GenerationResult['source'], 'missing'>;

const SOURCE_ROOTS: Array<{ source: ModelSource; absRoot: string }> = [
	{ source: 'published-models', absRoot: path.join(PROJECT_ROOT, 'published-models') },
	{ source: 'public/models', absRoot: path.join(PROJECT_ROOT, 'public', 'models') },
	{ source: 'example-models', absRoot: path.join(PROJECT_ROOT, 'example-models') },
];

const SAFE_NAME_ALIASES: Partial<Record<NoRefName, string[]>> = {
	ab_tutorial: ['AB'],
};

let bnglIndex:
	| Map<
			string,
			Array<{
				fileAbs: string;
				source: ModelSource;
				fileRel: string;
				priority: number;
			}>
		>
	| undefined;

function walkFilesRecursive(dirAbs: string, results: string[]) {
	if (!fs.existsSync(dirAbs)) return;
	for (const entry of fs.readdirSync(dirAbs, { withFileTypes: true })) {
		const abs = path.join(dirAbs, entry.name);
		if (entry.isDirectory()) {
			walkFilesRecursive(abs, results);
			continue;
		}
		results.push(abs);
	}
}

function buildBnglIndex(): NonNullable<typeof bnglIndex> {
	const idx = new Map<
		string,
		Array<{
			fileAbs: string;
			source: ModelSource;
			fileRel: string;
			priority: number;
		}>
	>();

	for (const [priority, root] of SOURCE_ROOTS.entries()) {
		const allFiles: string[] = [];
		walkFilesRecursive(root.absRoot, allFiles);
		for (const abs of allFiles) {
			if (!abs.toLowerCase().endsWith('.bngl')) continue;
			const base = path.basename(abs, '.bngl');
			const key = normalizeKey(base);
			const fileRel = path.relative(PROJECT_ROOT, abs).replace(/\\/g, '/');
			const arr = idx.get(key) ?? [];
			arr.push({ fileAbs: abs, source: root.source, fileRel, priority });
			idx.set(key, arr);
		}
	}

	// Prefer earlier roots and then shorter rel paths (more canonical-ish).
	for (const [key, entries] of idx.entries()) {
		entries.sort((a, b) => a.priority - b.priority || a.fileRel.length - b.fileRel.length || a.fileRel.localeCompare(b.fileRel));
		idx.set(key, entries);
	}

	return idx;
}

function getBnglIndex(): NonNullable<typeof bnglIndex> {
	if (!bnglIndex) bnglIndex = buildBnglIndex();
	return bnglIndex;
}

function loadModelCodeBySafeName(safeName: NoRefName): { code: string; source: GenerationResult['source']; sourceId?: string } {
	const idx = getBnglIndex();

	const candidateKeys = new Set<string>();
	candidateKeys.add(normalizeKey(safeName));
	for (const alias of SAFE_NAME_ALIASES[safeName] ?? []) candidateKeys.add(normalizeKey(alias));

	for (const key of candidateKeys) {
		const entries = idx.get(key);
		if (!entries || entries.length === 0) continue;
		const chosen = entries[0];
		const code = fs.readFileSync(chosen.fileAbs, 'utf8').replace(/^\uFEFF/, '');
		return { code, source: chosen.source, sourceId: chosen.fileRel };
	}

	return { code: '', source: 'missing' };
}

function generateOne(safeName: NoRefName): GenerationResult {
	const existingAny = ['.gdat', '.cdat', '.net'].some((ext) => fs.existsSync(path.join(BNG_TEST_OUTPUT_DIR, `${safeName}${ext}`)));
	if (existingAny) {
		return {
			safeName,
			source: 'missing',
			status: 'skipped_exists',
			error: 'At least one reference output already exists in bng_test_output/',
		};
	}

	const loaded = loadModelCodeBySafeName(safeName);
	if (loaded.source === 'missing') {
		return { safeName, source: 'missing', status: 'source_missing', error: 'Model source not found in constants or public/models' };
	}

	ensureDir(WORK_ROOT);
	ensureDir(LOG_ROOT);

	const workDir = path.join(WORK_ROOT, safeName);
	if (fs.existsSync(workDir)) fs.rmSync(workDir, { recursive: true, force: true });
	ensureDir(workDir);

	const sanitized = sanitizeActionsKeepFirstOdeSimulateOnly(loaded.code);

	const bnglPath = path.join(workDir, `${safeName}.bngl`);
	fs.writeFileSync(bnglPath, sanitized, 'utf8');

	const t0 = Date.now();
	const res = spawnSync(PERL, [BNG2_PL, path.basename(bnglPath)], {
		cwd: workDir,
		encoding: 'utf8',
		timeout: TIMEOUT_MS,
		maxBuffer: 1024 * 1024 * 200,
		windowsHide: true,
	});
	const elapsedMs = Date.now() - t0;

	const timedOut = Boolean(res.error && (res.error as any).code === 'ETIMEDOUT');
	const stdout = res.stdout || '';
	const stderr = res.stderr || '';

	const produced = fs.readdirSync(workDir);
	const producedFiles = produced.filter((f) => /\.(gdat|cdat|net)$/i.test(f)).sort();

	const logFileAbs = path.join(LOG_ROOT, `${safeName}.log.txt`);
	const logRel = path.relative(PROJECT_ROOT, logFileAbs).replace(/\\/g, '/');
	fs.writeFileSync(
		logFileAbs,
		[
			`SAFE_NAME: ${safeName}`,
			`SOURCE: ${loaded.source}`,
			`SOURCE_ID: ${loaded.sourceId ?? ''}`,
			`BNG2_PL: ${BNG2_PL}`,
			`PERL: ${PERL}`,
			`TIMEOUT_MS: ${TIMEOUT_MS}`,
			`WORKDIR: ${workDir}`,
			`EXIT_STATUS: ${res.status}`,
			`SIGNAL: ${res.signal}`,
			`TIMED_OUT: ${timedOut}`,
			`ELAPSED_MS: ${elapsedMs}`,
			`PRODUCED: ${producedFiles.join(', ')}`,
			`\n=== STDOUT (tail) ===\n${tail(stdout)}`,
			`\n=== STDERR (tail) ===\n${tail(stderr)}`,
		].join('\n'),
		'utf8'
	);

	if (res.status !== 0 || producedFiles.length === 0) {
		return {
			safeName,
			source: loaded.source,
			sourceId: loaded.sourceId,
			status: 'bng2_failed',
			elapsedMs,
			exitStatus: res.status,
			timedOut,
			producedFiles,
			logFile: logRel,
			error: timedOut ? 'BNG2.pl timed out' : 'BNG2.pl failed or produced no outputs',
		};
	}

	// Copy the BNGL used for generation + produced outputs into bng_test_output.
	const copiedFiles: string[] = [];

	const dstBngl = path.join(BNG_TEST_OUTPUT_DIR, `${safeName}.bngl`);
	if (!fs.existsSync(dstBngl)) {
		fs.copyFileSync(bnglPath, dstBngl);
		copiedFiles.push(path.basename(dstBngl));
	}

	for (const f of producedFiles) {
		const src = path.join(workDir, f);
		const dst = path.join(BNG_TEST_OUTPUT_DIR, f);
		fs.copyFileSync(src, dst);
		copiedFiles.push(f);
	}

	return {
		safeName,
		source: loaded.source,
		sourceId: loaded.sourceId,
		status: 'generated',
		elapsedMs,
		exitStatus: res.status,
		timedOut,
		producedFiles,
		copiedFiles,
		logFile: logRel,
	};
}

function main() {
	ensureDir(SESSION_DIR);
	ensureDir(WORK_ROOT);
	ensureDir(LOG_ROOT);

	if (!fs.existsSync(BNG2_PL)) {
		console.error('BNG2.pl not found at:', BNG2_PL);
		process.exitCode = 2;
		return;
	}
	if (!fs.existsSync(BNG_TEST_OUTPUT_DIR)) {
		console.error('Missing bng_test_output directory:', BNG_TEST_OUTPUT_DIR);
		process.exitCode = 2;
		return;
	}

	console.log('Generating missing BNG2 references for NOREF models...');
	console.log('BNG2_PL:', BNG2_PL);
	console.log('PERL:', PERL);
	console.log('TIMEOUT_MS:', TIMEOUT_MS);
	console.log('Count:', NO_REF_SAFE_NAMES.length);
	console.log();

	const results: GenerationResult[] = [];
	for (const name of NO_REF_SAFE_NAMES) {
		console.log(`--- ${name} ---`);
		const r = generateOne(name);
		results.push(r);
		console.log(`Status: ${r.status}`);
		if (r.error) console.log(`Error: ${r.error}`);
		if (r.producedFiles?.length) console.log(`Produced: ${r.producedFiles.join(', ')}`);
		if (r.copiedFiles?.length) console.log(`Copied: ${r.copiedFiles.join(', ')}`);
		if (r.logFile) console.log(`Log: ${r.logFile}`);
		console.log();
	}

	const summaryPath = path.join(SESSION_DIR, 'generated_no_ref_gdat_summary.json');
	fs.writeFileSync(
		summaryPath,
		JSON.stringify(
			{
				generatedAt: new Date().toISOString(),
				bng2Pl: BNG2_PL,
				perl: PERL,
				timeoutMs: TIMEOUT_MS,
				results,
			},
			null,
			2
		),
		'utf8'
	);

	const ok = results.filter((r) => r.status === 'generated').length;
	const failed = results.filter((r) => r.status === 'bng2_failed').length;
	const missing = results.filter((r) => r.status === 'source_missing').length;
	const skipped = results.filter((r) => r.status === 'skipped_exists').length;

	console.log('Done.');
	console.log(`generated=${ok} failed=${failed} source_missing=${missing} skipped_exists=${skipped}`);
	console.log('Summary:', path.relative(PROJECT_ROOT, summaryPath).replace(/\\/g, '/'));
}

main();
import fs from 'node:fs';
import path from 'node:path';

type RootCause =
  | 'pass'
  | 'threshold_only'
  | 'parameter_mismatch'
  | 'species_mismatch'
  | 'reaction_count_mismatch'
  | 'rate_constant_mismatch'
  | 'group_mismatch'
  | 'solver_or_steadystate'
  | 'unknown';

interface TrajectoryDiff {
  observable: string;
  maxRelErr: number;
  maxAbsErr: number;
  firstBadTime: number;
  tier: 'pass' | 'fp_drift' | 'derivative_bug' | 'major';
}

interface LayeredReport {
  model: string;
  rootCause: RootCause;
  firstDivergingLayer: 'none' | 'parameters' | 'species' | 'reactions' | 'groups' | 'cdat' | 'gdat';
  parameterDiffs: unknown[];
  speciesDiffs: unknown[];
  reactionDiffs: unknown[];
  groupDiffs: unknown[];
  cdatDiffs: TrajectoryDiff[];
  gdatDiffs: TrajectoryDiff[];
  netFilesCompared: boolean;
  cdatFilesCompared: boolean;
  gdatFilesCompared: boolean;
}

type ModelMethod = 'ode' | 'ssa' | 'nfsim' | 'unspecified';

const ROOT = process.cwd();
const REPORT_JSON = path.join(ROOT, 'artifacts', 'parity_layer_report.all.json');
const OUT_MD = path.join(ROOT, 'artifacts', 'parity_layer_report_full_document.md');
const PUBLIC_MODELS_DIR = path.join(ROOT, 'public', 'models');
const EXAMPLE_MODELS_DIR = path.join(ROOT, 'example-models');

function normalizeKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/^results_/, '')
    .replace(/\.(csv|gdat|bngl|net|cdat)$/i, '')
    .replace(/\(\d+\)$/, '')
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

function listBnglFiles(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) return [];
  return fs.readdirSync(dirPath)
    .filter((f) => f.toLowerCase().endsWith('.bngl'))
    .map((f) => path.join(dirPath, f));
}

function findBestBnglPath(modelName: string, candidates: string[]): string | null {
  const key = normalizeKey(modelName);
  let best: { fp: string; score: number } | null = null;

  for (const fp of candidates) {
    const base = path.basename(fp, '.bngl');
    const ckey = normalizeKey(base);
    let score = 0;
    if (ckey === key) score += 1000;
    if (ckey.includes(key) || key.includes(ckey)) score += 200;
    score -= Math.abs(ckey.length - key.length);
    if (!best || score > best.score) best = { fp, score };
  }

  if (!best || best.score < 40) return null;
  return best.fp;
}

function detectMethodFromBngl(text: string): ModelMethod {
  const lowered = text.toLowerCase();
  const compact = lowered.replace(/\s+/g, '');

  const isNf = compact.includes("method=>'nf'")
    || compact.includes('method=>"nf"')
    || compact.includes("method=>'nfsim'")
    || compact.includes('method=>"nfsim"')
    || /simulate\s*\(\s*\{[^}]*method\s*=>\s*["']nfsim["']/.test(lowered);
  if (isNf) return 'nfsim';

  const isSsa = compact.includes("method=>'ssa'")
    || compact.includes('method=>"ssa"')
    || /simulate\s*\(\s*\{[^}]*method\s*=>\s*["']ssa["']/.test(lowered);
  if (isSsa) return 'ssa';

  const isOde = /simulate_ode\s*\(/.test(lowered)
    || /simulate\s*\(\s*\{[^}]*method\s*=>\s*["']ode["']/.test(lowered);
  if (isOde) return 'ode';

  return 'unspecified';
}

function worstTrajectoryError(r: LayeredReport): number | null {
  const c = r.cdatDiffs[0]?.maxRelErr;
  const g = r.gdatDiffs[0]?.maxRelErr;
  const vals = [c, g].filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  if (vals.length === 0) return null;
  return Math.max(...vals);
}

function countByRoot(rows: LayeredReport[]): Record<RootCause, number> {
  const out: Record<RootCause, number> = {
    pass: 0,
    threshold_only: 0,
    parameter_mismatch: 0,
    species_mismatch: 0,
    reaction_count_mismatch: 0,
    rate_constant_mismatch: 0,
    group_mismatch: 0,
    solver_or_steadystate: 0,
    unknown: 0,
  };
  for (const r of rows) out[r.rootCause] += 1;
  return out;
}

function formatPct(count: number, total: number): string {
  if (total <= 0) return '0.0%';
  return `${((count / total) * 100).toFixed(1)}%`;
}

function main(): void {
  if (!fs.existsSync(REPORT_JSON)) {
    throw new Error(`Missing report JSON: ${REPORT_JSON}`);
  }

  const reports = JSON.parse(fs.readFileSync(REPORT_JSON, 'utf8')) as LayeredReport[];
  const bnglCandidates = [...listBnglFiles(PUBLIC_MODELS_DIR), ...listBnglFiles(EXAMPLE_MODELS_DIR)];

  const methodByModel = new Map<string, ModelMethod>();
  for (const r of reports) {
    const bnglPath = findBestBnglPath(r.model, bnglCandidates);
    if (!bnglPath) {
      methodByModel.set(r.model, 'unspecified');
      continue;
    }
    const text = fs.readFileSync(bnglPath, 'utf8');
    methodByModel.set(r.model, detectMethodFromBngl(text));
  }

  const allCounts = countByRoot(reports);
  const nfsim = reports.filter((r) => methodByModel.get(r.model) === 'nfsim');
  const deterministic = reports.filter((r) => methodByModel.get(r.model) !== 'nfsim');
  const detCounts = countByRoot(deterministic);

  const detPassLike = detCounts.pass + detCounts.threshold_only;
  const nfsimNames = nfsim.map((r) => r.model).sort((a, b) => a.localeCompare(b));

  const byModelRows = reports
    .map((r) => {
      const method = methodByModel.get(r.model) ?? 'unspecified';
      const ignored = method === 'nfsim' ? 'yes' : 'no';
      const worst = worstTrajectoryError(r);
      const worstText = worst == null ? 'n/a' : worst.toExponential(3);
      return `| ${r.model} | ${method} | ${ignored} | ${r.rootCause} | ${r.firstDivergingLayer} | ${r.netFilesCompared} | ${r.cdatFilesCompared} | ${r.gdatFilesCompared} | ${r.parameterDiffs.length} | ${r.speciesDiffs.length} | ${r.reactionDiffs.length} | ${r.groupDiffs.length} | ${worstText} |`;
    })
    .sort((a, b) => a.localeCompare(b));

  const now = new Date().toISOString();

  const md = [
    '# Layered Parity Results (All 212 Models)',
    '',
    `Generated: ${now}`,
    `Source: ${path.relative(ROOT, REPORT_JSON).replace(/\\/g, '/')}`,
    '',
    '## Scope and interpretation rules',
    '',
    '- Total models analyzed: **212**.',
    '- **NFsim models are marked as ignored for deterministic interpretation** (non-deterministic trajectories).',
    '- **SSA and ODE models are included** in deterministic interpretation.',
    '- A model is considered deterministic-pass if root cause is `pass` or `threshold_only`.',
    '',
    '## Category definitions',
    '',
    '- `pass`: No structural mismatches and no trajectory drift beyond exact tolerance.',
    '- `threshold_only`: No structural mismatches; trajectory differences are only floating-point drift (`1e-10 < rel err <= 1e-4`).',
    '- `parameter_mismatch`: At least one parameter differs with relative error `> 1e-4`.',
    '- `species_mismatch`: Species sets differ between BNG2 and web NET (missing/extra species).',
    '- `reaction_count_mismatch`: Reaction set differs (missing/extra reaction signatures).',
    '- `rate_constant_mismatch`: Matching reaction signatures exist, but at least one rate differs with relative error `> 1e-4`.',
    '- `group_mismatch`: Observable/group entries differ after species mapping.',
    '- `solver_or_steadystate`: NET structure aligns, but CDAT/GDAT has major trajectory divergence (`rel err > 1e-2`) or derivative-level divergence (`1e-4 < rel err <= 1e-2`).',
    '- `unknown`: Divergence detected but not attributable confidently (often missing layer artifacts).',
    '',
    '### Tolerance constants used',
    '',
    '- Exact tolerance (`REL_TOL_EXACT`): `1e-10`',
    '- Solver tolerance (`REL_TOL_SOLVER`): `1e-4`',
    '- Major/bug boundary (`REL_TOL_BUG`): `1e-2`',
    '',
    '## Overall counts (all 212, including NFsim)',
    '',
    `- pass: ${allCounts.pass}`,
    `- threshold_only: ${allCounts.threshold_only}`,
    `- parameter_mismatch: ${allCounts.parameter_mismatch}`,
    `- species_mismatch: ${allCounts.species_mismatch}`,
    `- reaction_count_mismatch: ${allCounts.reaction_count_mismatch}`,
    `- rate_constant_mismatch: ${allCounts.rate_constant_mismatch}`,
    `- group_mismatch: ${allCounts.group_mismatch}`,
    `- solver_or_steadystate: ${allCounts.solver_or_steadystate}`,
    `- unknown: ${allCounts.unknown}`,
    '',
    '## Deterministic interpretation (NFsim ignored; SSA + ODE included)',
    '',
    `- NFsim ignored: ${nfsim.length}`,
    `- Deterministic set size: ${deterministic.length}`,
    `- Deterministic pass-like (pass + threshold_only): ${detPassLike} (${formatPct(detPassLike, deterministic.length)})`,
    `- Deterministic non-pass: ${deterministic.length - detPassLike} (${formatPct(deterministic.length - detPassLike, deterministic.length)})`,
    '',
    '### Deterministic counts by category',
    '',
    `- pass: ${detCounts.pass}`,
    `- threshold_only: ${detCounts.threshold_only}`,
    `- parameter_mismatch: ${detCounts.parameter_mismatch}`,
    `- species_mismatch: ${detCounts.species_mismatch}`,
    `- reaction_count_mismatch: ${detCounts.reaction_count_mismatch}`,
    `- rate_constant_mismatch: ${detCounts.rate_constant_mismatch}`,
    `- group_mismatch: ${detCounts.group_mismatch}`,
    `- solver_or_steadystate: ${detCounts.solver_or_steadystate}`,
    `- unknown: ${detCounts.unknown}`,
    '',
    '### Ignored NFsim models',
    '',
    nfsimNames.length > 0 ? nfsimNames.map((name) => `- ${name}`).join('\n') : '- (none detected)',
    '',
    '## Per-model results (all 212)',
    '',
    '| model | method | nfsim_ignored | root_cause | first_diverging_layer | net_compared | cdat_compared | gdat_compared | param_diffs | species_diffs | reaction_diffs | group_diffs | worst_traj_rel_err |',
    '|---|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...byModelRows,
    '',
  ].join('\n');

  fs.mkdirSync(path.dirname(OUT_MD), { recursive: true });
  fs.writeFileSync(OUT_MD, md, 'utf8');
  console.log(`Wrote ${path.relative(ROOT, OUT_MD).replace(/\\/g, '/')}`);
}

main();

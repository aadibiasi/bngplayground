#!/usr/bin/env node
import { basename, dirname, extname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync, copyFileSync, mkdirSync, existsSync, readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { DEFAULT_BNG2_PATH, DEFAULT_PERL_CMD } from './bngDefaults.js';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, '..');
const defaultOutDir = resolve(projectRoot, 'bng_test_output');

function printHelp() {
  console.log(`Generate GDAT baselines for NFsim models via BNG2.pl.

Usage: node scripts/generate_nf_gdat_refs.mjs [options] <paths...>

Options:
  --out <dir>       Output directory for GDAT files (default: bng_test_output)
  --bng2 <path>     Path to BNG2.pl (default: env BNG2_PATH or bundled path)
  --perl <cmd>      Perl executable to invoke (default: env PERL_CMD or perl)
  --seed <number>   Seed for NFsim (injected into simulate_nf if missing)
  --all             Include BNGL files without simulate_nf (default: only simulate_nf)
  --help            Show this message

Notes:
  - Adds get_final_state=>0 to simulate_nf if missing to avoid requiring .species output.
  - Adds seed=>N to simulate_nf if missing when --seed is provided.
`);
}

function parseArgs(argv) {
  const args = {
    outDir: defaultOutDir,
    bng2: process.env.BNG2_PATH || DEFAULT_BNG2_PATH,
    perl: process.env.PERL_CMD || DEFAULT_PERL_CMD,
    seed: undefined,
    onlyNF: true,
    targets: []
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    switch (token) {
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      case '--out':
        args.outDir = resolve(process.cwd(), argv[++i] ?? '');
        break;
      case '--bng2':
        args.bng2 = resolve(process.cwd(), argv[++i] ?? '');
        break;
      case '--perl':
        args.perl = argv[++i] ?? args.perl;
        break;
      case '--seed':
        args.seed = Number(argv[++i]);
        break;
      case '--all':
        args.onlyNF = false;
        break;
      default:
        args.targets.push(resolve(process.cwd(), token));
    }
  }

  return args;
}

function ensureBng2Exists(bng2Path) {
  if (!existsSync(bng2Path)) {
    throw new Error(`BNG2.pl not found at ${bng2Path}. Provide --bng2 or set BNG2_PATH.`);
  }
}

function collectBnGLTargets(targets, onlyNF = true) {
  const files = new Set();
  targets.forEach((target) => {
    let stat;
    try {
      stat = statSync(target);
    } catch {
      console.warn(`Skipping missing path: ${target}`);
      return;
    }

    if (stat.isDirectory()) {
      readdirSync(target).forEach((entry) => {
        if (entry.toLowerCase().endsWith('.bngl')) {
          files.add(resolve(target, entry));
        }
      });
    } else if (stat.isFile()) {
      if (target.toLowerCase().endsWith('.bngl')) {
        files.add(resolve(target));
      } else {
        console.warn(`Ignoring non-BNGL file: ${target}`);
      }
    }
  });
  const sorted = [...files].sort();
  if (!onlyNF) return sorted;

  return sorted.filter((file) => {
    try {
      const content = readFileSync(file, 'utf8');
      return /\bsimulate_nf\s*\(/i.test(content);
    } catch (error) {
      console.warn(`Skipping unreadable file: ${file}`);
      return false;
    }
  });
}

function patchSimulateNf(content, seed) {
  const simulateRegex = /(simulate_nf\s*\(\s*\{)([^}]*)\}(\s*\))/gi;
  return content.replace(simulateRegex, (match, prefix, body, suffix) => {
    const hasGetFinalState = /get_final_state\s*=>/i.test(body);
    const hasSeed = /seed\s*=>/i.test(body);
    let updated = body.trim();

    if (!hasGetFinalState) {
      updated = updated ? `${updated}, get_final_state=>0` : 'get_final_state=>0';
    }

    if (Number.isFinite(seed) && !hasSeed) {
      updated = updated ? `${updated}, seed=>${seed}` : `seed=>${seed}`;
    }

    return `${prefix}${updated}}${suffix}`;
  });
}

function runBngModel(perlCmd, bng2Path, sourcePath, outDir, seed) {
  const tempDir = mkdtempSync(join(tmpdir(), 'bng-nf-'));
  const modelName = basename(sourcePath);
  const modelCopy = join(tempDir, modelName);

  const content = readFileSync(sourcePath, 'utf8');
  const patched = patchSimulateNf(content, seed);
  writeFileSync(modelCopy, patched, 'utf8');

  const result = spawnSync(perlCmd, [bng2Path, modelName], {
    cwd: tempDir,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const stdout = result.stdout?.toString() ?? '';
  const stderr = result.stderr?.toString() ?? '';

  if (stdout.trim().length) {
    console.log(stdout.trim());
  }

  if (result.status !== 0) {
    if (stderr.trim().length) {
      console.error(stderr.trim());
    }
    rmSync(tempDir, { recursive: true, force: true });
    throw new Error(`BNG2.pl failed for ${modelName} with exit code ${result.status ?? 'unknown'}`);
  }

  if (stderr.trim().length) {
    console.warn(stderr.trim());
  }

  const outputs = readdirSync(tempDir);
  const gdatFiles = outputs.filter((file) => file.toLowerCase().endsWith('.gdat'));

  if (gdatFiles.length === 0) {
    rmSync(tempDir, { recursive: true, force: true });
    throw new Error(`No GDAT produced for ${modelName}.`);
  }

  const sourceGdat = join(tempDir, gdatFiles[0]);
  const destName = `${basename(modelName, extname(modelName))}.gdat`;
  const destPath = join(outDir, destName);
  copyFileSync(sourceGdat, destPath);

  rmSync(tempDir, { recursive: true, force: true });
  return destPath;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  ensureBng2Exists(args.bng2);
  mkdirSync(args.outDir, { recursive: true });

  if (!args.targets.length) {
    console.error('No BNGL targets provided.');
    process.exit(1);
  }

  const files = collectBnGLTargets(args.targets, args.onlyNF);
  if (files.length === 0) {
    console.error('No BNGL files found.');
    process.exit(1);
  }

  console.log(`Running BioNetGen for ${files.length} model(s) ...`);

  let success = 0;
  const failures = [];

  files.forEach((file) => {
    try {
      const output = runBngModel(args.perl, args.bng2, file, args.outDir, args.seed);
      if (output) {
        success += 1;
        const rel = relative(projectRoot, output).replace(/\\/g, '/');
        console.log(`  ✔ ${relative(projectRoot, file)} -> ${rel}`);
      }
    } catch (error) {
      failures.push({ file, message: error.message });
      console.error(`  ✖ ${relative(projectRoot, file)} (${error.message})`);
    }
  });

  console.log(`Finished. ${success} GDAT file(s) copied to ${relative(projectRoot, args.outDir)}.`);

  if (failures.length > 0) {
    console.log('\nFailures:');
    failures.forEach((failure) => {
      console.log(`  - ${relative(projectRoot, failure.file)}: ${failure.message}`);
    });
    process.exitCode = 1;
  }
}

main();

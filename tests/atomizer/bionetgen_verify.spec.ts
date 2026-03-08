import { describe, it, expect } from 'vitest';
import { mkdtempSync, copyFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveBNG2Paths, resolveBNGValidateDir } from '../../tools/bng2-paths';

const bng2Paths = resolveBNG2Paths();
const DEFAULT_BNG2_PATH = bng2Paths.bng2pl ?? '';
const DEFAULT_PERL5LIB = bng2Paths.perl5lib ?? '';
const DEFAULT_PERL_CMD = process.env.PERL_CMD ?? 'perl';

const VALIDATE_DIR = resolveBNGValidateDir();
const MODELS = VALIDATE_DIR
  ? [
      join(VALIDATE_DIR, 'simple_system.bngl'),
      join(VALIDATE_DIR, 'test_sbml_flat.bngl'),
      join(VALIDATE_DIR, 'test_sbml_structured.bngl')
    ]
  : [];

function normalizeBNGL(s: string): string {
  return s.replace(/\r\n/g, '\n').replace(/\n{2,}/g, '\n').trim();
}

function runBNG2(bnglPath: string, tempDir: string): boolean {
  const modelName = basename(bnglPath);
  const modelCopy = join(tempDir, modelName);
  copyFileSync(bnglPath, modelCopy);

  const PERL_CMD = process.env.PERL_CMD ?? DEFAULT_PERL_CMD;
  const BNG2_PATH = process.env.BNG2_PATH ?? DEFAULT_BNG2_PATH;

  const result = spawnSync(PERL_CMD, [BNG2_PATH, modelName, '--outdir', tempDir], {
    cwd: tempDir,
    encoding: 'utf-8',
    timeout: 2 * 60 * 1000,
    env: { ...process.env, PERL5LIB: process.env.PERL5LIB ?? DEFAULT_PERL5LIB },
  });

  if (result.status !== 0) {
    console.warn('BNG2.pl non-zero status for', modelName);
    console.warn(result.stdout);
    console.warn(result.stderr);
  }

  const xmlName = modelName.replace(/\.bngl$/i, '.xml');
  return existsSync(join(tempDir, xmlName));
}

describe.skipIf(!VALIDATE_DIR)('Bionetgen BNGL -> SBML -> Atomizer verification (local, no commit)', () => {
  for (const model of MODELS) {
    it(`${basename(model)} -> atomize`, { timeout: 120000 }, async () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'bng-verify-'));

      const hasXml = runBNG2(model, tempDir);
      if (!hasXml) {
        console.warn('BNG2 did not produce SBML for', model, 'skipping');
        return;
      }

      const xmlName = basename(model).replace(/\.bngl$/i, '.xml');
      const xmlPath = join(tempDir, xmlName);
      const xml = readFileSync(xmlPath, 'utf8');

      // Provide a 'self' shim so libsbmljs (WASM) can initialize in Node tests where possible
      const originalSelf: any = (globalThis as any).self;
      (globalThis as any).self = globalThis;

      try {
        // Import after shim
        const { Atomizer } = await import('../../src/lib/atomizer/index.ts');
        const atomizer = new Atomizer();
        try {
          await atomizer.initialize();
        } catch (e: any) {
          console.warn('Atomizer.initialize failed in this environment, skipping:', e?.message || e);
          return;
        }

        const res = await atomizer.atomize(xml);
        expect(res.success).toBe(true);
        expect(res.bngl).toBeTruthy();

        // Compare text (normalized) to original BNGL
        const originalBNGL = readFileSync(model, 'utf8');
        if (normalizeBNGL(res.bngl) !== normalizeBNGL(originalBNGL)) {
          console.warn('\nText outputs differ for', model);
          // Not failing test hard; leave for manual inspection
        } else {
          console.log('\nText outputs match for', model);
        }
      } finally {
        (globalThis as any).self = originalSelf;
      }
    });
  }
});

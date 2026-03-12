import { existsSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

export function resolveRuleHubRoot(projectRoot: string = process.cwd()): string {
  const fromEnv = process.env.RULEHUB_ROOT?.trim();
  if (fromEnv) {
    const resolved = resolve(fromEnv);
    if (existsSync(resolved)) return resolved;
  }

  const candidates = [
    resolve(projectRoot, '..', 'RuleHub'),
    resolve(process.cwd(), '..', 'RuleHub'),
  ];

  const existing = candidates.find((candidate) => existsSync(candidate));
  return existing ?? candidates[0];
}

export function collectBnglFiles(dir: string, results: string[] = []): string[] {
  if (!existsSync(dir)) return results;

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectBnglFiles(fullPath, results);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.bngl')) {
      results.push(fullPath);
    }
  }

  return results;
}

function normalizeModelKey(raw: string): string {
  return basename(raw)
    .toLowerCase()
    .replace(/\.bngl$/i, '')
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

export function findRuleHubModelPath(modelName: string, projectRoot: string = process.cwd()): string | null {
  const ruleHubRoot = resolveRuleHubRoot(projectRoot);
  const candidateDirs = [
    join(ruleHubRoot, 'Published'),
    join(ruleHubRoot, 'Tutorials'),
    join(ruleHubRoot, 'PyBioNetGen'),
    join(ruleHubRoot, 'Contributed', 'BNGPlayground_Examples'),
    join(ruleHubRoot, 'Contributed', 'BNGPlayground_Validation'),
    join(ruleHubRoot, 'Contributed', 'BNGPlayground_PublicRuntime'),
  ];

  const targetKey = normalizeModelKey(modelName);
  for (const dir of candidateDirs) {
    const files = collectBnglFiles(dir);
    const found = files.find((filePath) => normalizeModelKey(filePath) === targetKey);
    if (found) return found;
  }

  return null;
}
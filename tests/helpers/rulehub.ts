import { existsSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import {
  findRuleHubModelPath as findRuleHubModelPathLocal,
  resolveRuleHubRoot as resolveRuleHubRootLocal,
} from '../../tools/rulehubLocal';

export function resolveRuleHubRoot(projectRoot: string = process.cwd()): string {
  const rootsToProbe = [
    projectRoot,
    resolve(projectRoot, '..'),
    resolve(projectRoot, '..', '..'),
    process.cwd(),
    resolve(process.cwd(), '..'),
  ];

  for (const root of rootsToProbe) {
    const candidate = resolveRuleHubRootLocal(root);
    if (candidate && existsSync(candidate)) return candidate;
  }

  // Last fallback for compatibility with callers that immediately join subpaths.
  return resolve(projectRoot, '..', 'RuleHub');
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
  const rootsToProbe = [
    projectRoot,
    resolve(projectRoot, '..'),
    resolve(projectRoot, '..', '..'),
    process.cwd(),
    resolve(process.cwd(), '..'),
  ];

  for (const root of rootsToProbe) {
    const manifestAware = findRuleHubModelPathLocal(root, modelName);
    if (manifestAware && existsSync(manifestAware)) return manifestAware;
  }

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
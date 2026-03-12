
import fs from 'fs';
import path from 'path';

const MODELS_LIST = 'published_models_list.txt';
const VIABLE_OUTPUT = 'viable_published_models.txt';

function resolveRuleHubRoot(projectRoot) {
    const fromEnv = process.env.RULEHUB_ROOT?.trim();
    if (fromEnv) {
        const resolved = path.resolve(fromEnv);
        if (fs.existsSync(resolved)) return resolved;
    }

    const sibling = path.resolve(projectRoot, '..', 'RuleHub');
    return fs.existsSync(sibling) ? sibling : null;
}

function collectBnglFilesRecursive(rootDir, results = []) {
    if (!fs.existsSync(rootDir)) return results;

    for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
        const fullPath = path.join(rootDir, entry.name);
        if (entry.isDirectory()) collectBnglFilesRecursive(fullPath, results);
        else if (entry.isFile() && entry.name.endsWith('.bngl')) results.push(fullPath);
    }

    return results;
}

const PROJECT_ROOT = process.cwd();
const RULEHUB_ROOT = resolveRuleHubRoot(PROJECT_ROOT);
if (!RULEHUB_ROOT) {
    throw new Error('RuleHub checkout not found. Set RULEHUB_ROOT or place RuleHub beside this repo.');
}

const publishedFiles = collectBnglFilesRecursive(path.join(RULEHUB_ROOT, 'Published'));
const publishedByName = new Map(publishedFiles.map((filePath) => [path.basename(filePath, '.bngl'), filePath]));

const EXCLUDED_IN_CONSTANTS = [
  'Erdem_2021', 'Faeder_2003', 'fceri_2003', 'fceri_fyn_lig', 
  'fceri_trimer', 'fceri_fyn', 'fceri_gamma2_asym', 'fceri_gamma2', 
  'Kozer_2013', 'Kozer_2014', 'Barua_2013'
];

const models = fs.readFileSync(MODELS_LIST, 'utf-8').split(',').map(m => m.trim()).filter(m => m);
const viableModels = [];

for (const model of models) {
    if (EXCLUDED_IN_CONSTANTS.includes(model)) continue;

    const bnglPath = publishedByName.get(model);
    if (!bnglPath || !fs.existsSync(bnglPath)) continue;

    const content = fs.readFileSync(bnglPath, 'utf-8');
    const lines = content.split('\n');

    let hasScan = false;
    let hasSSA = false;

    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('#') || trimmed.startsWith('//')) continue;

        if (trimmed.includes('parameter_scan') || trimmed.match(/scan\s*\(/)) {
            hasScan = true;
        }
        if (trimmed.match(/simulate.*method\s*=>\s*["']ssa["']/) || trimmed.includes('simulate_ssa')) {
            hasSSA = true;
        }
    }

    if (!hasScan && !hasSSA) {
        viableModels.push(model);
    }
}

fs.writeFileSync(VIABLE_OUTPUT, viableModels.join(','));
console.log(`Viable Models Count: ${viableModels.length}`);
console.log(`Excluded models due to scan/ssa/slow: ${models.length - viableModels.length}`);

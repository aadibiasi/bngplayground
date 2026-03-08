
import fs from 'fs';
import path from 'path';

const MODELS_LIST = 'published_models_list.txt';
const MODELS_DIR = 'public/models';
const VIABLE_OUTPUT = 'viable_published_models.txt';

const EXCLUDED_IN_CONSTANTS = [
  'Erdem_2021', 'Faeder_2003', 'fceri_2003', 'fceri_fyn_lig', 
  'fceri_trimer', 'fceri_fyn', 'fceri_gamma2_asym', 'fceri_gamma2', 
  'Kozer_2013', 'Kozer_2014', 'Barua_2013'
];

const models = fs.readFileSync(MODELS_LIST, 'utf-8').split(',').map(m => m.trim()).filter(m => m);
const viableModels = [];

for (const model of models) {
    if (EXCLUDED_IN_CONSTANTS.includes(model)) continue;

    const bnglPath = path.join(MODELS_DIR, `${model}.bngl`);
    if (!fs.existsSync(bnglPath)) continue;

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

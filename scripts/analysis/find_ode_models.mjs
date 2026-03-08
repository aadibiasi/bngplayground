/**
 * Scan published-models to find all models with active (uncommented) simulate_ode commands
 * Excludes simulate_nf (stochastic) models
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PUBLISHED_MODELS_DIR = path.join(PROJECT_ROOT, 'published-models');

function findAllBnglFiles(dir) {
    const files = [];

    function scanDir(d) {
        if (!fs.existsSync(d)) return;
        const items = fs.readdirSync(d, { withFileTypes: true });
        for (const item of items) {
            const fullPath = path.join(d, item.name);
            if (item.isDirectory()) {
                scanDir(fullPath);
            } else if (item.name.endsWith('.bngl')) {
                files.push(fullPath);
            }
        }
    }

    scanDir(dir);
    return files;
}

function hasActiveOdeSimulate(content) {
    const lines = content.split('\n');

    for (const line of lines) {
        const trimmed = line.trim();

        // Skip commented lines
        if (trimmed.startsWith('#')) continue;

        // Check for simulate_ode or simulate({...method=>"ode"...}) but NOT simulate_nf
        if (trimmed.includes('simulate_nf')) {
            continue; // This line is stochastic
        }

        // Match simulate_ode or simulate with method=>ode
        if (trimmed.match(/simulate_ode\s*\(/i) ||
            trimmed.match(/simulate\s*\(\s*\{[^}]*method\s*=>\s*["']?ode["']?/i) ||
            (trimmed.match(/simulate\s*\(\s*\{/) && !trimmed.includes('simulate_nf'))) {
            return true;
        }
    }

    return false;
}

function main() {
    console.log('Scanning published-models for active ODE simulation commands...\n');

    const allFiles = findAllBnglFiles(PUBLISHED_MODELS_DIR);
    console.log(`Found ${allFiles.length} BNGL files in published-models\n`);

    const odeModels = [];
    const stochasticModels = [];
    const noSimModels = [];

    for (const filePath of allFiles) {
        const content = fs.readFileSync(filePath, 'utf-8');
        const modelName = path.basename(filePath, '.bngl');

        // Check for any simulate command
        const hasSimNf = content.match(/^\s*simulate_nf\s*\(/m);
        const hasSimOde = content.match(/^\s*simulate_ode\s*\(/m) || content.match(/^\s*simulate\s*\(\s*\{/m);
        const hasCommentedSim = content.match(/^\s*#.*simulate/m);

        // More precise check: look for uncommented simulate_ode
        if (hasActiveOdeSimulate(content)) {
            odeModels.push({ name: modelName, path: filePath });
        } else if (hasSimNf && !hasSimNf[0].trim().startsWith('#')) {
            stochasticModels.push(modelName);
        } else {
            noSimModels.push(modelName);
        }
    }

    console.log('=== Models with active ODE simulation ===');
    odeModels.forEach(m => console.log(`  ✓ ${m.name}`));
    console.log(`\nTotal: ${odeModels.length} ODE-compatible models\n`);

    console.log('=== Stochastic models (simulate_nf) ===');
    stochasticModels.forEach(m => console.log(`  ✗ ${m}`));
    console.log(`\nTotal: ${stochasticModels.length} stochastic models\n`);

    console.log('=== Models without active simulation ===');
    noSimModels.forEach(m => console.log(`  - ${m}`));
    console.log(`\nTotal: ${noSimModels.length} models without simulation\n`);

    // Write the ODE models list to a JSON file for use by other scripts
    const outputPath = path.join(PROJECT_ROOT, 'ode_published_models.json');
    fs.writeFileSync(outputPath, JSON.stringify(odeModels, null, 2));
    console.log(`\nODE model list written to: ${outputPath}`);
}

main();

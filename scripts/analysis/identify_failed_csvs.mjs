/**
 * Identify which example models failed to generate CSV outputs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.resolve(__dirname, '..');
const EXAMPLE_MODELS_DIR = path.join(PROJECT_ROOT, 'example-models');
const WEB_OUTPUT_DIR = path.join(PROJECT_ROOT, 'web_output');

// Get all example model names
const allModels = fs.readdirSync(EXAMPLE_MODELS_DIR)
    .filter(f => f.endsWith('.bngl'))
    .map(f => path.basename(f, '.bngl'))
    .sort();

// Get models that generated CSVs
const generatedModels = fs.readdirSync(WEB_OUTPUT_DIR)
    .filter(f => f.startsWith('results_') && f.endsWith('.csv'))
    .map(f => f.replace(/^results_/, '').replace(/\.csv$/, ''))
    .map(name => {
        // Normalize model names (handle hyphens vs underscores)
        return name.replace(/_/g, '-');
    })
    .sort();

// Find models that didn't generate CSVs
const failedModels = allModels.filter(model => {
    const normalized = model.replace(/_/g, '-');
    return !generatedModels.includes(normalized);
});

console.log('='.repeat(80));
console.log('Failed CSV Generation Analysis');
console.log('='.repeat(80));
console.log(`Total Example Models: ${allModels.length}`);
console.log(`Generated CSVs: ${generatedModels.length}`);
console.log(`Failed: ${failedModels.length}`);
console.log('');

if (failedModels.length > 0) {
    console.log('Models that failed to generate CSVs:');
    failedModels.forEach((model, idx) => {
        console.log(`  ${idx + 1}. ${model}`);
    });
} else {
    console.log('✅ All models successfully generated CSVs!');
}

console.log('');

// Save to file
const reportPath = path.join(PROJECT_ROOT, 'failed_csv_generation.json');
fs.writeFileSync(reportPath, JSON.stringify({
    total: allModels.length,
    generated: generatedModels.length,
    failed: failedModels.length,
    failedModels: failedModels
}, null, 2), 'utf-8');

console.log(`Report saved to: ${reportPath}`);

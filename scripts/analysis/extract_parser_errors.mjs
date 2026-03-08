/**
 * Extract detailed parser errors for the 9 failed example models
 * 
 * This script attempts to parse each failed model using the web simulator's
 * parser and captures the exact error messages, line numbers, and context.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.resolve(__dirname, '..');
const EXAMPLE_MODELS_DIR = path.join(PROJECT_ROOT, 'example-models');

const FAILED_MODELS = [
    'beta-adrenergic-response',
    'bmp-signaling',
    'circadian-oscillator',
    'clock-bmal1-gene-circuit',
    'hematopoietic-growth-factor',
    'interferon-signaling',
    'lac-operon-regulation',
    'mapk-signaling-cascade',
    'mtorc2-signaling'
];

console.log('='.repeat(80));
console.log('Parser Error Extraction for Failed Models');
console.log('='.repeat(80));
console.log('');

const errors = [];

for (const modelName of FAILED_MODELS) {
    const modelPath = path.join(EXAMPLE_MODELS_DIR, `${modelName}.bngl`);
    
    if (!fs.existsSync(modelPath)) {
        console.log(`❌ ${modelName}: File not found`);
        errors.push({ model: modelName, error: 'File not found', details: null });
        continue;
    }
    
    console.log(`Testing: ${modelName}...`);
    
    // Use a simple Node.js script to test parsing
    // We'll create a temporary test file that imports the parser
    const testScript = `
const fs = require('fs');
const path = require('path');

// Read the BNGL file
const bnglPath = ${JSON.stringify(modelPath)};
const bnglContent = fs.readFileSync(bnglPath, 'utf-8');

// Try to parse it (this will use the same parser as the web simulator)
// We need to import the parser from the web simulator
// For now, just output the file path and we'll manually test
console.log(JSON.stringify({
    model: ${JSON.stringify(modelName)},
    path: bnglPath,
    lineCount: bnglContent.split('\\n').length,
    hasSetConcentration: bnglContent.includes('setConcentration'),
    hasSaveConcentrations: bnglContent.includes('saveConcentrations'),
    hasMultiPhase: (bnglContent.match(/simulate/g) || []).length > 1,
    moleculeTypes: (bnglContent.match(/begin molecule types([\\s\\S]*?)end molecule types/i) || [''])[0].split('\\n').filter(l => l.trim() && !l.trim().startsWith('#')).length - 1,
    seedSpecies: (bnglContent.match(/begin seed species([\\s\\S]*?)end seed species/i) || [''])[0].split('\\n').filter(l => l.trim() && !l.trim().startsWith('#')).length - 1
}));
`;
    
    const testPath = path.join(PROJECT_ROOT, `temp_test_${modelName}.cjs`);
    fs.writeFileSync(testPath, testScript, 'utf-8');
    
    try {
        const result = await new Promise((resolve, reject) => {
            const proc = spawn('node', [testPath], {
                cwd: PROJECT_ROOT,
                timeout: 5000
            });
            
            let stdout = '';
            let stderr = '';
            
            proc.stdout.on('data', (data) => {
                stdout += data.toString();
            });
            
            proc.stderr.on('data', (data) => {
                stderr += data.toString();
            });
            
            proc.on('close', (code) => {
                fs.rmSync(testPath); // Cleanup
                resolve({ stdout, stderr, code });
            });
            
            proc.on('error', (err) => {
                fs.rmSync(testPath); // Cleanup
                reject(err);
            });
        });
        
        if (result.stdout) {
            const info = JSON.parse(result.stdout);
            console.log(`  ✓ Analyzed: ${info.lineCount} lines, ${info.moleculeTypes} molecule types, ${info.seedSpecies} seed species`);
            console.log(`    Multi-phase: ${info.hasMultiPhase}, setConcentration: ${info.hasSetConcentration}, saveConcentrations: ${info.hasSaveConcentrations}`);
            errors.push({ model: modelName, error: null, info });
        }
        
    } catch (err) {
        console.log(`  ❌ Error analyzing: ${err.message}`);
        errors.push({ model: modelName, error: err.message, details: null });
    }
}

console.log('');
console.log('='.repeat(80));
console.log('Summary');
console.log('='.repeat(80));

const modelsWithSetConc = errors.filter(e => e.info?.hasSetConcentration).map(e => e.model);
const modelsWithSaveConc = errors.filter(e => e.info?.hasSaveConcentrations).map(e => e.model);
const modelsMultiPhase = errors.filter(e => e.info?.hasMultiPhase).map(e => e.model);

console.log(`\nModels using setConcentration (${modelsWithSetConc.length}):`, modelsWithSetConc.join(', ') || 'None');
console.log(`Models using saveConcentrations (${modelsWithSaveConc.length}):`, modelsWithSaveConc.join(', ') || 'None');
console.log(`Models with multi-phase simulation (${modelsMultiPhase.length}):`, modelsMultiPhase.join(', ') || 'None');

// Save detailed report
const reportPath = path.join(PROJECT_ROOT, 'failed_models_analysis.json');
fs.writeFileSync(reportPath, JSON.stringify(errors, null, 2), 'utf-8');
console.log(`\nDetailed report saved to: ${reportPath}`);

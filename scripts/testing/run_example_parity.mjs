/**
 * Run parity validation for example models only
 * 
 * This script:
 * 1. Generates a comma-separated list of example model names
 * 2. Sets WEB_OUTPUT_MODELS environment variable with explicit list
 * 3. Runs web output generation via Playwright
 * 4. Runs parity comparison via compare_outputs.ts
 * 5. Generates example-specific validation report
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.resolve(__dirname, '..');
const EXAMPLE_MODELS_DIR = path.join(PROJECT_ROOT, 'example-models');
const REPORT_FILE = path.join(PROJECT_ROOT, 'example_models_parity_report.txt');

console.log('='.repeat(80));
console.log('Example Models Parity Validation');
console.log('='.repeat(80));
console.log('');

// Get list of all example model names (without .bngl extension)
const exampleModelNames = fs.readdirSync(EXAMPLE_MODELS_DIR)
    .filter(f => f.endsWith('.bngl'))
    .map(f => path.basename(f, '.bngl'))
    .sort();

console.log(`Found ${exampleModelNames.length} example models`);
console.log('');

// Create comma-separated list for WEB_OUTPUT_MODELS
const modelList = exampleModelNames.join(',');

console.log('Step 1: Generating web outputs for example models...');
console.log('-----------------------------------------------------');

// Run generate:web-output with filtered model list
const isWin = process.platform === 'win32';
const generateCmd = isWin
    ? spawn('cmd.exe', ['/d', '/s', '/c', 'npm run generate:web-output'], {
        cwd: PROJECT_ROOT,
        stdio: 'inherit',
        env: { ...process.env, WEB_OUTPUT_MODELS: modelList }
    })
    : spawn('npm', ['run', 'generate:web-output'], {
        cwd: PROJECT_ROOT,
        stdio: 'inherit',
        env: { ...process.env, WEB_OUTPUT_MODELS: modelList }
    });

await new Promise((resolve, reject) => {
    generateCmd.on('close', (code) => {
        if (code !== 0) {
            console.error(`\nWeb output generation failed with exit code ${code}`);
            reject(new Error(`Generation failed: ${code}`));
        } else {
            console.log('\n✓ Web output generation complete');
            resolve();
        }
    });
    generateCmd.on('error', reject);
});

console.log('');
console.log('Step 2: Running parity comparison...');
console.log('-------------------------------------');

// Run compare_outputs.ts
const compareCmd = isWin
    ? spawn('cmd.exe', ['/d', '/s', '/c', 'npx tsx scripts/compare_outputs.ts'], {
        cwd: PROJECT_ROOT,
        stdio: 'pipe'
    })
    : spawn('npx', ['tsx', 'scripts/compare_outputs.ts'], {
        cwd: PROJECT_ROOT,
        stdio: 'pipe'
    });

let compareOutput = '';
compareCmd.stdout.on('data', (data) => {
    const text = data.toString();
    process.stdout.write(text);
    compareOutput += text;
});

compareCmd.stderr.on('data', (data) => {
    process.stderr.write(data);
});

await new Promise((resolve, reject) => {
    compareCmd.on('close', (code) => {
        console.log(`\n✓ Parity comparison complete (exit code: ${code})`);
        resolve();
    });
    compareCmd.on('error', reject);
});

console.log('');
console.log('Step 3: Generating summary report...');
console.log('--------------------------------------');

// Extract summary from comparison output
const summaryMatch = compareOutput.match(/SUMMARY[\s\S]*$/m);
const summary = summaryMatch ? summaryMatch[0] : 'No summary found';

const reportContent = `
Example Models Parity Validation Report
${'='.repeat(80)}

Total Example Models: ${exampleModelNames.length}

${summary}

Generated: ${new Date().toISOString()}
`.trim();

fs.writeFileSync(REPORT_FILE, reportContent, 'utf-8');
console.log(`\n✓ Report saved to: ${REPORT_FILE}`);

console.log('');
console.log('='.repeat(80));
console.log('Parity Validation Complete');
console.log('='.repeat(80));
console.log(`\nResults saved to: ${REPORT_FILE}`);
console.log('');

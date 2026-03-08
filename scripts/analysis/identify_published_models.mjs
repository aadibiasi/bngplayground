#!/usr/bin/env node
/**
 * Generate GDAT and CSV for published models (non-example models)
 * Focuses on models in public/models/ excluding BNG2_EXCLUDED_MODELS
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

// Excluded models (from constants.ts)
const EXCLUDED_MODELS = new Set([
  'Erdem_2021',
  'Faeder_2003',
  'fceri_2003',
]);

// Example models directory (skip these)
const EXAMPLE_MODELS_DIR = path.join(PROJECT_ROOT, 'example-models');

// Get all .bngl files from public/models
const publicModelsDir = path.join(PROJECT_ROOT, 'public', 'models');
const allModels = fs.readdirSync(publicModelsDir)
  .filter(f => f.endsWith('.bngl'))
  .map(f => path.basename(f, '.bngl'));

// Filter out excluded and example models
const exampleModels = fs.readdirSync(EXAMPLE_MODELS_DIR)
  .filter(f => f.endsWith('.bngl'))
  .map(f => path.basename(f, '.bngl'));

const publishedModels = allModels.filter(m => 
  !EXCLUDED_MODELS.has(m) && !exampleModels.includes(m)
);

console.log(`Total models in public/models: ${allModels.length}`);
console.log(`Example models (skipping): ${exampleModels.length}`);
console.log(`Excluded models: ${Array.from(EXCLUDED_MODELS).join(', ')}`);
console.log(`Published models to process: ${publishedModels.length}`);
console.log('');

// Create models list for web output generation
const modelsListPath = path.join(PROJECT_ROOT, 'published_models_list.txt');
fs.writeFileSync(modelsListPath, publishedModels.join(','), 'utf-8');

console.log(`Saved published models list to: ${modelsListPath}`);
console.log('');
console.log('Published models:', publishedModels.slice(0, 10).join(', '), '...');
console.log('');
console.log('Next step: Run web output generation with:');
console.log(`  $env:WEB_OUTPUT_MODELS='${publishedModels.join(',')}'; npm run generate:web-output`);

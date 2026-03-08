/**
 * Extract Validation Models to Separate BNGL Files
 * 
 * This script parses validation_models.ts and extracts each model's code
 * into a separate .bngl file in public/models/
 */

const fs = require('fs');
const path = require('path');

// Configuration
const VALIDATION_MODELS_PATH = 'validation_models.ts';
const PUBLIC_MODELS_DIR = 'public/models';
const PUBLISHED_MODELS_DIRS = [
  'bionetgen_repo/bionetgen/bng2/Models2',
  'bionetgen_repo/bionetgen/bng2/Validate'
];

// Stats
let created = 0;
let skipped = 0;
let errors = 0;

// Read validation_models.ts
console.log('Reading validation_models.ts...');
const content = fs.readFileSync(VALIDATION_MODELS_PATH, 'utf8');

// Get list of existing model files to avoid duplicates
const existingModels = new Set();

// Check public/models
if (fs.existsSync(PUBLIC_MODELS_DIR)) {
  fs.readdirSync(PUBLIC_MODELS_DIR)
    .filter(f => f.endsWith('.bngl'))
    .forEach(f => existingModels.add(f.replace('.bngl', '').toLowerCase()));
}

// Check published-models directories
PUBLISHED_MODELS_DIRS.forEach(dir => {
  if (fs.existsSync(dir)) {
    fs.readdirSync(dir)
      .filter(f => f.endsWith('.bngl'))
      .forEach(f => existingModels.add(f.replace('.bngl', '').toLowerCase()));
  }
});

console.log(`Found ${existingModels.size} existing BNGL files.`);

// Parse models using regex
// Pattern matches: { name: `model_name`, code: `...code...` }
const modelPattern = /\{\s*name:\s*[`'"]([^`'"]+)[`'"],\s*code:\s*`([\s\S]*?)`\s*\}/g;

let match;
const models = [];

while ((match = modelPattern.exec(content)) !== null) {
  const name = match[1];
  const code = match[2];
  models.push({ name, code });
}

console.log(`Found ${models.length} models in validation_models.ts.`);

// Ensure output directory exists
if (!fs.existsSync(PUBLIC_MODELS_DIR)) {
  fs.mkdirSync(PUBLIC_MODELS_DIR, { recursive: true });
}

// Process each model
models.forEach(({ name, code }) => {
  const normalizedName = name.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  
  // Check if model already exists (case-insensitive)
  if (existingModels.has(normalizedName) || existingModels.has(name.toLowerCase())) {
    console.log(`  [SKIP] ${name} (already exists)`);
    skipped++;
    return;
  }
  
  // Create the BNGL file
  const fileName = `${name}.bngl`;
  const filePath = path.join(PUBLIC_MODELS_DIR, fileName);
  
  try {
    fs.writeFileSync(filePath, code.trim() + '\n');
    console.log(`  [CREATE] ${fileName}`);
    created++;
    existingModels.add(name.toLowerCase());
  } catch (err) {
    console.error(`  [ERROR] ${name}: ${err.message}`);
    errors++;
  }
});

// Summary
console.log('\n--- Summary ---');
console.log(`Total models found: ${models.length}`);
console.log(`Created: ${created}`);
console.log(`Skipped (existing): ${skipped}`);
console.log(`Errors: ${errors}`);
console.log(`\nNew BNGL files created in: ${PUBLIC_MODELS_DIR}/`);

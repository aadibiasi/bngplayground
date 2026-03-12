/**
 * Extract Validation Models to Separate BNGL Files
 * 
 * This script parses validation_models.ts and extracts each model's code
 * into separate BNGL files under the local RuleHub validation area.
 */

const fs = require('fs');
const path = require('path');

// Configuration
const PROJECT_ROOT = process.cwd();
const VALIDATION_MODELS_PATH = path.join(PROJECT_ROOT, 'tests', 'fixtures', 'validation_models.ts');
function resolveRuleHubRoot(projectRoot) {
  const fromEnv = process.env.RULEHUB_ROOT && process.env.RULEHUB_ROOT.trim();
  if (fromEnv) {
    const resolved = path.resolve(fromEnv);
    if (fs.existsSync(resolved)) return resolved;
  }

  const sibling = path.resolve(projectRoot, '..', 'RuleHub');
  return fs.existsSync(sibling) ? sibling : null;
}

const RULEHUB_ROOT = resolveRuleHubRoot(PROJECT_ROOT);
if (!RULEHUB_ROOT) {
  console.error('RuleHub checkout not found. Set RULEHUB_ROOT or place RuleHub beside this repo.');
  process.exit(2);
}

const VALIDATION_OUTPUT_DIR = path.join(RULEHUB_ROOT, 'Contributed', 'BNGPlayground_Validation');
const PUBLISHED_MODELS_DIRS = [
  path.join(RULEHUB_ROOT, 'Published'),
  path.join(RULEHUB_ROOT, 'Contributed', 'BNGPlayground_Examples'),
  path.join(RULEHUB_ROOT, 'Contributed', 'BNGPlayground_Validation'),
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

PUBLISHED_MODELS_DIRS.forEach(dir => {
  if (fs.existsSync(dir)) {
    const stack = [dir];
    while (stack.length) {
      const current = stack.pop();
      if (!current || !fs.existsSync(current)) continue;
      fs.readdirSync(current, { withFileTypes: true }).forEach(entry => {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) stack.push(fullPath);
        else if (entry.isFile() && entry.name.endsWith('.bngl')) existingModels.add(entry.name.replace('.bngl', '').toLowerCase());
      });
    }
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
if (!fs.existsSync(VALIDATION_OUTPUT_DIR)) {
  fs.mkdirSync(VALIDATION_OUTPUT_DIR, { recursive: true });
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
  const modelDir = path.join(VALIDATION_OUTPUT_DIR, name);
  const filePath = path.join(modelDir, fileName);
  
  try {
    fs.mkdirSync(modelDir, { recursive: true });
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
console.log(`\nNew BNGL files created in: ${VALIDATION_OUTPUT_DIR}/`);

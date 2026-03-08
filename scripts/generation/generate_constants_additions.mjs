import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const PROJECT_ROOT = process.cwd();
const CONSTANTS_PATH = path.join(PROJECT_ROOT, 'constants.ts');

// 1. Get full analysis of valid/candidate models
console.log("Analyzing models...");
const analysisJson = execSync('node scripts/analyze_models.mjs').toString();
const analysis = JSON.parse(analysisJson);

// Candidates are 'passed' and 'untestedOde'
const allCandidates = [
    ...analysis.passed,
    ...analysis.untestedOde
];

// 2. Read existing constants.ts to find what's already there
const constantsContent = fs.readFileSync(CONSTANTS_PATH, 'utf8');

// Simple heuristic: check if the Model ID is mentioned in constants.ts
// (Note: This might miss if ID is different from filename, but usually they match or are close)
// Better: check if the filename is imported?
// Imports look like: import barua2013 from './published-models/cell-regulation/Barua_2013.bngl?raw';

const missingModels = [];

for (const model of allCandidates) {
    // Check if model.name (which is filename without extension in analyze_models) is present
    // or if the ID (from contents) is present.
    // analyze_models gives us 'name' (filename base) and 'path' (absolute).
    
    // We want to verify if this model is ALREADY in constants.ts
    // Regex for: id: 'ModelName'
    const idRegex = new RegExp(`id:\\s*['"]${model.name}['"]`);
    
    if (!idRegex.test(constantsContent)) {
        missingModels.push(model);
    }
}

console.log(`Found ${missingModels.length} missing models not in constants.ts`);

// 3. Generate TS Code
const imports = [];
const arrayEntries = [];

const sanitizeIdentifier = (name) => name.replace(/[^a-zA-Z0-9]/g, '_');

for (const model of missingModels) {
    const safeId = sanitizeIdentifier(model.name);
    // Path relative to constants.ts (root) -> ./public/models/...
    // model.path is absolute. 
    // We assume file is in public/models
    
    if (!model.path) {
        console.warn(`Skipping model ${model.name} due to missing path.`);
        continue;
    }
    const relativePath = './' + path.relative(PROJECT_ROOT, model.path).replaceAll('\\', '/');
    const importName = `model_${safeId}`;
    
    imports.push(`import ${importName} from '${relativePath}?raw';`);
    
    // Use extracted description or fallback
    const desc = model.description ? model.description.replace(/['"`]/g, '') : `Validation Model: ${model.name}`;
    
    arrayEntries.push(`  {
    id: '${model.name}',
    name: '${model.name}',
    description: '${desc}',
    code: ${importName},
    tags: ['validation'],
  },`);
}

console.log("\n// --- COPY BELOW TO IMPORTS SECTION ---\n");
console.log(imports.join('\n'));

console.log("\n// --- COPY BELOW TO DEFINE NEW ARRAY ---\n");
console.log(`const INTERNAL_VALIDATION_MODELS: Example[] = [\n${arrayEntries.join('\n')}\n];`);

console.log("\n// --- ADD '...INTERNAL_VALIDATION_MODELS' TO MODEL_CATEGORIES 'Internal Validation Models' list ---");

import { execSync } from 'child_process';
import fs from 'fs';

// Run analysis script
try {
  const output = execSync('node scripts/analyze_models.mjs').toString();
  const data = JSON.parse(output);

  // Merge passed + untestedOde
  const allModels = [...data.passed, ...data.untestedOde].map(m => m.name).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

  // Deduplicate
  const uniqueModels = [...new Set(allModels)];

  const fileContent = `/**
 * Validation Model Names
 * 
 * These models are loaded from public/models/{name}.bngl files.
 * The inline code has been extracted to separate files.
 * 
 * To load a model's code, use: \`fetch('/models/{name}.bngl')\`
 * or \`fs.readFileSync('public/models/{name}.bngl')\` in Node.js scripts.
 */

// All validation models available in public/models/
export const VALIDATION_MODEL_NAMES: string[] = [
${uniqueModels.map(name => `  '${name}',`).join('\n')}
];

// Helper function to get model file path (for browser)
export const getModelPath = (modelName: string): string => 
  \`/models/\${modelName}.bngl\`;

// Helper function to load model code (for use in browser)
export const loadModelCode = async (modelName: string): Promise<string> => {
  const response = await fetch(getModelPath(modelName));
  if (!response.ok) {
    throw new Error(\`Failed to load model \${modelName}: \${response.statusText}\`);
  }
  return await response.text();
};

export const VALIDATION_MODELS: Array<{name: string; code: string}> = []; // Browser-safe export

// Helper to load models in Node.js environment
export const loadModelsFromFiles = async (): Promise<Array<{name: string; code: string}>> => {
  try {
    const fs = await import('fs');
    const path = await import('path');
    
    return VALIDATION_MODEL_NAMES.map(name => {
      const filePath = path.join(process.cwd(), 'public', 'models', \`\${name}.bngl\`);
      const code = fs.readFileSync(filePath, 'utf-8');
      return { name, code };
    });
  } catch (error) {
    console.warn('loadModelsFromFiles is only supported in Node.js environment');
    return [];
  }
};
`;

  fs.writeFileSync('validation_models.ts', fileContent, 'utf8');
  console.log('Successfully wrote validation_models.ts');
} catch (e) {
  console.error(e);
}

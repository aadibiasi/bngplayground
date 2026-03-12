import { execSync } from 'child_process';
import fs from 'fs';

// Run analysis script
try {
  const output = execSync('node scripts/analysis/analyze_models.mjs').toString();
  const data = JSON.parse(output);

  // Merge passed + untestedOde
  const allModels = [...data.passed, ...data.untestedOde].map(m => m.name).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

  // Deduplicate
  const uniqueModels = [...new Set(allModels)];

  const fileContent = `/**
 * Validation Model Names
 * 
 * These models are resolved from the local RuleHub checkout by model name.
 * The inline code has been extracted to separate BNGL fixtures.
 * 
 * Use the generated fixture list together with RuleHub-backed lookup helpers.
 */

// All validation models available via RuleHub-backed fixtures
export const VALIDATION_MODEL_NAMES: string[] = [
${uniqueModels.map(name => `  '${name}',`).join('\n')}
];

export const VALIDATION_MODELS: Array<{name: string; code: string}> = []; // Browser-safe export

// Helper to load models in Node.js environment
export const loadModelsFromFiles = async (): Promise<Array<{name: string; code: string}>> => {
  try {
    const lookup = await import('../../tools/rulehubLocal');
    
    return VALIDATION_MODEL_NAMES.map(name => {
      const filePath = lookup.findRuleHubModelPath(process.cwd(), name);
      if (!filePath) throw new Error(\`Model not found in local RuleHub checkout: \${name}\`);
      const code = fs.readFileSync(filePath, 'utf-8');
      return { name, code };
    });
  } catch (error) {
    console.warn('loadModelsFromFiles requires a local RuleHub checkout');
    return [];
  }
};
`;

  fs.writeFileSync('tests/fixtures/validation_models.ts', fileContent, 'utf8');
  console.log('Successfully wrote tests/fixtures/validation_models.ts');
} catch (e) {
  console.error(e);
}

#!/usr/bin/env node

/**
 * Generate reference GDAT files for models without reference files
 * Uses BioNetGen (BNG2.pl) to simulate the models
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const MODELS_TO_GENERATE = [
  'Kesseler_2013.bngl',
  'Kozer_2013.bngl',
  'Kozer_2014.bngl',
  'mapk-dimers.bngl',
  'mapk-monomers.bngl',
  'wnt-beta-catenin-signaling.bngl'
];

const WORKSPACE_ROOT = process.cwd();
const MODELS_DIR = path.join(WORKSPACE_ROOT, 'public', 'models');
const GDAT_OUTPUT_DIR = path.join(WORKSPACE_ROOT, 'gdat_comparison_output');
const BNG2_EXECUTABLE = path.join(WORKSPACE_ROOT, 'bionetgen_repo', 'bionetgen', 'bng2', 'BNG2.pl');

// Ensure output directory exists
if (!fs.existsSync(GDAT_OUTPUT_DIR)) {
  fs.mkdirSync(GDAT_OUTPUT_DIR, { recursive: true });
}

console.log('================================================================================');
console.log('Generating Reference GDAT Files for NOREF Models');
console.log('================================================================================\n');

let successCount = 0;
let failCount = 0;

for (const modelFile of MODELS_TO_GENERATE) {
  const modelPath = path.join(MODELS_DIR, modelFile);
  
  if (!fs.existsSync(modelPath)) {
    console.log(`❌ Model not found: ${modelFile}`);
    failCount++;
    continue;
  }

  console.log(`Processing: ${modelFile}`);
  
  const modelName = modelFile.replace('.bngl', '');
  const tempDir = path.join(WORKSPACE_ROOT, `temp_bng_${modelName}`);
  
  try {
    // Create temp directory for BNG2 output
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Run BNG2
    console.log(`  Running BNG2 for ${modelFile}...`);
    const cmd = `perl "${BNG2_EXECUTABLE}" "${modelPath}"`;
    
    try {
      execSync(cmd, { 
        cwd: tempDir,
        stdio: 'pipe',
        timeout: 120000 // 2 minute timeout per model
      });
    } catch (e) {
      console.log(`  ⚠️ BNG2 execution note: ${(e as Error).message}`);
      // BNG2 may exit with non-zero status even on success, so don't fail yet
    }

    // Check if .gdat file was created
    const gdatFiles = fs.readdirSync(tempDir).filter(f => f.endsWith('.gdat'));
    
    if (gdatFiles.length > 0) {
      const gdatFile = gdatFiles[0];
      const sourceGdat = path.join(tempDir, gdatFile);
      const targetGdat = path.join(GDAT_OUTPUT_DIR, `${modelName}.gdat`);
      
      // Copy GDAT file to reference directory
      fs.copyFileSync(sourceGdat, targetGdat);
      console.log(`  ✅ Generated: ${modelName}.gdat`);
      successCount++;
    } else {
      console.log(`  ❌ No .gdat file generated for ${modelFile}`);
      failCount++;
    }

    // Clean up temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });

  } catch (error) {
    console.log(`  ❌ Error processing ${modelFile}: ${(error as Error).message}`);
    failCount++;
    
    // Clean up on error
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

console.log('\n================================================================================');
console.log(`Summary: ${successCount} generated, ${failCount} failed`);
console.log('================================================================================');

if (failCount === 0) {
  console.log('✅ All reference files generated successfully!');
  process.exit(0);
} else {
  console.log(`⚠️ ${failCount} model(s) failed to generate reference files`);
  process.exit(1);
}

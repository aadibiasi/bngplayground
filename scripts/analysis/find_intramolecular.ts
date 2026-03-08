/**
 * Script to identify models that use TRUE intramolecular reactions
 * These are reactions where sites within a SINGLE molecule bind to each other (ring closure)
 * 
 * In native bng2.pl:
 * - Intramolecular vs intermolecular reactions are distinguished by rule structure
 * - A rule like "A(s1,s2) -> A(s1!1,s2!1)" forms internal bonds (ring closure)
 * - A rule like "A(s1).B(s2) -> A(s1!1).B(s2!1)" forms intermolecular bonds
 * - If products use "+" they must produce separate species (no ring closure)
 * 
 * The web simulator's behavior of "skipping intramolecular mapping when rule forbids it"
 * is CORRECT and matches native bng2.pl behavior.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PUBLISHED_MODELS_DIR = path.resolve(__dirname, '../published-models');
const EXAMPLE_MODELS_DIR = path.resolve(__dirname, '../example-models');

interface IntramolecularInfo {
  model: string;
  hasTrueIntramolecular: boolean;
  hasMoveConnected: boolean;
  intramolecularRules: string[];
}

/**
 * Check if a single molecule pattern forms an internal bond
 * e.g., A(s1,s2) -> A(s1!1,s2!1) means s1 and s2 on the same A molecule bind together
 */
function hasSingleMoleculeInternalBond(pattern: string): boolean {
  // Match molecule patterns like A(sites...) 
  // We want to find cases where a SINGLE molecule has bonds connecting its own sites
  
  // Split by '.' to get individual molecules in the pattern
  const molecules = pattern.split('.');
  
  for (const mol of molecules) {
    // Extract site info from molecule
    const siteMatch = mol.match(/\w+\(([^)]*)\)/);
    if (!siteMatch) continue;
    
    const sites = siteMatch[1];
    
    // Find all bond indices in this single molecule's sites
    const bondMatches = sites.match(/!(\d+)/g);
    if (!bondMatches) continue;
    
    // If the same bond index appears twice in ONE molecule's sites, 
    // that's intramolecular binding
    const bondCounts: Record<string, number> = {};
    for (const match of bondMatches) {
      bondCounts[match] = (bondCounts[match] || 0) + 1;
    }
    
    for (const count of Object.values(bondCounts)) {
      if (count >= 2) {
        return true; // Same bond appears twice in one molecule = intramolecular
      }
    }
  }
  
  return false;
}

function analyzeModel(filePath: string): IntramolecularInfo | null {
  const modelName = path.basename(filePath);
  const bnglCode = fs.readFileSync(filePath, 'utf8');

  // Skip VCell-specific models
  if (bnglCode.includes('begin anchors')) {
    return null;
  }

  const info: IntramolecularInfo = {
    model: modelName,
    hasTrueIntramolecular: false,
    hasMoveConnected: false,
    intramolecularRules: []
  };

  // Check for MoveConnected keyword
  if (/MoveConnected/i.test(bnglCode)) {
    info.hasMoveConnected = true;
  }

  // Extract reaction rules block
  const rulesMatch = bnglCode.match(/begin\s+reaction\s*rules([\s\S]*?)end\s+reaction\s*rules/i);
  if (!rulesMatch) return info;

  const rulesBlock = rulesMatch[1];
  const lines = rulesBlock.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Parse the rule to get reactants and products
    const arrowMatch = trimmed.match(/(.+?)\s*(<->|->)\s*(.+)/);
    if (!arrowMatch) continue;

    const reactants = arrowMatch[1];
    const products = arrowMatch[3];
    
    // Check if products have single molecules with internal bonds
    // that weren't present in reactants
    if (hasSingleMoleculeInternalBond(products) && !hasSingleMoleculeInternalBond(reactants)) {
      info.hasTrueIntramolecular = true;
      info.intramolecularRules.push(trimmed.substring(0, 120));
    }
    
    // Also check reactants for reverse direction
    if (hasSingleMoleculeInternalBond(reactants)) {
      info.hasTrueIntramolecular = true;
      if (!info.intramolecularRules.some(r => r.startsWith(trimmed.substring(0, 50)))) {
        info.intramolecularRules.push(trimmed.substring(0, 120));
      }
    }
  }

  return info;
}

function getBnglFiles(dir: string): string[] {
  let files: string[] = [];
  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      files = files.concat(getBnglFiles(fullPath));
    } else if (item.name.endsWith('.bngl')) {
      files.push(fullPath);
    }
  }
  return files;
}

async function run() {
  const files = [
    ...getBnglFiles(PUBLISHED_MODELS_DIR),
    ...getBnglFiles(EXAMPLE_MODELS_DIR)
  ];

  console.log(`Analyzing ${files.length} models for TRUE intramolecular reactions...\n`);
  console.log('True intramolecular = bonds forming WITHIN a single molecule (ring closure)\n');

  const modelsWithIntramolecular: IntramolecularInfo[] = [];
  
  for (const file of files) {
    const info = analyzeModel(file);
    if (info && (info.hasTrueIntramolecular || info.hasMoveConnected)) {
      modelsWithIntramolecular.push(info);
    }
  }

  console.log('=== Models with TRUE intramolecular reactions ===\n');
  
  for (const info of modelsWithIntramolecular) {
    console.log(`⚠️  ${info.model}`);
    if (info.hasMoveConnected) console.log('   - Uses MoveConnected keyword');
    if (info.hasTrueIntramolecular) console.log('   - Has intramolecular bond formation (ring closure)');
    if (info.intramolecularRules.length > 0) {
      console.log('   Example rules:');
      for (const rule of info.intramolecularRules.slice(0, 3)) {
        console.log(`     ${rule}${rule.length >= 120 ? '...' : ''}`);
      }
    }
    console.log();
  }

  console.log(`\n--- Summary ---`);
  console.log(`Total models analyzed: ${files.length}`);
  console.log(`Models with TRUE intramolecular reactions: ${modelsWithIntramolecular.length}`);
  console.log(`\nNote: These models have rules that form bonds within a single molecule.`);
  console.log(`This is valid BNGL syntax and is supported by native bng2.pl.`);
  console.log(`The web simulator correctly handles these by checking if intramolecular`);
  console.log(`mapping is appropriate for each rule application.`);
}

run();

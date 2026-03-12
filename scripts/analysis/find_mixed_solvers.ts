
import fs from 'fs';
import path from 'path';
import { listAllRuleHubModelFiles } from '../../tools/rulehubLocal';

const PROJECT_ROOT = process.cwd();

function analyzeFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    
    let hasOde = false;
    let hasSsa = false;
    let ssaActive = false;
    let odeActive = false;

    // improved matching
    // simulate({method=>"ode"}) OR simulate_ode()
    // simulate({method=>"ssa"}) OR simulate_ssa()
    // allow spaces around => and quotes
    
    lines.forEach((line, index) => {
        const trimmed = line.trim();
        const isCommented = trimmed.startsWith('#');
        
        // Check ODE
        if (
            /simulate_ode/i.test(line) || 
            /method\s*=>\s*["']ode["']/i.test(line)
        ) {
            hasOde = true;
            if (!isCommented) odeActive = true;
        }
        
        // Check SSA
        if (
            /simulate_ssa/i.test(line) || 
            /method\s*=>\s*["']ssa["']/i.test(line)
        ) {
            hasSsa = true;
            if (!isCommented) ssaActive = true;
        }
    });

    return { hasOde, hasSsa, odeActive, ssaActive };
}

function main() {
    const files = listAllRuleHubModelFiles(PROJECT_ROOT).map((entry) => entry.filePath);
    
    console.log(`Scanning ${files.length} BNGL files...`);
    
    const candidates = [];

    files.forEach(file => {
        const result = analyzeFile(file);
        // We want models that have BOTH present in some form
        if (result.hasOde && result.hasSsa) {
            candidates.push({
                file: path.basename(file),
                path: file,
                ode: result.odeActive ? "Active" : "Commented",
                ssa: result.ssaActive ? "Active" : "Commented"
            });
        }
    });

    fs.writeFileSync('mixed_models_scan.json', JSON.stringify(candidates, null, 2));
    console.log(`Found ${candidates.length} mixed models. Saved to mixed_models_scan.json`);
}

main();

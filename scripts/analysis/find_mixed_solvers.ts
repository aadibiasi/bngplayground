
import fs from 'fs';
import path from 'path';

// Directories to scan
const DIRS = [
    path.resolve('public/models'),
    path.resolve('published-models'),
    path.resolve('example-models') // Include this to be thorough
];

function getBnglFiles(dir, fileList = []) {
    if (!fs.existsSync(dir)) return fileList;
    const files = fs.readdirSync(dir);
    files.forEach(file => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
            getBnglFiles(filePath, fileList);
        } else if (file.endsWith('.bngl')) {
            fileList.push(filePath);
        }
    });
    return fileList;
}

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
    let files = [];
    DIRS.forEach(dir => getBnglFiles(dir, files));
    // unique files
    files = [...new Set(files)];
    
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

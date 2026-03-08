import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.join(__dirname, '..');
const MODELS_DIR = path.join(PROJECT_ROOT, 'public/models');
const VALIDATION_FILE = path.join(PROJECT_ROOT, 'validation_models.ts');
const CONSTANTS_FILE = path.join(PROJECT_ROOT, 'constants.ts');

// 1. Get all model files
const files = fs.readdirSync(MODELS_DIR)
    .filter(f => f.endsWith('.bngl'))
    .map(f => f.slice(0, -5)); // remove .bngl

// 2. Get Validated models
const valContent = fs.readFileSync(VALIDATION_FILE, 'utf8');
const valMatches = valContent.matchAll(/'([^']+)'/g);
const validated = new Set([...valMatches].map(m => m[1]));

// 3. Get Excluded models
const constContent = fs.readFileSync(CONSTANTS_FILE, 'utf8');
// Extract the set content
const excludedMatch = constContent.match(/const BNG2_EXCLUDED_MODELS = new Set\(\[([\s\S]*?)\]\);/);
let excluded = new Set();
if (excludedMatch) {
    const rawList = excludedMatch[1];
    const matches = rawList.matchAll(/'([^']+)'/g);
    excluded = new Set([...matches].map(m => m[1]));
}

// 4. Analyze each model
const results = files.map(name => {
    const filePath = path.join(MODELS_DIR, `${name}.bngl`);
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    
    let hasOde = false;
    let hasSimulate = false;
    
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        
        // Check for simulate commands
        // Matches: simulate_ode
        // Matches: simulate({method=>"ode"}) or simulate({method=>'ode'})
        // Matches: simulate({..., method=>"ode", ...})
        
        if (trimmed.includes('simulate')) {
            hasSimulate = true;
            
            // Check for ODE specifically
            // 1. Exact 'simulate_ode' command
            // Match simulate_ode followed by ( or { or space
            if (/simulate_ode\s*[\(\{]/.test(trimmed)) {
                hasOde = true;
                break;
            }
            
            // Match simulate_nf followed by ( or { or space
            if (/simulate_nf\s*[\(\{]/.test(trimmed)) {
                 // It's a simulation, but distinct. We'll mark hasSimulate=true.
                 // We don't mark hasOde=true.
                 // The 'reason' logic later will check for this.
                 hasSimulate = true;
                 // We can break here if we only care about hasOde, but we want to capture the reason.
                 // Actually, the loop breaks if hasOde is found. If simulate_nf is found, we should flag it so 'reason' knows.
            }
            
            // 2. simulate({... method=>"ode" ...})
            if (/^simulate\s*\(\s*\{/.test(trimmed)) {
                 if (/method\s*=>\s*["']ode["']/.test(trimmed)) {
                    hasOde = true;
                    break; 
                 }
            }
        }
    }

    let reason = "No simulate action";
    if (hasOde) reason = "Has ODE";
    else if (hasSimulate) {
        // Try to find what kind of simulate
        const simLines = lines.filter(l => l.includes('simulate') && !l.trim().startsWith('#'));
        if (simLines.some(l => /method\s*=>\s*["']ssa["']/.test(l))) reason = "SSA Simulation";
        else if (simLines.some(l => /method\s*=>\s*["']nf["']/.test(l))) reason = "NFsim Simulation";
        else if (simLines.some(l => /simulate_nf/.test(l))) reason = "NFsim Simulation"; // Explicit command
        else if (simLines.some(l => /method\s*=>\s*["']psa["']/.test(l))) reason = "Parameter Scan (PSA)";
        else reason = "Other Simulation";
    } else {
        // Check for other actions
        const code = lines.join('\n');
        if (code.includes('parameter_scan') || code.includes('bifurcation')) reason = "Parameter Scan";
        else if (code.includes('writeXML')) reason = "XML Output Only";
        else if (code.includes('writeSBML')) reason = "SBML Output Only";
        else if (code.includes('begin species')) reason = "No Actions Block"; // simplified guess
    }
    
    let description = "No description available";
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('#')) {
            description = trimmed.replace(/^#\s*/, '');
            break;
        }
    }

    let status = 'Other';
    if (validated.has(name)) status = 'Passed';
    else if (excluded.has(name)) status = 'Excluded';
    
    return { name, status, hasOde, hasSimulate, reason, description, path: filePath };
});

// 5. Group and Print
const passed = results.filter(r => r.status === 'Passed');
const excluded_list = results.filter(r => r.status === 'Excluded');
const others = results.filter(r => r.status === 'Other');

const untestedOde = others.filter(r => r.hasOde);
const noOde = others.filter(r => !r.hasOde);

console.log(JSON.stringify({
    stats: {
        total: results.length,
        passed: passed.length,
        excluded: excluded_list.length,
        untestedOde: untestedOde.length,
        otherNoOde: noOde.length
    },
    passed: passed.map(r => ({name: r.name, description: r.description, path: r.path})),
    untestedOde: untestedOde.map(r => ({name: r.name, description: r.description, path: r.path})),
    noOde: noOde.map(r => ({name: r.name, reason: r.reason, description: r.description, path: r.path}))
}, null, 2));


import { runNFsimSimulation } from '@bngplayground/engine';
import { parseBNGL } from '../services/parseBNGL';
import * as fs from 'fs';
import * as path from 'path';

function resolveRuleHubRoot(): string {
    const fromEnv = process.env.RULEHUB_ROOT?.trim();
    if (fromEnv) return path.resolve(fromEnv);
    return path.resolve(process.cwd(), '..', 'RuleHub');
}

async function run() {
    const bnglPath = path.join(resolveRuleHubRoot(), 'Tutorials', 'General', 'polymer', 'polymer.bngl');
    const bnglCode = fs.readFileSync(bnglPath, 'utf-8');
    const model = parseBNGL(bnglCode);
    
    console.log('Running web simulation (SSA fallback)...');
    const results = await runNFsimSimulation(model, {
        t_end: 0.01,
        n_steps: 10,
        seed: 1 // Match a seed if possible, though SSA seeds might differ
    });
    
    const headers = ['time', ...model.observables!.map(o => o.name)];
    let gdatContent = '#' + headers.join(' ') + '\n';
    
    results.data.forEach(row => {
        const vals = headers.map(h => row[h]);
        gdatContent += vals.join(' ') + '\n';
    });
    
    const outPath = path.resolve('temp_parity_polymer', 'polymer_web_ssa.gdat');
    fs.writeFileSync(outPath, gdatContent);
    console.log(`Web SSA output saved to: ${outPath}`);
}

run().catch(console.error);

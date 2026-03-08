
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const REPORT_PATH = 'C:/Users/Achyudhan/.gemini/antigravity/brain/a33d9450-7b3c-4c15-a02f-53f7c9eae367/validation_report.md';
const BNG2_PATH = process.env.BNG2_PATH || 'C:\\Users\\Achyudhan\\anaconda3\\envs\\Research\\Lib\\site-packages\\bionetgen\\bng-win\\BNG2.pl';
const PERL_CMD = process.env.PERL_CMD || 'perl';
const REPO_DIRS = [
    path.resolve('public/models')
];

const EXCLUDE_MODELS = ['Kozer_2014'];

if (!fs.existsSync(BNG2_PATH)) {
    console.error(`BNG2 not found at ${BNG2_PATH}`);
    process.exit(1);
}

const content = fs.readFileSync(REPORT_PATH, 'utf8');
const lines = content.split('\n');

const missingModels: string[] = [];

lines.forEach(line => {
    if (line.includes('MISSING_REFERENCE')) {
        const parts = line.split('|');
        if (parts.length >= 3) {
            const name = parts[2].trim();
            if (name && !EXCLUDE_MODELS.includes(name)) {
                missingModels.push(name);
            }
        }
    }
});

console.log(`Found ${missingModels.length} missing references:`, missingModels);

for (const model of missingModels) {
    let bnglPath = null;
    let foundDir = null;

    // Try finding the model file
    for (const dir of REPO_DIRS) {
        const candidate = path.join(dir, `${model}.bngl`);
        if (fs.existsSync(candidate)) {
            bnglPath = candidate;
            foundDir = dir;
            break;
        }
    }

    if (!bnglPath) {
        console.error(`Could not find BNGL file for ${model}`);
        const nosourceMarker = path.join(path.resolve('bng_test_output'), `${model}.nosource`);
        fs.writeFileSync(nosourceMarker, 'BNGL source file not found in search paths');
        continue;
    }

    console.log(`Generating reference for ${model} from ${bnglPath}...`);
    try {
        const cmd = `${PERL_CMD} "${BNG2_PATH}" "${bnglPath}"`;
        console.log(`Running: ${cmd}`);

        let success = true;
        let errorOutput = '';
        try {
            if (foundDir && bnglPath) {
                execSync(cmd, { cwd: foundDir, stdio: [0, 'pipe', 'pipe'] });
            }
        } catch (e: any) {
            console.error(`❌ BNG2 execution failed for ${model}`);
            success = false;
            errorOutput = e.stderr?.toString() || e.stdout?.toString() || e.message;
        }

        const gdatFile = foundDir ? path.join(foundDir, `${model}.gdat`) : '';
        const targetGdat = path.join(path.resolve('bng_test_output'), `${model}.gdat`);
        const failMarker = path.join(path.resolve('bng_test_output'), `${model}.bngfail`);

        if (success && fs.existsSync(gdatFile)) {
            console.log(`✓ successfully generated GDAT for ${model}`);
            fs.copyFileSync(gdatFile, targetGdat);
            if (fs.existsSync(failMarker)) fs.unlinkSync(failMarker);
            const nosourceMarker = path.join(path.resolve('bng_test_output'), `${model}.nosource`);
            if (fs.existsSync(nosourceMarker)) fs.unlinkSync(nosourceMarker);
        } else {
            console.log(`⚠️ Marking ${model} as BNG_FAILED`);
            fs.writeFileSync(failMarker, errorOutput || 'BNG2.pl produced no GDAT output');
            if (fs.existsSync(targetGdat)) fs.unlinkSync(targetGdat);
        }

    } catch (e: any) {
        console.error(`❌ Failed script logic for ${model}:`, e.message);
    }
}

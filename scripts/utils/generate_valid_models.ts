
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const REPO_ROOT = path.resolve(process.cwd(), 'bionetgen_repo');
const BNG2_PATH = path.resolve(process.cwd(), 'bionetgen_repo/bionetgen/bng2/BNG2.pl');
const OUTPUT_FILE = path.resolve(process.cwd(), 'tests/bionetgen-repo/valid_models.json');

// Helper to find all BNGL files recursively
function findBNGLFiles(dir: string, fileList: string[] = []) {
    try {
        const files = fs.readdirSync(dir);
        files.forEach(file => {
            const filePath = path.join(dir, file);
            const stat = fs.statSync(filePath);
            if (stat.isDirectory()) {
                findBNGLFiles(filePath, fileList);
            } else {
                if (path.extname(file) === '.bngl') {
                    fileList.push(filePath);
                }
            }
        });
    } catch (e) {
        console.warn(`Error scanning directory ${dir}:`, e);
    }
    return fileList;
}

function main() {
    console.log('Searching for BNGL models...');
    const specificDir = path.join(REPO_ROOT, 'bionetgen/bng2'); // Focus on bng2 folder
    const files = findBNGLFiles(specificDir);
    const validModels: string[] = [];
    const failedModels: string[] = [];

    console.log(`Found ${files.length} models. Validating with BNG2.pl...`);

    files.forEach((file, index) => {
        try {
            // Run BNG2.pl --check
            execSync(`perl "${BNG2_PATH}" --check "${file}"`, { stdio: 'ignore' });
            validModels.push(file);
            process.stdout.write('.');
        } catch (e) {
            failedModels.push(file);
            process.stdout.write('x');
        }
        if ((index + 1) % 50 === 0) console.log(` (${index + 1}/${files.length})`);
    });

    console.log('\nValidation complete.');
    console.log(`Valid: ${validModels.length}`);
    console.log(`Failed: ${failedModels.length}`);

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(validModels, null, 2));
    console.log(`Written valid models to ${OUTPUT_FILE}`);
}

main();

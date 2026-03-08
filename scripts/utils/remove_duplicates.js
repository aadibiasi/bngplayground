import fs from 'fs';
import path from 'path';
const root = path.join(process.cwd(), 'public', 'models');
const re = /-(\d+)\.bngl$/i;
const files = fs.readdirSync(root).filter(f => re.test(f));
if (files.length === 0) {
  console.log('No duplicates found.');
  process.exit(0);
}
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const outdir = path.join('artifacts', 'duplicates-' + ts);
fs.mkdirSync(outdir, { recursive: true });
for (const f of files) {
  fs.renameSync(path.join(root, f), path.join(outdir, f));
}
fs.writeFileSync(path.join(outdir, 'moved_files.txt'), files.join('\n'));
const rptPath = 'artifacts/normalize_public_models_report.json';
let report = {};
try { report = JSON.parse(fs.readFileSync(rptPath)); } catch (e) {}
report.removedDuplicates = files.length;
report.removedDuplicatesDir = outdir;
fs.writeFileSync(rptPath, JSON.stringify(report, null, 2));
console.log(`Moved ${files.length} duplicates to ${outdir}`);

import fs from 'fs';
const file = process.argv[2];
if (!file) {
    console.error('Usage: node scripts/normalize.js <file>');
    process.exit(1);
}
const content = fs.readFileSync(file, 'utf8');
const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
const lines = normalized.split('\n');
const trimmed = lines.map(line => line.trimEnd()).join('\n');
fs.writeFileSync(file, trimmed);
console.log(`Normalized and trimmed ${file}`);

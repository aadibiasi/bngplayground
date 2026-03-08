import fs from 'fs';
const file = process.argv[2] || 'src/validation_models.ts';
const content = fs.readFileSync(file, 'utf8');
// Normalize line endings to \n and then split
const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
const trimmed = lines.map(line => line.trimEnd()).join('\n');
fs.writeFileSync(file, trimmed);
console.log(`Normalized and trimmed ${file}`);

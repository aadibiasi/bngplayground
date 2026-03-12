import fs from 'fs';
import path from 'path';

const examplesDir = process.env.RULEHUB_ROOT
  ? path.resolve(process.env.RULEHUB_ROOT, 'Contributed', 'BNGPlayground_Examples')
  : path.resolve('..', 'RuleHub', 'Contributed', 'BNGPlayground_Examples');

function collectBnglFiles(dir, results = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectBnglFiles(full, results);
    else if (entry.isFile() && entry.name.endsWith('.bngl')) results.push(full);
  }
  return results;
}

const entries = collectBnglFiles(examplesDir);

const results = [];

for (const full of entries) {
  const file = path.relative(examplesDir, full);
  const code = fs.readFileSync(full, 'utf-8');
  const m = code.match(/begin\s+observables([\s\S]*?)end\s+observables/i);
  if (!m) continue;
  const body = m[1];
  const names = [];
  for (const line of body.split(/\r?\n/)) {
    const l = line.replace(/#.*$/, '').trim();
    if (!l) continue;
    const parts = l.split(/\s+/);
    if (parts.length >= 2) names.push(parts[1]);
  }
  const counts = {};
  for (const n of names) counts[n] = (counts[n] || 0) + 1;
  const dup = Object.keys(counts).filter(k => counts[k] > 1);
  if (dup.length > 0) results.push({ file, dup });
}

if (results.length === 0) {
  console.log('No duplicates in RuleHub BNGPlayground_Examples folder.');
} else {
  console.log('Found duplicates in RuleHub BNGPlayground_Examples:');
  for (const r of results) {
    console.log(`- ${r.file}: ${r.dup.join(', ')}`);
  }
}

const fs = require('fs');
const path = require('path');

function stripBnglCommentLines(code) {
  return code.replace(/^\s*#.*$/gm, '');
}

const ODE_SIMULATE_ACTION_RE = /\b(?:simulate\s*\(\s*\{[\s\S]*?\bmethod\s*=>\s*["']ode["'][\s\S]*?\}\s*\)|simulate_ode\s*\()\s*/i;

function listFilesRecursive(rootDir) {
  const out = [];
  const stack = [rootDir];

  while (stack.length) {
    const cur = stack.pop();
    if (!cur || !fs.existsSync(cur)) continue;

    const entries = fs.readdirSync(cur, { withFileTypes: true });
    for (const ent of entries) {
      const full = path.join(cur, ent.name);
      if (ent.isDirectory()) {
        stack.push(full);
      } else if (ent.isFile()) {
        out.push(full);
      }
    }
  }

  return out;
}

function readCompatibleSetFromConstants(constantsPath) {
  const txt = fs.readFileSync(constantsPath, 'utf8');
  // Be tolerant of formatting/CRLF differences in constants.ts.
  // Expected shape: const BNG2_COMPATIBLE_MODELS = new Set([ ... ]);
  const m = txt.match(
    /BNG2_COMPATIBLE_MODELS\s*=\s*new\s+Set\s*\(\s*\[([\s\S]*?)\]\s*\)\s*;?/
  );
  if (!m) return new Set();

  const body = m[1];
  const ids = [...body.matchAll(/'([^']+)'/g)].map((x) => x[1]);
  return new Set(ids);
}

function main() {
  const projectRoot = process.cwd();

  const roots = [
    path.join(projectRoot, 'published-models'),
    path.join(projectRoot, 'example-models'),
    path.join(projectRoot, 'public', 'models'),
  ];

  const constantsPath = path.join(projectRoot, 'constants.ts');
  const compatible = fs.existsSync(constantsPath)
    ? readCompatibleSetFromConstants(constantsPath)
    : new Set();

  const candidates = [];
  const byKind = {
    'published-models': new Set(),
    'example-models': new Set(),
    'public/models': new Set(),
  };

  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const files = listFilesRecursive(root);
    for (const file of files) {
      if (!file.endsWith('.bngl')) continue;
      const code = stripBnglCommentLines(fs.readFileSync(file, 'utf8'));
      if (!ODE_SIMULATE_ACTION_RE.test(code)) continue;

      const id = path.basename(file, '.bngl');
      const rel = path.relative(projectRoot, file).replace(/\\/g, '/');
      if (rel.startsWith('published-models/')) byKind['published-models'].add(id);
      if (rel.startsWith('example-models/')) byKind['example-models'].add(id);
      if (rel.startsWith('public/models/')) byKind['public/models'].add(id);
      candidates.push({
        id,
        rel,
        inCompatibleSet: compatible.has(id),
      });
    }
  }

  candidates.sort((a, b) => a.id.localeCompare(b.id));

  const inSet = candidates.filter((c) => c.inCompatibleSet);
  const notInSet = candidates.filter((c) => !c.inCompatibleSet);

  const uniqueIds = new Set(candidates.map((c) => c.id));
  const uniqueInSet = new Set(inSet.map((c) => c.id));
  const uniqueNotInSet = new Set(notInSet.map((c) => c.id));

  console.log('ODE simulate candidates found:', candidates.length);
  console.log(' - in BNG2_COMPATIBLE_MODELS:', inSet.length);
  console.log(' - NOT in BNG2_COMPATIBLE_MODELS:', notInSet.length);

  console.log('\nUnique IDs:');
  console.log(' - total:', uniqueIds.size);
  console.log(' - in BNG2_COMPATIBLE_MODELS:', uniqueInSet.size);
  console.log(' - NOT in BNG2_COMPATIBLE_MODELS:', uniqueNotInSet.size);

  console.log('\nUnique IDs by folder (ODE simulate present):');
  console.log(' - published-models:', byKind['published-models'].size);
  console.log(' - example-models:', byKind['example-models'].size);
  console.log(' - public/models:', byKind['public/models'].size);

  const visibleLike = new Set([
    ...[...byKind['published-models']].filter((id) => compatible.has(id)),
    ...[...byKind['example-models']].filter((id) => compatible.has(id)),
  ]);
  console.log(
    `\nApprox “UI visible” unique IDs (published+example AND allowlisted AND ODE simulate): ${visibleLike.size}`
  );

  if (notInSet.length) {
    console.log('\nFirst 100 NOT in BNG2_COMPATIBLE_MODELS:');
    for (const c of notInSet.slice(0, 100)) {
      console.log(`  ${c.id} -> ${c.rel}`);
    }
  }

  // Also show if anything in public/models is ODE-simulated (informational).
  const publicHits = candidates.filter((c) => c.rel.startsWith('public/models/'));
  if (publicHits.length) {
    console.log(`\npublic/models ODE-simulated: ${publicHits.length}`);
    for (const c of publicHits.slice(0, 50)) {
      console.log(`  ${c.id} -> ${c.rel}`);
    }
  }
}

main();

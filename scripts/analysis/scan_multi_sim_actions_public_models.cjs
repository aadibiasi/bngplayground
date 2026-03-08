const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const MODELS_DIR = path.join(PROJECT_ROOT, 'public', 'models');

function stripBnglCommentLines(code) {
  return code.replace(/^\s*#.*$/gm, '');
}

function extractActionsBody(code) {
  const beginRe = /\bbegin\s+actions\b/i;
  const endRe = /\bend\s+actions\b/i;

  const beginMatch = beginRe.exec(code);
  if (!beginMatch) return null;

  const afterBeginIdx = beginMatch.index + beginMatch[0].length;
  const endMatch = endRe.exec(code.slice(afterBeginIdx));
  if (!endMatch) return null;

  const endIdx = afterBeginIdx + endMatch.index;
  return code.slice(afterBeginIdx, endIdx);
}

function countSimulateLike(code) {
  const matches = code.match(/\b(simulate|simulate_ode)\s*\(/gi);
  return matches ? matches.length : 0;
}

function main() {
  if (!fs.existsSync(MODELS_DIR)) {
    console.error('Missing folder:', MODELS_DIR);
    process.exit(2);
  }

  const files = fs
    .readdirSync(MODELS_DIR)
    .filter((f) => f.toLowerCase().endsWith('.bngl'))
    .sort((a, b) => a.localeCompare(b));

  const rows = [];
  for (const file of files) {
    const abs = path.join(MODELS_DIR, file);
    const raw = fs.readFileSync(abs, 'utf8');
    const code = stripBnglCommentLines(raw);

    const actionsBody = extractActionsBody(code);
    const hasActions = Boolean(actionsBody);
    const totalCount = countSimulateLike(code);
    const actionsCount = actionsBody ? countSimulateLike(actionsBody) : 0;

    if (totalCount > 1) {
      rows.push({
        id: path.basename(file, '.bngl'),
        totalCount,
        hasActions,
        actionsCount,
      });
    }
  }

  rows.sort((a, b) => b.totalCount - a.totalCount || a.id.localeCompare(b.id));

  console.log('public/models BNGLs with >1 simulate/simulate_ode anywhere:', rows.length);
  console.log('total\tactions\thasActions\tid');
  for (const r of rows) {
    console.log(`${r.totalCount}\t${r.actionsCount}\t${r.hasActions ? 'y' : 'n'}\t${r.id}`);
  }
}

main();

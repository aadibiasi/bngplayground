import * as fs from 'fs';
import * as path from 'path';
import {
  findRuleHubModelPath,
  loadRuleHubManifest,
  normalizeModelKey,
  resolveRuleHubRoot,
} from '../rulehubLocal';

type DoiRecord = {
  modelId: string;
  doi: string;
  pmid: string;
  authors: string;
  title: string;
  year: string;
  journal: string;
  confidence: string;
};

type CitationHint = {
  modelId: string;
  confidence: string;
  doi: string;
  pmid: string;
  resolvedPath?: string;
  headerPreview?: string[];
  signalLines: string[];
};

const PROJECT_ROOT = process.cwd();
const DOI_CSV_PATH = path.join(PROJECT_ROOT, 'tools', 'migration', 'doi-database.csv');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'artifacts');
const OUTPUT_JSON_PATH = path.join(OUTPUT_DIR, 'citation_hints.json');
const OUTPUT_CSV_PATH = path.join(OUTPUT_DIR, 'citation_hints.csv');

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      fields.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  fields.push(current);
  return fields.map((field) => field.trim());
}

function loadDoiRecords(): DoiRecord[] {
  const raw = fs.readFileSync(DOI_CSV_PATH, 'utf8').replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const [headerLine, ...rows] = lines;
  const headers = parseCsvLine(headerLine);

  return rows.map((row) => {
    const record = buildCsvRecord(headers, parseCsvLine(row));
    const modelId = record.model_id ?? '';
    const doi = record.doi ?? '';
    const pmid = record.pmid ?? '';
    const authors = record.authors ?? '';
    const title = record.title ?? '';
    const year = record.year ?? '';
    const journal = record.journal ?? '';
    const confidence = record.confidence ?? '';
    return { modelId, doi, pmid, authors, title, year, journal, confidence };
  });
}

function buildCsvRecord(headers: string[], values: string[]): Record<string, string> {
  if (
    headers.length === 8
    && headers[0] === 'model_id'
    && headers[1] === 'doi'
    && headers[2] === 'pmid'
    && headers[3] === 'authors'
    && headers[4] === 'title'
    && headers[5] === 'year'
    && headers[6] === 'journal'
    && headers[7] === 'confidence'
  ) {
    const [model_id = '', doi = '', pmid = '', authors = '', ...rest] = values;
    const trailing = [...rest];
    const confidence = trailing.pop() ?? '';
    const journal = trailing.pop() ?? '';
    const year = trailing.pop() ?? '';
    const title = trailing.join(',').trim();
    return { model_id, doi, pmid, authors, title, year, journal, confidence };
  }

  const record: Record<string, string> = {};
  headers.forEach((header, index) => {
    record[header] = values[index] ?? '';
  });
  return record;
}

function resolveModelPath(modelId: string): string | null {
  const direct = findRuleHubModelPath(PROJECT_ROOT, modelId);
  if (direct) return direct;

  const manifest = loadRuleHubManifest(PROJECT_ROOT);
  const ruleHubRoot = resolveRuleHubRoot(PROJECT_ROOT);
  if (!ruleHubRoot) return null;

  const targetKey = normalizeModelKey(modelId);
  const byCollection = manifest.find((entry) =>
    typeof entry.collectionId === 'string' && normalizeModelKey(entry.collectionId) === targetKey && entry.path,
  );

  if (!byCollection?.path) return null;
  const fullPath = path.join(ruleHubRoot, byCollection.path);
  return fs.existsSync(fullPath) ? fullPath : null;
}

function extractHeaderPreview(content: string): string[] {
  const lines = content.split(/\r?\n/);
  const preview: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (preview.length > 0) break;
      continue;
    }

    if (/^(begin|parameters|molecule types|seed species|reaction rules|observables|functions|actions)\b/i.test(trimmed)) {
      break;
    }

    if (trimmed.startsWith('#')) {
      preview.push(trimmed.replace(/^#\s?/, ''));
      continue;
    }

    break;
  }

  return preview.slice(0, 20);
}

function extractSignalLines(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /doi|pmid|pubmed|citation|reference|journal|author|published/i.test(line))
    .slice(0, 20);
}

function toCsvValue(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function main() {
  const ruleHubRoot = resolveRuleHubRoot(PROJECT_ROOT);
  if (!ruleHubRoot) {
    console.error('RuleHub checkout not found. Set RULEHUB_ROOT or place RuleHub beside this repo.');
    process.exitCode = 1;
    return;
  }

  const records = loadDoiRecords().filter((record) => record.confidence.toLowerCase() === 'needs_lookup');
  const hints: CitationHint[] = records.map((record) => {
    const resolvedPath = resolveModelPath(record.modelId) ?? undefined;
    if (!resolvedPath) {
      return {
        modelId: record.modelId,
        confidence: record.confidence,
        doi: record.doi,
        pmid: record.pmid,
        signalLines: [],
      };
    }

    const content = fs.readFileSync(resolvedPath, 'utf8').replace(/^\uFEFF/, '');
    return {
      modelId: record.modelId,
      confidence: record.confidence,
      doi: record.doi,
      pmid: record.pmid,
      resolvedPath: path.relative(PROJECT_ROOT, resolvedPath).replace(/\\/g, '/'),
      headerPreview: extractHeaderPreview(content),
      signalLines: extractSignalLines(content),
    };
  });

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_JSON_PATH, JSON.stringify(hints, null, 2), 'utf8');

  const csvLines = [
    'model_id,confidence,doi,pmid,resolved_path,signal_lines,header_preview',
    ...hints.map((hint) => [
      hint.modelId,
      hint.confidence,
      hint.doi,
      hint.pmid,
      hint.resolvedPath ?? '',
      hint.signalLines.join(' | '),
      (hint.headerPreview ?? []).join(' | '),
    ].map((value) => toCsvValue(value)).join(',')),
  ];
  fs.writeFileSync(OUTPUT_CSV_PATH, `${csvLines.join('\n')}\n`, 'utf8');

  const resolved = hints.filter((hint) => hint.resolvedPath).length;
  console.log(`Wrote ${hints.length} citation hints (${resolved} resolved) to artifacts/citation_hints.json and artifacts/citation_hints.csv`);
}

main();
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

type SimulationMethod = 'ode' | 'ssa' | 'nf';

interface PlaygroundModel {
  file: string;
  id: string;
  name: string;
  description: string;
  tags: string[];
  bng2_compatible: boolean;
}

interface PlaygroundFile {
  models: PlaygroundModel[];
}

interface CollectionRule {
  id: string;
  name: string;
  description: string;
  type: string;
  parentModel: string;
  variantKey: string;
  tags?: string[];
}

interface MappingRule {
  sourcePrefix: string;
  destinationRoot: string;
  origin: string;
  category: string;
  collection?: CollectionRule;
}

interface MappingFile {
  rules: MappingRule[];
}

interface DetectedFeatures {
  simulationMethods: SimulationMethod[];
  usesCompartments: boolean;
  usesEnergy: boolean;
  usesFunctions: boolean;
  nfsimCompatible: boolean;
}

interface ExportedModelRecord {
  id: string;
  sourcePath: string;
  destinationDir: string;
  destinationFile: string;
  origin: string;
  category: string;
  visible: boolean;
  collectionId?: string;
}

const ROOT_DIR = process.cwd();
const DEFAULT_OUTPUT_ROOT = path.join(ROOT_DIR, 'artifacts', 'rulehub-export');
const MAP_FILE = path.join(ROOT_DIR, 'tools', 'migration', 'category-map.json');
const VISIBLE_MODELS_FILE = path.join(ROOT_DIR, 'public', 'visible-models.json');
const PUBLIC_MODELS_DIR = path.join(ROOT_DIR, 'public', 'models');
const TAG_STOPWORDS = new Set([
  'begin',
  'end',
  'model',
  'models',
  'simulate',
  'generate',
  'parameter',
  'parameters',
  'species',
  'reaction',
  'reactions',
  'observable',
  'observables',
  'molecule',
  'molecules',
  'seed',
  'action',
  'actions',
  'compartment',
  'compartments',
  'function',
  'functions',
  'energy',
  'network',
]);
const SOURCE_ROOTS = [
  path.join(ROOT_DIR, 'example-models'),
  path.join(ROOT_DIR, 'published-models'),
];
const DOI_DATABASE_PATH = path.join(ROOT_DIR, 'tools', 'migration', 'doi-database.csv');

function parseArgs(argv: string[]): { outputRoot: string; includePublicRuntimeOrphans: boolean } {
  let outputRoot = DEFAULT_OUTPUT_ROOT;
  let includePublicRuntimeOrphans = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--output' && argv[index + 1]) {
      outputRoot = path.resolve(ROOT_DIR, argv[index + 1]);
      index += 1;
      continue;
    }

    if (arg === '--include-public-runtime-orphans') {
      includePublicRuntimeOrphans = true;
    }
  }

  return { outputRoot, includePublicRuntimeOrphans };
}

function parseScalar(rawValue: string): string | boolean | string[] {
  const value = rawValue.trim();

  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map(entry => entry.trim().replace(/^"|"$/g, ''));
  }
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }

  return value;
}

function parsePlaygroundYaml(content: string): PlaygroundFile {
  const result: PlaygroundFile = { models: [] };
  let currentModel: Partial<PlaygroundModel> | null = null;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line === 'models:') continue;

    if (line.startsWith('- ')) {
      if (currentModel?.file && currentModel.id) {
        result.models.push({
          file: currentModel.file,
          id: currentModel.id,
          name: currentModel.name ?? currentModel.id,
          description: currentModel.description ?? '',
          tags: currentModel.tags ?? [],
          bng2_compatible: currentModel.bng2_compatible ?? false,
        });
      }
      currentModel = {};

      const maybeInline = line.slice(2).trim();
      if (maybeInline) {
        const separator = maybeInline.indexOf(':');
        if (separator >= 0) {
          const key = maybeInline.slice(0, separator).trim() as keyof PlaygroundModel;
          const value = parseScalar(maybeInline.slice(separator + 1));
          (currentModel as Record<string, unknown>)[key] = value;
        }
      }
      continue;
    }

    if (!currentModel) continue;
    const separator = line.indexOf(':');
    if (separator < 0) continue;

    const key = line.slice(0, separator).trim() as keyof PlaygroundModel;
    const value = parseScalar(line.slice(separator + 1));
    (currentModel as Record<string, unknown>)[key] = value;
  }

  if (currentModel?.file && currentModel.id) {
    result.models.push({
      file: currentModel.file,
      id: currentModel.id,
      name: currentModel.name ?? currentModel.id,
      description: currentModel.description ?? '',
      tags: currentModel.tags ?? [],
      bng2_compatible: currentModel.bng2_compatible ?? false,
    });
  }

  return result;
}

function findPlaygroundFiles(dir: string, results: string[] = []): string[] {
  if (!fs.existsSync(dir)) return results;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'public') continue;
      findPlaygroundFiles(fullPath, results);
      continue;
    }

    if (entry.isFile() && entry.name === 'playground.yaml') {
      results.push(fullPath);
    }
  }

  return results;
}

function findFilesByName(dir: string, targetName: string, results: string[] = []): string[] {
  if (!fs.existsSync(dir)) return results;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findFilesByName(fullPath, targetName, results);
      continue;
    }
    if (entry.isFile() && entry.name === targetName) {
      results.push(fullPath);
    }
  }

  return results;
}

function loadMappingRules(): MappingRule[] {
  const raw = fs.readFileSync(MAP_FILE, 'utf8');
  const parsed = JSON.parse(raw) as MappingFile;
  return parsed.rules.sort((left, right) => right.sourcePrefix.length - left.sourcePrefix.length);
}

function normalizeVisibleKey(value: string): string {
  return value
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\.bngl$/i, '')
    .replace(/^\/+|\/+$/g, '');
}

function loadVisibleModels(): Set<string> {
  if (!fs.existsSync(VISIBLE_MODELS_FILE)) return new Set<string>();
  const raw = JSON.parse(fs.readFileSync(VISIBLE_MODELS_FILE, 'utf8')) as { models?: string[] };
  return new Set((raw.models ?? []).map(normalizeVisibleKey));
}

function isVisibleModel(visibleModels: Set<string>, sourceRelativePath: string, modelId: string): boolean {
  const normalizedSource = normalizeVisibleKey(sourceRelativePath);
  const normalizedId = normalizeVisibleKey(modelId);
  const normalizedBaseName = normalizeVisibleKey(path.basename(sourceRelativePath));

  return [
    normalizedSource,
    normalizedId,
    normalizedBaseName,
    normalizeVisibleKey(`public/models/${modelId}`),
    normalizeVisibleKey(`public/models/${path.basename(sourceRelativePath)}`),
  ].some(candidate => visibleModels.has(candidate));
}

function loadDoiDatabase(): Map<string, Record<string, string>> {
  const database = new Map<string, Record<string, string>>();
  if (!fs.existsSync(DOI_DATABASE_PATH)) return database;

  const [headerLine, ...rows] = fs.readFileSync(DOI_DATABASE_PATH, 'utf8').split(/\r?\n/).filter(Boolean);
  if (!headerLine) return database;

  const headers = parseCsvLine(headerLine).map(cell => cell.trim());
  for (const row of rows) {
    const values = parseCsvLine(row).map(cell => cell.trim());
    const record = buildCsvRecord(headers, values);
    if (record.model_id) database.set(record.model_id, record);
  }

  return database;
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

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
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
      values.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  values.push(current);
  return values;
}

function detectFeatures(bnglContent: string, tags: string[]): DetectedFeatures {
  const methodMatches = Array.from(bnglContent.matchAll(/simulate\s*\(\s*\{[^}]*method\s*=>\s*"([^"]+)"/gi));
  const methodSet = new Set<SimulationMethod>();

  for (const match of methodMatches) {
    const methodName = match[1].toLowerCase();
    if (methodName.includes('ode') || methodName.includes('cvode')) methodSet.add('ode');
    if (methodName.includes('ssa')) methodSet.add('ssa');
    if (methodName.includes('nf')) methodSet.add('nf');
  }

  if (tags.some(tag => tag.toLowerCase() === 'nfsim')) {
    methodSet.add('nf');
  }

  if (methodSet.size === 0) {
    methodSet.add('ode');
  }

  const usesCompartments = /begin\s+compartments/iu.test(bnglContent);
  const usesFunctions = /begin\s+functions/iu.test(bnglContent) || /\b(Sat|MM|Hill)\s*\(/u.test(bnglContent);
  const usesEnergy = /begin\s+energy\s+patterns/iu.test(bnglContent) || /\bphi\s*\(/u.test(bnglContent);
  const nfsimCompatible = !/generate_network\s*\(/iu.test(bnglContent);

  return {
    simulationMethods: Array.from(methodSet),
    usesCompartments,
    usesEnergy,
    usesFunctions,
    nfsimCompatible,
  };
}

function canonicalModelDirectoryName(id: string): string {
  const normalized = id
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-')
    .toLowerCase();

  if (!normalized) return 'model';
  if (/^[0-9]/.test(normalized)) return `model-${normalized}`;
  return normalized;
}

function sanitizeFileStem(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9._/-]+/g, '_')
    .replace(/[\/]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function buildCollectionFileName(sourceRelativePath: string, rule: MappingRule): string {
  const normalizedPrefix = `${rule.sourcePrefix.replace(/\\/g, '/')}/`;
  const relativeToCollection = sourceRelativePath.startsWith(normalizedPrefix)
    ? sourceRelativePath.slice(normalizedPrefix.length)
    : path.basename(sourceRelativePath);
  const withoutExtension = relativeToCollection.replace(/\.bngl$/i, '');
  let stem = sanitizeFileStem(withoutExtension);

  if (stem.toLowerCase().endsWith('_model')) {
    stem = stem.slice(0, -6);
  }

  return `${stem || path.basename(sourceRelativePath, '.bngl')}.bngl`;
}

function ensureUniqueFileName(targetDir: string, desiredName: string, usedNames: Map<string, Set<string>>): string {
  const seenNames = usedNames.get(targetDir) ?? new Set<string>();
  if (!seenNames.has(desiredName)) {
    seenNames.add(desiredName);
    usedNames.set(targetDir, seenNames);
    return desiredName;
  }

  const extension = path.extname(desiredName);
  const stem = desiredName.slice(0, desiredName.length - extension.length);
  let counter = 2;
  let candidate = `${stem}_${counter}${extension}`;
  while (seenNames.has(candidate)) {
    counter += 1;
    candidate = `${stem}_${counter}${extension}`;
  }

  seenNames.add(candidate);
  usedNames.set(targetDir, seenNames);
  return candidate;
}

function classifyExampleBucket(fileName: string): { bucket: string; category: string } {
  const prefixMap: Array<{ prefix: string; bucket: string; category: string }> = [
    { prefix: 'cs_', bucket: 'cs', category: 'computer-science' },
    { prefix: 'eco_', bucket: 'ecology', category: 'ecology' },
    { prefix: 'energy_', bucket: 'energy', category: 'other' },
    { prefix: 'genetic_', bucket: 'genetics', category: 'gene-expression' },
    { prefix: 'synbio_', bucket: 'synbio', category: 'synthetic-biology' },
    { prefix: 'ph_', bucket: 'physics', category: 'physics' },
    { prefix: 'ml_', bucket: 'ml', category: 'computer-science' },
    { prefix: 'nn_', bucket: 'ml', category: 'computer-science' },
    { prefix: 'wacky_', bucket: 'wacky', category: 'other' },
    { prefix: 'nfsim_', bucket: 'nfsim', category: 'other' },
    { prefix: 'gm_', bucket: 'generative', category: 'computer-science' },
    { prefix: 'mt_', bucket: 'meta', category: 'computer-science' },
    { prefix: 'sp_', bucket: 'signal-processing', category: 'computer-science' },
    { prefix: 'feature_', bucket: 'feature-demos', category: 'other' },
    { prefix: 'process_', bucket: 'processes', category: 'other' },
    { prefix: 'compartment_', bucket: 'compartments', category: 'other' },
    { prefix: 'meta_', bucket: 'meta', category: 'computer-science' },
  ];

  const normalized = fileName.toLowerCase();
  for (const mapping of prefixMap) {
    if (normalized.startsWith(mapping.prefix)) {
      return { bucket: mapping.bucket, category: mapping.category };
    }
  }

  return { bucket: 'biology', category: 'signaling' };
}

function inferTags(model: PlaygroundModel, bnglContent: string): string[] {
  const filenameTags = model.file
    .replace(/\.bngl$/i, '')
    .split(/[-_]/)
    .map(tag => tag.trim().toLowerCase())
    .filter(Boolean);

  const moleculeMatches = Array.from(bnglContent.matchAll(/^\s*([A-Za-z][A-Za-z0-9_]*)\s*\(/gmu))
    .slice(0, 8)
    .map(match => match[1].toLowerCase());

  return Array.from(new Set([
    ...model.tags.map(tag => tag.toLowerCase()),
    ...filenameTags,
    ...moleculeMatches,
  ].filter(tag => tag.length >= 3 && !TAG_STOPWORDS.has(tag))));
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function yamlArray(values: string[]): string {
  if (values.length === 0) return '[]';
  return `[${values.map(value => yamlString(value)).join(', ')}]`;
}

function getPlaygroundContributorName(): string | null {
  const candidates = [
    process.env.RULEHUB_PLAYGROUND_AUTHOR,
    process.env.GIT_AUTHOR_NAME,
    process.env.USERNAME,
    process.env.USER,
  ];

  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed) return trimmed;
  }

  return null;
}

function isAiGeneratedOrigin(origin: string): boolean {
  return origin === 'ai-generated';
}

function inferAuthorFromModelId(modelId: string): string | null {
  const candidate = modelId.match(/^([A-Z][A-Za-z]+(?:-[A-Z][A-Za-z]+)*)/u)?.[1]?.trim();
  return candidate || null;
}

function buildModelMetadataYaml(args: {
  model: PlaygroundModel;
  description: string;
  tags: string[];
  category: string;
  origin: string;
  visible: boolean;
  features: DetectedFeatures;
  doiRecord?: Record<string, string>;
  sourcePath: string;
}): string {
  const { model, description, tags, category, origin, visible, features, doiRecord, sourcePath } = args;
  const contributorName = isAiGeneratedOrigin(origin) ? getPlaygroundContributorName() : null;
  const inferredAuthor = !doiRecord?.authors && origin === 'published' ? inferAuthorFromModelId(model.id) : null;

  const lines = [
    `id: ${yamlString(model.id)}`,
    `name: ${yamlString(model.name)}`,
    `description: ${yamlString(description)}`,
  ];

  if (doiRecord?.authors) {
    lines.push('authors:');
    for (const author of doiRecord.authors.split(';').map(entry => entry.trim()).filter(Boolean)) {
      lines.push(`  - name: ${yamlString(author)}`);
    }
  } else if (inferredAuthor) {
    lines.push('authors:');
    lines.push(`  - name: ${yamlString(inferredAuthor)}`);
  }

  if (doiRecord?.doi || doiRecord?.pmid || doiRecord?.title) {
    lines.push('citation:');
    if (doiRecord.doi) lines.push(`  doi: ${yamlString(doiRecord.doi)}`);
    if (doiRecord.pmid) lines.push(`  pmid: ${yamlString(doiRecord.pmid)}`);
    if (doiRecord.title) lines.push(`  reference: ${yamlString(doiRecord.title)}`);
  }

  if (contributorName) {
    lines.push('contributors:');
    lines.push(`  - name: ${yamlString(contributorName)}`);
  }

  lines.push(`tags: ${yamlArray(tags)}`);
  lines.push(`category: ${yamlString(category)}`);
  lines.push('compatibility:');
  lines.push(`  bng2_compatible: ${model.bng2_compatible}`);
  lines.push(`  simulation_methods: ${yamlArray(features.simulationMethods)}`);
  lines.push(`  uses_compartments: ${features.usesCompartments}`);
  lines.push(`  uses_energy: ${features.usesEnergy}`);
  lines.push(`  uses_functions: ${features.usesFunctions}`);
  lines.push(`  nfsim_compatible: ${features.nfsimCompatible}`);
  lines.push('source:');
  lines.push(`  origin: ${yamlString(origin)}`);
  lines.push(`  original_format: ${yamlString('bngl')}`);
  lines.push(`  original_repository: ${yamlString('bionetgen-web-simulator')}`);
  lines.push(`  source_path: ${yamlString(sourcePath)}`);
  lines.push('playground:');
  lines.push(`  visible: ${visible}`);
  lines.push(`  gallery_category: ${yamlString(category)}`);
  lines.push(`  featured: false`);
  lines.push(`  difficulty: ${yamlString(visible ? 'intermediate' : 'advanced')}`);

  return `${lines.join('\n')}\n`;
}

function buildCollectionMetadataYaml(args: {
  collection: CollectionRule;
  category: string;
  origin: string;
  visible: boolean;
  count: number;
  doiRecord?: Record<string, string>;
}): string {
  const { collection, category, origin, visible, count, doiRecord } = args;
  const lines = [
    `id: ${yamlString(collection.id)}`,
    `name: ${yamlString(collection.name)}`,
    `description: ${yamlString(collection.description)}`,
    `tags: ${yamlArray(collection.tags ?? [])}`,
    `category: ${yamlString(category)}`,
  ];

  if (doiRecord?.authors) {
    lines.push('authors:');
    for (const author of doiRecord.authors.split(';').map(entry => entry.trim()).filter(Boolean)) {
      lines.push(`  - name: ${yamlString(author)}`);
    }
  }

  if (doiRecord?.doi || doiRecord?.pmid || doiRecord?.title) {
    lines.push('citation:');
    if (doiRecord.doi) lines.push(`  doi: ${yamlString(doiRecord.doi)}`);
    if (doiRecord.pmid) lines.push(`  pmid: ${yamlString(doiRecord.pmid)}`);
    if (doiRecord.title) lines.push(`  reference: ${yamlString(doiRecord.title)}`);
  }

  lines.push(
    'compatibility:',
    '  bng2_compatible: true',
    '  simulation_methods: ["ode"]',
    '  uses_compartments: false',
    '  uses_energy: false',
    '  uses_functions: false',
    '  nfsim_compatible: false',
    'source:',
    `  origin: ${yamlString(origin)}`,
    `  original_repository: ${yamlString('bionetgen-web-simulator')}`,
    'collection:',
    `  type: ${yamlString(collection.type)}`,
    `  parent_model: ${yamlString(collection.parentModel)}`,
    `  variant_key: ${yamlString(collection.variantKey)}`,
    `  count: ${count}`,
    'playground:',
    `  visible: ${visible}`,
    `  gallery_category: ${yamlString(category)}`,
    '  featured: false',
    `  difficulty: ${yamlString('advanced')}`,
  );

  return lines.join('\n') + '\n';
}

function buildReadme(args: {
  title: string;
  description: string;
  tags: string[];
  bng2Compatible: boolean;
  simulationMethods: SimulationMethod[];
  modelFiles: string[];
  origin: string;
  doiRecord?: Record<string, string>;
}): string {
  const { title, description, tags, bng2Compatible, simulationMethods, modelFiles, origin, doiRecord } = args;
  const contributorName = isAiGeneratedOrigin(origin) ? getPlaygroundContributorName() : null;
  const citationSection = doiRecord?.title || doiRecord?.doi || doiRecord?.pmid
    ? [
        '## Citation',
        '',
        doiRecord.title || 'Citation pending manual curation.',
        doiRecord.doi ? `DOI: ${doiRecord.doi}` : 'DOI: pending',
        doiRecord.pmid ? `PMID: ${doiRecord.pmid}` : '',
      ].filter(Boolean).join('\n')
    : isAiGeneratedOrigin(origin)
      ? [
          '## Provenance',
          '',
          contributorName
            ? `This BNGL example was generated in BNG Playground and curated by ${contributorName}.`
            : 'This BNGL example was generated in BNG Playground and curated locally.',
          'No external literature citation is associated with this model unless one is added manually.',
        ].join('\n')
    : [
        '## Citation',
        '',
        'Citation pending manual curation in tools/migration/doi-database.csv.',
      ].join('\n');

  return [
    `# ${title}`,
    '',
    description,
    '',
    citationSection,
    '',
    '## Compatibility',
    '',
    `- BNG2 compatible: ${bng2Compatible ? 'yes' : 'no'}`,
    `- Simulation methods: ${simulationMethods.join(', ')}`,
    `- Imported from: ${origin}`,
    '',
    '## Files',
    '',
    ...modelFiles.map(file => `- ${file}`),
    '',
    '## Tags',
    '',
    tags.length > 0 ? tags.join(', ') : 'No tags yet.',
  ].join('\n') + '\n';
}

function ensureDirectory(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

function removeDirectory(dirPath: string): void {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

function normalizeRelativePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

function resolveSourcePath(playgroundFile: string, fileName: string): string | null {
  const directPath = path.join(path.dirname(playgroundFile), fileName);
  if (fs.existsSync(directPath)) return directPath;

  const matches = findFilesByName(path.dirname(playgroundFile), path.basename(fileName));
  if (matches.length === 1) {
    return matches[0];
  }

  const exactNormalized = normalizeRelativePath(fileName);
  const exactMatch = matches.find(match => normalizeRelativePath(path.relative(path.dirname(playgroundFile), match)) === exactNormalized);
  return exactMatch ?? matches[0] ?? null;
}

function buildDestinationDir(args: {
  outputRoot: string;
  rule: MappingRule;
  relativeDir: string;
  model: PlaygroundModel;
  sourceRelativePath: string;
  usedDestinationDirs: Set<string>;
}): string {
  const { outputRoot, rule, relativeDir, model, sourceRelativePath, usedDestinationDirs } = args;
  const exampleBucket = relativeDir.startsWith('example-models') ? classifyExampleBucket(model.file) : null;
  const destinationRoot = exampleBucket
    ? path.join(outputRoot, rule.destinationRoot, exampleBucket.bucket)
    : path.join(outputRoot, rule.destinationRoot);
  const baseName = canonicalModelDirectoryName(model.id);
  let candidate = path.join(destinationRoot, baseName);

  if (!usedDestinationDirs.has(candidate)) {
    usedDestinationDirs.add(candidate);
    return candidate;
  }

  const relativeSourceDir = normalizeRelativePath(path.dirname(sourceRelativePath));
  const sourcePrefix = `${rule.sourcePrefix.replace(/\\/g, '/')}/`;
  const context = sanitizeFileStem(
    relativeSourceDir.startsWith(sourcePrefix)
      ? relativeSourceDir.slice(sourcePrefix.length)
      : relativeSourceDir,
  );

  candidate = path.join(destinationRoot, `${baseName}_${context || 'variant'}`);
  if (!usedDestinationDirs.has(candidate)) {
    usedDestinationDirs.add(candidate);
    return candidate;
  }

  let counter = 2;
  let numberedCandidate = `${candidate}_${counter}`;
  while (usedDestinationDirs.has(numberedCandidate)) {
    counter += 1;
    numberedCandidate = `${candidate}_${counter}`;
  }
  usedDestinationDirs.add(numberedCandidate);
  return numberedCandidate;
}

function findRule(relativeDir: string, rules: MappingRule[]): MappingRule | undefined {
  return rules.find(rule => relativeDir.startsWith(rule.sourcePrefix));
}

function computeContentHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function buildPublicRuntimeDescription(fileName: string): string {
  const stem = fileName.replace(/\.bngl$/i, '');
  return `Runtime-only BNGL model migrated from public/models: ${stem}`;
}

function main(): void {
  const { outputRoot, includePublicRuntimeOrphans } = parseArgs(process.argv.slice(2));
  const rules = loadMappingRules();
  const visibleModels = loadVisibleModels();
  const doiDatabase = loadDoiDatabase();
  const collectionEntries = new Map<string, {
    rule: MappingRule;
    count: number;
    visible: boolean;
    files: string[];
  }>();
  const exportedModels: ExportedModelRecord[] = [];
  const usedCollectionFileNames = new Map<string, Set<string>>();
  const usedDestinationDirs = new Set<string>();
  const processedSourcePaths = new Set<string>();
  const exportedContentHashes = new Set<string>();

  removeDirectory(outputRoot);
  ensureDirectory(outputRoot);

  const playgroundFiles = SOURCE_ROOTS.flatMap(sourceRoot => findPlaygroundFiles(sourceRoot));

  for (const playgroundFile of playgroundFiles) {
    const relativeDir = normalizeRelativePath(path.relative(ROOT_DIR, path.dirname(playgroundFile)));
    const rule = findRule(relativeDir, rules);
    if (!rule) {
      console.warn(`Skipping ${relativeDir}: no mapping rule`);
      continue;
    }

    const parsed = parsePlaygroundYaml(fs.readFileSync(playgroundFile, 'utf8'));
    for (const model of parsed.models) {
      const sourcePath = resolveSourcePath(playgroundFile, model.file);
      if (!sourcePath) {
        console.warn(`Skipping missing source file: ${path.join(path.dirname(playgroundFile), model.file)}`);
        continue;
      }

      const sourceRelativePath = normalizeRelativePath(path.relative(ROOT_DIR, sourcePath));
      if (processedSourcePaths.has(sourceRelativePath.toLowerCase())) {
        continue;
      }
      processedSourcePaths.add(sourceRelativePath.toLowerCase());

      const visible = isVisibleModel(visibleModels, sourceRelativePath, model.id);
      const rawBngl = fs.readFileSync(sourcePath, 'utf8');
      exportedContentHashes.add(computeContentHash(rawBngl));
      const features = detectFeatures(rawBngl, model.tags);
      const tags = inferTags(model, rawBngl);
      const doiRecord = doiDatabase.get(model.id);

      if (rule.collection) {
        const targetDir = path.join(outputRoot, rule.destinationRoot);
        ensureDirectory(targetDir);
        const collectionFileName = ensureUniqueFileName(
          targetDir,
          buildCollectionFileName(sourceRelativePath, rule),
          usedCollectionFileNames,
        );
        const destinationFile = path.join(targetDir, collectionFileName);
        fs.copyFileSync(sourcePath, destinationFile);

        const group = collectionEntries.get(targetDir) ?? {
          rule,
          count: 0,
          visible: false,
          files: [],
        };
        group.count += 1;
        group.visible = group.visible || visible;
        group.files.push(collectionFileName);
        collectionEntries.set(targetDir, group);

        exportedModels.push({
          id: model.id,
          sourcePath: sourceRelativePath,
          destinationDir: normalizeRelativePath(path.relative(outputRoot, targetDir)),
          destinationFile: path.basename(destinationFile),
          origin: rule.origin,
          category: rule.category,
          visible,
          collectionId: rule.collection.id,
        });
        continue;
      }

      const exampleBucket = relativeDir.startsWith('example-models') ? classifyExampleBucket(model.file) : null;
      const category = exampleBucket?.category ?? rule.category;
      const destinationDir = buildDestinationDir({
        outputRoot,
        rule,
        relativeDir,
        model,
        sourceRelativePath,
        usedDestinationDirs,
      });

      ensureDirectory(destinationDir);
      const destinationFile = path.join(destinationDir, path.basename(model.file));
      fs.copyFileSync(sourcePath, destinationFile);

      const metadataYaml = buildModelMetadataYaml({
        model,
        description: model.description,
        tags,
        category,
        origin: rule.origin,
        visible,
        features,
        doiRecord,
        sourcePath: sourceRelativePath,
      });
      fs.writeFileSync(path.join(destinationDir, 'metadata.yaml'), metadataYaml, 'utf8');

      const readme = buildReadme({
        title: model.name,
        description: model.description,
        tags,
        bng2Compatible: model.bng2_compatible,
        simulationMethods: features.simulationMethods,
        modelFiles: [path.basename(model.file)],
        origin: rule.origin,
        doiRecord,
      });
      fs.writeFileSync(path.join(destinationDir, 'README.md'), readme, 'utf8');

      exportedModels.push({
        id: model.id,
        sourcePath: sourceRelativePath,
        destinationDir: normalizeRelativePath(path.relative(outputRoot, destinationDir)),
        destinationFile: path.basename(destinationFile),
        origin: rule.origin,
        category,
        visible,
      });
    }
  }

  if (includePublicRuntimeOrphans && fs.existsSync(PUBLIC_MODELS_DIR)) {
    const publicModelFiles = fs.readdirSync(PUBLIC_MODELS_DIR, { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.endsWith('.bngl'))
      .map(entry => entry.name)
      .sort((left, right) => left.localeCompare(right));

    for (const fileName of publicModelFiles) {
      const sourcePath = path.join(PUBLIC_MODELS_DIR, fileName);
      const content = fs.readFileSync(sourcePath, 'utf8');
      const contentHash = computeContentHash(content);
      if (exportedContentHashes.has(contentHash)) {
        continue;
      }

      exportedContentHashes.add(contentHash);
      const id = path.basename(fileName, '.bngl');
      const description = buildPublicRuntimeDescription(fileName);
      const tags = Array.from(new Set(id.split(/[-_\s]+/).map(tag => tag.toLowerCase()).filter(Boolean)));
      const features = detectFeatures(content, tags);
      const visible = isVisibleModel(visibleModels, normalizeRelativePath(path.relative(ROOT_DIR, sourcePath)), id);
      const destinationDir = path.join(outputRoot, 'Contributed', 'BNGPlayground_PublicRuntime', canonicalModelDirectoryName(id));

      ensureDirectory(destinationDir);
      fs.copyFileSync(sourcePath, path.join(destinationDir, fileName));
      fs.writeFileSync(
        path.join(destinationDir, 'metadata.yaml'),
        buildModelMetadataYaml({
          model: {
            file: fileName,
            id,
            name: id,
            description,
            tags,
            bng2_compatible: true,
          },
          description,
          tags,
          category: 'other',
          origin: 'contributed',
          visible,
          features,
          sourcePath: normalizeRelativePath(path.relative(ROOT_DIR, sourcePath)),
        }),
        'utf8',
      );
      fs.writeFileSync(
        path.join(destinationDir, 'README.md'),
        buildReadme({
          title: id,
          description,
          tags,
          bng2Compatible: true,
          simulationMethods: features.simulationMethods,
          modelFiles: [fileName],
          origin: 'contributed',
        }),
        'utf8',
      );

      exportedModels.push({
        id,
        sourcePath: normalizeRelativePath(path.relative(ROOT_DIR, sourcePath)),
        destinationDir: normalizeRelativePath(path.relative(outputRoot, destinationDir)),
        destinationFile: fileName,
        origin: 'contributed',
        category: 'other',
        visible,
      });
    }
  }

  if (!includePublicRuntimeOrphans && fs.existsSync(PUBLIC_MODELS_DIR)) {
    console.log('Skipping public/models orphan export. Pass --include-public-runtime-orphans to include unmatched runtime-only BNGL files.');
  }

  for (const [targetDir, group] of collectionEntries.entries()) {
    const collectionDoiRecord = doiDatabase.get(group.rule.collection!.id);
    const metadataYaml = buildCollectionMetadataYaml({
      collection: group.rule.collection!,
      category: group.rule.category,
      origin: group.rule.origin,
      visible: group.visible,
      count: group.count,
      doiRecord: collectionDoiRecord,
    });
    fs.writeFileSync(path.join(targetDir, 'metadata.yaml'), metadataYaml, 'utf8');

    const readme = buildReadme({
      title: group.rule.collection!.name,
      description: group.rule.collection!.description,
      tags: group.rule.collection!.tags ?? [],
      bng2Compatible: true,
      simulationMethods: ['ode'],
      modelFiles: group.files.sort(),
      origin: group.rule.origin,
      doiRecord: collectionDoiRecord,
    });
    fs.writeFileSync(path.join(targetDir, 'README.md'), readme, 'utf8');
  }

  fs.writeFileSync(
    path.join(outputRoot, 'migration-summary.json'),
    JSON.stringify(
      {
        generated: new Date().toISOString(),
        totalModels: exportedModels.length,
        collections: Array.from(collectionEntries.values()).map(entry => ({
          id: entry.rule.collection?.id,
          destinationRoot: entry.rule.destinationRoot,
          count: entry.count,
        })),
        models: exportedModels,
      },
      null,
      2,
    ),
    'utf8',
  );

  console.log(`Exported ${exportedModels.length} models to ${outputRoot}`);
}

main();
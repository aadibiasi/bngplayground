// === MCP stdio transport compatibility ===
// Set CWD to project root (Claude Desktop launches from System32)
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
process.chdir(resolve(__dirname, '..', '..', '..'));

// MCP uses stdout for JSON-RPC - redirect all console output to stderr
const _write = (msg: string) => { process.stderr.write(msg + '\n'); };

console.log = (...args: any[]) => _write(args.map(String).join(' '));
console.warn = (...args: any[]) => _write('[WARN] ' + args.map(String).join(' '));
console.error = (...args: any[]) => _write('[ERROR] ' + args.map(String).join(' '));
console.info = (...args: any[]) => _write(args.map(String).join(' '));
console.debug = (...args: any[]) => _write('[DEBUG] ' + args.map(String).join(' '));

import { z } from 'zod';
import { Server, StdioServerTransport, CallToolRequestSchema, ListToolsRequestSchema } from './sdk';
import {
  BNGLParser,
  clearAllEvaluatorCaches,
  evaluateFunctionalRate,
  generateRange,
  parseBNGLWithANTLR,
  generateExpandedNetwork,
  simulate,
  loadEvaluator,
  type BNGLModel,
  type BNGLMoleculeType,
  type ReactionRule,
  type SimulationOptions,
  validateModelForNFsim,
} from '@bngplayground/engine';

type ToolArgs = Record<string, unknown> | undefined;

type ToolResult<T> = {
  content: Array<{
    type: 'text';
    text: string;
  }>;
  structuredContent: T;
};

type ValidationMessage = {
  source: 'parse' | 'model' | 'observable' | 'nfsim';
  code: string;
  message: string;
  severity: 'error' | 'warning' | 'info';
  relatedElement?: string;
};

type ContactNode = {
  id: string;
  label: string;
  type: 'molecule' | 'component' | 'state' | 'compartment';
  parent?: string;
  isGroup?: boolean;
};

type ContactEdge = {
  from: string;
  to: string;
  interactionType: 'binding';
  componentPair?: [string, string];
  ruleIds: string[];
  ruleLabels: string[];
};

type ContactMap = {
  nodes: ContactNode[];
  edges: ContactEdge[];
};

type ParameterScanResult = {
  mode: '1d' | '2d';
  xValues: number[];
  observables: Record<string, number[] | number[][]>;
  yValues?: number[];
  parameter: string;
  parameter2?: string;
};

type ValidateModelResult = {
  valid: boolean;
  parseSuccess: boolean;
  parseErrors: Array<{ line: number; column: number; message: string }>;
  errors: ValidationMessage[];
  warnings: ValidationMessage[];
  info: ValidationMessage[];
  summary: {
    errors: number;
    warnings: number;
    info: number;
  };
  nfsim: ReturnType<typeof validateModelForNFsim> | null;
};

type ParsedSpeciesGraph = ReturnType<typeof BNGLParser.parseSpeciesGraph>;

const simulationMethods = ['ode', 'ssa', 'nf', 'default'] as const;
const solverValues = ['auto', 'cvode', 'cvode_auto', 'cvode_sparse', 'cvode_jac', 'rosenbrock23', 'rk45', 'rk4', 'webgpu_rk4'] as const;

const finiteNumber = z.number().finite();
const positiveInt = z.number().int().positive();

const parseBnglArgsSchema = z.object({
  code: z.string(),
}).strict();

const generateNetworkArgsSchema = z.object({
  code: z.string(),
  max_agents: positiveInt.optional(),
  max_reactions: positiveInt.optional(),
  max_iterations: positiveInt.optional(),
  max_agg: positiveInt.optional(),
}).strict();

const simulateArgsSchema = z.object({
  code: z.string(),
  method: z.enum(simulationMethods).optional(),
  t_end: finiteNumber.nonnegative().optional(),
  n_steps: positiveInt.optional(),
  solver: z.enum(solverValues).optional(),
  atol: finiteNumber.positive().optional(),
  rtol: finiteNumber.positive().optional(),
  max_steps: positiveInt.optional(),
  seed: z.number().int().optional(),
  sparse: z.boolean().optional(),
  include_species_data: z.boolean().optional(),
  max_agents: positiveInt.optional(),
  max_reactions: positiveInt.optional(),
  max_iterations: positiveInt.optional(),
  max_agg: positiveInt.optional(),
}).strict();

const parameterScanArgsSchema = z.object({
  code: z.string(),
  parameter: z.string(),
  start: finiteNumber,
  end: finiteNumber,
  steps: positiveInt,
  parameter2: z.string().optional(),
  start2: finiteNumber.optional(),
  end2: finiteNumber.optional(),
  steps2: positiveInt.optional(),
  logarithmic: z.boolean().optional(),
  method: z.enum(simulationMethods).optional(),
  t_end: finiteNumber.nonnegative().optional(),
  n_steps: positiveInt.optional(),
  solver: z.enum(solverValues).optional(),
  atol: finiteNumber.positive().optional(),
  rtol: finiteNumber.positive().optional(),
  max_steps: positiveInt.optional(),
  seed: z.number().int().optional(),
  sparse: z.boolean().optional(),
  max_agents: positiveInt.optional(),
  max_reactions: positiveInt.optional(),
  max_iterations: positiveInt.optional(),
  max_agg: positiveInt.optional(),
}).strict();

const validateModelArgsSchema = z.object({
  code: z.string(),
  include_nfsim: z.boolean().optional(),
}).strict();

const getContactMapArgsSchema = z.object({
  code: z.string(),
}).strict();

function createToolResult<T>(data: T): ToolResult<T> {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(data, null, 2),
      },
    ],
    structuredContent: data,
  };
}

function formatZodError(toolName: string, args: ToolArgs, error: z.ZodError): Error {
  const issues = error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : 'arguments';
    return `${path}: ${issue.message}`;
  }).join('; ');
  const received = args === undefined ? 'undefined' : JSON.stringify(args);
  return new Error(`Invalid arguments for ${toolName}: ${issues}. Received: ${received}`);
}

function parseArgs<T>(toolName: string, schema: z.ZodType<T>, args: ToolArgs): T {
  const parsed = schema.safeParse(args ?? {});
  if (!parsed.success) {
    throw formatZodError(toolName, args, parsed.error);
  }
  return parsed.data;
}

function parseModelOrThrow(code: string): BNGLModel {
  const result = parseBNGLWithANTLR(code);
  if (!result.success || !result.model) {
    const message = result.errors.length > 0
      ? result.errors.map((error) => `line ${error.line}:${error.column} ${error.message}`).join('; ')
      : 'Unknown BNGL parse failure';
    throw new Error(`BNGL parse failed: ${message}`);
  }
  return result.model;
}

function buildSimulationOptions(args: z.infer<typeof simulateArgsSchema> | z.infer<typeof parameterScanArgsSchema>): SimulationOptions {
  const simulationOptions: SimulationOptions = {
    method: args.method ?? 'ode',
    t_end: args.t_end ?? 10,
    n_steps: args.n_steps ?? 100,
    ...(args.solver !== undefined ? { solver: args.solver } : {}),
    ...(args.atol !== undefined ? { atol: args.atol } : {}),
    ...(args.rtol !== undefined ? { rtol: args.rtol } : {}),
    ...(args.max_steps !== undefined ? { maxSteps: args.max_steps } : {}),
    ...(args.seed !== undefined ? { seed: args.seed } : {}),
    ...(args.sparse !== undefined ? { sparse: args.sparse } : {}),
  };

  if (simulationOptions.method === 'ode' && simulationOptions.solver === undefined) {
    simulationOptions.solver = 'auto';
  }

  return simulationOptions;
}

function applyNetworkOptions<T extends { max_agents?: number; max_reactions?: number; max_iterations?: number; max_agg?: number }>(
  model: BNGLModel,
  args: T,
): BNGLModel {
  const hasOverrides = args.max_agents !== undefined
    || args.max_reactions !== undefined
    || args.max_iterations !== undefined
    || args.max_agg !== undefined;

  if (!hasOverrides) {
    return model;
  }

  return {
    ...model,
    networkOptions: {
      ...(model.networkOptions ?? {}),
      ...(args.max_agents !== undefined ? { maxSpecies: args.max_agents } : {}),
      ...(args.max_reactions !== undefined ? { maxReactions: args.max_reactions } : {}),
      ...(args.max_iterations !== undefined ? { maxIter: args.max_iterations } : {}),
      ...(args.max_agg !== undefined ? { maxAgg: args.max_agg } : {}),
    },
  };
}

async function expandModel(model: BNGLModel): Promise<BNGLModel> {
  return generateExpandedNetwork(
    model,
    () => { },
    () => { },
  );
}

function extractMoleculeNames(pattern: string): string[] {
  if (!pattern) {
    return [];
  }

  return pattern
    .split('.')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .map((segment) => {
      const match = segment.match(/^([A-Za-z0-9_]+)/);
      return match ? match[1] : segment;
    });
}

function buildInitialMoleculeSet(model: BNGLModel): Set<string> {
  const molecules = new Set<string>();

  model.species.forEach((species) => {
    extractMoleculeNames(species.name).forEach((name) => molecules.add(name));
  });

  return molecules;
}

function findUnreachableRules(model: BNGLModel): string[] {
  const knownMolecules = buildInitialMoleculeSet(model);
  const reachable = new Set<string>();
  const reactionRules = model.reactionRules ?? [];

  const ruleDescriptors = reactionRules.map((rule, index) => {
    const reactants = rule.reactants.flatMap(extractMoleculeNames);
    const products = rule.products.flatMap(extractMoleculeNames);
    const label = rule.name ?? `Rule ${index + 1}`;
    const id = rule.name ?? `rule_${index + 1}`;
    return { id, label, reactants, products };
  });

  let progress = true;
  while (progress) {
    progress = false;
    ruleDescriptors.forEach((descriptor) => {
      if (reachable.has(descriptor.id)) {
        return;
      }
      if (descriptor.reactants.length === 0 || descriptor.reactants.every((name) => knownMolecules.has(name))) {
        descriptor.products.forEach((name) => knownMolecules.add(name));
        reachable.add(descriptor.id);
        progress = true;
      }
    });
  }

  return ruleDescriptors
    .filter((descriptor) => !reachable.has(descriptor.id))
    .map((descriptor) => descriptor.label);
}

function validateModel(model: BNGLModel, includeNFsim: boolean): ValidateModelResult {
  const errors: ValidationMessage[] = [];
  const warnings: ValidationMessage[] = [];
  const info: ValidationMessage[] = [];

  if (model.observables.length === 0) {
    errors.push({
      source: 'model',
      code: 'MISSING_OBSERVABLES',
      severity: 'error',
      message: 'No observables defined. Add at least one observable to inspect simulation output.',
      relatedElement: 'observables',
    });
  }

  Object.entries(model.parameters).forEach(([name, value]) => {
    if (!Number.isFinite(value)) {
      errors.push({
        source: 'model',
        code: 'NON_FINITE_PARAMETER',
        severity: 'error',
        message: `Parameter ${name} is not a finite number.`,
        relatedElement: name,
      });
      return;
    }

    if (Math.abs(value) >= 1e6 || (Math.abs(value) > 0 && Math.abs(value) <= 1e-6)) {
      warnings.push({
        source: 'model',
        code: 'UNUSUAL_PARAMETER_MAGNITUDE',
        severity: 'warning',
        message: `Parameter ${name} has an unusual magnitude (${value}).`,
        relatedElement: name,
      });
    }
  });

  const unreachableRules = findUnreachableRules(model);
  if (unreachableRules.length > 0) {
    warnings.push({
      source: 'model',
      code: 'UNREACHABLE_RULES',
      severity: 'warning',
      message: `${unreachableRules.length} rule(s) may never trigger because their reactants are not reachable from seed species.`,
      relatedElement: unreachableRules.join(', '),
    });
  }

  model.observables.forEach((observable) => {
    const patternIssue = BNGLParser.validatePattern(observable.pattern);
    if (patternIssue) {
      errors.push({
        source: 'observable',
        code: 'INVALID_OBSERVABLE_PATTERN',
        severity: 'error',
        message: `Observable ${observable.name} has an invalid pattern: ${patternIssue}`,
        relatedElement: observable.name,
      });
    }
  });

  const nfsim = includeNFsim ? validateModelForNFsim(model) : null;
  if (nfsim) {
    nfsim.errors.forEach((issue) => {
      errors.push({
        source: 'nfsim',
        code: issue.type,
        severity: issue.severity ?? 'error',
        message: issue.message,
      });
    });
    nfsim.warnings.forEach((issue) => {
      warnings.push({
        source: 'nfsim',
        code: issue.type,
        severity: issue.severity ?? 'warning',
        message: issue.message,
      });
    });
    nfsim.recommendations.forEach((recommendation) => {
      info.push({
        source: 'nfsim',
        code: recommendation.type,
        severity: 'info',
        message: recommendation.message,
      });
    });
  }

  return {
    valid: errors.length === 0,
    parseSuccess: true,
    parseErrors: [],
    errors,
    warnings,
    info,
    summary: {
      errors: errors.length,
      warnings: warnings.length,
      info: info.length,
    },
    nfsim,
  };
}

function splitByTopLevelCommas(pattern: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  for (const ch of pattern) {
    if (ch === '(') {
      depth += 1;
    } else if (ch === ')') {
      depth = Math.max(0, depth - 1);
    }
    if (ch === ',' && depth === 0) {
      const trimmed = current.trim();
      if (trimmed) {
        parts.push(trimmed);
      }
      current = '';
      continue;
    }
    current += ch;
  }
  const trimmed = current.trim();
  if (trimmed) {
    parts.push(trimmed);
  }
  return parts;
}

function parseSpeciesGraphs(patterns: string[]): ParsedSpeciesGraph[] {
  const graphs: ParsedSpeciesGraph[] = [];
  for (const pattern of patterns) {
    const pieces = splitByTopLevelCommas(String(pattern));
    for (const piece of pieces) {
      graphs.push(BNGLParser.parseSpeciesGraph(piece, true));
    }
  }
  return graphs;
}

function extractBonds(graphs: ParsedSpeciesGraph[]): Map<string, { mol1: string; mol2: string; comp1: string; comp2: string }> {
  const bonds = new Map<string, { mol1: string; mol2: string; comp1: string; comp2: string }>();
  const sanitize = (name: string) => name.split('.')[0];

  graphs.forEach((graph) => {
    graph.molecules.forEach((molecule, molIdx) => {
      const molName = sanitize(molecule.name);
      molecule.components.forEach((component, compIdx) => {
        const partnerKeys = graph.adjacency.get(`${molIdx}.${compIdx}`);
        if (!partnerKeys || partnerKeys.length === 0) {
          return;
        }
        for (const partnerKey of partnerKeys) {
          const [partnerMolIdxStr, partnerCompIdxStr] = partnerKey.split('.');
          const partnerMolIdx = Number.parseInt(partnerMolIdxStr, 10);
          const partnerCompIdx = Number.parseInt(partnerCompIdxStr, 10);
          if (Number.isNaN(partnerMolIdx) || Number.isNaN(partnerCompIdx)) {
            continue;
          }
          if (partnerMolIdx < molIdx || (partnerMolIdx === molIdx && partnerCompIdx < compIdx)) {
            continue;
          }
          const partnerMolecule = graph.molecules[partnerMolIdx];
          const partnerComponent = partnerMolecule?.components[partnerCompIdx];
          if (!partnerMolecule || !partnerComponent) {
            continue;
          }
          const partnerName = sanitize(partnerMolecule.name);
          const endpoints = [`${molName}:${component.name}`, `${partnerName}:${partnerComponent.name}`].sort();
          const key = endpoints.join('|');
          bonds.set(key, {
            mol1: molName,
            mol2: partnerName,
            comp1: component.name,
            comp2: partnerComponent.name,
          });
        }
      });
    });
  });

  return bonds;
}

function buildContactMap(rules: ReactionRule[], moleculeTypes: BNGLMoleculeType[] = []): ContactMap {
  const moleculeMap = new Map<string, Set<string>>();
  const componentStateMap = new Map<string, Set<string>>();
  const edgeMap = new Map<string, ContactEdge>();

  moleculeTypes.forEach((moleculeType) => {
    if (!moleculeMap.has(moleculeType.name)) {
      moleculeMap.set(moleculeType.name, new Set());
    }
    moleculeType.components.forEach((componentDefinition) => {
      const parts = componentDefinition.split('~');
      const componentName = parts[0];
      moleculeMap.get(moleculeType.name)?.add(componentName);
      if (parts.length > 1) {
        const stateKey = `${moleculeType.name}_${componentName}`;
        if (!componentStateMap.has(stateKey)) {
          componentStateMap.set(stateKey, new Set());
        }
        parts.slice(1).forEach((state) => componentStateMap.get(stateKey)?.add(state));
      }
    });
  });

  rules.forEach((rule, index) => {
    const ruleId = rule.name ?? `rule_${index + 1}`;
    const ruleLabel = rule.name ?? `Rule ${index + 1}`;
    const reactantGraphs = parseSpeciesGraphs(rule.reactants);
    const productGraphs = parseSpeciesGraphs(rule.products);
    [...reactantGraphs, ...productGraphs].forEach((graph) => {
      graph.molecules.forEach((molecule) => {
        if (molecule.name === '0') {
          return;
        }
        const moleculeName = molecule.name.split('.')[0];
        if (!moleculeMap.has(moleculeName)) {
          moleculeMap.set(moleculeName, new Set());
        }
        molecule.components.forEach((component) => {
          moleculeMap.get(moleculeName)?.add(component.name);
          if (component.state && component.state !== '?') {
            const stateKey = `${moleculeName}_${component.name}`;
            if (!componentStateMap.has(stateKey)) {
              componentStateMap.set(stateKey, new Set());
            }
            componentStateMap.get(stateKey)?.add(component.state);
          }
        });
      });
    });

    const bonds = new Map<string, { mol1: string; mol2: string; comp1: string; comp2: string }>();
    extractBonds(reactantGraphs).forEach((value, key) => bonds.set(key, value));
    extractBonds(productGraphs).forEach((value, key) => bonds.set(key, value));

    bonds.forEach((bond) => {
      const source = `${bond.mol1}_${bond.comp1}`;
      const target = `${bond.mol2}_${bond.comp2}`;
      const edgeKey = `${source}->${target}`;
      if (!edgeMap.has(edgeKey)) {
        edgeMap.set(edgeKey, {
          from: source,
          to: target,
          interactionType: 'binding',
          componentPair: [bond.comp1, bond.comp2],
          ruleIds: [],
          ruleLabels: [],
        });
      }
      const edge = edgeMap.get(edgeKey);
      if (edge && !edge.ruleIds.includes(ruleId)) {
        edge.ruleIds.push(ruleId);
        edge.ruleLabels.push(ruleLabel);
      }
    });
  });

  const nodes: ContactNode[] = [];
  const sortedMolecules = Array.from(moleculeMap.keys()).sort();
  const idMap = new Map<string, string>();

  sortedMolecules.forEach((moleculeName, moleculeIndex) => {
    const moleculeId = `${moleculeIndex}`;
    const components = Array.from(moleculeMap.get(moleculeName) ?? []).sort();
    idMap.set(moleculeName, moleculeId);
    nodes.push({
      id: moleculeId,
      label: moleculeName,
      type: 'molecule',
      isGroup: components.length > 0,
    });
    components.forEach((componentName, componentIndex) => {
      const componentId = `${moleculeIndex}.${componentIndex}`;
      idMap.set(`${moleculeName}_${componentName}`, componentId);
      const stateKey = `${moleculeName}_${componentName}`;
      const states = Array.from(componentStateMap.get(stateKey) ?? []).sort();
      nodes.push({
        id: componentId,
        label: componentName,
        type: 'component',
        parent: moleculeId,
        isGroup: states.length > 0,
      });
      states.forEach((stateName, stateIndex) => {
        nodes.push({
          id: `${moleculeIndex}.${componentIndex}.${stateIndex}`,
          label: stateName,
          type: 'state',
          parent: componentId,
        });
      });
    });
  });

  const validNodeIds = new Set(nodes.map((node) => node.id));
  const edges = Array.from(edgeMap.values())
    .map((edge) => ({
      ...edge,
      from: idMap.get(edge.from) ?? edge.from,
      to: idMap.get(edge.to) ?? edge.to,
    }))
    .filter((edge) => validNodeIds.has(edge.from) && validNodeIds.has(edge.to));

  return { nodes, edges };
}

function assertScannableParameter(model: BNGLModel, parameter: string): void {
  if (!(parameter in model.parameters)) {
    throw new Error(`Unknown parameter for parameter_scan: ${parameter}`);
  }
}

function updateMassActionRates(model: BNGLModel): void {
  const context = model.parameters ?? {};
  for (const reaction of model.reactions ?? []) {
    if (!reaction.isFunctionalRate && reaction.rate && typeof reaction.rate === 'string') {
      try {
        const updatedRate = evaluateFunctionalRate(reaction.rate, context, {}, model.functions);
        if (Number.isFinite(updatedRate)) {
          reaction.rateConstant = updatedRate;
        }
      } catch {
        // Keep the existing concrete rate when a symbolic update fails.
      }
    }
  }
  clearAllEvaluatorCaches();
}

function cloneExpandedModel(model: BNGLModel): BNGLModel {
  return structuredClone(model);
}

export async function handleParseBngl(args: ToolArgs): Promise<ToolResult<ReturnType<typeof parseBNGLWithANTLR>>> {
  const parsedArgs = parseArgs('parse_bngl', parseBnglArgsSchema, args);
  const result = parseBNGLWithANTLR(parsedArgs.code);
  return createToolResult(result);
}

export async function handleGenerateNetwork(args: ToolArgs): Promise<ToolResult<BNGLModel>> {
  const parsedArgs = parseArgs('generate_network', generateNetworkArgsSchema, args);
  const model = applyNetworkOptions(parseModelOrThrow(parsedArgs.code), parsedArgs);
  const expandedModel = await expandModel(model);
  return createToolResult(expandedModel);
}

export async function handleSimulate(args: ToolArgs): Promise<ToolResult<Awaited<ReturnType<typeof simulate>>>> {
  const parsedArgs = parseArgs('simulate', simulateArgsSchema, args);
  const model = applyNetworkOptions(parseModelOrThrow(parsedArgs.code), parsedArgs);
  const expandedModel = await expandModel(model);
  const simulationOptions = buildSimulationOptions(parsedArgs);
  if (parsedArgs.include_species_data !== undefined) {
    simulationOptions.includeSpeciesData = parsedArgs.include_species_data;
  }
  
  await loadEvaluator();
  const results = await simulate(0, expandedModel, simulationOptions, {
    checkCancelled: () => { },
    postMessage: () => { },
  });
  return createToolResult(results);
}

export async function handleParameterScan(args: ToolArgs): Promise<ToolResult<ParameterScanResult>> {
  const parsedArgs = parseArgs('parameter_scan', parameterScanArgsSchema, args);
  if (parsedArgs.parameter2 !== undefined) {
    if (parsedArgs.parameter2 === parsedArgs.parameter) {
      throw new Error('parameter_scan requires two distinct parameters for 2D scans.');
    }
    if (parsedArgs.start2 === undefined || parsedArgs.end2 === undefined || parsedArgs.steps2 === undefined) {
      throw new Error('parameter_scan requires start2, end2, and steps2 when parameter2 is provided.');
    }
  }

  const baseModel = applyNetworkOptions(parseModelOrThrow(parsedArgs.code), parsedArgs);
  assertScannableParameter(baseModel, parsedArgs.parameter);
  if (parsedArgs.parameter2 !== undefined) {
    assertScannableParameter(baseModel, parsedArgs.parameter2);
  }

  const expandedModel = await expandModel(baseModel);
  const xValues = generateRange(parsedArgs.start, parsedArgs.end, parsedArgs.steps, parsedArgs.logarithmic ?? false);
  const yValues = parsedArgs.parameter2 !== undefined
    ? generateRange(parsedArgs.start2!, parsedArgs.end2!, parsedArgs.steps2!, parsedArgs.logarithmic ?? false)
    : [];

  if (xValues.length * Math.max(1, yValues.length || 1) > 400) {
    throw new Error('parameter_scan supports at most 400 simulation combinations per request.');
  }

  const simulationOptions = buildSimulationOptions(parsedArgs);

  if (parsedArgs.parameter2 === undefined) {
    const observables: Record<string, number[]> = {};
    expandedModel.observables.forEach((observable) => {
      observables[observable.name] = [];
    });

    await loadEvaluator();
    for (const value of xValues) {
      const runModel = cloneExpandedModel(expandedModel);
      runModel.parameters[parsedArgs.parameter] = value;
      updateMassActionRates(runModel);
      const result = await simulate(0, runModel, simulationOptions, {
        checkCancelled: () => { },
        postMessage: () => { },
      });
      const lastPoint = result.data.at(-1) ?? {};
      Object.keys(observables).forEach((observableName) => {
        const rawValue = lastPoint[observableName as keyof typeof lastPoint];
        const numericValue = typeof rawValue === 'number' ? rawValue : Number(rawValue ?? 0);
        observables[observableName].push(Number.isFinite(numericValue) ? numericValue : 0);
      });
    }

    return createToolResult({
      mode: '1d',
      parameter: parsedArgs.parameter,
      xValues,
      observables,
    });
  }

  const observables: Record<string, number[][]> = {};
  expandedModel.observables.forEach((observable) => {
    observables[observable.name] = yValues.map(() => new Array(xValues.length).fill(0));
  });

  await loadEvaluator();
  for (let yIndex = 0; yIndex < yValues.length; yIndex += 1) {
    for (let xIndex = 0; xIndex < xValues.length; xIndex += 1) {
      const runModel = cloneExpandedModel(expandedModel);
      runModel.parameters[parsedArgs.parameter] = xValues[xIndex];
      runModel.parameters[parsedArgs.parameter2] = yValues[yIndex];
      updateMassActionRates(runModel);
      const result = await simulate(0, runModel, simulationOptions, {
        checkCancelled: () => { },
        postMessage: () => { },
      });
      const lastPoint = result.data.at(-1) ?? {};
      Object.keys(observables).forEach((observableName) => {
        const rawValue = lastPoint[observableName as keyof typeof lastPoint];
        const numericValue = typeof rawValue === 'number' ? rawValue : Number(rawValue ?? 0);
        observables[observableName][yIndex][xIndex] = Number.isFinite(numericValue) ? numericValue : 0;
      });
    }
  }

  return createToolResult({
    mode: '2d',
    parameter: parsedArgs.parameter,
    parameter2: parsedArgs.parameter2,
    xValues,
    yValues,
    observables,
  });
}

export async function handleValidateModel(args: ToolArgs): Promise<ToolResult<ValidateModelResult>> {
  const parsedArgs = parseArgs('validate_model', validateModelArgsSchema, args);
  const parseResult = parseBNGLWithANTLR(parsedArgs.code);
  if (!parseResult.success || !parseResult.model) {
    const result: ValidateModelResult = {
      valid: false,
      parseSuccess: false,
      parseErrors: parseResult.errors,
      errors: parseResult.errors.map((error) => ({
        source: 'parse',
        code: 'PARSE_ERROR',
        severity: 'error',
        message: `line ${error.line}:${error.column} ${error.message}`,
      })),
      warnings: [],
      info: [],
      summary: {
        errors: parseResult.errors.length,
        warnings: 0,
        info: 0,
      },
      nfsim: null,
    };
    return createToolResult(result);
  }

  return createToolResult(validateModel(parseResult.model, parsedArgs.include_nfsim ?? true));
}

export async function handleGetContactMap(args: ToolArgs): Promise<ToolResult<ContactMap>> {
  const parsedArgs = parseArgs('get_contact_map', getContactMapArgsSchema, args);
  const model = parseModelOrThrow(parsedArgs.code);
  return createToolResult(buildContactMap(model.reactionRules ?? [], model.moleculeTypes ?? []));
}

const server = new Server(
  {
    name: 'bng-mcp-server',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'parse_bngl',
        description: 'Parse BNGL (BioNetGen Language) code and return structured result',
        inputSchema: {
          type: 'object',
          properties: {
            code: {
              type: 'string',
              description: 'BNGL code to parse',
            },
          },
          required: ['code'],
        },
      },
      {
        name: 'generate_network',
        description: 'Generate expanded reaction network from BNGL model',
        inputSchema: {
          type: 'object',
          properties: {
            code: {
              type: 'string',
              description: 'BNGL code to generate network from',
            },
            max_agents: {
              type: 'number',
              description: 'Maximum number of agent patterns (default: 1000)',
            },
            max_iterations: {
              type: 'number',
              description: 'Maximum number of expansion iterations (default: 100)',
            },
            max_reactions: {
              type: 'number',
              description: 'Maximum number of generated reactions',
            },
            max_agg: {
              type: 'number',
              description: 'Maximum aggregate size during expansion',
            },
          },
          required: ['code'],
        },
      },
      {
        name: 'simulate',
        description: 'Run ODE/SSA simulation on BNGL model',
        inputSchema: {
          type: 'object',
          properties: {
            code: {
              type: 'string',
              description: 'BNGL code to simulate',
            },
            method: {
              type: 'string',
              enum: [...simulationMethods],
              description: 'Simulation method (default: ode)',
            },
            t_end: {
              type: 'number',
              description: 'End time for simulation (default: 10)',
            },
            n_steps: {
              type: 'number',
              description: 'Number of time points (default: 100)',
            },
            solver: {
              type: 'string',
              enum: [...solverValues],
              description: 'Optional ODE solver override. Defaults to rk4 for ODE requests in the MCP server.',
            },
            atol: {
              type: 'number',
              description: 'Absolute tolerance for deterministic solvers',
            },
            rtol: {
              type: 'number',
              description: 'Relative tolerance for deterministic solvers',
            },
            max_steps: {
              type: 'number',
              description: 'Maximum internal solver steps',
            },
            seed: {
              type: 'number',
              description: 'Random seed for stochastic simulations',
            },
            sparse: {
              type: 'boolean',
              description: 'Request sparse deterministic solving when supported',
            },
            include_species_data: {
              type: 'boolean',
              description: 'Include species trajectories in the response',
            },
            max_agents: {
              type: 'number',
              description: 'Maximum number of generated species during pre-simulation network expansion',
            },
            max_reactions: {
              type: 'number',
              description: 'Maximum number of generated reactions during pre-simulation network expansion',
            },
            max_iterations: {
              type: 'number',
              description: 'Maximum number of network expansion iterations before simulation',
            },
            max_agg: {
              type: 'number',
              description: 'Maximum aggregate size allowed during pre-simulation network expansion',
            },
          },
          required: ['code'],
        },
      },
      {
        name: 'parameter_scan',
        description: 'Run a 1D or 2D parameter scan while reusing a single expanded network',
        inputSchema: {
          type: 'object',
          properties: {
            code: { type: 'string', description: 'BNGL code to scan' },
            parameter: { type: 'string', description: 'Primary parameter name to scan' },
            start: { type: 'number', description: 'Start value for the primary parameter' },
            end: { type: 'number', description: 'End value for the primary parameter' },
            steps: { type: 'number', description: 'Number of primary scan points' },
            parameter2: { type: 'string', description: 'Optional second parameter for a 2D scan' },
            start2: { type: 'number', description: 'Start value for the secondary parameter' },
            end2: { type: 'number', description: 'End value for the secondary parameter' },
            steps2: { type: 'number', description: 'Number of secondary scan points' },
            logarithmic: { type: 'boolean', description: 'Use log-spaced ranges instead of linear spacing' },
            method: { type: 'string', enum: [...simulationMethods], description: 'Simulation method for each scan point' },
            t_end: { type: 'number', description: 'End time for each simulation' },
            n_steps: { type: 'number', description: 'Number of output steps for each simulation' },
            solver: { type: 'string', enum: [...solverValues], description: 'Optional deterministic solver override' },
          },
          required: ['code', 'parameter', 'start', 'end', 'steps'],
        },
      },
      {
        name: 'validate_model',
        description: 'Parse and validate BNGL structure, observables, and NFsim compatibility',
        inputSchema: {
          type: 'object',
          properties: {
            code: { type: 'string', description: 'BNGL code to validate' },
            include_nfsim: { type: 'boolean', description: 'Include NFsim compatibility checks in the result' },
          },
          required: ['code'],
        },
      },
      {
        name: 'get_contact_map',
        description: 'Build a static contact map from the parsed molecule types and reaction rules',
        inputSchema: {
          type: 'object',
          properties: {
            code: { type: 'string', description: 'BNGL code to analyze' },
          },
          required: ['code'],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request: { params: { name: string; arguments: Record<string, unknown> } }) => {
  const { name, arguments: args } = request.params;
  switch (name) {
    case 'parse_bngl':
      return handleParseBngl(args);
    case 'generate_network':
      return handleGenerateNetwork(args);

    case 'simulate':
      return handleSimulate(args);
    case 'parameter_scan':
      return handleParameterScan(args);
    case 'validate_model':
      return handleValidateModel(args);
    case 'get_contact_map':
      return handleGetContactMap(args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

// start listening (stubbed behavior for tests, stdio transport for runtime)
server.listen?.(new StdioServerTransport());

export { server };

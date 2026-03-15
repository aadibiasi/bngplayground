import {
    analyzeModelStiffness,
    computeFIM,
    formatBNGL,
    parseBNGLWithANTLR,
    simulate,
    sobolSensitivity,
    loadEvaluator,
} from '@bngplayground/engine';
import { parseModelOrThrow, validateModel, cloneExpandedModel, updateMassActionRates, expandModel, buildSimulationOptions, extractMoleculeNames } from './engine.js';
import { handleSimulate } from '../handlers/simulate.js';
import { BioParser } from './grammar/parser.js';
import { BNGLGenerator } from './grammar/generator.js';
import type { DefinitionSentence } from './grammar/types.js';

type ComposeSeedSpecies = {
    species: string;
    count: number;
};

type ComposeRule = {
    name: string;
    rule: string;
    source: string;
};

type ComposeAnalysis = {
    recognizedCount: number;
    unparsedStatements: string[];
};

type ComposeMolecule = {
    name: string;
    sites: string[];
    states: Record<string, string[]>;
};

type SuggestedFix = {
    issue: string;
    suggestion: string;
    severity: 'error' | 'warning' | 'info';
};

type ExplainSection = {
    title: string;
    content: string;
};

function normalizeWhitespace(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
}

function uniquePush(target: string[], value: string): void {
    if (!target.includes(value)) {
        target.push(value);
    }
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function ensureBlock(code: string, blockName: string): string {
    const begin = `begin ${blockName}`;
    const end = `end ${blockName}`;
    if (code.includes(begin) && code.includes(end)) {
        return code;
    }

    const trimmed = code.trimEnd();
    if (trimmed.length === 0) {
        return `${begin}\n${end}\n`;
    }

    return `${trimmed}\n${begin}\n${end}\n`;
}

function insertIntoBlock(code: string, blockName: string, line: string): string {
    const ensured = ensureBlock(code, blockName);
    const endRegex = new RegExp(`end\\s+${blockName}\\s*$`, 'm');
    const match = ensured.match(endRegex);
    if (!match || match.index === undefined) {
        return `${ensured.trimEnd()}\n${line}\n`;
    }

    const insertionPoint = match.index;
    const head = ensured.slice(0, insertionPoint).trimEnd();
    const tail = ensured.slice(insertionPoint);
    return `${head}\n  ${line}\n${tail}`;
}

function replaceLineInBlock(code: string, blockName: string, matcher: (trimmedLine: string) => boolean, replacementLine: string): string {
    const ensured = ensureBlock(code, blockName);
    const beginRegex = new RegExp(`begin\\s+${blockName}\\s*$`, 'm');
    const endRegex = new RegExp(`end\\s+${blockName}\\s*$`, 'm');

    const beginMatch = ensured.match(beginRegex);
    const endMatch = ensured.match(endRegex);
    if (!beginMatch || !endMatch || beginMatch.index === undefined || endMatch.index === undefined) {
        return ensured;
    }

    const blockStart = beginMatch.index + beginMatch[0].length;
    const blockEnd = endMatch.index;
    const prefix = ensured.slice(0, blockStart);
    const blockBody = ensured.slice(blockStart, blockEnd);
    const suffix = ensured.slice(blockEnd);

    const lines = blockBody.split('\n');
    let replaced = false;
    const updated = lines.map((rawLine) => {
        const trimmed = rawLine.trim();
        if (!replaced && trimmed.length > 0 && matcher(trimmed)) {
            replaced = true;
            return `  ${replacementLine}`;
        }
        return rawLine;
    });

    return `${prefix}${updated.join('\n')}${suffix}`;
}

function removeLineInBlock(code: string, blockName: string, matcher: (trimmedLine: string) => boolean): string {
    const ensured = ensureBlock(code, blockName);
    const beginRegex = new RegExp(`begin\\s+${blockName}\\s*$`, 'm');
    const endRegex = new RegExp(`end\\s+${blockName}\\s*$`, 'm');

    const beginMatch = ensured.match(beginRegex);
    const endMatch = ensured.match(endRegex);
    if (!beginMatch || !endMatch || beginMatch.index === undefined || endMatch.index === undefined) {
        return ensured;
    }

    const blockStart = beginMatch.index + beginMatch[0].length;
    const blockEnd = endMatch.index;
    const prefix = ensured.slice(0, blockStart);
    const blockBody = ensured.slice(blockStart, blockEnd);
    const suffix = ensured.slice(blockEnd);

    const lines = blockBody.split('\n');
    const updated = lines.filter((rawLine) => {
        const trimmed = rawLine.trim();
        if (trimmed.length === 0) {
            return true;
        }
        return !matcher(trimmed);
    });

    return `${prefix}${updated.join('\n')}${suffix}`;
}

function gatherMoleculeTypesFromRules(rules: ComposeRule[]): string[] {
    const types: string[] = [];

    for (const rule of rules) {
        if (rule.rule.includes('(state~u)') || rule.rule.includes('(state~p)')) {
            const match = rule.rule.match(/\b([A-Za-z][A-Za-z0-9_]*)\(state~u\)/);
            if (match) {
                uniquePush(types, `${match[1]}(state~u~p)`);
            }
        }

        const moleculeMatches = [...rule.rule.matchAll(/\b([A-Za-z][A-Za-z0-9_]*)\(([^)]*)\)/g)];
        for (const m of moleculeMatches) {
            const name = m[1];
            const siteBody = m[2].trim();
            if (siteBody.length === 0 || siteBody.includes('state~')) {
                continue;
            }
            if (siteBody.includes('a') || siteBody.includes('b')) {
                if (siteBody.includes('a')) {
                    uniquePush(types, `${name}(a)`);
                }
                if (siteBody.includes('b')) {
                    uniquePush(types, `${name}(b)`);
                }
            }
        }

        const statelessMatches = [...rule.rule.matchAll(/\b([A-Za-z][A-Za-z0-9_]*)\(\)/g)];
        for (const m of statelessMatches) {
            uniquePush(types, `${m[1]}()`);
        }
    }

    return types;
}

function pickDefaultSeeds(moleculeTypes: string[]): ComposeSeedSpecies[] {
    if (moleculeTypes.length === 0) {
        return [{ species: 'A()', count: 100 }];
    }

    return moleculeTypes.slice(0, 6).map((definition) => {
        const species = definition.replace(/\([^)]*\)/, '()');
        return { species, count: 100 };
    });
}

function ensureModelEnvelope(code: string): string {
    return code.trim();
}

function insertRuleLine(code: string, ruleLine: string): string {
    return insertIntoBlock(code, 'reaction rules', ruleLine);
}

function updateParameterLine(code: string, name: string, value: number): string {
    const assignment = `${name} ${value}`;
    const hasParameter = new RegExp(`^\\s*${name}\\s+`, 'm').test(code);

    if (hasParameter) {
        return replaceLineInBlock(code, 'parameters', (line) => line.startsWith(`${name} `), assignment);
    }

    return insertIntoBlock(code, 'parameters', assignment);
}

function setSeedSpeciesLine(code: string, species: string, count: number): string {
    const normalizedSpecies = normalizeWhitespace(species);
    const matcher = (line: string) => line.startsWith(`${normalizedSpecies} `);
    const replacement = `${normalizedSpecies} ${count}`;

    if (new RegExp(`^\\s*${escapeRegExp(normalizedSpecies)}\\s+`, 'm').test(code)) {
        return replaceLineInBlock(code, 'seed species', matcher, replacement);
    }

    return insertIntoBlock(code, 'seed species', replacement);
}

function setObservableLine(code: string, name: string, type: 'Molecules' | 'Species', pattern: string): string {
    const normalizedName = normalizeWhitespace(name);
    const normalizedPattern = normalizeWhitespace(pattern);
    const line = `${type} ${normalizedName} ${normalizedPattern}`;

    if (new RegExp(`^\\s*(Molecules|Species)\\s+${escapeRegExp(normalizedName)}\\b`, 'm').test(code)) {
        return replaceLineInBlock(
            code,
            'observables',
            (raw) => /^(Molecules|Species)\s+/.test(raw) && raw.split(/\s+/)[1] === normalizedName,
            line,
        );
    }

    return insertIntoBlock(code, 'observables', line);
}

export function composeModelFromStatements(args: {
    statements?: string[];
    parameters?: Record<string, number>;
    seed_species?: ComposeSeedSpecies[];
    strict?: boolean;
}): {
    code: string;
    rules: Array<{ name: string; rule: string }>;
    analysis: ComposeAnalysis;
    molecules: ComposeMolecule[];
    confirmation: string;
} {
    if (!args.statements || args.statements.length === 0) {
        throw new Error('No statements were provided for model composition.');
    }

    const documentText = args.statements.map((line) => normalizeWhitespace(line)).join('\n');
    const sentences = BioParser.parseDocument(documentText);
    const validSentences = sentences.filter((sentence) => sentence.isValid && sentence.type !== 'COMMENT');
    const invalidSentences = sentences.filter((sentence) => !sentence.isValid || sentence.type === 'INVALID');

    if (args.strict && validSentences.length === 0) {
        throw new Error('No statements could be translated into a valid designer grammar sentence.');
    }

    const generated = BNGLGenerator.generate(sentences);
    let currentCode = generated;

    if (args.parameters) {
        for (const [name, value] of Object.entries(args.parameters)) {
            currentCode = updateParameterLine(currentCode, name, value);
        }
    }

    if (args.seed_species && args.seed_species.length > 0) {
        for (const seed of args.seed_species) {
            currentCode = setSeedSpeciesLine(currentCode, seed.species, seed.count);
        }
    }

    const formattedCode = currentCode.includes('begin model')
        ? currentCode
        : (() => {
            try {
                return formatBNGL(currentCode);
            } catch {
                return currentCode;
            }
        })();

    const parseResult = parseBNGLWithANTLR(formattedCode);
    if (!parseResult.success) {
        const messages = parseResult.errors.map((error: any) => `line ${error.line}:${error.column} ${error.message}`).join('; ');
        throw new Error(`Composed model is invalid BNGL: ${messages || 'unknown parse error'}`);
    }

    const model = parseResult.model;
    const ruleList = (model?.reactionRules ?? []).map((rule, index) => ({
        name: rule.name ?? `rule_${index + 1}`,
        rule: `${rule.reactants.join(' + ')} ${rule.isBidirectional ? '<->' : '->'} ${rule.products.join(' + ')} ${rule.rate}`,
    }));

    const definitionSentences = sentences.filter((sentence): sentence is DefinitionSentence => sentence.type === 'DEFINITION' && sentence.isValid);
    const definitionsByName = new Map<string, ComposeMolecule>();
    for (const definition of definitionSentences) {
        definitionsByName.set(definition.agent.name, {
            name: definition.agent.name,
            sites: [...definition.agent.sites],
            states: Object.fromEntries(
                Object.entries(definition.agent.states).map(([site, states]) => [site, [...states]]),
            ),
        });
    }

    const molecules: ComposeMolecule[] = (model?.moleculeTypes ?? []).map((moleculeType) => {
        const fromDefinition = definitionsByName.get(moleculeType.name);
        return {
            name: moleculeType.name,
            sites: fromDefinition?.sites ?? [...moleculeType.components],
            states: fromDefinition?.states ?? {},
        };
    });

    const unparsedStatements = invalidSentences.map((sentence) => sentence.text);

    return {
        code: formattedCode,
        rules: ruleList,
        analysis: {
            recognizedCount: validSentences.length,
            unparsedStatements,
        },
        molecules,
        confirmation: `Parsed ${validSentences.length}/${sentences.length} statements into BNGL.`,
    };
}

export function applyModelEdits(
    code: string,
    operations: Array<Record<string, unknown>>,
): {
    code: string;
    summary: string[];
    validation: {
        valid: boolean;
        errors: number;
        warnings: number;
    };
} {
    let current = ensureModelEnvelope(code);
    const summary: string[] = [];

    for (const operation of operations) {
        const action = String(operation.action ?? '');
        switch (action) {
            case 'add_rule': {
                const rule = normalizeWhitespace(String(operation.rule ?? ''));
                current = insertRuleLine(current, rule);
                summary.push(`Added rule: ${rule}`);
                break;
            }
            case 'add_statement': {
                const text = String(operation.text ?? '');
                const composed = composeModelFromStatements({ statements: [text] });
                if (composed.rules.length === 0) {
                    throw new Error(`Unable to translate statement into a rule: ${text}`);
                }
                const translated = composed.rules[0];
                current = insertRuleLine(current, `${translated.name}: ${translated.rule}`);
                summary.push(`Added statement as rule: ${translated.name}`);
                break;
            }
            case 'remove_rule': {
                const name = normalizeWhitespace(String(operation.name ?? ''));
                current = removeLineInBlock(current, 'reaction rules', (line) => line.startsWith(`${name}:`) || line === name);
                summary.push(`Removed rule: ${name}`);
                break;
            }
            case 'remove_rule_index': {
                const index = Number(operation.index ?? -1);
                const ensured = ensureBlock(current, 'reaction rules');
                const blockMatch = ensured.match(/begin\s+reaction rules([\s\S]*?)end\s+reaction rules/m);
                if (!blockMatch) {
                    throw new Error('Reaction rules block not found.');
                }
                const lines = blockMatch[1]
                    .split('\n')
                    .map((line) => line.trim())
                    .filter((line) => line.length > 0);
                if (!Number.isInteger(index) || index < 0 || index >= lines.length) {
                    throw new Error(`Rule index ${index} is out of bounds.`);
                }
                const removed = lines[index];
                current = removeLineInBlock(current, 'reaction rules', (line) => line === removed);
                summary.push(`Removed rule at index ${index}`);
                break;
            }
            case 'set_parameter':
            case 'add_parameter': {
                const name = normalizeWhitespace(String(operation.name ?? ''));
                const value = Number(operation.value);
                if (!Number.isFinite(value)) {
                    throw new Error(`Invalid parameter value for ${name}.`);
                }
                current = updateParameterLine(current, name, value);
                summary.push(`Set parameter ${name} = ${value}`);
                break;
            }
            case 'set_concentration': {
                const species = normalizeWhitespace(String(operation.species ?? ''));
                const value = Number(operation.value);
                if (!Number.isFinite(value)) {
                    throw new Error(`Invalid concentration for ${species}.`);
                }
                current = setSeedSpeciesLine(current, species, value);
                summary.push(`Set concentration ${species} = ${value}`);
                break;
            }
            case 'add_observable': {
                const name = String(operation.name ?? 'obs');
                const type = (String(operation.type ?? 'Molecules') === 'Species' ? 'Species' : 'Molecules') as 'Molecules' | 'Species';
                const pattern = String(operation.pattern ?? '');
                current = setObservableLine(current, name, type, pattern);
                summary.push(`Added/updated observable ${name}`);
                break;
            }
            case 'remove_observable': {
                const name = normalizeWhitespace(String(operation.name ?? ''));
                current = removeLineInBlock(current, 'observables', (line) => {
                    if (!/^(Molecules|Species)\s+/.test(line)) {
                        return false;
                    }
                    return line.split(/\s+/)[1] === name;
                });
                summary.push(`Removed observable ${name}`);
                break;
            }
            case 'add_molecule_type': {
                const definition = normalizeWhitespace(String(operation.definition ?? ''));
                current = insertIntoBlock(current, 'molecule types', definition);
                summary.push(`Added molecule type ${definition}`);
                break;
            }
            case 'add_species': {
                const species = normalizeWhitespace(String(operation.species ?? ''));
                const concentration = Number(operation.concentration);
                if (!Number.isFinite(concentration)) {
                    throw new Error(`Invalid species concentration for ${species}.`);
                }
                current = insertIntoBlock(current, 'seed species', `${species} ${concentration}`);
                summary.push(`Added seed species ${species}`);
                break;
            }
            default:
                throw new Error(`Unsupported edit operation: ${action}`);
        }
    }

    const formatted = (() => {
        try {
            return formatBNGL(current);
        } catch {
            return current;
        }
    })();

    const parsedModel = parseModelOrThrow(formatted);
    const validation = validateModel(parsedModel, false);

    return {
        code: formatted,
        summary,
        validation: {
            valid: validation.valid,
            errors: validation.summary.errors,
            warnings: validation.summary.warnings,
        },
    };
}

function detectOscillation(samples: number[]): boolean {
    if (samples.length < 8) {
        return false;
    }

    const mean = samples.reduce((acc, value) => acc + value, 0) / samples.length;
    const minValue = Math.min(...samples);
    const maxValue = Math.max(...samples);
    const amplitude = maxValue - minValue;
    const scale = Math.max(1e-9, Math.abs(mean));
    if (amplitude / scale < 0.05) {
        return false;
    }

    let signChanges = 0;
    let lastSign = 0;
    for (let i = 1; i < samples.length; i++) {
        const diff = samples[i] - samples[i - 1];
        const sign = diff > 0 ? 1 : diff < 0 ? -1 : 0;
        if (sign !== 0 && lastSign !== 0 && sign !== lastSign) {
            signChanges += 1;
        }
        if (sign !== 0) {
            lastSign = sign;
        }
    }

    return signChanges >= 4;
}

function reachedSteadyState(samples: number[]): boolean {
    if (samples.length < 6) {
        return false;
    }

    const tail = samples.slice(-5);
    const start = tail[0];
    const end = tail[tail.length - 1];
    const delta = Math.abs(end - start);
    const scale = Math.max(1e-9, Math.abs(start), Math.abs(end));
    return delta / scale < 0.01;
}

function getMoleculeCounts(side: string): Map<string, number> {
    const counts = new Map<string, number>();
    const tokens = side.split('+').map((token) => token.trim()).filter(Boolean);
    for (const token of tokens) {
        const moleculeMatch = token.match(/^([A-Za-z][A-Za-z0-9_]*)\(/);
        if (!moleculeMatch) {
            continue;
        }
        const name = moleculeMatch[1];
        counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return counts;
}

function inferConservationHints(ruleLines: string[]): string[] {
    const hints: string[] = [];
    for (const line of ruleLines) {
        const normalized = normalizeWhitespace(line);
        const noLabel = normalized.replace(/^[^:]+:\s*/, '');
        const split = noLabel.split('->');
        if (split.length !== 2 || noLabel.includes('<->')) {
            continue;
        }

        const left = getMoleculeCounts(split[0]);
        const rightSide = split[1].replace(/\s+[A-Za-z0-9_\.]+\s*$/, '');
        const right = getMoleculeCounts(rightSide);
        if (left.size === 0 || right.size === 0) {
            continue;
        }

        const allNames = new Set<string>([...left.keys(), ...right.keys()]);
        const conserved = [...allNames].every((name) => (left.get(name) ?? 0) === (right.get(name) ?? 0));
        if (conserved) {
            hints.push(`Potential moiety-conserving transformation: ${normalized}`);
        }
        if (hints.length >= 3) {
            break;
        }
    }
    return hints;
}

function buildMoleculeGraph(ruleDescriptors: Array<{ reactants: string[]; products: string[] }>): Map<string, Set<string>> {
    const graph = new Map<string, Set<string>>();
    const connect = (a: string, b: string) => {
        if (a === b) return;
        if (!graph.has(a)) graph.set(a, new Set<string>());
        if (!graph.has(b)) graph.set(b, new Set<string>());
        graph.get(a)!.add(b);
        graph.get(b)!.add(a);
    };

    for (const descriptor of ruleDescriptors) {
        const molecules = Array.from(new Set([
            ...descriptor.reactants.flatMap(extractMoleculeNames),
            ...descriptor.products.flatMap(extractMoleculeNames),
        ]));
        for (let i = 0; i < molecules.length; i++) {
            for (let j = i + 1; j < molecules.length; j++) {
                connect(molecules[i], molecules[j]);
            }
        }
    }

    return graph;
}

function findShortestPath(
    graph: Map<string, Set<string>>,
    sources: string[],
    targets: Set<string>,
    maxDepth = 6,
): string[] {
    const queue: Array<{ node: string; path: string[]; depth: number }> = [];
    const visited = new Set<string>();

    for (const source of sources) {
        if (!source) continue;
        queue.push({ node: source, path: [source], depth: 0 });
        visited.add(source);
        if (targets.has(source)) {
            return [source];
        }
    }

    while (queue.length > 0) {
        const current = queue.shift()!;
        if (current.depth >= maxDepth) {
            continue;
        }
        const neighbors = graph.get(current.node);
        if (!neighbors) {
            continue;
        }
        for (const neighbor of neighbors) {
            if (visited.has(neighbor)) {
                continue;
            }
            const nextPath = [...current.path, neighbor];
            if (targets.has(neighbor)) {
                return nextPath;
            }
            visited.add(neighbor);
            queue.push({ node: neighbor, path: nextPath, depth: current.depth + 1 });
        }
    }

    return [];
}

export async function diagnoseModelDeep(args: {
    code?: string;
    method?: 'ode' | 'ssa' | 'nf' | 'default';
    t_end?: number;
    n_steps?: number;
    n_samples?: number;
    n_bootstrap?: number;
    max_parameters?: number;
}): Promise<{
    validation: {
        valid: boolean;
        errors: number;
        warnings: number;
    };
    structure: {
        species: number;
        reactionRules: number;
        observables: number;
        parameters: number;
    };
    stiffness: {
        category: string;
        ratio: number;
        features: string[];
    };
    dynamics: {
        reaches_steady_state: boolean;
        likely_oscillatory: boolean;
    };
    conservation: {
        count: number;
        preview: string[];
    };
    sobol?: {
        observable: string;
        topFirstOrder: Array<{ name: string; value: number }>;
        topTotalOrder: Array<{ name: string; value: number }>;
    };
    fim?: {
        conditionNumber: number;
        identifiableParams: string[];
        unidentifiableParams: string[];
    };
    mechanisticCausalTrace?: Array<{
        parameter: string;
        firstOrder: number;
        implicatedRules: string[];
        targetObservable?: string;
        topologyPath?: string[];
    }>;
    parameterSelection?: {
        strategy: 'triage_end_observable' | 'magnitude';
        candidates: number;
        analyzed: number;
        selectedParameters: string[];
    };
}> {
    if (!args.code) {
        throw new Error('No BNGL code provided for model diagnosis.');
    }

    const model = parseModelOrThrow(args.code);
    const reactionRules = model.reactionRules ?? [];
    const validation = validateModel(model, false);

    const rateConstants = reactionRules.map((rule) => {
        if (rule.isFunctionalRate) {
            return NaN;
        }
        const paramValue = model.parameters[rule.rate];
        if (Number.isFinite(paramValue)) {
            return Number(paramValue);
        }
        const numericRate = Number(rule.rate);
        return Number.isFinite(numericRate) ? numericRate : NaN;
    }).filter((value) => Number.isFinite(value)) as number[];

    const stiffness = analyzeModelStiffness(rateConstants, {
        hasFunctionalRates: reactionRules.some((rule) => rule.isFunctionalRate),
        systemSize: model.species.length,
    });

    const simulation = await handleSimulate({
        code: args.code,
        method: args.method ?? 'ode',
        t_end: args.t_end ?? 10,
        n_steps: args.n_steps ?? 100,
        include_species_data: false,
    });

    const timeSeries = simulation.structuredContent.data as Array<Record<string, number>>;
    const observableNames = model.observables.map((obs) => obs.name).filter((name) => name in (timeSeries[0] ?? {}));
    const firstObservable = observableNames[0];
    const series = firstObservable
        ? timeSeries.map((row) => Number(row[firstObservable] ?? 0))
        : [];

    const conservationPreview = inferConservationHints(
        reactionRules.map((rule, index) => `${rule.name ?? `rule_${index + 1}`}: ${rule.reactants.join(' + ')} -> ${rule.products.join(' + ')}`),
    );

    let sobolSummary: {
        observable: string;
        topFirstOrder: Array<{ name: string; value: number }>;
        topTotalOrder: Array<{ name: string; value: number }>;
    } | undefined;
    let fimSummary: {
        conditionNumber: number;
        identifiableParams: string[];
        unidentifiableParams: string[];
    } | undefined;
    let mechanisticCausalTrace: Array<{
        parameter: string;
        firstOrder: number;
        implicatedRules: string[];
        targetObservable?: string;
        topologyPath?: string[];
    }> | undefined;
    let parameterSelection: {
        strategy: 'triage_end_observable' | 'magnitude';
        candidates: number;
        analyzed: number;
        selectedParameters: string[];
    } | undefined;

    const allParameterEntries = Object.entries(model.parameters)
        .filter(([, value]) => Number.isFinite(value))
        .sort(([a], [b]) => a.localeCompare(b));

    const maxParameters = Math.max(1, Math.min(args.max_parameters ?? 5, 20));
    let parameterEntries: Array<[string, number]> = [];

    if (allParameterEntries.length > 0) {
        const ruleDescriptors = reactionRules.map((rule, index) => ({
            name: rule.name ?? `rule_${index + 1}`,
            reactants: rule.reactants,
            products: rule.products,
            rate: normalizeWhitespace(rule.rate),
        }));
        const moleculeGraph = buildMoleculeGraph(ruleDescriptors);
        const observableTargets = model.observables.map((observable) => ({
            name: observable.name,
            molecules: new Set(extractMoleculeNames(observable.pattern)),
        }));

        const expandedModel = await expandModel(model);
        const simOptions = buildSimulationOptions({
            method: args.method,
            t_end: args.t_end,
            n_steps: args.n_steps,
        });

        await loadEvaluator();
        const simulateWithOverrides = async (overrides: Record<string, number>) => {
            const runModel = cloneExpandedModel(expandedModel);
            Object.entries(overrides).forEach(([key, value]) => {
                runModel.parameters[key] = value;
            });
            updateMassActionRates(runModel);
            return simulate(0, runModel, simOptions, {
                checkCancelled: () => { },
                postMessage: () => { },
            });
        };

        if (allParameterEntries.length <= maxParameters) {
            parameterEntries = allParameterEntries;
            parameterSelection = {
                strategy: 'magnitude',
                candidates: allParameterEntries.length,
                analyzed: allParameterEntries.length,
                selectedParameters: parameterEntries.map(([name]) => name),
            };
        } else {
            const triageCandidates = allParameterEntries.slice(0, Math.min(allParameterEntries.length, 30));
            const baselineValue = firstObservable
                ? Number(timeSeries[timeSeries.length - 1]?.[firstObservable] ?? 0)
                : Number.NaN;

            if (firstObservable && Number.isFinite(baselineValue)) {
                const triageScores: Array<{ name: string; value: number; score: number }> = [];
                for (const [name, value] of triageCandidates) {
                    const delta = Math.max(Math.abs(value) * 0.1, 1e-6);
                    const perturbed = await simulateWithOverrides({ [name]: value + delta });
                    const perturbedEnd = Number(perturbed.data[perturbed.data.length - 1]?.[firstObservable] ?? baselineValue);
                    const scale = Math.max(Math.abs(baselineValue), 1e-9);
                    const score = Math.abs((perturbedEnd - baselineValue) / scale);
                    triageScores.push({ name, value, score });
                }

                parameterEntries = triageScores
                    .sort((a, b) => b.score - a.score)
                    .slice(0, maxParameters)
                    .map((entry) => [entry.name, entry.value] as [string, number]);
                parameterSelection = {
                    strategy: 'triage_end_observable',
                    candidates: triageCandidates.length,
                    analyzed: parameterEntries.length,
                    selectedParameters: parameterEntries.map(([name]) => name),
                };
            } else {
                parameterEntries = [...allParameterEntries]
                    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
                    .slice(0, maxParameters);
                parameterSelection = {
                    strategy: 'magnitude',
                    candidates: allParameterEntries.length,
                    analyzed: parameterEntries.length,
                    selectedParameters: parameterEntries.map(([name]) => name),
                };
            }
        }

        const sobolParams = parameterEntries.map(([name, value]) => {
            const magnitude = Math.max(1e-6, Math.abs(value));
            return {
                name,
                min: magnitude * 0.1,
                max: magnitude * 10,
            };
        });

        const sobolResults = await sobolSensitivity({
            simulate: simulateWithOverrides,
            params: sobolParams,
            observables: model.observables.slice(0, 1).map((obs) => obs.name),
            N: args.n_samples ?? 64,
            nBootstrap: args.n_bootstrap ?? 100,
            seed: 42,
        });

        const firstSobol = sobolResults[0];
        if (firstSobol) {
            const topFirstOrder = [...firstSobol.firstOrder]
                .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
                .slice(0, 3)
                .map((entry) => ({ name: entry.name, value: entry.value }));
            const topTotalOrder = [...firstSobol.totalOrder]
                .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
                .slice(0, 3)
                .map((entry) => ({ name: entry.name, value: entry.value }));
            sobolSummary = {
                observable: firstSobol.observable,
                topFirstOrder,
                topTotalOrder,
            };

            mechanisticCausalTrace = topFirstOrder.map((entry) => {
                const implicatedRuleDescriptors = ruleDescriptors
                    .filter((rule) => rule.rate.includes(entry.name))
                    .slice(0, 5);
                const implicatedRules = implicatedRuleDescriptors.map((rule) => rule.name);

                const sourceMolecules = Array.from(new Set(
                    implicatedRuleDescriptors.flatMap((rule) => [
                        ...rule.reactants.flatMap(extractMoleculeNames),
                        ...rule.products.flatMap(extractMoleculeNames),
                    ]),
                ));

                let bestPath: string[] = [];
                let targetObservable: string | undefined;
                for (const observable of observableTargets) {
                    if (observable.molecules.size === 0) {
                        continue;
                    }
                    const path = findShortestPath(moleculeGraph, sourceMolecules, observable.molecules, 8);
                    if (path.length === 0) {
                        continue;
                    }
                    if (bestPath.length === 0 || path.length < bestPath.length) {
                        bestPath = path;
                        targetObservable = observable.name;
                    }
                }

                return {
                    parameter: entry.name,
                    firstOrder: entry.value,
                    implicatedRules,
                    ...(targetObservable ? { targetObservable } : {}),
                    ...(bestPath.length > 0 ? { topologyPath: bestPath } : {}),
                };
            });
        }

        const fimResult = await computeFIM({
            simulate: simulateWithOverrides,
            parameters: Object.fromEntries(parameterEntries),
            parameterNames: parameterEntries.map(([name]) => name),
            allTimepoints: true,
            logParameters: false,
            approxProfile: false,
        });

        fimSummary = {
            conditionNumber: fimResult.conditionNumber,
            identifiableParams: fimResult.identifiableParams,
            unidentifiableParams: fimResult.unidentifiableParams,
        };
    }

    return {
        validation: {
            valid: validation.valid,
            errors: validation.summary.errors,
            warnings: validation.summary.warnings,
        },
        structure: {
            species: model.species.length,
            reactionRules: reactionRules.length,
            observables: model.observables.length,
            parameters: Object.keys(model.parameters).length,
        },
        stiffness: {
            category: stiffness.category,
            ratio: stiffness.rateRatio,
            features: stiffness.features,
        },
        dynamics: {
            reaches_steady_state: reachedSteadyState(series),
            likely_oscillatory: detectOscillation(series),
        },
        conservation: {
            count: conservationPreview.length,
            preview: conservationPreview,
        },
        ...(sobolSummary ? { sobol: sobolSummary } : {}),
        ...(fimSummary ? { fim: fimSummary } : {}),
        ...(mechanisticCausalTrace ? { mechanisticCausalTrace } : {}),
        ...(parameterSelection ? { parameterSelection } : {}),
    };
}

export function explainModelNarrative(code: string): {
    summary: string;
    sections: ExplainSection[];
} {
    const model = parseModelOrThrow(code);
    const reactionRules = model.reactionRules ?? [];

    const moleculeTypes = model.moleculeTypes.map((molecule) => molecule.name);
    const ruleNames = reactionRules.map((rule, index) => rule.name || `rule_${index + 1}`);
    const observableNames = model.observables.map((obs) => obs.name);

    const sections: ExplainSection[] = [
        {
            title: 'Entities',
            content: `Molecule types (${model.moleculeTypes.length}): ${moleculeTypes.slice(0, 10).join(', ') || 'none'}.`,
        },
        {
            title: 'Initialization',
            content: `Seed species (${model.species.length}) are initialized with explicit concentrations and driven by ${Object.keys(model.parameters).length} parameters.`,
        },
        {
            title: 'Dynamics',
            content: `Reaction rules (${reactionRules.length}) define the network transitions. Key rules: ${ruleNames.slice(0, 6).join(', ') || 'none'}.`,
        },
        {
            title: 'Readouts',
            content: `Observables (${model.observables.length}) report model behavior: ${observableNames.slice(0, 8).join(', ') || 'none'}.`,
        },
    ];

    const summary = [
        `Model contains ${model.moleculeTypes.length} molecule types, ${model.species.length} seed species, and ${reactionRules.length} reaction rules.`,
        reactionRules.length > 20
            ? 'The model appears rule-dense and may require network limits for expansion-heavy analyses.'
            : 'The model size is moderate and suitable for direct deterministic simulation.',
    ].join(' ');

    return {
        summary,
        sections,
    };
}

export function suggestModelFixes(code: string, includeAutoCorrectedCode: boolean): {
    fixes: SuggestedFix[];
    auto_corrected_code?: string;
} {
    const model = parseModelOrThrow(code);
    const validation = validateModel(model, true);

    const fixes: SuggestedFix[] = [];

    if (model.observables.length === 0) {
        fixes.push({
            issue: 'No observables are defined.',
            suggestion: 'Add at least one observable in a begin observables block to inspect simulation output.',
            severity: 'error',
        });
    }

    if ((model.species ?? []).length === 0) {
        fixes.push({
            issue: 'No seed species are defined.',
            suggestion: 'Add seed species with initial concentrations in begin seed species.',
            severity: 'error',
        });
    }

    for (const warning of validation.warnings) {
        fixes.push({
            issue: warning.message,
            suggestion: warning.code === 'UNUSUAL_PARAMETER_MAGNITUDE'
                ? 'Rescale parameters to a numerically stable range when possible.'
                : 'Inspect the referenced model element and adjust the rule/pattern.',
            severity: warning.severity,
        });
    }

    let autoCorrectedCode: string | undefined;
    if (includeAutoCorrectedCode) {
        let candidate = ensureModelEnvelope(code);
        if (model.observables.length === 0) {
            const firstSpecies = model.species[0]?.name ?? 'A()';
            candidate = insertIntoBlock(candidate, 'observables', `Molecules auto_obs ${firstSpecies}`);
        }

        autoCorrectedCode = (() => {
            try {
                return formatBNGL(candidate);
            } catch {
                return candidate;
            }
        })();
    }

    return {
        fixes,
        ...(autoCorrectedCode ? { auto_corrected_code: autoCorrectedCode } : {}),
    };
}

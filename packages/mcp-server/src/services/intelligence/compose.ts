import {
    normalizeWhitespace,
    ensureModelEnvelope,
    insertRuleLine,
    updateParameterLine,
    setSeedSpeciesLine,
    setObservableLine,
    insertIntoBlock,
} from './utils/codeUtils.js';
import { pickDefaultSeeds } from './utils/modelUtils.js';
import { BioParser } from '@grammar/parser.js';
import { BNGLGenerator } from '@grammar/generator.js';
import type { DefinitionSentence } from '@grammar/types.js';
import type { ComposeSeedSpecies, ComposeAnalysis, ComposeMolecule } from './types.js';
import { parseBNGLWithANTLR, formatBNGL } from '@bngplayground/engine';

interface ComposeRuleResult {
    name: string;
    rule: string;
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
    const ruleList: ComposeRuleResult[] = (model?.reactionRules ?? []).map((rule, index) => ({
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
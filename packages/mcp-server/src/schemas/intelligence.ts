import { z } from 'zod';
import { simulationMethods, finiteNumber, positiveInt } from './core.js';

const composeSeedSpeciesSchema = z.object({
    species: z.string(),
    count: finiteNumber,
}).strict();

export const composeModelArgsSchema = z.object({
    statements: z.array(z.string().min(1)).min(1),
    parameters: z.record(finiteNumber).optional(),
    seed_species: z.array(composeSeedSpeciesSchema).optional(),
}).strict();

const editOperationSchema = z.discriminatedUnion('action', [
    z.object({ action: z.literal('add_rule'), rule: z.string() }).strict(),
    z.object({ action: z.literal('add_statement'), text: z.string() }).strict(),
    z.object({ action: z.literal('remove_rule'), name: z.string() }).strict(),
    z.object({ action: z.literal('remove_rule_index'), index: z.number().int().nonnegative() }).strict(),
    z.object({ action: z.literal('set_parameter'), name: z.string(), value: finiteNumber }).strict(),
    z.object({ action: z.literal('add_parameter'), name: z.string(), value: finiteNumber }).strict(),
    z.object({ action: z.literal('set_concentration'), species: z.string(), value: finiteNumber }).strict(),
    z.object({ action: z.literal('add_observable'), name: z.string(), type: z.enum(['Molecules', 'Species']), pattern: z.string() }).strict(),
    z.object({ action: z.literal('remove_observable'), name: z.string() }).strict(),
    z.object({ action: z.literal('add_molecule_type'), definition: z.string() }).strict(),
    z.object({ action: z.literal('add_species'), species: z.string(), concentration: finiteNumber }).strict(),
    z.object({ action: z.literal('knockout_rule'), name: z.string() }).strict(),
    z.object({ action: z.literal('randomize_parameters'), range: finiteNumber }).strict(),
    z.object({ action: z.literal('set_scope'), includes: z.array(z.string()), excludes: z.array(z.string()), justification: z.string() }).strict(),
]);

export const editModelArgsSchema = z.object({
    code: z.string(),
    operations: z.array(editOperationSchema).min(1),
}).strict();

export const diagnoseModelArgsSchema = z.object({
    code: z.string(),
    n_samples: positiveInt.optional(),
    n_bootstrap: positiveInt.optional(),
    max_parameters: positiveInt.optional(),
    method: z.enum(simulationMethods).optional(),
    t_end: finiteNumber.nonnegative().optional(),
    n_steps: positiveInt.optional(),
    experimental_data: z.array(z.object({
        time: z.number(),
        observables: z.record(z.number()),
        errors: z.record(z.number()).optional(),
    })).optional().describe('Experimental data for profile likelihood. When provided, enables identifiability classification.'),
}).strict();

export const explainModelArgsSchema = z.object({
    code: z.string(),
    include_crux: z.boolean().optional(),
}).strict();

export const suggestFixArgsSchema = z.object({
    code: z.string(),
    include_auto_corrected_code: z.boolean().optional(),
}).strict();

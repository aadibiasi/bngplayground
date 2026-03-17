import { z } from 'zod';
import { finiteNumber, positiveInt } from './core.js';

export const exportSedmlArgsSchema = z.object({
    code: z.string().describe('BNGL model code'),
    method: z.enum(['ode', 'ssa', 'nf']).optional().describe('Simulation method (default: ode)'),
    t_end: finiteNumber.nonnegative().optional().describe('End time (default: 100)'),
    n_steps: positiveInt.optional().describe('Number of output steps (default: 100)'),
    t_start: finiteNumber.optional().describe('Start time (default: 0)'),
    observables: z.array(z.string()).optional().describe('Observables to include'),
    model_name: z.string().optional().describe('Model name in SED-ML'),
    model_source: z.string().optional().describe('Model file reference'),
    atol: finiteNumber.positive().optional(),
    rtol: finiteNumber.positive().optional(),
}).strict();

export const exportOmexArgsSchema = z.object({
    code: z.string().describe('BNGL model code'),
    model_name: z.string().optional().describe('Model name'),
    method: z.enum(['ode', 'ssa', 'nf']).optional().describe('Simulation method'),
    t_end: finiteNumber.nonnegative().optional(),
    n_steps: positiveInt.optional(),
    metadata: z.object({
        title: z.string().optional(),
        creators: z.array(z.string()).optional(),
        description: z.string().optional(),
    }).optional().describe('Dublin Core metadata for the archive'),
}).strict();

export const exportSbmlArgsSchema = z.object({
    code: z.string().describe('BNGL model code'),
    annotate: z.boolean().optional().describe('Include SBO/MIRIAM annotations'),
}).strict();

export const suggestAnnotationsArgsSchema = z.object({
    code: z.string().describe('BNGL model code'),
    organism: z.string().optional().describe('Organism for UniProt lookup (default: Homo sapiens)'),
}).strict();

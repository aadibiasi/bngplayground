import { z } from 'zod';

export const fitParametersArgsSchema = z.object({
    code: z.string().describe('BNGL code containing the model and observables'),
    parameters: z.record(z.object({
        min: z.number(),
        max: z.number(),
        initial: z.number().optional(),
    })).describe('Map of parameter names to their fitting bounds { min, max, initial? }'),
    data: z.array(z.object({
        time: z.number(),
        observables: z.record(z.number()),
    })).describe('Experimental data points: list of { time, observables: { obsName: value } }'),
    method: z.enum(['ode', 'ssa']).default('ode').describe('Simulation method to use during fitting'),
    algorithm: z.enum(['nelder-mead', 'sbplx']).default('nelder-mead').describe('Optimization algorithm'),
    max_iterations: z.number().optional().describe('Maximum iterations for the optimizer'),
}).strict();

export const diagnoseArgsSchema = z.object({
    code: z.string().describe('BNGL code to analyze'),
}).strict();

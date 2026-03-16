import { z } from 'zod';

export const simulationMethods = ['ode', 'ssa', 'nf', 'default'] as const;
export const solverValues = ['auto', 'cvode', 'cvode_auto', 'cvode_sparse', 'cvode_jac', 'rosenbrock23', 'rk45', 'rk4', 'webgpu_rk4'] as const;

export const finiteNumber = z.number().finite();
export const positiveInt = z.number().int().positive();

export const parseBnglArgsSchema = z.object({
    code: z.string(),
}).strict();

export const generateNetworkArgsSchema = z.object({
    code: z.string(),
    max_agents: positiveInt.optional(),
    max_reactions: positiveInt.optional(),
    max_iterations: positiveInt.optional(),
    max_agg: positiveInt.optional(),
}).strict();

export const simulateArgsSchema = z.object({
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

export const parameterScanArgsSchema = z.object({
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

export const validateModelArgsSchema = z.object({
    code: z.string(),
    include_nfsim: z.boolean().optional(),
}).strict();

export const getContactMapArgsSchema = z.object({
    code: z.string(),
}).strict();

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

// ── Track E: Sensitivity Analysis ───────────────────────────────────

export const sobolSensitivityArgsSchema = z.object({
    code: z.string().describe('BNGL model code'),
    parameters: z.array(z.object({
        name: z.string(),
        min: z.number(),
        max: z.number(),
    })).describe('Parameters to analyze with their bounds'),
    observables: z.array(z.string()).optional().describe('Observable names to analyze (default: all)'),
    n_samples: positiveInt.optional().describe('Number of Saltelli base samples (default: 512)'),
    n_bootstrap: positiveInt.optional().describe('Bootstrap replicates for CIs (default: 500)'),
    log_scale: z.boolean().optional().describe('Use log-uniform sampling'),
    seed: z.number().int().optional().describe('Random seed'),
    method: z.enum(simulationMethods).optional(),
    t_end: finiteNumber.nonnegative().optional(),
    n_steps: positiveInt.optional(),
    solver: z.enum(solverValues).optional(),
    atol: finiteNumber.positive().optional(),
    rtol: finiteNumber.positive().optional(),
    max_agents: positiveInt.optional(),
    max_reactions: positiveInt.optional(),
}).strict();

export const computeFimArgsSchema = z.object({
    code: z.string().describe('BNGL model code'),
    parameters: z.array(z.string()).optional().describe('Parameter names to include in FIM (default: all)'),
    all_timepoints: z.boolean().optional().describe('Use all timepoints (default: true)'),
    log_parameters: z.boolean().optional().describe('Use log-parameter sensitivities'),
    approx_profile: z.boolean().optional().describe('Run approximate 1D profile scans'),
    compute_collinearity: z.boolean().optional().describe('Compute collinearity index'),
    collinearity_subset_size: positiveInt.optional().describe('Subset size for collinearity (default: 2)'),
    method: z.enum(simulationMethods).optional(),
    t_end: finiteNumber.nonnegative().optional(),
    n_steps: positiveInt.optional(),
    solver: z.enum(solverValues).optional(),
    atol: finiteNumber.positive().optional(),
    rtol: finiteNumber.positive().optional(),
    max_agents: positiveInt.optional(),
    max_reactions: positiveInt.optional(),
}).strict();

export const identifiabilityArgsSchema = z.object({
    code: z.string().describe('BNGL model code'),
    parameters: z.array(z.string()).optional().describe('Parameters to profile (default: all)'),
    data: z.array(z.object({
        time: z.number(),
        observables: z.record(z.number()),
    })).describe('Experimental data for SSR computation'),
    n_grid: positiveInt.optional().describe('Grid points per parameter (default: 20)'),
    range_factor: finiteNumber.positive().optional().describe('Grid range factor (default: 10)'),
    reoptimize: z.boolean().optional().describe('Re-optimize nuisance params (default: true)'),
    alpha: finiteNumber.optional().describe('Confidence level (default: 0.95)'),
    method: z.enum(simulationMethods).optional(),
    t_end: finiteNumber.nonnegative().optional(),
    n_steps: positiveInt.optional(),
    solver: z.enum(solverValues).optional(),
    atol: finiteNumber.positive().optional(),
    rtol: finiteNumber.positive().optional(),
    max_agents: positiveInt.optional(),
    max_reactions: positiveInt.optional(),
}).strict();

// ── Track G: Bayesian Inference ─────────────────────────────────────

export const bayesianInferenceArgsSchema = z.object({
    code: z.string().describe('BNGL model code'),
    priors: z.array(z.object({
        name: z.string(),
        distribution: z.enum(['uniform', 'log-uniform', 'normal']),
        min: z.number().optional(),
        max: z.number().optional(),
        mean: z.number().optional(),
        std: z.number().optional(),
    })).describe('Prior distribution specifications for each parameter'),
    data: z.array(z.object({
        time: z.number(),
        observables: z.record(z.number()),
    })).describe('Experimental data to fit against'),
    observables: z.array(z.string()).optional().describe('Observables to compare'),
    distance: z.enum(['sse', 'rmse', 'weighted_sse', 'chi_squared']).optional().describe('Distance metric (default: sse)'),
    n_particles: positiveInt.optional().describe('Number of particles (default: 500)'),
    n_populations: positiveInt.optional().describe('Number of SMC populations (default: 10)'),
    max_simulations: positiveInt.optional().describe('Max total simulations (default: 100000)'),
    seed: z.number().int().optional().describe('Random seed'),
    method: z.enum(simulationMethods).optional(),
    t_end: finiteNumber.nonnegative().optional(),
    n_steps: positiveInt.optional(),
    solver: z.enum(solverValues).optional(),
    atol: finiteNumber.positive().optional(),
    rtol: finiteNumber.positive().optional(),
    max_agents: positiveInt.optional(),
    max_reactions: positiveInt.optional(),
}).strict();

// ── Track F: Standards & Export ──────────────────────────────────────

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

// ── Section 5: MCP Intelligence Tools ──────────────────────────────

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
    // P2 operations
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
    })).optional().describe('Experimental data for profile likelihood. When provided, enables identifiability classification.'),
}).strict();

export const explainModelArgsSchema = z.object({
    code: z.string(),
}).strict();

export const suggestFixArgsSchema = z.object({
    code: z.string(),
    include_auto_corrected_code: z.boolean().optional(),
}).strict();

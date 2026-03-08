import { BNGLModel, SimulationResults } from '../types';
import { getSimulationOptionsFromParsedModel } from './simulationOptions';

/**
 * Interface for a model definition in a batch.
 */
export interface BatchModelDef {
    name: string;
    code?: string;
    id?: string;
}

/**
 * Interface for the simulation service used by the batch runner.
 */
export interface BatchSimulator {
    parse(code: string, options?: { description?: string }): Promise<BNGLModel>;
    generateNetwork(model: BNGLModel, options: any, options2?: { description?: string }): Promise<BNGLModel>;
    simulate(model: BNGLModel, options: any, options2?: { description?: string }): Promise<SimulationResults>;
    loadModelCode?(id: string): Promise<string | undefined>;
    restart?(): void;
}

/**
 * Interface for reporting progress and results.
 */
export interface BatchReporter {
    log(message: string): void;
    warn(message: string): void;
    error(message: string, error?: any): void;
    group(name: string): void;
    groupEnd(): void;
    time(label: string): void;
    timeEnd(label: string): void;
    /**
     * Callback for exporting results.
     * NOTE: Implementation is environment-specific (e.g., browser downloads vs server-side file writing).
     */
    onExport(results: SimulationResults, modelDef: BatchModelDef, model: BNGLModel): Promise<void>;
}

export interface BatchRunnerOptions {
    simulator: BatchSimulator;
    reporter: BatchReporter;
    verbose?: boolean;
    nfSimModels?: Set<string>;
}

export function normalizeFilterNames(names?: string[]) {
    if (!names || names.length === 0) return null;
    const normalized = names
        .map(n => String(n ?? '').trim())
        .filter(Boolean)
        .map(n => n.toLowerCase());
    return normalized.length ? normalized : null;
}

export function safeModelName(name: string) {
    return name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
}

/**
 * Run simulation using the worker's native phase/action execution path.
 */
export async function executeMultiPhaseSimulation(
    simulator: BatchSimulator,
    model: BNGLModel,
    seed?: number
): Promise<SimulationResults> {
    const options = getSimulationOptionsFromParsedModel(model, 'default', {
        solver: 'cvode',
        includeSpeciesData: false,
        ...(seed !== undefined ? { seed } : {})
    });
    const phaseCount = model.simulationPhases?.length ?? 0;
    const label = phaseCount > 1 ? `Multi-Phase (${phaseCount})` : 'Single Phase';
    return await simulator.simulate(model, options, { description: label });
}

export async function runSingleBatchItem(
    options: BatchRunnerOptions,
    modelDef: BatchModelDef,
    batchSeed?: number
): Promise<boolean> {
    const { simulator, reporter, verbose, nfSimModels } = options;
    reporter.group(`Processing: ${modelDef.name}`);
    try {
        // Resolve code
        let code = modelDef.code;
        if (!code && modelDef.id && simulator.loadModelCode) {
            code = await simulator.loadModelCode(modelDef.id);
        }
        if (!code) throw new Error(`No code available for model: ${modelDef.name}`);

        // 1. Parse
        if (verbose) reporter.time('Parse');
        const model: BNGLModel = await simulator.parse(code, { description: `Batch Parse: ${modelDef.name}` });
        if (verbose) reporter.timeEnd('Parse');

        // 1b. Network Generation
        const actions = model.actions || [];
        const needsNetGen = actions.some(a =>
            a.type === 'generate_network' ||
            a.type === 'simulate_ode' ||
            (a.type === 'simulate' && a.args?.method === 'ode')
        );

        const isNfSimModel = nfSimModels?.has(modelDef.id || modelDef.name) ?? false;

        if (needsNetGen && !isNfSimModel) {
            if (verbose) reporter.time('NetGen');
            reporter.log('Generating network...');
            const netOptions = {
                maxSpecies: model.networkOptions?.maxSpecies ?? 2000,
                maxReactions: model.networkOptions?.maxReactions ?? 5000,
                maxIterations: model.networkOptions?.maxIter ?? 1000,
                maxAgg: model.networkOptions?.maxAgg ?? 500,
                ...(model.networkOptions?.maxStoich !== undefined ? { maxStoich: model.networkOptions.maxStoich as any } : {})
            };

            const expanded = await simulator.generateNetwork(model, netOptions, { description: `Batch NetGen: ${modelDef.name}` });
            if (expanded.reactions) model.reactions = expanded.reactions;
            if (expanded.species) model.species = expanded.species;
            if ((expanded as any).concreteObservables) (model as any).concreteObservables = (expanded as any).concreteObservables;

            if (verbose) reporter.timeEnd('NetGen');
        }

        // 2. Simulate
        if (verbose) reporter.time('Simulate');
        model.simulationPhases = model.simulationPhases ?? [];
        if (model.simulationPhases.length === 0) {
            reporter.log(`[Batch] Auto-injecting default simulate action for ${model.name}`);
            model.simulationPhases.push({ method: 'ode', t_end: 100, n_steps: 100 });
        }
        const results: SimulationResults = await executeMultiPhaseSimulation(simulator, model, batchSeed);
        if (verbose) reporter.timeEnd('Simulate');

        // 3. Export (via reporter callback)
        await reporter.onExport(results, modelDef, model);

        reporter.log('✅ Exported results');
        reporter.groupEnd();
        return true;
    } catch (e: any) {
        reporter.error('❌ Failed:', e);
        if (simulator.restart && (e.message?.includes('terminated') || e.message?.includes('Worker'))) {
            reporter.warn('⚠️ Simulator terminated/crashed. Restarting...');
            simulator.restart();
        }
        reporter.groupEnd();
        return false;
    }
}

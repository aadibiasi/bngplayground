import { z } from 'zod';
import { ToolArgs, ToolResult, MCPErrorResult } from '../types/index.js';
import { diagnoseModelArgsSchema } from '../schemas/index.js';
import { createToolResult, parseArgs } from '../services/engine.js';
import { diagnoseModelDeep } from '../services/intelligence.js';
import { structureError } from '../services/errors.js';

type DiagnoseModelArgs = {
    code: string;
    method?: 'ode' | 'ssa' | 'nf' | 'default';
    t_end?: number;
    n_steps?: number;
    n_samples?: number;
    n_bootstrap?: number;
    max_parameters?: number;
    experimental_data?: Array<{
        time: number;
        observables: Record<string, number>;
    }>;
};

export async function handleDiagnoseModel(args: ToolArgs): Promise<ToolResult<any>> {
    try {
        const parsedArgs = parseArgs('diagnose_model', diagnoseModelArgsSchema, args) as DiagnoseModelArgs;
        const result = await diagnoseModelDeep(parsedArgs);
        return createToolResult(result);
    } catch (error) {
        const structured = structureError(error instanceof Error ? error : new Error(String(error)));
        return createToolResult(structured);
    }
}

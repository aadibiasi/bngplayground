import { z } from 'zod';
import { ToolArgs, ToolResult } from '../types/index.js';
import { diagnoseModelArgsSchema } from '../schemas/index.js';
import { createToolResult, parseArgs } from '../services/engine.js';
import { diagnoseModelDeep } from '../services/intelligence.js';

type DiagnoseModelArgs = {
    code: string;
    method?: 'ode' | 'ssa' | 'nf' | 'default';
    t_end?: number;
    n_steps?: number;
    n_samples?: number;
    n_bootstrap?: number;
    max_parameters?: number;
};

export async function handleDiagnoseModel(args: ToolArgs): Promise<ToolResult<any>> {
    const parsedArgs = parseArgs('diagnose_model', diagnoseModelArgsSchema, args) as DiagnoseModelArgs;
    const result = await diagnoseModelDeep(parsedArgs);
    return createToolResult(result);
}

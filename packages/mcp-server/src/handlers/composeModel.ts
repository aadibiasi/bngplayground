import { z } from 'zod';
import { ToolArgs, ToolResult } from '../types/index.js';
import { composeModelArgsSchema } from '../schemas/index.js';
import { createToolResult, parseArgs } from '../services/engine.js';
import { composeModelFromStatements } from '../services/intelligence.js';
import { structureError } from '../services/errors.js';

type ComposeModelArgs = {
    statements: string[];
    parameters?: Record<string, number>;
    seed_species?: { species: string; count: number }[];
    strict?: boolean;
};

export async function handleComposeModel(args: ToolArgs): Promise<ToolResult<any>> {
    try {
        const parsedArgs = parseArgs('compose_model', composeModelArgsSchema, args) as ComposeModelArgs;
        const composed = composeModelFromStatements(parsedArgs);
        return createToolResult(composed);
    } catch (error) {
        const structured = structureError(error instanceof Error ? error : new Error(String(error)));
        return createToolResult(structured);
    }
}

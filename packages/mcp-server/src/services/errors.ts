import { MCPErrorResult } from '../types/index.js';

export function structureError(error: Error): MCPErrorResult {
    const msg = error.message;
    if (msg.includes('diverged') || msg.includes('step size')) {
        return {
            error: msg,
            diagnosis: 'ODE solver failed — likely stiff system or rate constant mismatch.',
            recovery: 'Try: (1) switch solver to cvode or rosenbrock23, (2) reduce t_end to locate divergence point, (3) check for rate constants differing by >6 orders of magnitude.',
            severity: 'recoverable',
            relatedTools: ['diagnose_model'],
        };
    }
    if (msg.includes('parse') || msg.includes('BNGL parse')) {
        return {
            error: msg,
            diagnosis: 'BNGL syntax error in the model code.',
            recovery: 'Use suggest_fix to get auto-corrected code, or check for missing end statements and unmatched parentheses.',
            severity: 'recoverable',
            relatedTools: ['suggest_fix', 'validate_model'],
        };
    }
    if (msg.includes('network') || msg.includes('expansion')) {
        return {
            error: msg,
            diagnosis: 'Network generation failed or hit size limits.',
            recovery: 'Reduce max_agents/max_iterations, or use NFsim (method: "nf") for large models.',
            severity: 'recoverable',
            relatedTools: ['simulate'],
        };
    }
    // Generic fallback
    return {
        error: msg,
        diagnosis: 'Unexpected error during tool execution.',
        recovery: 'Retry with simpler parameters or check the model with validate_model first.',
        severity: 'fatal',
    };
}
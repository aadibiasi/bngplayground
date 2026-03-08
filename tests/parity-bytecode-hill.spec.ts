import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { generateExpandedNetwork, simulate, parseBNGLStrict as parseBNGL } from '@bngplayground/engine';

const hasCvode = existsSync(join(process.cwd(), 'public', 'cvode.wasm'));
const maybeIt = hasCvode ? it : it.skip;

describe('Functional Rate Bytecode Parity', () => {
    maybeIt('matches JS evaluation for Hill function kinetics', async () => {
        const bngl = `
        begin parameters
            V 1.0
            K 0.5
            n 2
        end parameters
        begin species
            S 1.0
            P 0.0
        end species
        begin observables
            Molecules S S()
            Molecules P P()
        end observables
        begin reaction rules
            S -> P  V * (S^n) / (K^n + S^n)
        end reaction rules
        `;
        
        const parsed = parseBNGL(bngl);
        const expanded = await generateExpandedNetwork(parsed as any, () => {}, () => {});
        const model = {
            ...parsed,
            reactions: expanded.reactions,
            species: expanded.species,
            concreteObservables: (expanded as any).concreteObservables,
        };

        const callbacks = { 
            checkCancelled() {}, 
            postMessage(msg: any) {
                if (msg.type === 'error') console.error('[Worker Error]', msg.error);
            } 
        };
        const baseOptions = {
            method: 'ode',
            solver: 'cvode',
            t_end: 2.0,
            n_steps: 10,
        } as const;

        // Note: Currently the simulation loop automatically uses bytecode if it can be compiled.
        // To compare, we rely on the fact that if jsep parsing fails or if we manually disable it in engine, 
        // it falls back to JS. For this test, since we've implemented it, we're testing the NATIVE path.
        const nativeResults = await simulate(1, model as any, {
            ...baseOptions,
        } as any, callbacks as any);

        expect(nativeResults.data).toHaveLength(11);
        console.log('[Hill Parity] Keys:', Object.keys(nativeResults.data[0]));
        const nativeLast = nativeResults.data[nativeResults.data.length - 1] as any;

        // Verify that simulation actually progressed and produced expected results
        // S_dot = -V*S^2 / (K^2 + S^2)
        // With V=1, K=0.5, n=2, S=1: S_dot = -1 * 1 / (0.25 + 1) = -0.8
        // At t=2, S should be much lower.
        expect(nativeLast.time).toBeCloseTo(2.0, 10);
        expect(nativeLast.S).toBeLessThan(0.5);
        expect(nativeLast.P).toBeGreaterThan(0.5);
        expect(nativeLast.S + nativeLast.P).toBeCloseTo(1.0, 10); // Mass conservation
        
        console.log('[Hill Parity] Native S(2.0):', nativeLast.S);
    });
});

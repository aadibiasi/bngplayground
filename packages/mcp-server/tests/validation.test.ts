import { describe, it, expect, vi } from 'vitest';
import {
    handleParseBngl,
    handleGenerateNetwork,
    handleSimulate,
    handleParameterScan,
    handleValidateModel,
    handleGetContactMap,
    handleFitParameters,
    handleDiagnose
} from '../src/index';

const simpleModel = `
begin parameters
  k1 0.1
  k2 0.01
end parameters
begin molecule types
  A(b)
  B(a)
end molecule types
begin seed species
  A(b) 100
  B(a) 50
end seed species
begin observables
  Molecules A_free A(b)
  Molecules B_free B(a)
  Molecules Complex A(b!1).B(a!1)
end observables
begin reaction rules
  A(b) + B(a) -> A(b!1).B(a!1) k1
  A(b!1).B(a!1) -> A(b) + B(a) k2
end reaction rules
`;

describe('MCP Server Tools Functional Validation', () => {
    it('should parse BNGL code (parse_bngl)', async () => {
        const result = await handleParseBngl({ code: simpleModel });
        expect(result.structuredContent.success).toBe(true);
        expect(result.structuredContent.model).toBeDefined();
        expect(result.structuredContent.model?.species.length).toBe(2);
    });

    it('should generate reaction network (generate_network)', async () => {
        const result = await handleGenerateNetwork({ code: simpleModel });
        expect(result.structuredContent.species).toBeDefined();
        expect(result.structuredContent.reactions).toBeDefined();
        // A + B -> complex (3 species total: A, B, Complex)
        expect(result.structuredContent.species.length).toBe(3);
    });

    it('should simulate model (simulate ODE)', async () => {
        const result = await handleSimulate({
            code: simpleModel,
            method: 'ode',
            t_end: 1,
            n_steps: 10
        });
        expect(result.structuredContent.data).toBeDefined();
        expect(result.structuredContent.data.length).toBe(11); // 0 to 10 steps
        expect(result.structuredContent.data[0].A_free).toBeCloseTo(100);
    });

    it('should simulate model (simulate SSA)', async () => {
        const result = await handleSimulate({
            code: simpleModel,
            method: 'ssa',
            t_end: 1,
            n_steps: 5
        });
        expect(result.structuredContent.data).toBeDefined();
        expect(result.structuredContent.data.length).toBe(6);
        // SSA results should be integers
        expect(Number.isInteger(result.structuredContent.data[0].A_free)).toBe(true);
    });

    it('should run 1D parameter scan', async () => {
        const result = await handleParameterScan({
            code: simpleModel,
            parameter: 'k1',
            start: 0.1,
            end: 0.5,
            steps: 3,
            t_end: 1,
            n_steps: 2
        });
        expect(result.structuredContent.mode).toBe('1d');
        expect(result.structuredContent.xValues.length).toBe(3);
        expect(result.structuredContent.observables.Complex).toBeDefined();
        expect(result.structuredContent.observables.Complex.length).toBe(3);
    });

    it('should run 2D parameter scan', async () => {
        const result = await handleParameterScan({
            code: simpleModel,
            parameter: 'k1',
            start: 0.1,
            end: 0.5,
            steps: 2,
            parameter2: 'k2',
            start2: 0.01,
            end2: 0.1,
            steps2: 2,
            t_end: 1,
            n_steps: 2
        });
        expect(result.structuredContent.mode).toBe('2d');
        expect(result.structuredContent.xValues.length).toBe(2);
        expect(result.structuredContent.yValues.length).toBe(2);
        expect(result.structuredContent.observables.Complex).toBeDefined();
        // 2D result is number[][]
        expect(Array.isArray(result.structuredContent.observables.Complex[0])).toBe(true);
    });

    it('should validate model (validate_model)', async () => {
        const result = await handleValidateModel({ code: simpleModel });
        expect(result.structuredContent.valid).toBe(true);
        expect(result.structuredContent.summary.errors).toBe(0);
    });

    it('should get contact map (get_contact_map)', async () => {
        const result = await handleGetContactMap({ code: simpleModel });
        expect(result.structuredContent.nodes.length).toBeGreaterThan(0);
        expect(result.structuredContent.edges.length).toBeGreaterThan(0);
        // Nodes: A, B, A.b, B.a
        const molNames = result.structuredContent.nodes.filter(n => n.type === 'molecule').map(n => n.label);
        expect(molNames).toContain('A');
        expect(molNames).toContain('B');
    });

    it('should fit parameters (fit_parameters)', async () => {
        const result = await handleFitParameters({
            code: simpleModel,
            parameters: {
                k1: { min: 0.01, max: 1.0, initial: 0.1 }
            },
            data: [
                { time: 0, observables: { Complex: 0 } },
                { time: 1, observables: { Complex: 5 } }
            ],
            max_iterations: 5
        });
        expect(result.structuredContent.params).toBeDefined();
        expect(result.structuredContent.paramNames).toContain('k1');
    });

    it('should diagnose model (diagnose)', async () => {
        const result = await handleDiagnose({ code: simpleModel });
        expect(result.structuredContent.stiffness).toBeDefined();
        expect(result.structuredContent.estimation).toBeDefined();
        expect(result.structuredContent.estimation.rules).toBe(2);
    });
});

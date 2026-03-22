import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleComposeModel } from '../src/handlers/composeModel';

const originalFetch = global.fetch;

afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = originalFetch;
});

describe('compose_model INDRA sources', () => {
    it('composes from INDRA NLP statements', async () => {
        global.fetch = vi.fn()
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                headers: { get: () => 'application/json' },
                json: async () => ({
                    statements: [{
                        type: 'Phosphorylation',
                        enz: { name: 'BRAF', db_refs: {} },
                        sub: { name: 'MAP2K1', db_refs: {} },
                    }],
                }),
            })
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                headers: { get: () => 'application/json' },
                json: async () => ({
                    model: `begin model
begin molecule types
  BRAF()
  MAP2K1()
end molecule types
begin reaction rules
  r1: BRAF() -> MAP2K1() k1
end reaction rules
end model`,
                }),
            }) as unknown as typeof fetch;

        const result = await handleComposeModel({
            source: 'indra_nlp',
            indra_text: 'BRAF phosphorylates MAP2K1',
        });

        expect(result.structuredContent.code).toContain('begin reaction rules');
        expect(result.structuredContent.analysis.recognizedCount).toBe(1);
        expect(result.structuredContent.confirmation).toContain('INDRA NLP');
    });

    it('composes from INDRA DB statements', async () => {
        global.fetch = vi.fn()
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                headers: { get: () => 'application/json' },
                json: async () => ({
                    results: {
                        h1: {
                            type: 'Phosphorylation',
                            enz: { name: 'BRAF', db_refs: {} },
                            sub: { name: 'MAP2K1', db_refs: {} },
                            belief: 0.99,
                            evidence: [{ source_api: 'reach' }],
                        },
                    },
                    evidence_totals: { h1: 42 },
                }),
            })
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                headers: { get: () => 'application/json' },
                json: async () => ({
                    model: `begin model
begin molecule types
  BRAF()
  MAP2K1()
end molecule types
begin reaction rules
  r1: BRAF() -> MAP2K1() k1
end reaction rules
end model`,
                }),
            }) as unknown as typeof fetch;

        const result = await handleComposeModel({
            source: 'indra_db',
            indra_query: { subject: 'BRAF', object: 'MAP2K1', type: 'Phosphorylation' },
        });

        expect(result.structuredContent.analysis.recognizedCount).toBe(1);
        expect(result.structuredContent.confirmation).toContain('INDRA DB');
        expect(result.structuredContent.confirmation).toContain('42');
    });
});

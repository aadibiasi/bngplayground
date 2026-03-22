import { afterEach, describe, expect, it, vi } from 'vitest';
import { INDRAError, INDRAService, summarizeStatement } from '../../services/indra/indraService';

const originalFetch = global.fetch;

function mockJsonFetch(payload: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null),
    },
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

afterEach(() => {
  vi.restoreAllMocks();
  global.fetch = originalFetch;
});

describe('INDRAService', () => {
  describe('processText', () => {
    it('returns empty array for empty input', async () => {
      expect(await INDRAService.processText('')).toEqual([]);
    });

    it('parses TRIPS response into typed statements', async () => {
      mockJsonFetch({
        statements: [{
          type: 'Phosphorylation',
          enz: { name: 'BRAF', db_refs: { HGNC: '1097' } },
          sub: { name: 'MAP2K1', db_refs: { HGNC: '6840' } },
          residue: 'S',
          position: '218',
        }],
      });

      const statements = await INDRAService.processText('BRAF phosphorylates MAP2K1');
      expect(statements).toHaveLength(1);
      expect(statements[0]?.type).toBe('Phosphorylation');
    });

    it('throws INDRAError when fetch rejects', async () => {
      global.fetch = vi.fn().mockRejectedValue(new DOMException('timed out', 'AbortError')) as unknown as typeof fetch;
      await expect(INDRAService.processText('test')).rejects.toThrow(INDRAError);
    });
  });

  describe('queryAgents', () => {
    it('builds correct query URL', async () => {
      const fetchMock = mockJsonFetch({ results: {}, total_evidence: 0, evidence_totals: {} });
      await INDRAService.queryAgents({ subject: 'BRAF', type: 'Phosphorylation' });
      const url = fetchMock.mock.calls[0]?.[0];
      expect(String(url)).toContain('subject=BRAF');
      expect(String(url)).toContain('type=Phosphorylation');
    });

    it('filters by minimum evidence and sorts by evidence descending', async () => {
      mockJsonFetch({
        results: {
          h1: {
            type: 'Phosphorylation',
            sub: { name: 'A', db_refs: {} },
            evidence: [{ source_api: 'reach' }],
            belief: 0.9,
          },
          h2: {
            type: 'Phosphorylation',
            sub: { name: 'B', db_refs: {} },
            evidence: [{ source_api: 'reach' }],
            belief: 0.95,
          },
        },
        total_evidence: 100,
        evidence_totals: { h1: 50, h2: 2 },
      });

      const result = await INDRAService.queryAgents({ subject: 'X', minEvidence: 10 });
      expect(result.statements).toHaveLength(1);
      expect(result.hashes).toEqual(['h1']);
    });
  });

  describe('assembleBNGL', () => {
    it('returns empty string for empty statements', async () => {
      expect(await INDRAService.assembleBNGL([])).toBe('');
    });

    it('sends statements and returns BNGL', async () => {
      mockJsonFetch({
        model: 'begin model\nbegin molecule types\n  ERK()\nend molecule types\nend model',
      });
      const bngl = await INDRAService.assembleBNGL([{
        type: 'Phosphorylation',
        sub: { name: 'ERK', db_refs: {} },
      } as any]);
      expect(bngl).toContain('begin model');
      expect(bngl).toContain('begin observables');
      expect(bngl).toContain('Molecules');
      expect(bngl).toContain('generate_network({overwrite=>1})');
      expect(bngl).toContain('simulate({method=>"ode", t_end=>100, n_steps=>100})');
    });

    it('does not duplicate simulate actions when INDRA already returned them', async () => {
      mockJsonFetch({
        model: 'begin model\nend model\ngenerate_network({overwrite=>1})\nsimulate({method=>"ode", t_end=>10, n_steps=>10})\n',
      });
      const bngl = await INDRAService.assembleBNGL([{
        type: 'Phosphorylation',
        sub: { name: 'ERK', db_refs: {} },
      } as any]);
      expect((bngl.match(/generate_network\(/g) ?? []).length).toBe(1);
      expect((bngl.match(/simulate\(/g) ?? []).length).toBe(1);
    });
  });

  describe('summarizeStatement', () => {
    it('handles Phosphorylation with residue and position', () => {
      expect(summarizeStatement({
        type: 'Phosphorylation',
        enz: { name: 'BRAF', db_refs: {} },
        sub: { name: 'MEK', db_refs: {} },
        residue: 'S',
        position: '218',
      })).toBe('BRAF phosphorylates MEK at S218.');
    });

    it('handles Complex with multiple members', () => {
      expect(summarizeStatement({
        type: 'Complex',
        members: [
          { name: 'EGFR', db_refs: {} },
          { name: 'GRB2', db_refs: {} },
        ],
      })).toBe('EGFR, GRB2 form a complex.');
    });
  });
});

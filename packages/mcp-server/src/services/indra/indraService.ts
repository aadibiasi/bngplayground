import type { INDRADBQueryParams, INDRAStatement } from './types.js';
import { parseBNGLWithANTLR } from '@bngplayground/engine';

const INDRA_API_BASE = (process.env.INDRA_API_BASE ?? 'http://api.indra.bio:8000').replace(/\/$/, '');
const INDRA_DB_BASE = (process.env.INDRA_DB_BASE ?? 'https://db.indra.bio').replace(/\/$/, '');
const DEFAULT_TIMEOUT_MS = 30_000;

type FetchPayload = Record<string, unknown> | unknown[];

async function indraFetch<T>(url: string, options: RequestInit & { timeout?: number } = {}): Promise<T> {
    const { timeout = DEFAULT_TIMEOUT_MS, ...fetchOptions } = options;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
        const response = await fetch(url, {
            ...fetchOptions,
            signal: controller.signal,
            headers: {
                'Content-Type': 'application/json',
                ...(fetchOptions.headers ?? {}),
            },
        });

        if (!response.ok) {
            const text = await response.text().catch(() => 'Unknown error');
            throw new Error(`INDRA request failed (${response.status}): ${text || response.statusText}`);
        }

        const contentType = response.headers.get('content-type') ?? '';
        if (contentType.includes('application/json')) {
            return await response.json() as T;
        }

        const text = await response.text();
        return ({ model: text } as unknown) as T;
    } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
            throw new Error(`INDRA request timed out after ${timeout}ms`);
        }
        throw error instanceof Error ? error : new Error(String(error));
    } finally {
        clearTimeout(timer);
    }
}

function normalizeStatements(payload: FetchPayload): INDRAStatement[] {
    if (Array.isArray(payload)) {
        return payload as INDRAStatement[];
    }
    return (payload.statements as INDRAStatement[] | undefined)
        ?? (payload.results as INDRAStatement[] | undefined)
        ?? [];
}

function normalizeDbEntries(payload: Record<string, unknown>): Array<[string, INDRAStatement]> {
    const records = (payload.statements as Record<string, INDRAStatement> | undefined)
        ?? (payload.results as Record<string, INDRAStatement> | undefined)
        ?? {};
    return Object.entries(records);
}

function hasGenerateNetworkAction(code: string): boolean {
    return /\bgenerate_network\s*\(/i.test(code);
}

function hasSimulateAction(code: string): boolean {
    return /\bsimulate(?:_ode|_ssa|_nf|_pla|_rm)?\s*\(/i.test(code);
}

function hasObservablesBlock(code: string): boolean {
    return /\bbegin observables\b/i.test(code);
}

function insertBeforeEndModel(code: string, insertion: string): string {
    const endModelMatch = /\nend model\b/i;
    if (!endModelMatch.test(code)) {
        return `${code.trimEnd()}\n${insertion}\n`;
    }
    return code.replace(endModelMatch, `\n${insertion}\nend model`);
}

function sanitizeObservableName(name: string): string {
    const cleaned = name.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
    const normalized = cleaned.length > 0 ? cleaned : 'obs';
    return /^[A-Za-z_]/.test(normalized) ? normalized : `obs_${normalized}`;
}

function ensureDefaultObservables(code: string): string {
    if (!code.trim() || hasObservablesBlock(code)) return code.trimEnd();

    try {
        const parsed = parseBNGLWithANTLR(code);
        if (!parsed.success || !parsed.model) {
            return code.trimEnd();
        }

        const observableLines: string[] = [];
        const usedNames = new Set<string>();

        for (const moleculeType of parsed.model.moleculeTypes) {
            const observableName = sanitizeObservableName(`${moleculeType.name}_total`);
            usedNames.add(observableName);
            observableLines.push(`  Molecules ${observableName} ${moleculeType.name}()`);
        }

        parsed.model.species.forEach((species, index) => {
            const baseName = sanitizeObservableName(species.initialExpression || `${species.name}_species_${index + 1}`);
            let observableName = baseName;
            let suffix = 2;
            while (usedNames.has(observableName)) {
                observableName = `${baseName}_${suffix}`;
                suffix += 1;
            }
            usedNames.add(observableName);
            observableLines.push(`  Molecules ${observableName} ${species.name}`);
        });

        if (observableLines.length === 0) {
            return code.trimEnd();
        }

        const block = `begin observables\n${observableLines.join('\n')}\nend observables`;
        return insertBeforeEndModel(code.trimEnd(), block);
    } catch {
        return code.trimEnd();
    }
}

function ensureDefaultActions(code: string): string {
    const trimmed = ensureDefaultObservables(code).trimEnd();
    if (!trimmed) return trimmed;

    const actionLines: string[] = [];
    if (!hasGenerateNetworkAction(trimmed)) {
        actionLines.push('generate_network({overwrite=>1})');
    }
    if (!hasSimulateAction(trimmed)) {
        actionLines.push('simulate({method=>"ode", t_end=>100, n_steps=>100})');
    }

    if (actionLines.length === 0) {
        return trimmed;
    }

    return `${trimmed}\n${actionLines.join('\n')}\n`;
}

export class INDRAService {
    static async processText(text: string): Promise<INDRAStatement[]> {
        if (!text.trim()) return [];
        const candidatePaths = ['/trips/process_text', '/api/trips/process_text'];
        let lastError: Error | null = null;

        for (const path of candidatePaths) {
            try {
                const payload = await indraFetch<FetchPayload>(`${INDRA_API_BASE}${path}`, {
                    method: 'POST',
                    body: JSON.stringify({ text }),
                    timeout: 60_000,
                });
                return normalizeStatements(payload);
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                if (!(error instanceof Error) || !error.message.includes('(404)')) {
                    throw error;
                }
            }
        }

        throw lastError ?? new Error('INDRA NLP endpoint not found.');
    }

    static async queryAgents(params: INDRADBQueryParams): Promise<{
        statements: INDRAStatement[];
        evidenceCounts: Map<string, number>;
        hashes: string[];
    }> {
        const query = new URLSearchParams();
        if (params.subject) query.set('subject', params.subject);
        if (params.object) query.set('object', params.object);
        if (params.type) query.set('type', params.type);
        query.set('format', 'json');

        const payload = await indraFetch<Record<string, unknown>>(
            `${INDRA_DB_BASE}/statements/from_agents?${query.toString()}`,
            { method: 'GET', headers: {}, timeout: 15_000 },
        );

        const entries = normalizeDbEntries(payload);
        const evidenceTotals = (payload.evidence_totals as Record<string, number> | undefined) ?? {};
        const evidenceCounts = new Map<string, number>();
        for (const [hash, statement] of entries) {
            evidenceCounts.set(hash, evidenceTotals[hash] ?? statement.evidence?.length ?? 0);
        }

        const filtered = entries
            .filter(([hash, statement]) => {
                const evidenceCount = evidenceCounts.get(hash) ?? 0;
                if (params.minEvidence !== undefined && evidenceCount < params.minEvidence) return false;
                if (params.minBelief !== undefined && (statement.belief ?? 0) < params.minBelief) return false;
                return true;
            })
            .sort((a, b) => {
                const evidenceDiff = (evidenceCounts.get(b[0]) ?? 0) - (evidenceCounts.get(a[0]) ?? 0);
                if (evidenceDiff !== 0) return evidenceDiff;
                return (b[1].belief ?? 0) - (a[1].belief ?? 0);
            });

        return {
            statements: filtered.map(([, statement]) => statement),
            evidenceCounts,
            hashes: filtered.map(([hash]) => hash),
        };
    }

    static async assembleBNGL(
        statements: INDRAStatement[],
        policy?: 'one_step' | 'two_step' | 'interactions_only',
    ): Promise<string> {
        if (statements.length === 0) return '';

        const payload = await indraFetch<Record<string, unknown>>(`${INDRA_API_BASE}/assemblers/pysb`, {
            method: 'POST',
            body: JSON.stringify({
                statements,
                export_format: 'bngl',
                ...(policy ? { policies: policy } : {}),
            }),
        });

        return ensureDefaultActions(String(payload.model ?? payload.model_str ?? payload.bngl ?? ''));
    }
}

import type {
  INDRADBQueryParams,
  INDRADBQueryResponse,
  INDRAAssembleEnglishResponse,
  INDRAAssemblePySBResponse,
  INDRAProcessTextResponse,
  INDRAStatement,
  INDRAModification,
  ReviewableStatement,
} from './types';

const DEFAULT_INDRA_API_BASE = 'http://api.indra.bio:8000';
const DEFAULT_INDRA_DB_BASE = 'https://db.indra.bio';
const INDRA_API_PROXY_BASE = '/api/indra';
const INDRA_DB_PROXY_BASE = '/api/indra-db';
const DEFAULT_TIMEOUT_MS = 30_000;
const DB_TIMEOUT_MS = 15_000;

function getEnvString(name: string): string | null {
  try {
    const value = (import.meta as ImportMeta & { env?: Record<string, unknown> }).env?.[name];
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
  } catch {
    return null;
  }
}

function getIndraApiBase(): string {
  const explicit = getEnvString('VITE_INDRA_API_BASE');
  if (explicit) return explicit.replace(/\/$/, '');
  if (shouldUseIndraProxy()) return INDRA_API_PROXY_BASE;
  return DEFAULT_INDRA_API_BASE;
}

function getIndraDbBase(): string {
  const explicit = getEnvString('VITE_INDRA_DB_BASE');
  if (explicit) return explicit.replace(/\/$/, '');
  if (shouldUseIndraProxy()) return INDRA_DB_PROXY_BASE;
  return DEFAULT_INDRA_DB_BASE;
}

function shouldUseIndraProxy(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0';
}

function normalizeStatementArray(payload: unknown): INDRAStatement[] {
  if (Array.isArray(payload)) {
    return payload as INDRAStatement[];
  }
  if (payload && typeof payload === 'object') {
    const candidate = payload as INDRAProcessTextResponse;
    if (Array.isArray(candidate.statements)) return candidate.statements;
    if (Array.isArray(candidate.results)) return candidate.results;
  }
  return [];
}

function normalizeDbPayload(payload: INDRADBQueryResponse): Array<[string, INDRAStatement]> {
  const records = payload.statements ?? payload.results ?? {};
  return Object.entries(records);
}

async function indraFetch<T>(
  url: string,
  options: RequestInit & { timeout?: number } = {},
): Promise<T> {
  const { timeout = DEFAULT_TIMEOUT_MS, ...fetchOpts } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...fetchOpts,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...fetchOpts.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new INDRAError(
        `INDRA API error (${response.status}): ${errorText || response.statusText}`,
        response.status,
        url,
      );
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      return await response.json() as T;
    }

    const text = await response.text();
    return ({ model: text } as unknown) as T;
  } catch (error) {
    if (error instanceof INDRAError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new INDRAError(`INDRA request timed out after ${timeout}ms`, 408, url);
    }
    throw new INDRAError(
      `Network error reaching INDRA: ${error instanceof Error ? error.message : String(error)}`,
      0,
      url,
    );
  } finally {
    clearTimeout(timer);
  }
}

export class INDRAError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly url: string,
  ) {
    super(message);
    this.name = 'INDRAError';
  }
}

export class INDRAService {
  static async processText(text: string): Promise<INDRAStatement[]> {
    if (!text.trim()) return [];
    const candidatePaths = ['/trips/process_text', '/api/trips/process_text'];
    let lastError: Error | null = null;

    for (const path of candidatePaths) {
      try {
        const response = await indraFetch<INDRAProcessTextResponse>(
          `${getIndraApiBase()}${path}`,
          {
            method: 'POST',
            body: JSON.stringify({ text }),
            timeout: 60_000,
          },
        );
        return normalizeStatementArray(response);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (!(error instanceof INDRAError) || error.statusCode !== 404) {
          throw error;
        }
      }
    }

    throw lastError ?? new INDRAError('INDRA NLP endpoint not found.', 404, getIndraApiBase());
  }

  static async queryAgents(params: INDRADBQueryParams): Promise<{
    statements: INDRAStatement[];
    evidenceCounts: Map<string, number>;
    hashes: string[];
  }> {
    const queryParams = new URLSearchParams();
    if (params.subject) queryParams.set('subject', params.subject);
    if (params.object) queryParams.set('object', params.object);
    if (params.type) queryParams.set('type', params.type);
    queryParams.set('format', 'json');

    const response = await indraFetch<INDRADBQueryResponse>(
      `${getIndraDbBase()}/statements/from_agents?${queryParams.toString()}`,
      {
        method: 'GET',
        timeout: DB_TIMEOUT_MS,
        headers: {},
      },
    );

    const entries = normalizeDbPayload(response);
    const evidenceCounts = new Map<string, number>();

    for (const [hash, statement] of entries) {
      evidenceCounts.set(hash, response.evidence_totals?.[hash] ?? statement.evidence?.length ?? 0);
    }

    const filteredEntries = entries.filter(([hash, statement]) => {
      const evidenceCount = evidenceCounts.get(hash) ?? 0;
      if (params.minEvidence !== undefined && evidenceCount < params.minEvidence) return false;
      if (params.minBelief !== undefined && (statement.belief ?? 0) < params.minBelief) return false;
      return true;
    });

    filteredEntries.sort((a, b) => {
      const evidenceDiff = (evidenceCounts.get(b[0]) ?? 0) - (evidenceCounts.get(a[0]) ?? 0);
      if (evidenceDiff !== 0) return evidenceDiff;
      return (b[1].belief ?? 0) - (a[1].belief ?? 0);
    });

    return {
      statements: filteredEntries.map(([, statement]) => statement),
      evidenceCounts,
      hashes: filteredEntries.map(([hash]) => hash),
    };
  }

  static async assembleBNGL(
    statements: INDRAStatement[],
    options: {
      policy?: 'one_step' | 'two_step' | 'interactions_only';
    } = {},
  ): Promise<string> {
    if (statements.length === 0) return '';

    const response = await indraFetch<INDRAAssemblePySBResponse>(
      `${getIndraApiBase()}/assemblers/pysb`,
      {
        method: 'POST',
        body: JSON.stringify({
          statements,
          export_format: 'bngl',
          ...(options.policy ? { policies: options.policy } : {}),
        }),
      },
    );

    return response.model ?? response.model_str ?? response.bngl ?? '';
  }

  static async statementsToEnglish(statements: INDRAStatement[]): Promise<string[]> {
    if (statements.length === 0) return [];

    try {
      const response = await indraFetch<INDRAAssembleEnglishResponse>(
        `${getIndraApiBase()}/assemblers/english`,
        {
          method: 'POST',
          body: JSON.stringify({ statements }),
        },
      );
      return response.sentences ?? response.english ?? [];
    } catch {
      return statements.map((statement) => summarizeStatement(statement));
    }
  }

  static async processTextForReview(text: string): Promise<ReviewableStatement[]> {
    const statements = await this.processText(text);
    if (statements.length === 0) return [];

    const english = await this.statementsToEnglish(statements);
    return statements.map((statement, index) => ({
      statement,
      hash: statement.matches_hash ?? statement.id ?? `nlp-${index}`,
      english: english[index] ?? summarizeStatement(statement),
      evidenceCount: statement.evidence?.length ?? 0,
      selected: true,
      sourceType: 'nlp',
    }));
  }

  static async queryAgentsForReview(params: INDRADBQueryParams): Promise<ReviewableStatement[]> {
    const { statements, evidenceCounts, hashes } = await this.queryAgents(params);
    if (statements.length === 0) return [];

    const english = await this.statementsToEnglish(statements);
    return statements.map((statement, index) => {
      const hash = hashes[index] ?? statement.matches_hash ?? statement.id ?? `db-${index}`;
      return {
        statement,
        hash,
        english: english[index] ?? summarizeStatement(statement),
        evidenceCount: evidenceCounts.get(hash) ?? statement.evidence?.length ?? 0,
        selected: true,
        sourceType: 'db' as const,
      };
    });
  }

  static async isAvailable(): Promise<boolean> {
    const urls = [
      `${getIndraApiBase()}/`,
      `${getIndraDbBase()}/statements/from_agents?subject=BRAF&format=json`,
    ];
    for (const url of urls) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5_000);
        const response = await fetch(url, {
          method: 'GET',
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (response.ok || response.status === 404 || response.status === 405) {
          return true;
        }
      } catch {
        // Try the next endpoint.
      }
    }
    return false;
  }
}

export function summarizeStatement(stmt: INDRAStatement): string {
  switch (stmt.type) {
    case 'Phosphorylation': {
      const enz = stmt.enz?.name ?? 'An enzyme';
      const site = stmt.residue && stmt.position
        ? ` at ${stmt.residue}${stmt.position}`
        : stmt.residue
          ? ` at ${stmt.residue}`
          : '';
      return `${enz} phosphorylates ${stmt.sub.name}${site}.`;
    }
    case 'Dephosphorylation': {
      const enz = stmt.enz?.name ?? 'A phosphatase';
      return `${enz} dephosphorylates ${stmt.sub.name}.`;
    }
    case 'Complex':
      return `${stmt.members.map((member) => member.name).join(', ')} form a complex.`;
    case 'Activation':
      return `${stmt.subj.name} activates ${stmt.obj.name}.`;
    case 'Inhibition':
      return `${stmt.subj.name} inhibits ${stmt.obj.name}.`;
    case 'IncreaseAmount':
      return `${stmt.subj?.name ?? 'Something'} increases the amount of ${stmt.obj.name}.`;
    case 'DecreaseAmount':
      return `${stmt.subj?.name ?? 'Something'} decreases the amount of ${stmt.obj.name}.`;
    case 'Translocation':
      return `${stmt.agent.name} translocates from ${stmt.from_location ?? '?'} to ${stmt.to_location ?? '?'}.`;
    default: {
      const modification = stmt as INDRAModification;
      return `${modification.enz?.name ?? 'An enzyme'} ${stmt.type.toLowerCase()}s ${modification.sub.name}.`;
    }
  }
}

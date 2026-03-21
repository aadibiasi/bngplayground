import { ActionType } from './types';

export interface ActionSiteConfig {
  site: string;
  states: string[];
  modFrom: string;
  modTo: string;
}

export interface ActionOntologyEntry {
  action: ActionType;
  verbs: string[];
  defaultRate: string;
  reverseRate?: string;
  bidirectional?: boolean;
  siteConfig?: ActionSiteConfig;
}

export const ACTION_ONTOLOGY: Record<Exclude<ActionType, 'unknown'>, ActionOntologyEntry> = {
  binds: {
    action: 'binds',
    verbs: [
      'binds', 'binds to', 'interacts with', 'associates with', 'complexes with',
      'attaches to', 'joins', 'connects to', 'docks to', 'recruits',
      'forms complex with', 'forms a complex with', 'binds with',
    ],
    defaultRate: 'k_on',
    reverseRate: 'k_off',
    bidirectional: true,
  },
  phosphorylates: {
    action: 'phosphorylates',
    verbs: ['phosphorylates', 'phosphorylate', 'adds phosphate to', 'kinases'],
    defaultRate: 'k_cat',
    siteConfig: { site: 'y', states: ['u', 'p'], modFrom: 'u', modTo: 'p' },
  },
  dephosphorylates: {
    action: 'dephosphorylates',
    verbs: ['dephosphorylates', 'dephosphorylate', 'removes phosphate from', 'phosphatases'],
    defaultRate: 'k_dephos',
    siteConfig: { site: 'y', states: ['u', 'p'], modFrom: 'p', modTo: 'u' },
  },
  synthesizes: {
    action: 'synthesizes',
    verbs: ['synthesizes', 'synthesize', 'produces', 'creates', 'generates', 'makes', 'transcribes', 'translates', 'expresses'],
    defaultRate: 'k_syn',
  },
  degrades: {
    action: 'degrades',
    verbs: ['degrades', 'degrade', 'destroys', 'breaks down', 'eliminates', 'removes', 'proteases', 'digests'],
    defaultRate: 'k_deg',
  },
  dimerizes: {
    action: 'dimerizes',
    verbs: ['dimerizes', 'dimerize', 'dimerizes with', 'forms dimer with', 'homodimerizes', 'heterodimerizes with', 'oligomerizes', 'multimerizes'],
    defaultRate: 'k_dim',
    reverseRate: 'k_undim',
    bidirectional: true,
  },
  translocates: {
    action: 'translocates',
    verbs: ['translocates to', 'translocate to', 'moves to', 'enters', 'exits', 'traffics to', 'localizes to', 'shuttles to', 'is transported to', 'is secreted from', 'is released from'],
    defaultRate: 'k_trans',
  },
  activates: {
    action: 'activates',
    verbs: ['activates', 'activate', 'turns on', 'enables', 'stimulates', 'promotes', 'upregulates', 'enhances', 'potentiates', 'induces'],
    defaultRate: 'k_act',
    siteConfig: { site: 'act', states: ['i', 'a'], modFrom: 'i', modTo: 'a' },
  },
  inhibits: {
    action: 'inhibits',
    verbs: ['inhibits', 'inhibit', 'blocks', 'suppresses', 'represses', 'prevents', 'downregulates', 'attenuates', 'antagonizes', 'inactivates'],
    defaultRate: 'k_inhib',
    siteConfig: { site: 'act', states: ['i', 'a'], modFrom: 'a', modTo: 'i' },
  },
  cleaves: {
    action: 'cleaves',
    verbs: ['cleaves', 'cleave', 'cuts', 'splits', 'processes', 'proteolyzes'],
    defaultRate: 'k_cleave',
    siteConfig: { site: 'cl', states: ['i', 'c'], modFrom: 'i', modTo: 'c' },
  },
  ubiquitinates: {
    action: 'ubiquitinates',
    verbs: ['ubiquitinates', 'ubiquitinate', 'ubiquitylates', 'adds ubiquitin to', 'tags for degradation'],
    defaultRate: 'k_ubiq',
    siteConfig: { site: 'ub', states: ['n', 'u'], modFrom: 'n', modTo: 'u' },
  },
  deubiquitinates: {
    action: 'deubiquitinates',
    verbs: ['deubiquitinates', 'deubiquitinate', 'removes ubiquitin from'],
    defaultRate: 'k_deubiq',
    siteConfig: { site: 'ub', states: ['n', 'u'], modFrom: 'u', modTo: 'n' },
  },
  methylates: {
    action: 'methylates',
    verbs: ['methylates', 'methylate', 'adds methyl to', 'adds methyl group to'],
    defaultRate: 'k_meth',
    siteConfig: { site: 'me', states: ['n', 'm'], modFrom: 'n', modTo: 'm' },
  },
  demethylates: {
    action: 'demethylates',
    verbs: ['demethylates', 'demethylate', 'removes methyl from'],
    defaultRate: 'k_demeth',
    siteConfig: { site: 'me', states: ['n', 'm'], modFrom: 'm', modTo: 'n' },
  },
  acetylates: {
    action: 'acetylates',
    verbs: ['acetylates', 'acetylate', 'adds acetyl to'],
    defaultRate: 'k_acet',
    siteConfig: { site: 'ac', states: ['n', 'a'], modFrom: 'n', modTo: 'a' },
  },
  deacetylates: {
    action: 'deacetylates',
    verbs: ['deacetylates', 'deacetylate', 'removes acetyl from'],
    defaultRate: 'k_deacet',
    siteConfig: { site: 'ac', states: ['n', 'a'], modFrom: 'a', modTo: 'n' },
  },
};

export const ACTION_SITE_CONFIG: Partial<Record<ActionType, ActionSiteConfig>> = Object.fromEntries(
  Object.values(ACTION_ONTOLOGY)
    .filter((entry) => Boolean(entry.siteConfig))
    .map((entry) => [entry.action, entry.siteConfig as ActionSiteConfig]),
);

export const DEFAULT_PARAMETER_VALUES: Record<string, number> = {
  k_on: 0.1,
  k_off: 0.01,
  k_cat: 1.0,
  k_dephos: 0.5,
  k_syn: 0.1,
  k_deg: 0.01,
  k_dim: 0.1,
  k_undim: 0.01,
  k_trans: 0.1,
  k_act: 1.0,
  k_inhib: 1.0,
  k_cleave: 0.5,
  k_ubiq: 0.5,
  k_deubiq: 0.5,
  k_meth: 0.5,
  k_demeth: 0.5,
  k_acet: 0.5,
  k_deacet: 0.5,
  k_fwd: 1.0,
  k_rev: 0.1,
};

export const VERBS_BY_ACTION: Record<Exclude<ActionType, 'unknown'>, string[]> = Object.fromEntries(
  Object.entries(ACTION_ONTOLOGY).map(([k, v]) => [k, v.verbs]),
) as Record<Exclude<ActionType, 'unknown'>, string[]>;

export function buildVerbPattern(verbs: string[]): string {
  return verbs.map((v) => v.replace(/\s+/g, '\\s+')).join('|');
}

export function defaultForwardRate(action: ActionType): string {
  if (action === 'unknown') return 'k_fwd';
  return ACTION_ONTOLOGY[action].defaultRate;
}

export function defaultReverseRate(action: ActionType): string {
  if (action === 'unknown') return 'k_rev';
  return ACTION_ONTOLOGY[action].reverseRate ?? 'k_rev';
}

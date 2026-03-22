export interface INDRADbRefs {
  HGNC?: string;
  UP?: string;
  TEXT?: string;
  CHEBI?: string;
  FPLX?: string;
  PUBCHEM?: string;
  MESH?: string;
  GO?: string;
  EGID?: string;
  [key: string]: string | undefined;
}

export interface INDRAModCondition {
  mod_type: string;
  residue?: string;
  position?: string;
  is_modified: boolean;
}

export interface INDRAMutCondition {
  residue_from?: string;
  residue_to?: string;
  position?: string;
}

export interface INDRAActivityCondition {
  activity_type: string;
  is_active: boolean;
}

export interface INDRAAgent {
  name: string;
  db_refs: INDRADbRefs;
  mods?: INDRAModCondition[];
  bound_conditions?: INDRABoundCondition[];
  mutations?: INDRAMutCondition[];
  activity?: INDRAActivityCondition;
  location?: string;
}

export interface INDRABoundCondition {
  agent: INDRAAgent;
  is_bound: boolean;
}

export interface INDRAEvidence {
  source_api: string;
  pmid?: string;
  text?: string;
  annotations?: Record<string, unknown>;
  epistemics?: {
    section_type?: string;
    direct?: boolean;
  };
}

export interface INDRAStatementBase {
  type: string;
  id?: string;
  belief?: number;
  evidence?: INDRAEvidence[];
  supports?: string[];
  supported_by?: string[];
  matches_hash?: string;
}

export interface INDRAPhosphorylation extends INDRAStatementBase {
  type: 'Phosphorylation';
  enz?: INDRAAgent;
  sub: INDRAAgent;
  residue?: string;
  position?: string;
}

export interface INDRADephosphorylation extends INDRAStatementBase {
  type: 'Dephosphorylation';
  enz?: INDRAAgent;
  sub: INDRAAgent;
  residue?: string;
  position?: string;
}

export interface INDRAComplex extends INDRAStatementBase {
  type: 'Complex';
  members: INDRAAgent[];
}

export interface INDRAActivation extends INDRAStatementBase {
  type: 'Activation';
  subj: INDRAAgent;
  obj: INDRAAgent;
  obj_activity?: string;
}

export interface INDRAInhibition extends INDRAStatementBase {
  type: 'Inhibition';
  subj: INDRAAgent;
  obj: INDRAAgent;
  obj_activity?: string;
}

export interface INDRAIncreaseAmount extends INDRAStatementBase {
  type: 'IncreaseAmount';
  subj?: INDRAAgent;
  obj: INDRAAgent;
}

export interface INDRADecreaseAmount extends INDRAStatementBase {
  type: 'DecreaseAmount';
  subj?: INDRAAgent;
  obj: INDRAAgent;
}

export interface INDRATranslocation extends INDRAStatementBase {
  type: 'Translocation';
  agent: INDRAAgent;
  from_location?: string;
  to_location?: string;
}

export interface INDRAModification extends INDRAStatementBase {
  type:
    | 'Ubiquitination' | 'Deubiquitination'
    | 'Sumoylation' | 'Desumoylation'
    | 'Acetylation' | 'Deacetylation'
    | 'Methylation' | 'Demethylation'
    | 'Hydroxylation' | 'Dehydroxylation'
    | 'Glycosylation' | 'Deglycosylation'
    | 'Farnesylation' | 'Defarnesylation'
    | 'Palmitoylation' | 'Depalmitoylation'
    | 'Myristoylation' | 'Demyristoylation'
    | 'Ribosylation' | 'Deribosylation'
    | 'Geranylgeranylation' | 'Degeranylgeranylation'
    | 'Autophosphorylation';
  enz?: INDRAAgent;
  sub: INDRAAgent;
  residue?: string;
  position?: string;
}

export type INDRAStatement =
  | INDRAPhosphorylation
  | INDRADephosphorylation
  | INDRAComplex
  | INDRAActivation
  | INDRAInhibition
  | INDRAIncreaseAmount
  | INDRADecreaseAmount
  | INDRATranslocation
  | INDRAModification;

export interface INDRAProcessTextResponse {
  statements?: INDRAStatement[];
  results?: INDRAStatement[];
}

export interface INDRADBQueryResponse {
  statements?: Record<string, INDRAStatement>;
  results?: Record<string, INDRAStatement>;
  total_evidence?: number;
  evidence_totals?: Record<string, number>;
}

export interface INDRAAssemblePySBResponse {
  model?: string;
  model_str?: string;
  bngl?: string;
  sbml?: string;
}

export interface INDRAAssembleEnglishResponse {
  sentences?: string[];
  english?: string[];
}

export interface ReviewableStatement {
  statement: INDRAStatement;
  hash: string;
  english: string;
  evidenceCount: number;
  selected: boolean;
  sourceType: 'nlp' | 'db';
}

export interface INDRADBQueryParams {
  subject?: string;
  object?: string;
  type?: string;
  minEvidence?: number;
  minBelief?: number;
}

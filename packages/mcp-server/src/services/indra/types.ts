export interface INDRADBQueryParams {
    subject?: string;
    object?: string;
    type?: string;
    minEvidence?: number;
    minBelief?: number;
}

export interface INDRADbRefs {
    [key: string]: string | undefined;
}

export interface INDRAAgent {
    name: string;
    db_refs: INDRADbRefs;
}

export interface INDRAEvidence {
    source_api: string;
    pmid?: string;
    text?: string;
}

export interface INDRAStatement {
    type: string;
    id?: string;
    belief?: number;
    evidence?: INDRAEvidence[];
    matches_hash?: string;
    enz?: INDRAAgent;
    sub?: INDRAAgent;
    subj?: INDRAAgent;
    obj?: INDRAAgent;
    agent?: INDRAAgent;
    members?: INDRAAgent[];
    residue?: string;
    position?: string;
    from_location?: string;
    to_location?: string;
}

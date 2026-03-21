import { ActionType, InteractionSentence } from './types';

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RATE_RE = /^(?:[A-Za-z_][A-Za-z0-9_]*|[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)$/;

const REQUIRES_TARGET_COMPARTMENT = new Set<ActionType>(['translocates']);
const MODIFICATION_ACTIONS = new Set<ActionType>([
  'phosphorylates', 'dephosphorylates', 'ubiquitinates', 'deubiquitinates',
  'methylates', 'demethylates', 'acetylates', 'deacetylates', 'activates', 'inhibits', 'cleaves',
]);

export function validateInteractionSentence(intent: InteractionSentence): ValidationResult {
  const errors: string[] = [];

  if (!IDENT_RE.test(intent.subject.name) && intent.subject.name !== 'Null') {
    errors.push(`Invalid subject identifier: ${intent.subject.name}`);
  }

  if (!IDENT_RE.test(intent.object.name) && intent.object.name !== 'Null') {
    errors.push(`Invalid object identifier: ${intent.object.name}`);
  }

  if (intent.rate && !RATE_RE.test(intent.rate)) {
    errors.push(`Invalid forward rate token: ${intent.rate}`);
  }

  if (intent.reverseRate && !RATE_RE.test(intent.reverseRate)) {
    errors.push(`Invalid reverse rate token: ${intent.reverseRate}`);
  }

  if (REQUIRES_TARGET_COMPARTMENT.has(intent.action) && !intent.targetCompartment) {
    errors.push('Translocation interactions require a target compartment.');
  }

  if (intent.action === 'binds' || intent.action === 'dimerizes') {
    if (intent.isBidirectional !== true) {
      errors.push(`${intent.action} interactions must be bidirectional.`);
    }
  }

  if (MODIFICATION_ACTIONS.has(intent.action) && intent.site && !IDENT_RE.test(intent.site)) {
    errors.push(`Invalid modification site identifier: ${intent.site}`);
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

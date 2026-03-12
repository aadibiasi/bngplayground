// @vitest-environment jsdom
import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// we need to spy on the builder used by RegulatoryTab to ensure it passes the
// correct option.  rather than invoking the real implementation (which is
// tested separately above) we'll mock the module.
const mockBuilder = vi.hoisted(() => ({
  buildAtomRuleGraph: vi.fn(() => ({ nodes: [], edges: [] })),
}));

vi.mock('../services/visualization/arGraphBuilder', () => mockBuilder);

import { RegulatoryTab } from '../components/tabs/RegulatoryTab';
import type { BNGLModel } from '../types';

const dummyModel: BNGLModel = {
  parameters: {},
  moleculeTypes: [],
  species: [],
  reactionRules: [],
  observables: [],
  functions: [],
};

describe('RegulatoryTab', () => {
  it('asks the graph builder to omit rate-law dependency atoms', () => {
    const rule = { name: 'r', reactants: ['A()'], products: ['B()'], rate: 'k', isBidirectional: false };
    const model: BNGLModel = { ...dummyModel, reactionRules: [rule] };

    render(<RegulatoryTab model={model} />);
    expect(mockBuilder.buildAtomRuleGraph).toHaveBeenCalledWith(
      [rule],
      expect.objectContaining({ includeRateLawDeps: false })
    );
  });
});

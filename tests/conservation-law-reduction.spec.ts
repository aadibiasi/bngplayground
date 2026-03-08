import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  generateExpandedNetwork,
  parseBNGLStrict,
  setFeatureFlags,
  simulate
} from '@bngplayground/engine';

const MODEL_TEXT = `begin model
begin parameters
  k1 1
  k2 0.5
end parameters

begin molecule types
  A()
  B()
end molecule types

begin seed species
  A() 10
  B() 0
end seed species

begin observables
  Molecules A_obs A()
  Molecules B_obs B()
end observables

begin reaction rules
  A() -> B() k1
  B() -> A() k2
end reaction rules
end model
`;

const callbacks = {
  checkCancelled: () => {},
  postMessage: () => {}
};

describe('conservation-law reduction integration', () => {
  afterEach(() => {
    setFeatureFlags({ conservationLawReduction: false, functionalRatesEnabled: true });
    vi.restoreAllMocks();
  });

  it('preserves trajectories while activating the reduced ODE path', async () => {
    const parsed = parseBNGLStrict(MODEL_TEXT);
    const expanded = await generateExpandedNetwork(parsed, () => {}, () => {});
    const options = {
      method: 'ode',
      solver: 'cvode',
      t_end: 1,
      n_steps: 4,
      disableNativeBytecode: true
    } as any;

    setFeatureFlags({ conservationLawReduction: false });
    const baseline = await simulate(1, expanded, options, callbacks);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    setFeatureFlags({ conservationLawReduction: true });
    const reduced = await simulate(1, expanded, options, callbacks);

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Using conservation-law reduced ODE system'));

    const baselineLast = baseline.data[baseline.data.length - 1];
    const reducedLast = reduced.data[reduced.data.length - 1];

    expect(reduced.data).toHaveLength(baseline.data.length);
    expect(reducedLast.A_obs + reducedLast.B_obs).toBeCloseTo(10, 6);
    expect(reducedLast.A_obs).toBeCloseTo(baselineLast.A_obs, 6);
    expect(reducedLast.B_obs).toBeCloseTo(baselineLast.B_obs, 6);
  }, 30000);
});
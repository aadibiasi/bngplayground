import { describe, expect, it } from 'vitest';
import { resolveSimulationControlDefaults, sanitizeSimulationControlOptions } from '../../components/SimulationControls';

describe('SimulationControls helpers', () => {
  it('falls back to sane defaults when model phase settings are missing or invalid', () => {
    const model = {
      simulationOptions: { t_end: 100, n_steps: 100 },
      simulationPhases: [{ method: 'ode', t_start: 0, t_end: 0, n_steps: 0 }],
    };

    expect(resolveSimulationControlDefaults(model, 'ode')).toEqual({
      tStart: '0',
      tEnd: '100',
      nSteps: '100',
    });
  });

  it('sanitizes empty or invalid user input before simulation', () => {
    expect(
      sanitizeSimulationControlOptions(
        { tEnd: '', nSteps: '0' },
        { t_end: 100, n_steps: 100 }
      )
    ).toEqual({ t_end: 100, n_steps: 100 });
  });

  it('preserves valid positive user input', () => {
    expect(
      sanitizeSimulationControlOptions(
        { tEnd: '250', nSteps: '400' },
        { t_end: 100, n_steps: 100 }
      )
    ).toEqual({ t_end: 250, n_steps: 400 });
  });
});
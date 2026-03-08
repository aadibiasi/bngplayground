import { describe, expect, it } from 'vitest';
import type { SimulationResults } from '../../types';
import { getSelectedSimulationSlice, reconcileVisibleSeries } from '../../components/ResultsChart';

describe('ResultsChart helpers', () => {
  it('uses the selected suffix slice instead of the default dataset', () => {
    const results: SimulationResults = {
      headers: ['time', 'ObsA'],
      data: [
        { time: 0, ObsA: 1 },
        { time: 1, ObsA: 2 },
      ],
      dataBySuffix: {
        __default__: [
          { time: 0, ObsA: 1 },
          { time: 1, ObsA: 2 },
        ],
        phase_2: [
          { time: 10, ObsA: 101 },
          { time: 20, ObsA: 202 },
        ],
      },
      speciesHeaders: ['S1'],
      speciesData: [{ S1: 5 }],
      speciesDataBySuffix: {
        phase_2: [{ S1: 50 }],
      },
    };

    const slice = getSelectedSimulationSlice(results, 'phase_2');

    expect(slice.sourceData).toEqual(results.dataBySuffix?.phase_2);
    expect(slice.sourceSpeciesData).toEqual(results.speciesDataBySuffix?.phase_2);
    expect(slice.selectedResults?.data).toEqual(results.dataBySuffix?.phase_2);
    expect(slice.selectedResults?.speciesData).toEqual(results.speciesDataBySuffix?.phase_2);
  });

  it('restores available series when current visibility does not match result headers', () => {
    const visible = new Set(['OldObs']);
    const reconciled = reconcileVisibleSeries(visible, ['ObsA', 'ObsB']);

    expect(reconciled).toEqual(new Set(['ObsA', 'ObsB']));
  });

  it('preserves current selection when it still overlaps with available series', () => {
    const visible = new Set(['ObsB']);
    const reconciled = reconcileVisibleSeries(visible, ['ObsA', 'ObsB']);

    expect(reconciled).toBeNull();
  });
});
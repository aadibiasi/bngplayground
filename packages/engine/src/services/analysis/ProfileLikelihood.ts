/**
 * ProfileLikelihood.ts — Profile likelihood analysis for parameter identifiability.
 *
 * Computes 1D likelihood profiles by fixing each parameter across a grid
 * and re-optimizing remaining parameters. Provides confidence intervals
 * and structural/practical identifiability classification.
 */

import { chi2Quantile } from '../../utils/mathUtils';
import { nelderMead } from '../optimization/nelderMead';

// ── Types ────────────────────────────────────────────────────────────

export interface ProfileLikelihoodConfig {
  /** Async simulation function */
  simulate: (overrides: Record<string, number>) => Promise<{ data: Array<Record<string, number>> }>;
  /** Baseline parameter values (MLE or best-fit) */
  parameters: Record<string, number>;
  /** Parameters to profile */
  parameterNames: string[];
  /** Experimental data for SSR computation */
  experimentalData: Array<{ time: number; values: Record<string, number>; errors?: Record<string, number> }>;
  /** Number of grid points per parameter (default: 20) */
  nGrid?: number;
  /** Range factor: grid spans [value/factor, value*factor] (default: 10) */
  rangeFactor?: number;
  /** Re-optimize other parameters at each grid point (default: true) */
  reoptimize?: boolean;
  /** Confidence level (default: 0.95) */
  alpha?: number;
  /** Max optimizer evaluations per grid point (default: 200) */
  maxReoptEval?: number;
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number) => void;
}

export interface ProfileLikelihoodResult {
  profiles: Record<string, {
    grid: number[];
    ssr: number[];
    minSSR: number;
    ci: { lower: number; upper: number } | null;
    flat: boolean;
    identifiability: 'identifiable' | 'practically_unidentifiable' | 'structurally_unidentifiable';
  }>;
  threshold: number;
  baselineSSR: number;
}

// ── Helpers ──────────────────────────────────────────────────────────

function computeSSR(
  simData: Array<Record<string, number>>,
  expData: Array<{ time: number; values: Record<string, number>; errors?: Record<string, number> }>,
  observables: string[],
): number {
  let ssr = 0;
  for (const dp of expData) {
    for (const obs of observables) {
      if (dp.values[obs] === undefined) continue;
      const simVal = interpolateValue(simData, dp.time, obs);
      const diff = simVal - dp.values[obs];
      const error = dp.errors?.[obs];
      if (error !== undefined && error > 0) {
        ssr += (diff * diff) / (error * error);
      } else {
        ssr += diff * diff;
      }
    }
  }
  return ssr;
}

function interpolateValue(
  data: Array<Record<string, number>>,
  targetTime: number,
  obs: string,
): number {
  if (data.length === 0) return 0;
  const exact = data.find((r) => Math.abs(r.time - targetTime) < 1e-12);
  if (exact) return exact[obs] ?? 0;

  if (targetTime <= data[0].time) return data[0][obs] ?? 0;
  if (targetTime >= data[data.length - 1].time) return data[data.length - 1][obs] ?? 0;

  for (let i = 1; i < data.length; i++) {
    if (data[i].time >= targetTime) {
      const t0 = data[i - 1].time;
      const t1 = data[i].time;
      const alpha = t1 > t0 ? (targetTime - t0) / (t1 - t0) : 0;
      const v0 = data[i - 1][obs] ?? 0;
      const v1 = data[i][obs] ?? 0;
      return v0 + alpha * (v1 - v0);
    }
  }
  return data[data.length - 1][obs] ?? 0;
}

// ── Main API ─────────────────────────────────────────────────────────

export async function profileLikelihood(
  config: ProfileLikelihoodConfig,
): Promise<ProfileLikelihoodResult> {
  const {
    simulate,
    parameters,
    parameterNames,
    experimentalData,
    nGrid = 20,
    rangeFactor = 10,
    reoptimize = true,
    alpha = 0.95,
    maxReoptEval = 200,
    signal,
    onProgress,
  } = config;

  const allObs = new Set<string>();
  for (const dp of experimentalData) {
    Object.keys(dp.values).forEach((k) => allObs.add(k));
  }
  const observables = [...allObs];

  // 1. Baseline SSR
  const baseResult = await simulate(parameters);
  const baselineSSR = computeSSR(baseResult.data, experimentalData, observables);

  // Chi-squared threshold
  const threshold = baselineSSR + chi2Quantile(alpha, 1);

  const total = parameterNames.length * nGrid;
  let completed = 0;

  const profiles: ProfileLikelihoodResult['profiles'] = {};

  for (const paramName of parameterNames) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const baseValue = parameters[paramName];
    const otherParams = parameterNames.filter((n) => n !== paramName);

    // Create log-spaced grid
    const grid: number[] = [];
    const logBase = Math.log(Math.max(baseValue, 1e-30));
    const logFactor = Math.log(rangeFactor);
    for (let i = 0; i < nGrid; i++) {
      const logVal = logBase - logFactor + (2 * logFactor * i) / (nGrid - 1);
      grid.push(Math.exp(logVal));
    }

    const ssr: number[] = [];

    for (const gridVal of grid) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

      if (reoptimize && otherParams.length > 0) {
        // Re-optimize remaining parameters at this grid point
        const otherValues = otherParams.map((n) => parameters[n]);

        const objective = async (x: number[]): Promise<number> => {
          const overrides = { ...parameters };
          overrides[paramName] = gridVal;
          otherParams.forEach((n, i) => {
            const v0 = parameters[n];
            if (v0 > 0) {
              overrides[n] = Math.exp(x[i]);
            } else {
              overrides[n] = x[i]; // Linear space for non-positive params
            }
          });
          try {
            const result = await simulate(overrides);
            return computeSSR(result.data, experimentalData, observables);
          } catch {
            return 1e12;
          }
        };

        const x0 = otherValues.map((v) => (v > 0 ? Math.log(v) : v));
        try {
          const optResult = await nelderMead(objective, x0, {
            maxEval: maxReoptEval,
            ftol: 1e-6,
            signal,
          });
          ssr.push(optResult.value);
        } catch {
          // Use non-optimized value
          const overrides = { ...parameters, [paramName]: gridVal };
          try {
            const result = await simulate(overrides);
            ssr.push(computeSSR(result.data, experimentalData, observables));
          } catch {
            ssr.push(Infinity);
          }
        }
      } else {
        // No re-optimization: just evaluate
        const overrides = { ...parameters, [paramName]: gridVal };
        try {
          const result = await simulate(overrides);
          ssr.push(computeSSR(result.data, experimentalData, observables));
        } catch {
          ssr.push(Infinity);
        }
      }

      completed++;
      onProgress?.(completed, total);
    }

    const finiteSsr = ssr.filter(isFinite);
    const minSSR = finiteSsr.length > 0 ? Math.min(...finiteSsr) : Infinity;
    const maxSSR = finiteSsr.length > 0 ? Math.max(...finiteSsr) : 0;
    const flat = (maxSSR - minSSR) / Math.max(minSSR, 1e-30) < 0.01;

    // CI: range of grid values where SSR < threshold
    let ci: { lower: number; upper: number } | null = null;
    const belowThreshold = grid.filter((_, i) => ssr[i] < threshold);
    if (belowThreshold.length > 0) {
      ci = {
        lower: Math.min(...belowThreshold),
        upper: Math.max(...belowThreshold),
      };
    }

    // Classification
    let identifiability: 'identifiable' | 'practically_unidentifiable' | 'structurally_unidentifiable';
    if (flat) {
      identifiability = 'structurally_unidentifiable';
    } else if (ci && (ci.lower <= grid[0] * 1.01 || ci.upper >= grid[grid.length - 1] * 0.99)) {
      identifiability = 'practically_unidentifiable';
    } else {
      identifiability = 'identifiable';
    }

    profiles[paramName] = { grid, ssr, minSSR, ci, flat, identifiability };
  }

  return { profiles, threshold, baselineSSR };
}

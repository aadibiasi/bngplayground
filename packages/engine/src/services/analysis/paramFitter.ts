// packages/engine/src/services/analysis/paramFitter.ts

import { BNGLModel, SimulationOptions, SimulationResults } from '../../types';
import { nelderMead, NelderMeadProgress } from '../optimization/nelderMead';
import { sbplx } from '../optimization/sbplx';
import { projectedNM } from '../optimization/projectedNM';
import type { ProjectedNMOptions } from '../optimization/projectedNM';

// ---------------------------------------------------------------------------
// Types (intentional match of UI-side names)
// ---------------------------------------------------------------------------

export type FitAlgorithm = 'nelder-mead' | 'sbplx' | 'projected-nm' | 'bobyqa';

export interface ParamBounds {
  name: string;
  initial: number;
  min: number;
  max: number;
}

export interface ExperimentalDataPoint {
  time: number;
  values: Record<string, number>;
}

export interface FitProgress {
  nEval: number;
  sse: number;
  params: number[];
  iteration: number;
}

export interface FitResult {
  params: number[];
  paramNames: string[];
  sse: number;
  rmse: number;
  rSquared: number;
  nEval: number;
  iterations: number;
  converged: boolean;
  sseHistory: number[];
  bestPredictions: Map<string, number[]>;
  confidenceIntervals: { lower: number; upper: number }[];
  algorithm: string;
}

export interface FitConfig {
  model: BNGLModel;
  paramBounds: ParamBounds[];
  experimentalData: ExperimentalDataPoint[];
  simulate: (
    overrides: Record<string, number>,
    options: SimulationOptions
  ) => Promise<SimulationResults>;
  algorithm?: FitAlgorithm;
  maxEval?: number;
  ftol?: number;
  onProgress?: (p: FitProgress) => void;
  signal?: AbortSignal;
  /**
   * Base simulation options; t_end and n_steps are required by the fitter and
   * will be overridden by values derived from the experimental data if provided.
   */
  simOptions?: Partial<SimulationOptions>;
}

// ---------------------------------------------------------------------------
// Main entry point — engine-side, agnostic of how simulation is performed
// ---------------------------------------------------------------------------

export async function fitParameters(cfg: FitConfig): Promise<FitResult> {
  const {
    model,
    paramBounds,
    experimentalData,
    simulate,
    algorithm = 'nelder-mead',
    maxEval = 500,
    ftol = 1e-6,
    onProgress,
    signal,
    simOptions = {},
  } = cfg;

  const n = paramBounds.length;
  const paramNames = paramBounds.map(b => b.name);

  const dataObsNames = Object.keys(experimentalData[0]?.values ?? {});
  const modelObsNames = model.observables.map(o => o.name);
  const sharedObs = dataObsNames.filter(n => modelObsNames.includes(n));

  const timePoints = experimentalData.map(d => d.time);
  const tEnd = timePoints[timePoints.length - 1];
  const nSteps = timePoints.length - 1;

  const observed: Record<string, number[]> = {};
  for (const obs of sharedObs) {
    observed[obs] = experimentalData.map(d => d.values[obs] ?? 0);
  }

  const totalPoints = sharedObs.length * timePoints.length;
  const sseHistory: number[] = [];
  let nEval = 0;

  const useLog: boolean[] = paramBounds.map(b => b.min > 0);
  const encode = (p: number[]): number[] =>
    p.map((v, i) => (useLog[i] ? Math.log(v) : v));
  const decode = (p: number[]): number[] =>
    p
      .map((v, i) => (useLog[i] ? Math.exp(v) : v))
      .map((v, i) => Math.max(paramBounds[i].min, Math.min(paramBounds[i].max, v)));

  const x0encoded = encode(paramBounds.map(b => b.initial));

  async function objective(xenc: number[]): Promise<number> {
    if (signal?.aborted) return Infinity;
    const params = decode(xenc);
    const overrides: Record<string, number> = {};
    for (let i = 0; i < n; i++) overrides[paramNames[i]] = params[i];

    try {
      const simResult = await simulate(overrides, {
        method: 'ode',
        t_end: tEnd,
        n_steps: nSteps,
        atol: 1e-8,
        rtol: 1e-6,
        ...simOptions,
      });

      let sse = 0;
      const dataRows = simResult.data;
      for (const obs of sharedObs) {
        const simVals = timePoints.map(t => {
          const row =
            dataRows.find(r => Math.abs(r.time - t) < 1e-12) ??
            interpolateRow(dataRows, t);
          return row?.[obs] ?? 0;
        });
        const obsData = observed[obs];
        for (let i = 0; i < simVals.length; i++) {
          const diff = simVals[i] - obsData[i];
          sse += diff * diff;
        }
      }
      nEval++;
      return isFinite(sse) ? sse : 1e12;
    } catch {
      return 1e12;
    }
  }

  const progressCallback = (info: {
    nEval: number;
    bestValue: number;
    bestX: Float64Array;
    iteration: number;
  }) => {
    sseHistory.push(info.bestValue);
    const params = decode([...info.bestX]);
    onProgress?.({
      nEval: info.nEval,
      sse: info.bestValue,
      params,
      iteration: info.iteration,
    });
  };

  let nmResult: {
    x: number[];
    value: number;
    nEval: number;
    iterations: number;
    converged: boolean;
  };

  switch (algorithm) {
    case 'sbplx':
    case 'bobyqa': {
      const sbResult = await sbplx(objective, x0encoded, {
        maxEval,
        ftol,
        signal,
        onProgress: info => progressCallback(info),
        minSubspaceDim: Math.min(2, n),
        maxSubspaceDim: Math.min(5, n),
      });
      nmResult = sbResult;
      break;
    }
    case 'projected-nm': {
      const opts: ProjectedNMOptions = {
        maxEval,
        ftol,
        signal,
        lowerBounds: paramBounds.map((b, i) =>
          useLog[i] ? Math.log(Math.max(b.min, 1e-30)) : b.min
        ),
        upperBounds: paramBounds.map((b, i) => (useLog[i] ? Math.log(b.max) : b.max)),
        barrierStrength: 0.001,
        onProgress: info => progressCallback(info),
      };
      const coResult = await projectedNM(objective, x0encoded, opts);
      nmResult = coResult;
      break;
    }
    case 'nelder-mead':
    default: {
      const nmRes = await nelderMead(objective, x0encoded, {
        maxEval,
        ftol,
        signal,
        onProgress: (info: NelderMeadProgress) => progressCallback(info),
      });
      nmResult = nmRes;
      break;
    }
  }

  const bestParams = decode(nmResult.x);
  const bestOverrides: Record<string, number> = {};
  for (let i = 0; i < n; i++) bestOverrides[paramNames[i]] = bestParams[i];

  const bestPredictions = new Map<string, number[]>();
  let finalSse = nmResult.value;

  try {
    const finalSim = await simulate(bestOverrides, {
      method: 'ode',
      t_end: tEnd,
      n_steps: nSteps,
      atol: 1e-8,
      rtol: 1e-6,
      ...simOptions,
    });

    for (const obs of sharedObs) {
      bestPredictions.set(obs,
        timePoints.map(t => {
          const dataRows = finalSim.data;
          const row =
            dataRows.find(r => Math.abs(r.time - t) < 1e-12) ??
            interpolateRow(dataRows, t);
          return row?.[obs] ?? 0;
        })
      );
    }

    let sse = 0;
    for (const obs of sharedObs) {
      const pred = bestPredictions.get(obs)!;
      const obsData = observed[obs];
      for (let i = 0; i < pred.length; i++) {
        const diff = pred[i] - obsData[i];
        sse += diff * diff;
      }
    }
    finalSse = sse;
  } catch {
    /* keep nmResult.value */
  }

  const rmse = totalPoints > 0 ? Math.sqrt(finalSse / totalPoints) : 0;
  let ssTot = 0;
  for (const obs of sharedObs) {
    const obsData = observed[obs];
    const mean = obsData.reduce((a, b) => a + b, 0) / obsData.length;
    for (const v of obsData) ssTot += (v - mean) ** 2;
  }
  const rSquared = ssTot > 0 ? 1 - finalSse / ssTot : 0;

  const confidenceIntervals = await finiteDiffCI(
    objective,
    nmResult.x,
    finalSse,
    bestParams,
    decode,
    signal
  );

  return {
    params: bestParams,
    paramNames,
    sse: finalSse,
    rmse,
    rSquared,
    nEval: nmResult.nEval,
    iterations: nmResult.iterations,
    converged: nmResult.converged,
    sseHistory,
    bestPredictions,
    confidenceIntervals,
    algorithm,
  };
}

async function finiteDiffCI(
  f: (x: number[]) => Promise<number>,
  xenc: number[],
  f0: number,
  bestParams: number[],
  decode: (x: number[]) => number[],
  signal?: AbortSignal
): Promise<{ lower: number; upper: number }[]> {
  const n = xenc.length;
  const h = 1e-4;
  const variances: number[] = new Array(n).fill(0);

  try {
    for (let i = 0; i < n; i++) {
      if (signal?.aborted) break;
      const xp = [...xenc]; xp[i] += h;
      const xm = [...xenc]; xm[i] -= h;
      const fp = await f(xp);
      const fm = await f(xm);
      const hess = (fp - 2 * f0 + fm) / (h * h);
      if (hess > 1e-30) {
        variances[i] = Math.max(0, f0 / hess);
      } else {
        variances[i] = bestParams[i] ** 2 * 0.25;
      }
    }
  } catch {
    /* leave zeros → fallback below */
  }

  return bestParams.map((v, i) => {
    const std = Math.sqrt(variances[i]) * 1.96;
    const fallback = Math.abs(v) * 0.5 || 0.5;
    const half = isFinite(std) && std > 0 ? std : fallback;
    return { lower: Math.max(0, v - half), upper: v + half };
  });
}

function interpolateRow(
  rows: Array<Record<string, number>>,
  t: number
): Record<string, number> | null {
  if (!rows.length) return null;
  const times = rows.map(r => r.time as number);
  const idx = times.findIndex(rt => rt >= t);
  if (idx <= 0) return rows[0];
  if (idx >= rows.length) return rows[rows.length - 1];
  const t0 = times[idx - 1], t1 = times[idx];
  const alpha = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
  const result: Record<string, number> = { time: t } as any;
  for (const key of Object.keys(rows[idx])) {
    if (key === 'time') continue;
    const v0 = rows[idx - 1][key] as number;
    const v1 = rows[idx][key] as number;
    result[key] = v0 + alpha * (v1 - v0);
  }
  return result;
}

/**
 * services/analysis/bpsl.ts
 *
 * Biological Property Specification Language (BPSL) parser and evaluator.
 *
 * Implements a subset of PyBioNetFit's BPSL for qualitative constraints on
 * model behavior.
 */

// --- Types ------------------------------------------------------------------

export type ConstraintType =
  | 'monotone_increasing'
  | 'monotone_decreasing'
  | 'peak_before'
  | 'peak_after'
  | 'peak_between'
  | 'peak_order'
  | 'steady_state'
  | 'bounds'
  | 'ratio'
  | 'oscillates'
  | 'no_oscillation'
  | 'final_value'
  | 'initial_increase'
  | 'overshoot';

export interface BPSLConstraint {
  type: ConstraintType;
  observable: string;
  /** Second observable (for peak_order, ratio). */
  observable2?: string;
  /** Numeric arguments (meaning depends on type). */
  args: number[];
  /** Original source line for error reporting. */
  source: string;
}

export interface BPSLResult {
  /** Total penalty (sum of all constraint penalties). */
  totalPenalty: number;
  /** Per-constraint breakdown. */
  details: BPSLConstraintResult[];
}

export interface BPSLConstraintResult {
  constraint: BPSLConstraint;
  penalty: number;
  satisfied: boolean;
  message: string;
}

// --- Parser -----------------------------------------------------------------

/**
 * Parse a BPSL specification string into structured constraints.
 * One constraint per line. Lines starting with # are comments.
 * Empty lines are ignored.
 */
export function parseBPSL(text: string): BPSLConstraint[] {
  const constraints: BPSLConstraint[] = [];

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const tokens = line.split(/\s+/);
    const type = tokens[0] as ConstraintType;

    switch (type) {
      case 'monotone_increasing':
      case 'monotone_decreasing':
        constraints.push({
          type,
          observable: tokens[1],
          args: tokens.slice(2).map(Number),
          source: line,
        });
        break;

      case 'peak_before':
      case 'peak_after':
        constraints.push({
          type,
          observable: tokens[1],
          args: [Number(tokens[2])],
          source: line,
        });
        break;

      case 'peak_between':
        constraints.push({
          type,
          observable: tokens[1],
          args: [Number(tokens[2]), Number(tokens[3])],
          source: line,
        });
        break;

      case 'peak_order':
        constraints.push({
          type,
          observable: tokens[1],
          observable2: tokens[2],
          args: [],
          source: line,
        });
        break;

      case 'steady_state':
        constraints.push({
          type,
          observable: tokens[1],
          args: tokens.slice(2).map(Number),
          source: line,
        });
        break;

      case 'bounds':
        constraints.push({
          type,
          observable: tokens[1],
          args: tokens.slice(2).map(Number),
          source: line,
        });
        break;

      case 'ratio':
        constraints.push({
          type,
          observable: tokens[1],
          observable2: tokens[2],
          args: tokens.slice(3).map(Number),
          source: line,
        });
        break;

      case 'oscillates':
        constraints.push({
          type,
          observable: tokens[1],
          args: [Number(tokens[2])],
          source: line,
        });
        break;

      case 'no_oscillation':
        constraints.push({
          type,
          observable: tokens[1],
          args: [],
          source: line,
        });
        break;

      case 'final_value':
        constraints.push({
          type,
          observable: tokens[1],
          args: [Number(tokens[2]), Number(tokens[3])],
          source: line,
        });
        break;

      case 'initial_increase':
        constraints.push({
          type,
          observable: tokens[1],
          args: [],
          source: line,
        });
        break;

      case 'overshoot':
        constraints.push({
          type,
          observable: tokens[1],
          args: [Number(tokens[2])],
          source: line,
        });
        break;

      default:
        console.warn(`[BPSL] Unknown constraint type: "${type}" in: ${line}`);
    }
  }

  return constraints;
}

// --- Evaluator ---------------------------------------------------------------

/**
 * Evaluate all constraints against a simulation trajectory.
 */
export function evaluateBPSL(
  constraints: BPSLConstraint[],
  time: number[],
  observables: Map<string, number[]>,
): BPSLResult {
  const details: BPSLConstraintResult[] = [];
  let totalPenalty = 0;

  for (const c of constraints) {
    const result = evaluateOne(c, time, observables);
    details.push(result);
    totalPenalty += result.penalty;
  }

  return { totalPenalty, details };
}

function evaluateOne(
  c: BPSLConstraint,
  time: number[],
  observables: Map<string, number[]>,
): BPSLConstraintResult {
  const vals = observables.get(c.observable);
  if (!vals) {
    return {
      constraint: c,
      penalty: 100,
      satisfied: false,
      message: `Observable "${c.observable}" not found`,
    };
  }

  const n = time.length;

  switch (c.type) {
    case 'monotone_increasing':
    case 'monotone_decreasing': {
      const t0 = c.args[0] ?? time[0];
      const t1 = c.args[1] ?? time[n - 1];
      const isIncreasing = c.type === 'monotone_increasing';
      let penalty = 0;
      for (let i = 1; i < n; i++) {
        if (time[i] < t0 || time[i - 1] > t1) continue;
        const diff = vals[i] - vals[i - 1];
        if (isIncreasing && diff < 0) penalty += diff * diff;
        if (!isIncreasing && diff > 0) penalty += diff * diff;
      }
      return {
        constraint: c,
        penalty,
        satisfied: penalty === 0,
        message:
          penalty === 0
            ? 'Satisfied'
            : `Monotonicity violated (penalty=${penalty.toExponential(2)})`,
      };
    }

    case 'peak_before':
    case 'peak_after':
    case 'peak_between': {
      const peakIdx = findPeakIndex(vals);
      if (peakIdx < 0) {
        return { constraint: c, penalty: 50, satisfied: false, message: 'No peak found' };
      }
      const peakTime = time[peakIdx];

      if (c.type === 'peak_before') {
        const deadline = c.args[0];
        const penalty = peakTime > deadline ? (peakTime - deadline) ** 2 : 0;
        return {
          constraint: c,
          penalty,
          satisfied: penalty === 0,
          message:
            penalty === 0
              ? `Peak at t=${peakTime.toPrecision(4)} < ${deadline}`
              : `Peak at t=${peakTime.toPrecision(4)} > deadline ${deadline}`,
        };
      }

      if (c.type === 'peak_after') {
        const earliest = c.args[0];
        const penalty = peakTime < earliest ? (earliest - peakTime) ** 2 : 0;
        return {
          constraint: c,
          penalty,
          satisfied: penalty === 0,
          message:
            penalty === 0
              ? `Peak at t=${peakTime.toPrecision(4)} > ${earliest}`
              : `Peak at t=${peakTime.toPrecision(4)} < earliest ${earliest}`,
        };
      }

      const [lo, hi] = c.args;
      let penalty = 0;
      if (peakTime < lo) penalty = (lo - peakTime) ** 2;
      if (peakTime > hi) penalty = (peakTime - hi) ** 2;
      return {
        constraint: c,
        penalty,
        satisfied: penalty === 0,
        message:
          penalty === 0
            ? `Peak at t=${peakTime.toPrecision(4)} in [${lo}, ${hi}]`
            : `Peak at t=${peakTime.toPrecision(4)} outside [${lo}, ${hi}]`,
      };
    }

    case 'peak_order': {
      const vals2 = observables.get(c.observable2!);
      if (!vals2) {
        return {
          constraint: c,
          penalty: 100,
          satisfied: false,
          message: `Observable "${c.observable2}" not found`,
        };
      }
      const peak1 = findPeakIndex(vals);
      const peak2 = findPeakIndex(vals2);
      if (peak1 < 0 || peak2 < 0) {
        return { constraint: c, penalty: 50, satisfied: false, message: 'Cannot find peaks for ordering' };
      }
      const t1 = time[peak1];
      const t2 = time[peak2];
      const penalty = t1 > t2 ? (t1 - t2) ** 2 : 0;
      return {
        constraint: c,
        penalty,
        satisfied: penalty === 0,
        message:
          penalty === 0
            ? `${c.observable} peaks (t=${t1.toPrecision(4)}) before ${c.observable2} (t=${t2.toPrecision(4)})`
            : `${c.observable} peaks AFTER ${c.observable2}`,
      };
    }

    case 'steady_state': {
      const tol = c.args[0] ?? 0.01;
      const tStart = c.args[1] ?? time[Math.floor(n * 0.8)];
      let penalty = 0;
      for (let i = 1; i < n; i++) {
        if (time[i] < tStart) continue;
        const dt = time[i] - time[i - 1];
        if (dt <= 0) continue;
        const deriv = Math.abs((vals[i] - vals[i - 1]) / dt);
        if (deriv > tol) penalty += (deriv - tol) ** 2;
      }
      return {
        constraint: c,
        penalty,
        satisfied: penalty === 0,
        message:
          penalty === 0
            ? 'Steady state reached'
            : `Steady state not reached (penalty=${penalty.toExponential(2)})`,
      };
    }

    case 'bounds': {
      const vmin = c.args[0];
      const vmax = c.args[1];
      const t0 = c.args[2] ?? time[0];
      const t1 = c.args[3] ?? time[n - 1];
      let penalty = 0;
      for (let i = 0; i < n; i++) {
        if (time[i] < t0 || time[i] > t1) continue;
        if (vals[i] < vmin) penalty += (vmin - vals[i]) ** 2;
        if (vals[i] > vmax) penalty += (vals[i] - vmax) ** 2;
      }
      return {
        constraint: c,
        penalty,
        satisfied: penalty === 0,
        message:
          penalty === 0
            ? `Values in [${vmin}, ${vmax}]`
            : `Bounds violated (penalty=${penalty.toExponential(2)})`,
      };
    }

    case 'ratio': {
      const vals2 = observables.get(c.observable2!);
      if (!vals2) {
        return {
          constraint: c,
          penalty: 100,
          satisfied: false,
          message: `Observable "${c.observable2}" not found`,
        };
      }
      const [minR, maxR] = c.args;
      const atTime = c.args[2];
      let penalty = 0;

      if (atTime !== undefined) {
        const idx = closestIndex(time, atTime);
        const ratio = vals2[idx] !== 0 ? vals[idx] / vals2[idx] : 1e6;
        if (ratio < minR) penalty = (minR - ratio) ** 2;
        if (ratio > maxR) penalty = (ratio - maxR) ** 2;
      } else {
        const ratio = vals2[n - 1] !== 0 ? vals[n - 1] / vals2[n - 1] : 1e6;
        if (ratio < minR) penalty = (minR - ratio) ** 2;
        if (ratio > maxR) penalty = (ratio - maxR) ** 2;
      }
      return {
        constraint: c,
        penalty,
        satisfied: penalty === 0,
        message:
          penalty === 0
            ? 'Ratio satisfied'
            : `Ratio violated (penalty=${penalty.toExponential(2)})`,
      };
    }

    case 'oscillates': {
      const minPeaks = c.args[0] ?? 2;
      const nPeaks = countPeaks(vals);
      const penalty = nPeaks < minPeaks ? (minPeaks - nPeaks) * 10 : 0;
      return {
        constraint: c,
        penalty,
        satisfied: penalty === 0,
        message: `Found ${nPeaks} peaks (need >=${minPeaks})`,
      };
    }

    case 'no_oscillation': {
      const nPeaks = countPeaks(vals);
      const penalty = nPeaks > 1 ? (nPeaks - 1) * 10 : 0;
      return {
        constraint: c,
        penalty,
        satisfied: penalty === 0,
        message: nPeaks <= 1 ? 'No oscillation' : `Found ${nPeaks} peaks`,
      };
    }

    case 'final_value': {
      const [vmin, vmax] = c.args;
      const finalVal = vals[n - 1];
      let penalty = 0;
      if (finalVal < vmin) penalty = (vmin - finalVal) ** 2;
      if (finalVal > vmax) penalty = (finalVal - vmax) ** 2;
      return {
        constraint: c,
        penalty,
        satisfied: penalty === 0,
        message:
          penalty === 0
            ? `Final value ${finalVal.toPrecision(4)} in [${vmin}, ${vmax}]`
            : `Final value ${finalVal.toPrecision(4)} outside [${vmin}, ${vmax}]`,
      };
    }

    case 'initial_increase': {
      if (n < 2) {
        return { constraint: c, penalty: 10, satisfied: false, message: 'Not enough data points' };
      }
      const penalty = vals[1] > vals[0] ? 0 : (vals[0] - vals[1]) ** 2;
      return {
        constraint: c,
        penalty,
        satisfied: penalty === 0,
        message: penalty === 0 ? 'Initial increase confirmed' : 'No initial increase',
      };
    }

    case 'overshoot': {
      const ssFraction = c.args[0] ?? 1.2;
      const ssStart = Math.floor(n * 0.9);
      let ssSum = 0;
      for (let i = ssStart; i < n; i++) ssSum += vals[i];
      const ssAvg = ssSum / (n - ssStart);

      const peakVal = Math.max(...vals);
      const hasOvershoot = ssAvg > 0 ? peakVal / ssAvg > ssFraction : peakVal > 0;
      const penalty = hasOvershoot ? 0 : 10;
      return {
        constraint: c,
        penalty,
        satisfied: hasOvershoot,
        message: hasOvershoot
          ? `Overshoot detected (peak/ss = ${ssAvg > 0 ? (peakVal / ssAvg).toPrecision(3) : 'inf'})`
          : `No overshoot (peak/ss = ${ssAvg > 0 ? (peakVal / ssAvg).toPrecision(3) : '0'})`,
      };
    }

    default:
      return { constraint: c, penalty: 0, satisfied: true, message: 'Unknown constraint (ignored)' };
  }
}

// --- Helpers ----------------------------------------------------------------

/** Find the index of the global maximum (the "peak"). */
function findPeakIndex(vals: number[]): number {
  if (vals.length === 0) return -1;
  let bestIdx = 0;
  for (let i = 1; i < vals.length; i++) {
    if (vals[i] > vals[bestIdx]) bestIdx = i;
  }
  return bestIdx;
}

/** Count local maxima (peaks) in a time series. */
function countPeaks(vals: number[]): number {
  let count = 0;
  for (let i = 1; i < vals.length - 1; i++) {
    if (vals[i] > vals[i - 1] && vals[i] > vals[i + 1]) count++;
  }
  return count;
}

/** Find the index of the time point closest to the target. */
function closestIndex(time: number[], target: number): number {
  let best = 0;
  let bestDist = Math.abs(time[0] - target);
  for (let i = 1; i < time.length; i++) {
    const d = Math.abs(time[i] - target);
    if (d < bestDist) {
      best = i;
      bestDist = d;
    }
  }
  return best;
}

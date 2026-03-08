import { describe, expect, it } from 'vitest';
import { sbplx } from '../src/services/optimization/sbplx';

const sphere = async (x: number[]): Promise<number> =>
  x.reduce((sum, xi) => sum + xi * xi, 0);

const rosenbrock2d = async (x: number[]): Promise<number> =>
  (1 - x[0]) ** 2 + 100 * (x[1] - x[0] ** 2) ** 2;

const rosenbrockNd = async (x: number[]): Promise<number> => {
  let sum = 0;
  for (let i = 0; i < x.length - 1; i++) {
    sum += (1 - x[i]) ** 2 + 100 * (x[i + 1] - x[i] ** 2) ** 2;
  }
  return sum;
};

describe('SBPLX optimizer', () => {
  it('converges on 2D sphere function', async () => {
    const result = await sbplx(sphere, [5, -3], {
      maxEval: 500,
      ftol: 1e-10,
    });

    expect(result.value).toBeLessThan(1e-8);
    expect(Math.abs(result.x[0])).toBeLessThan(1e-4);
    expect(Math.abs(result.x[1])).toBeLessThan(1e-4);
    expect(result.converged).toBe(true);
  });

  it('converges on 2D Rosenbrock function', async () => {
    const result = await sbplx(rosenbrock2d, [0, 0], {
      maxEval: 2000,
      ftol: 1e-8,
    });

    expect(result.value).toBeLessThan(1e-4);
    expect(Math.abs(result.x[0] - 1)).toBeLessThan(0.05);
    expect(Math.abs(result.x[1] - 1)).toBeLessThan(0.05);
  });

  it('converges on 5D Rosenbrock function', async () => {
    const result = await sbplx(rosenbrockNd, [-1, -1, -1, -1, -1], {
      maxEval: 5000,
      ftol: 1e-6,
    });

    expect(result.value).toBeLessThan(1.0);
    expect(result.converged).toBe(true);
  });

  it('converges on 8D sphere function', async () => {
    const result = await sbplx(sphere, [1, 2, 3, 4, 5, 6, 7, 8], {
      maxEval: 3000,
      ftol: 1e-6,
    });

    expect(result.value).toBeLessThan(1e-3);
  });

  it('respects AbortSignal', async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await sbplx(sphere, [5, -3, 1, -2], {
      maxEval: 100000,
      signal: controller.signal,
    });

    expect(result.stopReason).toBe('aborted');
  });

  it('calls progress callback', async () => {
    const progressCalls: number[] = [];

    await sbplx(sphere, [5, -3], {
      maxEval: 500,
      ftol: 1e-8,
      onProgress: (info) => progressCalls.push(info.bestValue),
    });

    expect(progressCalls.length).toBeGreaterThan(0);

    for (let i = 1; i < progressCalls.length; i++) {
      expect(progressCalls[i]).toBeLessThanOrEqual(progressCalls[i - 1] + 1e-10);
    }
  });

  it('returns maxeval stop reason when max evals reached', async () => {
    const result = await sbplx(rosenbrockNd, [0, 0, 0, 0, 0], {
      maxEval: 50,
      ftol: 1e-20,
    });

    expect(result.converged).toBe(false);
    expect(result.stopReason).toMatch(/maxeval|aborted/);
  });
});
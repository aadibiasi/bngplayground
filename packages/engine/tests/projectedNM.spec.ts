import { describe, expect, it } from 'vitest';
import { projectedNM } from '../src/services/optimization/projectedNM';

const sphere = async (x: number[]): Promise<number> =>
  x.reduce((sum, xi) => sum + xi * xi, 0);

const shiftedSphere = async (x: number[]): Promise<number> =>
  (x[0] - 3) ** 2 + (x[1] - 2) ** 2;

describe('ProjectedNM-style bound-constrained optimizer', () => {
  it('converges on 2D sphere without bounds', async () => {
    const result = await projectedNM(sphere, [5, -3], {
      maxEval: 500,
      ftol: 1e-10,
    });

    expect(result.value).toBeLessThan(1e-6);
    expect(Math.abs(result.x[0])).toBeLessThan(1e-3);
    expect(Math.abs(result.x[1])).toBeLessThan(1e-3);
  });

  it('respects lower bounds', async () => {
    const result = await projectedNM(sphere, [5, 5], {
      maxEval: 500,
      ftol: 1e-10,
      lowerBounds: [1, 1],
      upperBounds: [10, 10],
    });

    expect(result.x[0]).toBeGreaterThanOrEqual(1 - 1e-10);
    expect(result.x[1]).toBeGreaterThanOrEqual(1 - 1e-10);
    expect(result.x[0]).toBeLessThan(1.1);
    expect(result.x[1]).toBeLessThan(1.1);
  });

  it('respects upper bounds', async () => {
    const result = await projectedNM(shiftedSphere, [1, 1], {
      maxEval: 500,
      ftol: 1e-10,
      lowerBounds: [0, 0],
      upperBounds: [2, 5],
    });

    expect(result.x[0]).toBeLessThanOrEqual(2 + 1e-10);
    expect(Math.abs(result.x[0] - 2)).toBeLessThan(0.1);
    expect(Math.abs(result.x[1] - 2)).toBeLessThan(0.1);
  });

  it('solution stays within bounds even with tight constraints', async () => {
    const result = await projectedNM(sphere, [1.5, 1.5], {
      maxEval: 300,
      ftol: 1e-8,
      lowerBounds: [1, 1],
      upperBounds: [2, 2],
    });

    expect(result.x[0]).toBeGreaterThanOrEqual(1 - 1e-10);
    expect(result.x[0]).toBeLessThanOrEqual(2 + 1e-10);
    expect(result.x[1]).toBeGreaterThanOrEqual(1 - 1e-10);
    expect(result.x[1]).toBeLessThanOrEqual(2 + 1e-10);
  });

  it('barrier penalty produces feasible solution', async () => {
    const result = await projectedNM(sphere, [5, 5], {
      maxEval: 500,
      ftol: 1e-10,
      lowerBounds: [1, 1],
      upperBounds: [10, 10],
      barrierStrength: 0.1,
    });

    expect(result.x[0]).toBeGreaterThanOrEqual(1 - 1e-10);
    expect(result.x[1]).toBeGreaterThanOrEqual(1 - 1e-10);
    expect(result.x[0]).toBeLessThanOrEqual(10 + 1e-10);
    expect(result.x[1]).toBeLessThanOrEqual(10 + 1e-10);
    expect(result.x[0]).toBeLessThan(3);
    expect(result.x[1]).toBeLessThan(3);
  });

  it('respects AbortSignal', async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await projectedNM(sphere, [5, -3], {
      maxEval: 100000,
      signal: controller.signal,
    });

    expect(result.stopReason).toBe('aborted');
  });

  it('handles 1D optimization', async () => {
    const f1d = async (x: number[]): Promise<number> => (x[0] - 2) ** 2;

    const result = await projectedNM(f1d, [5], {
      maxEval: 200,
      ftol: 1e-8,
      lowerBounds: [0],
      upperBounds: [10],
    });

    expect(Math.abs(result.x[0] - 2)).toBeLessThan(0.01);
  });
});
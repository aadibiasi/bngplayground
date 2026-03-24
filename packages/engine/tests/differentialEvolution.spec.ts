import { describe, it, expect } from 'vitest';
import { differentialEvolution } from '../src/services/optimization/differentialEvolution';

describe('differentialEvolution', () => {
  it('minimizes a 2D Rosenbrock function', async () => {
    // f(x,y) = (1-x)^2 + 100*(y-x^2)^2, minimum at (1,1)
    const result = await differentialEvolution(
      async ([x, y]) => (1 - x) ** 2 + 100 * (y - x * x) ** 2,
      [0, 0],
      {
        lowerBounds: [-5, -5],
        upperBounds: [5, 5],
        maxEval: 5000,
        seed: 42,
      },
    );
    expect(result.value).toBeLessThan(0.01);
    expect(result.x[0]).toBeCloseTo(1, 1);
    expect(result.x[1]).toBeCloseTo(1, 1);
  });

  it('minimizes a 1D parabola', async () => {
    const result = await differentialEvolution(
      async ([x]) => (x - 3) ** 2,
      [0],
      {
        lowerBounds: [-10],
        upperBounds: [10],
        maxEval: 1000,
        seed: 123,
      },
    );
    expect(result.x[0]).toBeCloseTo(3, 1);
    expect(result.value).toBeLessThan(0.01);
  });

  it('respects bounds', async () => {
    const result = await differentialEvolution(
      async ([x]) => (x - 100) ** 2,
      [2],
      {
        lowerBounds: [0],
        upperBounds: [5],
        maxEval: 500,
        seed: 1,
      },
    );
    expect(result.x[0]).toBeGreaterThanOrEqual(0);
    expect(result.x[0]).toBeLessThanOrEqual(5);
    expect(result.x[0]).toBeCloseTo(5, 0);
  });

  it('can be aborted', async () => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 10);
    const result = await differentialEvolution(
      async ([x]) => {
        await new Promise(r => setTimeout(r, 1));
        return x * x;
      },
      [5],
      {
        lowerBounds: [-10],
        upperBounds: [10],
        maxEval: 100000,
        signal: ac.signal,
        seed: 1,
      },
    );
    expect(result.stopReason).toBe('aborted');
  });

  it('emits progress callbacks', async () => {
    const progress: number[] = [];
    await differentialEvolution(
      async ([x, y]) => x * x + y * y,
      [5, 5],
      {
        lowerBounds: [-10, -10],
        upperBounds: [10, 10],
        maxEval: 500,
        seed: 42,
        onProgress: (info) => progress.push(info.bestValue),
      },
    );
    expect(progress.length).toBeGreaterThan(0);
    for (let i = 1; i < progress.length; i++) {
      expect(progress[i]).toBeLessThanOrEqual(progress[i - 1] + 1e-10);
    }
  });
});

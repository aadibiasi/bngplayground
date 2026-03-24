import { describe, it, expect } from 'vitest';
import { parseBPSL, evaluateBPSL } from '../src/services/analysis/bpsl';

describe('parseBPSL', () => {
  it('parses monotone constraint', () => {
    const c = parseBPSL('monotone_increasing A 0 10');
    expect(c).toHaveLength(1);
    expect(c[0].type).toBe('monotone_increasing');
    expect(c[0].observable).toBe('A');
    expect(c[0].args).toEqual([0, 10]);
  });

  it('ignores comments and blank lines', () => {
    const c = parseBPSL('# comment\n\nmonotone_decreasing B\n');
    expect(c).toHaveLength(1);
    expect(c[0].type).toBe('monotone_decreasing');
  });

  it('parses peak_order', () => {
    const c = parseBPSL('peak_order A B');
    expect(c[0].observable).toBe('A');
    expect(c[0].observable2).toBe('B');
  });

  it('parses oscillates', () => {
    const c = parseBPSL('oscillates X 3');
    expect(c[0].args).toEqual([3]);
  });

  it('parses final_value', () => {
    const c = parseBPSL('final_value A 0.5 1.5');
    expect(c[0].args).toEqual([0.5, 1.5]);
  });
});

describe('evaluateBPSL', () => {
  const time = [0, 1, 2, 3, 4, 5];

  it('monotone_increasing satisfied', () => {
    const obs = new Map([['A', [0, 1, 2, 3, 4, 5]]]);
    const c = parseBPSL('monotone_increasing A');
    const r = evaluateBPSL(c, time, obs);
    expect(r.totalPenalty).toBe(0);
    expect(r.details[0].satisfied).toBe(true);
  });

  it('monotone_increasing violated', () => {
    const obs = new Map([['A', [0, 1, 2, 1, 4, 5]]]);
    const c = parseBPSL('monotone_increasing A');
    const r = evaluateBPSL(c, time, obs);
    expect(r.totalPenalty).toBeGreaterThan(0);
    expect(r.details[0].satisfied).toBe(false);
  });

  it('peak_before satisfied', () => {
    const obs = new Map([['A', [0, 5, 10, 8, 3, 1]]]);
    const c = parseBPSL('peak_before A 3');
    const r = evaluateBPSL(c, time, obs);
    expect(r.totalPenalty).toBe(0);
  });

  it('peak_before violated', () => {
    const obs = new Map([['A', [0, 1, 2, 3, 10, 5]]]);
    const c = parseBPSL('peak_before A 2');
    const r = evaluateBPSL(c, time, obs);
    expect(r.totalPenalty).toBeGreaterThan(0);
  });

  it('steady_state satisfied', () => {
    const obs = new Map([['A', [0, 5, 9.9, 10, 10, 10]]]);
    const c = parseBPSL('steady_state A 0.5 3');
    const r = evaluateBPSL(c, time, obs);
    expect(r.totalPenalty).toBe(0);
  });

  it('bounds satisfied', () => {
    const obs = new Map([['A', [1, 2, 3, 4, 5, 6]]]);
    const c = parseBPSL('bounds A 0 10');
    const r = evaluateBPSL(c, time, obs);
    expect(r.totalPenalty).toBe(0);
  });

  it('bounds violated', () => {
    const obs = new Map([['A', [1, 2, 15, 4, 5, 6]]]);
    const c = parseBPSL('bounds A 0 10');
    const r = evaluateBPSL(c, time, obs);
    expect(r.totalPenalty).toBeGreaterThan(0);
  });

  it('final_value satisfied', () => {
    const obs = new Map([['A', [0, 1, 2, 3, 4, 5]]]);
    const c = parseBPSL('final_value A 4 6');
    const r = evaluateBPSL(c, time, obs);
    expect(r.totalPenalty).toBe(0);
  });

  it('oscillates with enough peaks', () => {
    const obs = new Map([['A', [0, 5, 2, 8, 1, 6]]]);
    const c = parseBPSL('oscillates A 2');
    const r = evaluateBPSL(c, time, obs);
    expect(r.totalPenalty).toBe(0);
  });

  it('no_oscillation satisfied for monotone', () => {
    const obs = new Map([['A', [0, 1, 2, 3, 4, 5]]]);
    const c = parseBPSL('no_oscillation A');
    const r = evaluateBPSL(c, time, obs);
    expect(r.totalPenalty).toBe(0);
  });

  it('missing observable gives penalty', () => {
    const obs = new Map([['B', [0, 1, 2, 3, 4, 5]]]);
    const c = parseBPSL('monotone_increasing A');
    const r = evaluateBPSL(c, time, obs);
    expect(r.totalPenalty).toBeGreaterThan(0);
    expect(r.details[0].message).toContain('not found');
  });

  it('multiple constraints sum penalties', () => {
    const obs = new Map([['A', [0, 1, 2, 1, 4, 5]]]);
    const c = parseBPSL('monotone_increasing A\nfinal_value A 4 6');
    const r = evaluateBPSL(c, time, obs);
    expect(r.details).toHaveLength(2);
    expect(r.details[0].satisfied).toBe(false);
    expect(r.details[1].satisfied).toBe(true);
    expect(r.totalPenalty).toBe(r.details[0].penalty);
  });
});

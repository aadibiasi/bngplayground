import { describe, expect, it } from 'vitest';
import {
  backwardSolve,
  csrMatVec,
  denseToCSR,
  forwardSolve,
  gmres,
  ilu0Factorize,
  sparseSolve,
  type CSRMatrix,
} from '../src/services/analysis/SparseLUSolver';

describe('SparseLUSolver Service', () => {
  describe('Matrix Utils', () => {
    it('should convert dense to CSR', () => {
      const dense = new Float64Array([
        1, 0, 2,
        0, 3, 0,
        4, 5, 6,
      ]);
      const csr = denseToCSR(dense, 3);

      expect(csr.n).toBe(3);
      expect(csr.nnz).toBe(6);
      expect(csr.rowPtr).toEqual(new Int32Array([0, 2, 3, 6]));
      expect(csr.values).toEqual(new Float64Array([1, 2, 3, 4, 5, 6]));
      expect(csr.colIdx).toEqual(new Int32Array([0, 2, 1, 0, 1, 2]));
    });

    it('should compute Matrix-Vector product', () => {
      const dense = new Float64Array([
        2, 0, 0,
        0, 3, 4,
        0, 0, 5,
      ]);
      const csr = denseToCSR(dense, 3);
      const x = new Float64Array([1, 1, 1]);
      const y = new Float64Array(3);

      csrMatVec(csr, x, y);
      expect(y[0]).toBe(2);
      expect(y[1]).toBe(7);
      expect(y[2]).toBe(5);
    });
  });

  describe('ILU0 Factorization', () => {
    it('should factorize diagonal matrix perfectly', () => {
      const dense = new Float64Array([
        2, 0,
        0, 4,
      ]);
      const csr = denseToCSR(dense, 2);
      const factors = ilu0Factorize(csr);

      expect(factors.U.values[0]).toBeCloseTo(2);
      expect(factors.U.values[1]).toBeCloseTo(4);
    });

    it('should factorize lower triangular matrix', () => {
      const dense = new Float64Array([
        2, 0,
        1, 3,
      ]);
      const csr = denseToCSR(dense, 2);
      const factors = ilu0Factorize(csr);

      expect(factors.L.values[0]).toBeCloseTo(1.0);
      expect(factors.L.values[1]).toBeCloseTo(0.5);
      expect(factors.U.values[0]).toBeCloseTo(2);
      expect(factors.U.values[1]).toBeCloseTo(3);
    });
  });

  describe('Solvers', () => {
    it('should solve triangular systems', () => {
      const lower: CSRMatrix = {
        n: 2,
        nnz: 1,
        rowPtr: new Int32Array([0, 0, 1]),
        colIdx: new Int32Array([0]),
        values: new Float64Array([2]),
      };

      const upper: CSRMatrix = {
        n: 2,
        nnz: 3,
        rowPtr: new Int32Array([0, 2, 3]),
        colIdx: new Int32Array([0, 1, 1]),
        values: new Float64Array([2, 1, 3]),
      };

      const b = new Float64Array([3, 9]);
      const y = new Float64Array(2);
      forwardSolve(lower, b, y);
      expect(y[0]).toBeCloseTo(3);
      expect(y[1]).toBeCloseTo(3);

      const x = new Float64Array(2);
      backwardSolve(upper, y, x);
      expect(x[0]).toBeCloseTo(1);
      expect(x[1]).toBeCloseTo(1);
    });

    it('should solve system using sparseSolve wrapper', () => {
      const dense = new Float64Array([
        4, 1,
        1, 3,
      ]);
      const csr = denseToCSR(dense, 2);
      const factors = ilu0Factorize(csr);
      const x = new Float64Array(2);

      sparseSolve(factors, new Float64Array([6, 7]), x);

      expect(x[0]).toBeCloseTo(1);
      expect(x[1]).toBeCloseTo(2);
    });
  });

  describe('GMRES', () => {
    it('should solve system iteratively', () => {
      const n = 10;
      const dense = new Float64Array(n * n).fill(0);
      for (let i = 0; i < n; i++) dense[i * n + i] = i + 1;

      const csr = denseToCSR(dense, n);
      const b = new Float64Array(n);
      csrMatVec(csr, new Float64Array(n).fill(1), b);

      const x = new Float64Array(n).fill(0);
      const iterations = gmres(csr, b, x, undefined, 1e-8, 20);

      expect(iterations).toBeGreaterThan(0);
      for (let i = 0; i < n; i++) {
        expect(x[i]).toBeCloseTo(1);
      }
    });

    it('should solve generic sparse system', () => {
      const n = 20;
      const rowPtr = new Int32Array(n + 1);
      const colIdx: number[] = [];
      const values: number[] = [];

      for (let i = 0; i < n; i++) {
        rowPtr[i] = colIdx.length;
        if (i > 0) {
          colIdx.push(i - 1);
          values.push(-1);
        }
        colIdx.push(i);
        values.push(2);
        if (i < n - 1) {
          colIdx.push(i + 1);
          values.push(-1);
        }
      }
      rowPtr[n] = colIdx.length;

      const csr: CSRMatrix = {
        n,
        nnz: colIdx.length,
        rowPtr,
        colIdx: new Int32Array(colIdx),
        values: new Float64Array(values),
      };

      const b = new Float64Array(n);
      csrMatVec(csr, new Float64Array(n).fill(1), b);

      const factors = ilu0Factorize(csr);
      const x = new Float64Array(n).fill(0);
      const iterations = gmres(csr, b, x, factors, 1e-6);
      expect(iterations).toBeGreaterThan(0);
      expect(iterations).toBeLessThan(n);
      expect(x[0]).toBeCloseTo(1);
      expect(x[n - 1]).toBeCloseTo(1);
    });
  });
});
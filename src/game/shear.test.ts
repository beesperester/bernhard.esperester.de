import { describe, expect, it } from 'vitest';
import { turnStretchTurn } from './shear.ts';

const turn = (t: number) => [[Math.cos(t), -Math.sin(t)], [Math.sin(t), Math.cos(t)]];
const times = (m: number[][], n: number[][]) => m.map((row) => [0, 1].map((j) => row[0] * n[0][j] + row[1] * n[1][j]));

describe('turnStretchTurn', () => {
  it('rebuilds any matrix, shears and mirrors too', () => {
    for (const [a, b, c, d] of [[1, -0.8, 0, -0.5], [1, 2.5, 0, 0.2], [2, 0, 0, 3], [0, 1, 1, 0], [1, -3.6, 0, -0.3]]) {
      const { phi, sx, sy, theta } = turnStretchTurn(a, b, c, d);
      const m = times(times(turn(phi), [[sx, 0], [0, sy]]), turn(theta));
      expect(m[0][0]).toBeCloseTo(a);
      expect(m[0][1]).toBeCloseTo(b);
      expect(m[1][0]).toBeCloseTo(c);
      expect(m[1][1]).toBeCloseTo(d);
    }
  });
});

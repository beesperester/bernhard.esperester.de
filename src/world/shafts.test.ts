import { describe, expect, it } from 'vitest';
import { SHAFTS, SHAFTS_BY_CELL } from './shafts.ts';
import { TREES } from './trees.ts';

describe('rays of light', () => {
  it('stand here and there on the ground among leafy trees', () => {
    expect(SHAFTS.length).toBeGreaterThan(50);
    for (const s of SHAFTS) {
      expect(TREES.some((t) => t.shape !== 'pine' && Math.hypot(t.x - s.x, t.y - s.y) < 72)).toBe(true);
      expect(s.w).toBeGreaterThanOrEqual(5);
      expect(s.lift).toBeGreaterThanOrEqual(0);
    }
    // (some reach the ground, most don't)
    const grounded = SHAFTS.filter((s) => s.lift === 0).length / SHAFTS.length;
    expect(grounded).toBeGreaterThan(0.15);
    expect(grounded).toBeLessThan(0.5);
    expect([...SHAFTS_BY_CELL.values()].reduce((a, l) => a + l.length, 0)).toBe(SHAFTS.length);
  });
});

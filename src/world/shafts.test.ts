import { describe, expect, it } from 'vitest';
import { SHAFTS, SHAFTS_BY_CELL } from './shafts.ts';
import { TREES } from './trees.ts';

describe('rays of light', () => {
  it('come down from the tops of the leafy crowns, a few to a tree', () => {
    expect(SHAFTS.length).toBeGreaterThan(TREES.length * 0.4);
    const per = new Map<number, number>();
    for (const s of SHAFTS) {
      const t = TREES[s.tree], c = t.crown[0];
      expect(t.shape).not.toBe('pine');
      // (inside its crown: across, and between its underside and its top)
      expect(Math.abs(s.x - (t.x + c.x))).toBeLessThanOrEqual(1);
      expect(s.side).toBeGreaterThan(0);
      expect(s.side).toBeLessThan(0.9);
      expect(s.h).toBeGreaterThan(t.elev + (c.base ?? c.z - c.rz));
      expect(s.h).toBeLessThan(t.elev + c.z + c.rz);
      expect(s.w).toBeGreaterThanOrEqual(3);
      expect(s.reach).toBeGreaterThan(0.5);
      expect(s.reach).toBeLessThanOrEqual(1);
      per.set(s.tree, (per.get(s.tree) ?? 0) + 1);
    }
    expect(Math.max(...per.values())).toBeLessThanOrEqual(3);
    expect([...SHAFTS_BY_CELL.values()].reduce((a, l) => a + l.length, 0)).toBe(SHAFTS.length);
  });
});

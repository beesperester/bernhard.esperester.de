import { describe, expect, it } from 'vitest';
import { FINDS, Food, placeFinds } from './finds.ts';
import { FOOD_POINTS } from './food.ts';
import { FURNITURE, TILE, tileAt } from './map.ts';
import { TREES } from './trees.ts';
import { Prey } from '../game/state.ts';
import { preyPoints } from '../game/fauna/prey.ts';

describe('things to find', () => {
  it('are of every sort, with an id each', () => {
    expect(FINDS.map((f) => f.id)).toEqual(FINDS.map((_, i) => i));
    for (const kind of ['basket', 'snack', 'bucket', 'nest'] as const) expect(FINDS.some((f) => f.kind === kind), kind).toBe(true);
    expect(FINDS.some((f) => f.tree !== undefined)).toBe(true);
    expect(FINDS.length).toBeLessThan(120);
  });

  it('are worth more than anything a cat can catch', () => {
    const best = Math.max(...Object.values(Prey).filter((k) => k !== Prey.Find).flatMap((k) => [0, 1, 2, 3].map((c) => preyPoints(k, c))));
    for (const food of Object.values(Food)) {
      expect(FOOD_POINTS[food]).toBeGreaterThan(best);
      expect(preyPoints(Prey.Find, food)).toBe(FOOD_POINTS[food]);
    }
  });

  it('lie where they belong: baskets on the picnic things, nests in bushes, hedges and trees', () => {
    for (const f of FINDS) {
      const tx = Math.floor(f.x / TILE), ty = Math.floor(f.y / TILE);
      if (f.kind === 'basket') expect(FURNITURE.some((p) => (p.kind === 'picnic' || p.kind === 'blanket') && tx >= p.tx && tx < p.tx + 4 && ty >= p.ty && ty < p.ty + 3)).toBe(true);
      if (f.kind === 'nest' && f.tree === undefined) expect('b#').toContain(tileAt(tx, ty));
      if (f.tree !== undefined) {
        const t = TREES[f.tree];
        expect(f.y).toBe(t.y);
        expect(t.perches.some((p) => t.elev + p.z === f.h && f.x >= t.x + p.x0 && f.x <= t.x + p.x1)).toBe(true);
      }
      if (f.kind === 'snack') expect(tileAt(tx, ty)).toBe('p');
    }
  });

  it('are the same for the same seed, and others for another', () => {
    expect(placeFinds(1)).toEqual(FINDS);
    expect(placeFinds(2)).not.toEqual(FINDS);
  });
});

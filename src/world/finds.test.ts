import { describe, expect, it } from 'vitest';
import { FIND_SLOTS, Food, REFILL_MS, findIn, planFinds, type Find } from './finds.ts';
import { FOOD_POINTS } from './food.ts';
import { FURNITURE, TILE, tileAt } from './map.ts';
import { TREES } from './trees.ts';
import { Prey } from '../game/state.ts';
import { preyPoints } from '../game/fauna/prey.ts';

/** Everything there is to find at garden time gt. */
const at = (gt: number): Find[] => FIND_SLOTS.map((_, n) => findIn(FIND_SLOTS, n, gt, 1)).filter((f): f is Find => !!f);
const T = 1.79e12;

describe('things to find', () => {
  it('are of every sort, each with its own id', () => {
    const now = at(T);
    expect(new Set(now.map((f) => f.id)).size).toBe(now.length);
    for (const kind of ['basket', 'snack', 'bucket', 'nest'] as const) expect(now.some((f) => f.kind === kind), kind).toBe(true);
    expect(now.some((f) => f.tree !== undefined)).toBe(true);
    expect(now.length).toBeLessThan(160);
    for (const f of now) expect(Number.isInteger(f.id)).toBe(true);
  });

  it('come back once eaten, as new ones (and not all at once)', () => {
    const now = at(T), later = at(T + REFILL_MS);
    // the same slot, another time round: a new id, so it isn't gone any more
    const ids = new Set(now.map((f) => f.id));
    expect(later.every((f) => !ids.has(f.id))).toBe(true);
    expect(later.length).toBeGreaterThan(now.length / 2);
    // snacks turn up in other places
    const spots = (fs: Find[]) => new Set(fs.filter((f) => f.kind === 'snack').map((f) => `${f.x},${f.y}`));
    const a = spots(now), b = spots(later);
    expect([...b].some((k) => !a.has(k))).toBe(true);
    // each slot at its own moment: a minute on, most are still the same ones
    const soon = new Set(at(T + 60000).map((f) => f.id));
    expect(now.filter((f) => soon.has(f.id)).length).toBeGreaterThan(now.length * 0.7);
  });

  it('are worth more than anything a cat can catch', () => {
    const best = Math.max(...Object.values(Prey).filter((k) => k !== Prey.Find).flatMap((k) => [0, 1, 2, 3].map((c) => preyPoints(k, c))));
    for (const food of Object.values(Food)) {
      expect(FOOD_POINTS[food]).toBeGreaterThan(best);
      expect(preyPoints(Prey.Find, food)).toBe(FOOD_POINTS[food]);
    }
  });

  it('lie where they belong: baskets on the picnic things, nests in bushes, hedges and trees', () => {
    for (const s of FIND_SLOTS)
      for (const f of s.spots) {
        const tx = Math.floor(f.x / TILE), ty = Math.floor(f.y / TILE);
        if (s.kind === 'basket') expect(FURNITURE.some((p) => (p.kind === 'picnic' || p.kind === 'blanket') && tx >= p.tx && tx < p.tx + 4 && ty >= p.ty && ty < p.ty + 3)).toBe(true);
        if (s.kind === 'nest' && f.tree === undefined) expect('b#').toContain(tileAt(tx, ty));
        if (f.tree !== undefined) {
          const t = TREES[f.tree];
          expect(f.y).toBe(t.y);
          expect(t.perches.some((p) => t.elev + p.z === f.h && f.x >= t.x + p.x0 && f.x <= t.x + p.x1)).toBe(true);
        }
        if (s.kind === 'snack') expect(tileAt(tx, ty)).toBe('p');
      }
  });

  it('are the same for the same seed, and others for another', () => {
    expect(planFinds(1)).toEqual(FIND_SLOTS);
    expect(planFinds(2)).not.toEqual(FIND_SLOTS);
  });
});

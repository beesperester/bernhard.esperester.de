import { describe, expect, it } from 'vitest';
import { Fruit, fruitOf, trunkNear } from './fruit.ts';
import { TREES } from './trees.ts';
import { seasonAt } from './season.ts';

const at = (iso: string) => seasonAt(Date.parse(iso));

describe('fruit', () => {
  it('comes in its season: nuts in autumn, cherries in early summer, cones all year', () => {
    const oak = TREES.find((t) => t.shape === 'broadleaf' && t.colour === 0)!;
    const cherry = TREES.find((t) => t.colour === 2)!;
    const pine = TREES.find((t) => t.shape === 'pine')!;
    expect(fruitOf(oak, at('2026-10-01T12:00:00+02:00'))).toEqual({ kind: Fruit.Acorn, amount: 1 });
    expect(fruitOf(oak, at('2026-04-01T12:00:00+02:00')).amount).toBe(0);
    expect(fruitOf(cherry, at('2026-06-25T12:00:00+02:00'))).toEqual({ kind: Fruit.Cherry, amount: 1 });
    expect(fruitOf(cherry, at('2026-10-01T12:00:00+02:00')).amount).toBe(0);
    expect(fruitOf(pine, at('2026-02-01T12:00:00+01:00')).amount).toBeGreaterThan(0);
  });

  it('is shaken down from the trunk a cat stands at, not from across the lawn', () => {
    const t = TREES[0];
    expect(trunkNear(t.x + 8, t.y + 4, t.elev)).toBe(0);
    expect(trunkNear(t.x + 60, t.y + 4, t.elev)).toBe(-1);
    // nor from up on a ledge above it
    expect(trunkNear(t.x + 8, t.y + 4, t.elev + 20)).toBe(-1);
  });
});

import { describe, expect, it } from 'vitest';
import { JUMP_HEIGHT } from '../game/movement.ts';
import { LANDMARK_SOLIDS, LANDMARK_SPRITE, type LandmarkKind } from './landmarks.ts';

/** How high a cat can climb a folly, from the ground, ledge by ledge (a ledge counts if a cat can get a paw on it). */
function highest(kind: LandmarkKind): number {
  const solids = LANDMARK_SOLIDS[kind];
  const near = (a: number[], b: number[]) => a[0] < b[2] + 6 && b[0] < a[2] + 6 && a[1] < b[3] + 6 && b[1] < a[3] + 6;
  const reached = new Set<number>();
  // from the ground, then from every ledge reached, to anything near enough and not too high
  const from = (z: number, box: number[] | null) =>
    solids.forEach((s, i) => {
      if (reached.has(i) || s[4] - z > JUMP_HEIGHT - 1 || (box && !near(box, s))) return;
      reached.add(i);
      from(s[4], s);
    });
  from(0, null);
  return Math.max(0, ...[...reached].map((i) => solids[i][4]));
}

describe('the landmark follies', () => {
  it('can be climbed to the top of the ruins, ledge by ledge', () => {
    expect(highest('gate')).toBe(39);
    expect(highest('church')).toBe(46);
    expect(highest('wall')).toBe(22);
    expect(highest('checkpoint')).toBe(19);
    expect(highest('oberbaum')).toBe(14);
    expect(highest('reichstag')).toBe(30);
    expect(highest('victory')).toBe(30);
    expect(highest('schloss')).toBe(26);
  });

  it('keep their towers out of reach', () => {
    expect(highest('tvtower')).toBeLessThan(20);
    expect(highest('rathaus')).toBeLessThan(30);
    expect(highest('dom')).toBeLessThan(20);
  });

  it('have sprites big enough for everything in them', () => {
    for (const s of Object.values(LANDMARK_SPRITE)) expect(s.w * s.h).toBeGreaterThan(0);
  });
});

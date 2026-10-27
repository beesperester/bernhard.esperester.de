// What the trees bear, by season, and which trunk a cat can paw at to shake
// it down (game/fauna/Squirrels.ts drops it and sends the squirrels for it).
import type { Season } from './season.ts';
import { TREES, type TreePlan } from './trees.ts';

export const Fruit = { Acorn: 0, Hazelnut: 1, Apple: 2, Cherry: 3, Cone: 4 } as const;
export type Fruit = (typeof Fruit)[keyof typeof Fruit];

/** What a tree bears in this season, and how much (0 = nothing). */
export function fruitOf(t: TreePlan, s: Season): { kind: Fruit; amount: number } {
  const d = s.day;
  if (t.shape === 'pine') return { kind: Fruit.Cone, amount: d > 240 && d < 330 ? 1 : 0.3 };
  if (t.colour === 2) return { kind: Fruit.Cherry, amount: d > 160 && d < 205 ? 1 : 0 };
  if (t.colour === 3) return { kind: Fruit.Apple, amount: s.apples };
  const nuts = d > 240 && d < 320 ? 1 : d >= 320 && d < 340 ? 0.4 : 0;
  return { kind: t.colour === 1 ? Fruit.Hazelnut : Fruit.Acorn, amount: nuts };
}

/** The tree whose trunk a cat at (x, y), height z, can paw at (give or take `slack` px), or -1. */
export function trunkNear(x: number, y: number, z: number, slack = 0): number {
  return TREES.findIndex((t) => Math.abs(x - t.x) < 14 + slack && y > t.y - 8 - slack && y < t.y + 12 + slack && Math.abs(z - t.elev) < 4 + slack);
}

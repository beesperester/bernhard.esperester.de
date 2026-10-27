// Trees a cat can climb. Every tree is planned here from its tile: where its
// branches are (a pine's tiers of boughs, a bird house's roof, a tree house's
// deck and roof), each one a perch: a flat surface at some height that a cat
// can land on from above. Perches are one-way: jumping up from below passes
// through them, so a cat climbs by jumping from perch to perch, up to the
// top of the crown. art/trees.ts draws each tree to match its plan.
//
// Seen from the front, a perch reaches left and right of the trunk; in depth
// it is a band around the trunk's foot, so a cat standing anywhere just in
// front of (or behind) a trunk can jump onto the branches above it. On a
// perch the cat stands on the trunk's line.

import { hash2, mulberry32 } from '../art/raster.ts';
import { FEET, FORK_Z, LEVEL, TILE, heightUnder, levelAt, tileAt, treeTiles, trunkBase, trunkTop } from './map.ts';

/** How far a branch is above the one below it: a jump (~14px) gets there, but not much higher. */
export const RISE = 11;
/** The perches' band in depth: this far behind and in front of the trunk's foot. */
export const BAND_BACK = 6, BAND_FRONT = 10;
/** A cat's paws can hang this far over the end of a branch. */
const OVERHANG = 3;
/** A falling cat still lands on a perch this far above its paws. */
const CATCH = 0.5;

export type PerchKind = 'fork' | 'branch' | 'tier' | 'top' | 'birdhouse' | 'deck' | 'roof';

/** A perch, relative to its tree: x from the trunk's middle, z above the tree's foot. */
export interface Perch { x0: number; x1: number; z: number; kind: PerchKind }

/** A perch in the world: x across, y the trunk's foot, z its absolute height. */
export interface PerchAt { tree: number; x0: number; x1: number; y: number; z: number; kind: PerchKind }

export type TreeShape = 'broadleaf' | 'pine' | 'treehouse';

export interface TreePlan {
  tx: number;
  ty: number;
  /** The trunk's foot in the world. */
  x: number;
  y: number;
  /** Height of the ground at its foot. */
  elev: number;
  shape: TreeShape;
  /** Colouring of a broadleaf: 0, 1 green trees, 2 cherry, 3 apple (pines and the tree house tree are green). */
  colour: number;
  seed: number;
  /** Size of its picture: the trunk's foot is at the bottom middle. */
  w: number;
  h: number;
  perches: Perch[];
  /** A bird house hangs on the trunk (its roof is a perch). */
  birdhouse: boolean;
}

/** Resting places: a cat dozing on one of these is well rested. */
export const HOUSES: ReadonlySet<PerchKind> = new Set(['birdhouse', 'deck', 'roof']);

/** A broadleaf: the fork, four branches zigzagging up from side to side, and the crown's top. */
function broadleafPerches(seed: number, birdhouse: boolean): Perch[] {
  const rnd = mulberry32(seed * 7919 + 3);
  const out: Perch[] = [{ x0: -9, x1: 9, z: FORK_Z, kind: 'fork' }];
  let side = rnd() < 0.5 ? -1 : 1;
  for (let i = 1; i <= 4; i++) {
    const z = FORK_Z + i * RISE;
    // the bird house hangs on the front of the trunk in place of a branch
    if (birdhouse && i === 2) {
      out.push({ x0: -5, x1: 5, z, kind: 'birdhouse' });
      continue;
    }
    const len = 12 + Math.floor(rnd() * 9);
    // some branches start right at the trunk; others only further out, which takes a jump
    const gap = rnd() < 0.5 ? 1 : 4 + Math.floor(rnd() * 6);
    out.push(side < 0 ? { x0: -gap - len, x1: -gap, z, kind: 'branch' } : { x0: gap, x1: gap + len, z, kind: 'branch' });
    side = -side;
  }
  out.push({ x0: -8, x1: 8, z: FORK_Z + 5 * RISE, kind: 'top' });
  return out;
}

/** A pine: tiers of boughs all round the trunk, narrowing to the top. */
function pinePerches(seed: number): Perch[] {
  const rnd = mulberry32(seed * 7919 + 5);
  const out: Perch[] = [];
  for (let i = 0; i <= 6; i++) {
    const hw = Math.round(21 - i * 2.6);
    // windswept: each tier leans a little one way or the other
    const off = i === 0 ? 0 : Math.round((rnd() - 0.5) * 4);
    out.push({ x0: -hw + off, x1: hw + off, z: FORK_Z + i * RISE, kind: i === 6 ? 'top' : 'tier' });
  }
  return out;
}

/** The big tree with a house in it: up two branches to the deck, past the hut onto its roof, and to the top. */
const TREEHOUSE: Perch[] = [
  { x0: -10, x1: 10, z: FORK_Z, kind: 'fork' },
  { x0: -24, x1: -2, z: FORK_Z + RISE, kind: 'branch' },
  { x0: 2, x1: 24, z: FORK_Z + 2 * RISE, kind: 'branch' },
  { x0: -30, x1: 30, z: FORK_Z + 3 * RISE, kind: 'deck' },
  { x0: 18, x1: 34, z: FORK_Z + 4 * RISE, kind: 'branch' },
  { x0: -10, x1: 10, z: FORK_Z + 4 * RISE + 9, kind: 'roof' },
  { x0: -8, x1: 8, z: FORK_Z + 5 * RISE + 9, kind: 'top' },
];

/** Picture sizes: room for the crown above the highest perch and the branches either side. */
const SIZE: Record<TreeShape, [number, number]> = { broadleaf: [72, 84], pine: [56, 96], treehouse: [104, 100] };

function plan(tx: number, ty: number, i: number): TreePlan {
  const ch = tileAt(tx, ty);
  const shape: TreeShape = ch === 'P' ? 'pine' : ch === 'H' ? 'treehouse' : 'broadleaf';
  const h = hash2(tx, ty, 55);
  const colour = shape !== 'broadleaf' ? 0 : h < 0.22 ? 2 : h < 0.36 ? 3 : h < 0.6 ? 1 : 0;
  const seed = i + 1;
  // bird houses on a few of the green trees and apple trees
  const birdhouse = shape === 'broadleaf' && colour !== 2 && hash2(tx, ty, 56) < 0.3;
  const [x, y] = trunkBase(tx, ty);
  const [w, hh] = SIZE[shape];
  const perches = shape === 'pine' ? pinePerches(seed) : shape === 'treehouse' ? TREEHOUSE : broadleafPerches(seed, birdhouse);
  return { tx, ty, x, y, elev: levelAt(tx, ty) * LEVEL, shape, colour, seed, w, h: hh, perches, birdhouse };
}

/** Every tree in the garden, in the order of treeTiles(). */
export const TREES: TreePlan[] = treeTiles().map(([tx, ty], i) => plan(tx, ty, i));

/** Each tree's perches in the world. */
const PERCHES: PerchAt[][] = TREES.map((t, tree) => t.perches.map((p) => ({ tree, x0: t.x + p.x0, x1: t.x + p.x1, y: t.y, z: t.elev + p.z, kind: p.kind })));

const inBand = (t: TreePlan, y: number) => y >= t.y - BAND_BACK && y <= t.y + BAND_FRONT;

/** The trees whose band reaches into each row of tiles, so a cat only asks the few near it. */
const BY_ROW: number[][] = [];
TREES.forEach((t, i) => {
  for (let r = Math.floor((t.y - BAND_BACK) / TILE); r <= Math.floor((t.y + BAND_FRONT) / TILE); r++) (BY_ROW[r] ??= []).push(i);
});
const near = (y: number): number[] => BY_ROW[Math.floor(y / TILE)] ?? [];

/**
 * The highest perch under a cat at (x, y) whose top is no higher than its
 * paws at height z (a hair above counts: it is landing on it), and lower
 * than `under` (to drop through the one it stood on).
 */
export function perchUnder(x: number, y: number, z: number, under = Infinity): PerchAt | null {
  let best: PerchAt | null = null;
  for (const i of near(y)) {
    const t = TREES[i];
    if (!inBand(t, y) || Math.abs(x - t.x) > t.w / 2 + OVERHANG) continue;
    for (const p of PERCHES[i])
      if (p.z <= z + CATCH && p.z < under && x > p.x0 - OVERHANG && x < p.x1 + OVERHANG && (!best || p.z > best.z)) best = p;
  }
  return best;
}

/** What a cat at (x, y), with its paws at height z, would stand on: the ground or a perch (not one at or above `under`). */
export function surfaceAt(x: number, y: number, z: number, under = Infinity): number {
  const x0 = x + FEET.x0, y0 = y + FEET.y0, x1 = x + FEET.x1, y1 = y + FEET.y1;
  // over a trunk (below its fork a wall to walk into), a cat dropping down comes to rest on its top
  const trunk = trunkTop(x0, y0, x1, y1);
  const ground = trunk > z + CATCH ? Math.max(trunk, heightUnder(x0, y0, x1, y1, trunk)) : heightUnder(x0, y0, x1, y1, z + CATCH);
  const p = perchUnder(x, y, z, under);
  return p && p.z > ground ? p.z : ground;
}

/** The perch a cat at (x, y, z) is standing on, if it is on one. */
export function standingOn(x: number, y: number, z: number): PerchAt | null {
  const p = perchUnder(x, y, z);
  return p && Math.abs(p.z - z) < 1 && p.z > heightUnder(x + FEET.x0, y + FEET.y0, x + FEET.x1, y + FEET.y1, z + CATCH) ? p : null;
}

/**
 * Index of the tree a cat at (x, y), height z, is up in (it is drawn in front of that tree), or -1.
 * It has to be off whatever it stands on too: a cat walking along a plateau or a folly
 * next to a tree down below is not up that tree (sorted as if it were, it would vanish
 * behind the plateau's own front).
 */
export function treeHolding(x: number, y: number, z: number): number {
  const found = near(y).find((i) => { const t = TREES[i]; return z >= t.elev + 6 && inBand(t, y) && Math.abs(x - t.x) <= t.w / 2; });
  if (found === undefined) return -1;
  // (trunks don't count as ground here: asked from high up, only terrain and furniture do)
  return z >= heightUnder(x + FEET.x0, y + FEET.y0, x + FEET.x1, y + FEET.y1, Infinity) + 6 ? found : -1;
}

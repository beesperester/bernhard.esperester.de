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
import { treeSizeAt } from './layout.ts';
import { FEET, FORK_Z, LEVEL, TILE, heightUnder, levelAt, tileAt, treeTiles, trunkBase, trunkHalf, trunkTop } from './map.ts';

/** How far a branch level is above the one below it: more than a jump, so a cat leaps up the trunk to it. */
export const RISE = 52;
/** The highest a leap up a tree goes: from a branch (or the ground under the lowest) to the next one up. */
export const LEAP = 58;
/** The perches' band in depth: this far behind and in front of the trunk's foot. */
export const BAND_BACK = 8, BAND_FRONT = 12;
/** A cat's paws can hang this far over the end of a branch. */
const OVERHANG = 3;
/** A falling cat still lands on a perch this far above its paws. */
const CATCH = 0.5;

export type PerchKind = 'fork' | 'branch' | 'tier' | 'top' | 'birdhouse' | 'deck' | 'roof';

/** A perch, relative to its tree: x from the trunk's middle, z above the tree's foot. */
export interface Perch { x0: number; x1: number; z: number; kind: PerchKind }

/** A perch in the world: x across, y the trunk's foot, z its absolute height. */
export interface PerchAt { tree: number; x0: number; x1: number; y: number; z: number; kind: PerchKind }

/** A mass of leaves, relative to its tree like a perch: an ellipse round (x, z), rx across and rz up and down. */
export interface Blob {
  x: number; z: number; rx: number; rz: number;
  /** Flattened underneath: no leaves below this height. */
  base?: number;
}

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
  /** Where its leaves are (the art fills these, and its shadow, its outline against lights and owls go by them). */
  crown: Blob[];
  /** Half the trunk's width at its foot. */
  trunk: number;
  /** A bird house hangs on the trunk (its roof is a perch). */
  birdhouse: boolean;
}

/** Resting places: a cat dozing on one of these is well rested. */
export const HOUSES: ReadonlySet<PerchKind> = new Set(['birdhouse', 'deck', 'roof']);

/** How many branch levels a tree of a size has (the top of the crown included). */
function levelsOf(seed: number, size: number): number {
  return [2, 3, 5 + (hash2(seed, 3, 57) < 0.5 ? 0 : 1)][size];
}

/**
 * A broadleaf: one round, lumpy crown of leaves on its trunk, with a branch
 * level every RISE up inside it (each a bough reaching further to one side
 * or the other), and its top the crown's top, where a cat sits up in the sun.
 */
function broadleafPlan(seed: number, size: number, trunk: number, birdhouse: boolean): Pick<TreePlan, 'perches' | 'crown' | 'w' | 'h' | 'trunk'> {
  const rnd = mulberry32(seed * 7919 + 3);
  const n = levelsOf(seed, size);
  const top = FORK_Z + (n - 1) * RISE;
  // the crown's underside: just under the lowest branch (a big old tree's lowest limbs reach out bare below it)
  const base = size === 2 ? FORK_Z + RISE * 0.55 : FORK_Z - 8 - rnd() * 6;
  // a squashed round crown, wider than it is tall, its underside flattened
  const rz = (top - base) / 1.7, zc = top - rz, flat = base;
  const rx = Math.max(32, rz * (1.15 + rnd() * 0.3));
  const crown: Blob[] = [{ x: 0, z: zc, rx, rz, base: flat }];
  // lumps round its rim, for a cloud of an outline (none higher than its top, nor lower than its flat underside)
  const lumps = 4 + Math.floor(rnd() * 4);
  for (let k = 0; k < lumps; k++) {
    // (round its upper rim only: a lump low on the side looks dropped off)
    const a = Math.PI * (0.08 + (0.84 * (k + 0.2 + rnd() * 0.6)) / lumps), r = rx * (0.26 + rnd() * 0.12);
    const x = Math.cos(a) * rx * 0.72, z = Math.max(flat + r * 0.6, zc + Math.sin(a) * rz * 0.65);
    crown.push({ x, z, rx: r, rz: Math.min(r * 0.75, top - z), base: flat });
  }
  const perches: Perch[] = [];
  let side = rnd() < 0.5 ? -1 : 1;
  for (let i = 0; i < n - 1; i++) {
    const z = FORK_Z + i * RISE;
    // each bough reaches well out to one side, less to the other (every one spans the trunk, so a leap up it lands)
    const w = rx * Math.sqrt(Math.max(0.15, 1 - ((z - zc) / rz) ** 2));
    const far = Math.max(trunk + 12, w * (0.6 + rnd() * 0.2)), near = Math.max(trunk + 6, w * (0.25 + rnd() * 0.15));
    perches.push({ x0: Math.round(side < 0 ? -far : -near), x1: Math.round(side < 0 ? near : far), z, kind: i === 0 ? 'fork' : 'branch' });
    side = -side;
  }
  const s = Math.max(10, Math.round(rx * 0.18));
  perches.push({ x0: -s, x1: s, z: top, kind: 'top' });
  // the bird house hangs on the front of the trunk between the two lowest levels
  if (birdhouse) perches.splice(1, 0, { x0: -5, x1: 5, z: FORK_Z + Math.round(RISE / 2), kind: 'birdhouse' });
  return frame(perches, crown, trunk);
}

/**
 * A spruce: a tall cone of drooping, overlapping tiers of boughs on a
 * straight trunk, up to a spire (its looks come first; a cat stands on top
 * of a tier by the trunk, every RISE up).
 */
function pinePlan(seed: number, size: number, trunk: number): Pick<TreePlan, 'perches' | 'crown' | 'w' | 'h' | 'trunk'> {
  const rnd = mulberry32(seed * 7919 + 5);
  const H = [96, 150, 240][size] * (0.9 + rnd() * 0.2), foot = [10, 14, 20][size];
  const wide = H * (0.3 + rnd() * 0.06);
  // tiers a little apart, each hanging over the top of the one below
  const n = Math.max(3, Math.round((H - foot) / 30)), step = (H - foot - 16) / n;
  const crown: Blob[] = [];
  for (let i = 0; i < n; i++) {
    const z0 = foot + i * step, u = (z0 - foot) / (H - foot);
    const hw = Math.max(8, wide * (1 - u) * (0.92 + rnd() * 0.16));
    crown.push({ x: Math.round((rnd() - 0.5) * 4), z: z0 + step * 0.8, rx: hw, rz: step * 0.8 });
  }
  // and the spire
  crown.push({ x: 0, z: H - 14, rx: 7, rz: 14 });
  const perches: Perch[] = [];
  for (let z = FORK_Z; z <= H - 20; z += RISE) perches.push({ x0: -(trunk + 6), x1: trunk + 6, z, kind: 'tier' });
  perches[perches.length - 1].kind = 'top';
  return frame(perches, crown, trunk);
}

/** The big tree with a house in it: up to the deck, onto the hut's roof, and to the top. */
function treehousePlan(trunk: number): Pick<TreePlan, 'perches' | 'crown' | 'w' | 'h' | 'trunk'> {
  const deck = FORK_Z + RISE, roof = deck + 34, top = roof + RISE * 2;
  const perches: Perch[] = [
    { x0: -30, x1: 30, z: FORK_Z, kind: 'fork' },
    { x0: -52, x1: 52, z: deck, kind: 'deck' },
    { x0: -24, x1: 24, z: roof, kind: 'roof' },
    { x0: -48, x1: 44, z: roof + RISE, kind: 'branch' },
    { x0: -50, x1: 50, z: top, kind: 'top' },
  ];
  // a big round crown over the hut, and clouds of leaves either side behind it
  const crown: Blob[] = [
    { x: -84, z: deck + 34, rx: 46, rz: 38 },
    { x: 84, z: deck + 28, rx: 46, rz: 38 },
    { x: 14, z: roof + 112, rx: 64, rz: 46 },
    { x: 0, z: roof + 74, rx: 112, rz: 70 },
  ];
  return frame(perches, crown, trunk);
}

/** The picture's size: room for every perch, leaf and root, with the trunk's foot at the bottom middle. */
function frame(perches: Perch[], crown: Blob[], trunk: number): Pick<TreePlan, 'perches' | 'crown' | 'w' | 'h' | 'trunk'> {
  let reach = trunk + 6, top = 0;
  for (const p of perches) reach = Math.max(reach, -p.x0 + 4, p.x1 + 4);
  for (const b of crown) {
    // (room for the puffs of leaves, which bulge out past the mass they fill)
    reach = Math.max(reach, Math.abs(b.x) + b.rx * 1.1 + 12);
    top = Math.max(top, b.z + b.rz + 10);
  }
  return { perches, crown, trunk, w: Math.ceil(reach) * 2, h: Math.ceil(top) + 1 };
}

function plan(tx: number, ty: number, i: number): TreePlan {
  const ch = tileAt(tx, ty);
  const shape: TreeShape = ch === 'P' ? 'pine' : ch === 'H' ? 'treehouse' : 'broadleaf';
  const h = hash2(tx, ty, 55);
  const colour = shape !== 'broadleaf' ? 0 : h < 0.22 ? 2 : h < 0.36 ? 3 : h < 0.6 ? 1 : 0;
  const seed = i + 1;
  // bird houses on a few of the green trees and apple trees
  const birdhouse = shape === 'broadleaf' && colour !== 2 && hash2(tx, ty, 56) < 0.3;
  const [x, y] = trunkBase(tx, ty);
  const trunk = trunkHalf(tx, ty), size = treeSizeAt(tx, ty);
  const made = shape === 'pine' ? pinePlan(seed, size, trunk) : shape === 'treehouse' ? treehousePlan(trunk) : broadleafPlan(seed, size, trunk, birdhouse);
  return { tx, ty, x, y, elev: levelAt(tx, ty) * LEVEL, shape, colour, seed, birdhouse, ...made };
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

/**
 * How high a leap from (x, y, z) goes, if a jump there is one: from the ground
 * in front of a trunk, or from one of its branches, up to the next perch
 * above (it spans the trunk, so straight up lands on it). 0 where there's
 * nothing to leap up to.
 */
export function leapUp(x: number, y: number, z: number): number {
  let best = Infinity;
  for (const i of near(y)) {
    const t = TREES[i];
    if (!inBand(t, y) || Math.abs(x - t.x) > t.w / 2 + OVERHANG) continue;
    for (const p of PERCHES[i]) if (p.z > z + 1 && p.z - z <= LEAP && x > p.x0 - OVERHANG && x < p.x1 + OVERHANG) best = Math.min(best, p.z - z);
  }
  // (and a little over it, to come down onto it)
  return best < Infinity ? best + 3 : 0;
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

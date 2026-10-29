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
export interface Blob { x: number; z: number; rx: number; rz: number }

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

/** How many branch levels a tree with a trunk `trunk` px across either side has (the top of the crown included): stouter trees have more. */
function levelsOf(seed: number, trunk: number): number {
  const u = hash2(seed, 3, 57);
  return Math.min(7, 3 + Math.floor((trunk - 8) / 3) + (u < 0.3 ? 0 : 1));
}

/**
 * A broadleaf: a branch level every RISE up the trunk, each a bough with a
 * cloud of leaves on it whose flat top a cat walks on, reaching further to
 * one side or the other; the crown's top the last of them.
 */
function broadleafPlan(seed: number, trunk: number, birdhouse: boolean): Pick<TreePlan, 'perches' | 'crown' | 'w' | 'h' | 'trunk'> {
  const rnd = mulberry32(seed * 7919 + 3);
  const n = levelsOf(seed, trunk);
  // (the stouter the tree, the further its boughs reach)
  const k = trunk / 12;
  const perches: Perch[] = [], crown: Blob[] = [];
  let side = rnd() < 0.5 ? -1 : 1;
  for (let i = 0; i < n; i++) {
    const z = FORK_Z + i * RISE, top = i === n - 1;
    // each bough reaches well out to one side, less to the other (every one spans the trunk, so a leap up it lands)
    // (the low boughs short, the middle ones longest)
    const reach = k * (0.75 + 0.25 * Math.sin((Math.PI * (i + 1)) / (n + 1)));
    const far = top ? (56 + rnd() * 20) * k : (70 + rnd() * 50) * reach, near = Math.max(trunk + 8, top ? (50 + rnd() * 16) * k : (30 + rnd() * 24) * reach);
    const x0 = Math.round(side < 0 ? -far : -near), x1 = Math.round(side < 0 ? near : far);
    perches.push({ x0, x1, z, kind: i === 0 ? 'fork' : top ? 'top' : 'branch' });
    // its leaves: a cloud whose top is the bough's line, hanging down below it (the crown a big one)
    // (the lowest a thin one, so the trunk shows below it)
    // (thin shelves of leaves below, the trunk and boughs showing between them; a big dome on top)
    const rz = top ? (48 + rnd() * 16) * k : i === 0 ? 12 + rnd() * 3 : (15 + rnd() * 6) * Math.min(k, 1.2);
    crown.push({ x: (x0 + x1) / 2, z: z + 4 - rz, rx: (x1 - x0) / 2 + (top ? 24 : 12) * k, rz });
    side = -side;
  }
  // the bird house hangs on the front of the trunk between the two lowest levels
  if (birdhouse) perches.splice(1, 0, { x0: -5, x1: 5, z: FORK_Z + Math.round(RISE / 2), kind: 'birdhouse' });
  return frame(perches, crown, trunk);
}

/** A pine: tiers of drooping boughs every RISE up the trunk, narrowing to a spire. */
function pinePlan(seed: number, trunk: number): Pick<TreePlan, 'perches' | 'crown' | 'w' | 'h' | 'trunk'> {
  const rnd = mulberry32(seed * 7919 + 5);
  const n = Math.max(4, levelsOf(seed, trunk) + 1);
  const perches: Perch[] = [], crown: Blob[] = [];
  for (let i = 0; i < n; i++) {
    const z = FORK_Z + i * RISE, top = i === n - 1;
    const hw = Math.round((72 - (i / Math.max(1, n - 1)) * 50) * (trunk / 10));
    // windswept: each tier leans a little one way or the other
    const off = i === 0 ? 0 : Math.round((rnd() - 0.5) * 6);
    // a cat stands on the narrow top of the tier's cone, by the trunk
    const stand = Math.max(trunk + 6, Math.round(hw * 0.35));
    perches.push({ x0: -stand + off, x1: stand + off, z, kind: top ? 'top' : 'tier' });
    // the tier's skirt of needles, spreading down from its line
    crown.push({ x: off, z: z - 22, rx: hw + 6, rz: 28 });
  }
  // and the spire above the top tier
  const peak = perches[perches.length - 1];
  crown.push({ x: (peak.x0 + peak.x1) / 2, z: peak.z + 20, rx: 14, rz: 30 });
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
  const crown: Blob[] = [
    { x: -70, z: deck + 26, rx: 44, rz: 28 },
    { x: 70, z: deck + 20, rx: 44, rz: 28 },
    { x: -2, z: roof + RISE + 4 - 30, rx: 70, rz: 30 },
    { x: 0, z: top + 4 - 56, rx: 96, rz: 56 },
  ];
  return frame(perches, crown, trunk);
}

/** The picture's size: room for every perch, leaf and root, with the trunk's foot at the bottom middle. */
function frame(perches: Perch[], crown: Blob[], trunk: number): Pick<TreePlan, 'perches' | 'crown' | 'w' | 'h' | 'trunk'> {
  let reach = trunk + 6, top = 0;
  for (const p of perches) reach = Math.max(reach, -p.x0 + 4, p.x1 + 4);
  for (const b of crown) {
    reach = Math.max(reach, Math.abs(b.x) + b.rx + 3);
    top = Math.max(top, b.z + b.rz + 3);
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
  const trunk = trunkHalf(tx, ty);
  const made = shape === 'pine' ? pinePlan(seed, trunk) : shape === 'treehouse' ? treehousePlan(trunk) : broadleafPlan(seed, trunk, birdhouse);
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

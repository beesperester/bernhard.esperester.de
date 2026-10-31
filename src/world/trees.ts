// Trees a cat can climb. Every tree is planned here from its tile: its
// skeleton (trunk, limbs, branches and the stumps along them, `limbs`), its
// leaves (`crown`) and what a cat can stand on (`perches`). art/trees.ts
// draws the very same limbs, so what a cat walks along is what is drawn: a
// branch is walkable where it slopes no steeper than MAX_SLOPE, and the
// trunk and steep limbs are climbed by stumps and short twigs along them, one
// jump apart. Perches are one-way: jumping up from below passes through them.
//
// Seen from the front, a perch is a sloping line; in depth it is a band
// around the trunk's foot, so a cat standing anywhere just in front of (or
// behind) a trunk can jump onto the branches above it. On a perch the cat
// stands on the trunk's line (or, low down where the trunk is solid, just in
// front of it).

import { hash2, mulberry32 } from '../art/raster.ts';
import { treeSizeAt } from './layout.ts';
import { KIND_COLOUR, TEMPLATE_SEED, TEMPLATE_TRUNK, paintedKind, treeKindAt, type TreeKind } from './templates.ts';
import { paintedPerches, paintedSize } from '../art/paintedTrees.ts';
import { FEET, FORK_Z, LEVEL, TILE, heightUnder, levelAt, tileAt, treeTiles, trunkBase, trunkHalf, trunkTop } from './map.ts';

/** How far a branch level is above the one below it (a pine's tiers, a crown's height). */
export const RISE = 52;
/** The steepest a branch a cat can walk along (degrees from level). */
export const MAX_SLOPE = 35;
export const WALKABLE = Math.tan((MAX_SLOPE * Math.PI) / 180);
/** A drawn line's slope is taken over this far either side (px)... */
const SLOPE_SPAN = 3;
/** ...and a steep bit of it rising no more than this is walked up like a stair (as game/movement.ts STEP_UP). */
const STEEP_STEP = 3;
/** Stumps up a trunk or a steep limb are this far apart in height, and a few px more (a jump goes about 14 px)... */
export const STUMP_STEP = 11, STUMP_VARY = 2;
/** ...the lowest this high: out of a kitten's jump, in a young cat's... */
export const STUMP_LOW = 10;
/** ...and each clear of the one below it, its middle at most this far across from it (px): never straight above, a jump to one side. */
export const HOP_MAX = 16;
/** A cat's paws hang this far over the end of a stump (not much: a stump is a small thing to land on). */
const STUMP_HANG = 1;
/** Perches lower than the trunk's solid top (FORK_Z) are stood on this far in front of the trunk. */
export const TRUNK_FRONT = 6;
/** The perches' band in depth: this far behind and in front of the trunk's foot. */
export const BAND_BACK = 8, BAND_FRONT = 12;
/** A cat's paws can hang this far over the end of a branch. */
const OVERHANG = 3;
/** A falling cat still lands on a perch this far above its paws. */
const CATCH = 0.5;
/** A branch is walked along from its root this much of the way out (its tip is twigs). */
const WALK_TO = 0.85;

export type PerchKind = 'stump' | 'fork' | 'branch' | 'tier' | 'top' | 'birdhouse' | 'deck' | 'roof';

/**
 * A perch, relative to its tree: a line from (x0, z0) to (x1, z1) (x0 < x1), x from the trunk's middle, z above the tree's foot.
 * One drawn by hand (a painted tree's guide) has `zs` too: its height in every column from x0 (x0 and x1 whole, x1 - x0
 * of them), and is stood on along exactly that, steep bits and all: too steep to walk up, a cat slides down them (slopeAt).
 */
export interface Perch { x0: number; z0: number; x1: number; z1: number; kind: PerchKind; zs?: number[] }

/** A perch in the world: x across, y the line it is stood on, z absolute heights. */
export interface PerchAt extends Perch { tree: number; y: number }

/** How high perch p is at x (held to its ends). */
export function zAt(p: Perch, x: number): number {
  if (p.zs) {
    // (from the middle of one column to the middle of the next)
    const u = Math.max(0, Math.min(p.zs.length - 1, x - p.x0 - 0.5)), k = Math.floor(u), f = u - k;
    return f ? p.zs[k] + (p.zs[k + 1] - p.zs[k]) * f : p.zs[k];
  }
  if (p.x1 <= p.x0) return Math.max(p.z0, p.z1);
  const f = Math.max(0, Math.min(1, (x - p.x0) / (p.x1 - p.x0)));
  return p.z0 + (p.z1 - p.z0) * f;
}

/** How a drawn line (with `zs`) is sloped at x, up to the right: over a few px either side, so a pixel staircase is as steep as it climbs overall. */
export function slopeAt(p: Perch, x: number): number {
  return (zAt(p, x + SLOPE_SPAN) - zAt(p, x - SLOPE_SPAN)) / (2 * SLOPE_SPAN);
}

const steepHere = (p: Perch, x: number): boolean => !!p.zs && Math.abs(slopeAt(p, x)) > WALKABLE;

/**
 * Whether perch p is too steep to walk up at x, and slid down (a drawn one: one planned never is):
 * steeper than MAX_SLOPE for longer than a step up (STEEP_STEP; a short steep bit is walked up like a stair).
 */
export function steepAt(p: Perch, x: number): boolean {
  if (!steepHere(p, x)) return false;
  let a = x, b = x;
  while (a - 1 >= p.x0 && steepHere(p, a - 1)) a--;
  while (b + 1 <= p.x1 && steepHere(p, b + 1)) b++;
  return Math.abs(zAt(p, b) - zAt(p, a)) > STEEP_STEP;
}

/** A perch's middle: x, and its height there. */
export const middleOf = (p: Perch): [number, number] => [(p.x0 + p.x1) / 2, (p.z0 + p.z1) / 2];

/**
 * A limb of a tree's skeleton, relative to the tree like a perch: from (x0, z0) to
 * (x1, z1), th0 thinning to th1 px thick, bent `bend` px to one side and kinked
 * along the way (from `seed`). A stump is short and straight; `leaf`: one leaf on it.
 */
export interface Limb {
  x0: number; z0: number; x1: number; z1: number;
  th0: number; th1: number;
  bend: number; seed: number;
  stump?: boolean; leaf?: boolean;
}

/** Where limb l is f (0..1) of the way along it: (x, z), its middle line. Art and climbing both go by this. */
export function limbAt(l: Limb, f: number): [number, number] {
  const dx = l.x1 - l.x0, dz = l.z1 - l.z0, len = Math.hypot(dx, dz) || 1;
  if (l.stump) return [l.x0 + dx * f, l.z0 + dz * f];
  const nx = -dz / len, nz = dx / len, seg = Math.max(12, len * 0.3), d = f * len;
  const k = Math.floor(d / seg), u = d / seg - k, a = hash2(k, l.seed, 1340) - 0.5, b = hash2(k + 1, l.seed, 1340) - 0.5;
  const kink = (a + (b - a) * (u * u * (3 - 2 * u))) * Math.min(3, 0.6 + len * 0.025);
  const off = Math.sin(f * Math.PI) * l.bend + kink * Math.min(1, f * 4);
  return [l.x0 + dx * f + nx * off, l.z0 + dz * f + nz * off];
}

/** How thick limb l is f of the way along it. */
export const limbThick = (l: Limb, f: number): number => Math.max(1, l.th0 + (l.th1 - l.th0) * f);

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
  /** Its skeleton beyond the trunk: limbs, branches and stumps (the art draws these). */
  limbs: Limb[];
  /** How high the trunk goes before it parts into limbs. */
  fork: number;
  /** Where its leaves are (the art fills these, and its shadow, its outline against lights and owls go by them). */
  crown: Blob[];
  /** Half the trunk's width at its foot. */
  trunk: number;
  /** A bird house hangs on the trunk (its roof is a perch). */
  birdhouse: boolean;
  /** Drawn as a file (art/paintedTrees.ts): planned as its kind's template, and drawn as in the file, maybe mirrored; null: drawn from its own plan. */
  painted: { flip: boolean; kind: TreeKind } | null;
}

type Made = Pick<TreePlan, 'perches' | 'crown' | 'w' | 'h' | 'trunk' | 'limbs' | 'fork'>;

/** Resting places: a cat dozing on one of these is well rested. */
export const HOUSES: ReadonlySet<PerchKind> = new Set(['birdhouse', 'deck', 'roof']);

/** How many branch levels a tree of a size has (the top of the crown included). */
function levelsOf(seed: number, size: number): number {
  return [2, 3, 5 + (hash2(seed, 3, 57) < 0.5 ? 0 : 1)][size];
}

/** The walkable stretches of limb l: pieces of it no steeper than MAX_SLOPE, stood on along its top. */
function walkable(l: Limb, kind: PerchKind): Perch[] {
  const len = Math.hypot(l.x1 - l.x0, l.z1 - l.z0), n = Math.max(2, Math.ceil((len * WALK_TO) / 5)), out: Perch[] = [];
  for (let k = 0; k < n; k++) {
    const f0 = (k / n) * WALK_TO, f1 = ((k + 1) / n) * WALK_TO;
    // (along its top)
    const [ax, az0] = limbAt(l, f0), [bx, bz0] = limbAt(l, f1), az = az0 + limbThick(l, f0) / 2, bz = bz0 + limbThick(l, f1) / 2;
    if (Math.abs(bx - ax) < 0.5 || Math.abs(bz - az) > Math.abs(bx - ax) * WALKABLE) continue;
    const [p, q] = ax < bx ? [[ax, az], [bx, bz]] : [[bx, bz], [ax, az]];
    out.push({ x0: p[0], z0: p[1], x1: q[0], z1: q[1], kind });
  }
  return out;
}

/**
 * Stumps up a column from height z0 to z1, its middle at x(z), half(z) wide:
 * every STUMP_STEP or so, each to one side of the one below it (HOP_MIN to
 * HOP_MAX across), so a cat zig-zags up, jumping across from one to the next.
 * Out at the column's edge a stump is a short stub sticking out of it (some
 * with a leaf); on the face of a wide trunk, a knot of an old branch.
 * `below`: the stump below the first (across, from the trunk's middle), if any. Returns the height the
 * next would be at, and the last stump.
 */
type Rung = { z: number; last: [number, number] | null };
function ladder(rnd: () => number, x: (z: number) => number, half: (z: number) => number, z0: number, z1: number, limbs: Limb[], perches: Perch[], below: [number, number] | null = null): Rung {
  let z = z0, last = below;
  for (; z <= z1; z += STUMP_STEP + Math.floor(rnd() * (STUMP_VARY + 1))) {
    const mx = x(z), h = half(z), reach = h + 7, th = 2.5;
    // (the stump round u: a knot on a wide trunk's face, or a stub out of its edge)
    const span = (u: number): [number, number] => {
      if (Math.abs(u) < h - 3) return [u - 2, u + 2];
      const side = Math.sign(u) || 1, root = side * (h - 1), tip = side * Math.max(h + 3, Math.abs(u) + 2);
      return [Math.min(root, tip), Math.max(root, tip)];
    };
    // (somewhere across the column, clear of the last and not too far from it)
    const prev = last && ([last[0] - mx, last[1] - mx] as const);
    const fits = ([a, b]: [number, number]) => !prev || ((b <= prev[0] - 2 || a >= prev[1] + 2) && Math.abs((a + b) / 2 - (prev[0] + prev[1]) / 2) <= HOP_MAX);
    let u = (rnd() * 2 - 1) * reach;
    for (let k = 0; k < 16 && !fits(span(u)); k++) u = (rnd() * 2 - 1) * reach;
    // (or the other side of the column from it)
    if (!fits(span(u)) && prev) u = (prev[0] + prev[1]) / 2 > 0 ? Math.min(-(h + 2), prev[0] - 6) : Math.max(h + 2, prev[1] + 6);
    const [a, b] = span(u);
    if (Math.abs(u) < h - 3) limbs.push({ x0: mx + a, z0: z, x1: mx + b, z1: z, th0: th, th1: th, bend: 0, seed: 0, stump: true });
    else {
      const side = Math.sign(u) || 1, root = side * (h - 1), tip = side * Math.max(h + 3, Math.abs(u) + 2);
      limbs.push({ x0: mx + root, z0: z, x1: mx + tip, z1: z + 1, th0: th, th1: 2, bend: 0, seed: 0, stump: true, leaf: rnd() < 0.4 });
    }
    perches.push({ x0: mx + a, z0: z + th / 2, x1: mx + b, z1: z + th / 2, kind: 'stump' });
    last = [mx + a, mx + b];
  }
  return { z, last };
}

/** The height along limb l at which it reaches z (its first crossing), as how far along it is; null if it never does. */
function along(l: Limb, z: number): number | null {
  for (let k = 0; k <= 40; k++) if (limbAt(l, k / 40)[1] >= z) return k / 40;
  return null;
}

/** Stumps up limb l from height z0 to its end (or z1), on from the stump `below`. */
function limbLadder(rnd: () => number, l: Limb, z0: number, z1: number, limbs: Limb[], perches: Perch[], below: [number, number] | null): Rung {
  const top = Math.min(z1, limbAt(l, 0.92)[1]);
  const xAt = (z: number) => limbAt(l, along(l, z) ?? 1)[0], half = (z: number) => limbThick(l, along(l, z) ?? 1) / 2;
  return ladder(rnd, xAt, half, z0, top, limbs, perches, below);
}

/**
 * A broadleaf: one round, lumpy crown of leaves on its trunk; the trunk
 * parts into 2 or 3 limbs spreading up through it, each with branches off it
 * (some level enough to walk along), and one goes on up to the crown's top,
 * where a cat sits up in the sun. Stumps up the trunk and the limbs.
 */
function broadleafPlan(seed: number, size: number, trunk: number, birdhouse: boolean): Made & { birdhouse: boolean } {
  const rnd = mulberry32(seed * 7919 + 3);
  const n = levelsOf(seed, size);
  const top = FORK_Z + (n - 1) * RISE;
  // the crown's underside: just under the lowest branch
  const base = FORK_Z - 8 - rnd() * 6;
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

  // the trunk, up into the crown, where it parts into limbs that spread up and out, with branches off them
  const fork = Math.max(14, zc - rz * 0.45), thin = trunk * 0.7, under = flat + 8;
  const trunkHalfAt = (z: number) => trunk - (z / fork) * (trunk - thin);
  const limbs: Limb[] = [], perches: Perch[] = [], mains: Limb[] = [];
  const nl = 2 + (rnd() < 0.5 ? 1 : 0);
  for (let j = 0; j < nl; j++) {
    const a = (j / (nl - 1) - 0.5) * 1.3 + (rnd() - 0.5) * 0.3, len = rz * (0.9 + rnd() * 0.35);
    let x1 = Math.sin(a) * len * Math.min(1.2, rx / rz), z1 = Math.max(under, fork + Math.cos(a) * len);
    // (its end well inside the crown)
    const out = Math.hypot(x1 / rx, (z1 - zc) / rz);
    if (out > 0.7) { x1 = (x1 * 0.7) / out; z1 = zc + ((z1 - zc) * 0.7) / out; }
    const th = Math.max(2, (thin * 2) / nl + 1);
    const main: Limb = { x0: (j / (nl - 1) - 0.5) * thin, z0: fork - 2, x1, z1, th0: th, th1: Math.max(1.5, th * 0.3), bend: (rnd() - 0.5) * len * 0.16, seed: Math.floor(rnd() * 1e6) };
    limbs.push(main);
    mains.push(main);
    // branches off it, to either side, some level enough to walk along
    for (let k = 0; k < 3; k++) {
      const f = 0.25 + k * 0.22 + rnd() * 0.1, [bx, bz] = limbAt(main, f);
      const b = a + (k % 2 ? 1 : -1) * (0.6 + rnd() * 0.8), bl = len * (0.3 + rnd() * 0.25);
      const branch: Limb = { x0: bx, z0: bz, x1: bx + Math.sin(b) * bl, z1: Math.max(under, bz + Math.cos(b) * bl * 0.8), th0: Math.max(1.5, th * (1 - f) * 0.6), th1: 1, bend: (rnd() - 0.5) * bl * 0.16, seed: Math.floor(rnd() * 1e6) };
      limbs.push(branch);
      perches.push(...walkable(branch, 'branch'));
    }
    perches.push(...walkable(main, 'branch'));
  }
  // the most upright limb goes on up, thinner, to the crown's top
  const lead = mains.reduce((a, b) => (Math.abs(b.x1) / (b.z1 - b.z0) < Math.abs(a.x1) / (a.z1 - a.z0) ? b : a));
  const [lx, lz] = limbAt(lead, 1);
  const leader: Limb = { x0: lx, z0: lz, x1: lx * 0.3, z1: top - 4, th0: Math.max(1.5, lead.th1), th1: 1, bend: (rnd() - 0.5) * 4, seed: Math.floor(rnd() * 1e6) };
  limbs.push(leader);
  const s = Math.max(10, Math.round(rx * 0.18));
  perches.push({ x0: leader.x1 - s, z0: top, x1: leader.x1 + s, z1: top, kind: 'top' });
  // stumps: up the trunk, and up every limb (the leader all the way to the top)
  // (each carrying on from the one below it without a gap)
  const up = ladder(rnd, () => 0, trunkHalfAt, STUMP_LOW, fork - 4, limbs, perches);
  let next = up;
  for (const m of mains) {
    const r = limbLadder(rnd, m, up.z, Infinity, limbs, perches, up.last);
    if (m === lead) next = r;
  }
  limbLadder(rnd, leader, next.z, top - 4, limbs, perches, next.last);
  // the bird house hangs on the front of the trunk, below the fork
  const house = Math.min(FORK_Z + Math.round(RISE / 2), Math.round(fork - 2));
  const hung = birdhouse && house >= 16;
  if (hung) perches.push({ x0: -5, z0: house, x1: 5, z1: house, kind: 'birdhouse' });
  return { ...frame(perches, crown, trunk, limbs, fork), birdhouse: hung };
}

/**
 * A spruce: a tall cone of drooping, overlapping tiers of boughs on a
 * straight trunk, up to a spire (its looks come first; a cat stands on top
 * of a tier by the trunk, every RISE up, and climbs the stumps of old
 * boughs up the trunk between them).
 */
function pinePlan(seed: number, size: number, trunk: number): Made {
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
  const tip = H;
  crown.push({ x: 0, z: H - 14, rx: 7, rz: 14 });
  const perches: Perch[] = [], limbs: Limb[] = [];
  for (let z = FORK_Z; z <= H - 20; z += RISE) perches.push({ x0: -(trunk + 6), z0: z, x1: trunk + 6, z1: z, kind: 'tier' });
  perches[perches.length - 1].kind = 'top';
  const half = (z: number) => Math.max(1.5, trunk - (z / tip) * (trunk - 1.5));
  ladder(rnd, () => 0, half, STUMP_LOW, perches[perches.length - 1].z0 - 4, limbs, perches);
  return frame(perches, crown, trunk, limbs, tip - 6);
}

/** The big tree with a house in it: up to the deck, onto the hut's roof, and to the top. */
function treehousePlan(trunk: number): Made {
  const deck = FORK_Z + RISE, roof = deck + 34, top = roof + RISE * 2;
  const flat = (x0: number, x1: number, z: number, kind: PerchKind): Perch => ({ x0, z0: z, x1, z1: z, kind });
  const perches: Perch[] = [flat(-30, 30, FORK_Z, 'fork'), flat(-52, 52, deck, 'deck'), flat(-24, 24, roof, 'roof'), flat(-48, 44, roof + RISE, 'branch'), flat(-50, 50, top, 'top')];
  // a big round crown over the hut, and clouds of leaves either side behind it
  const crown: Blob[] = [
    { x: -84, z: deck + 34, rx: 46, rz: 38 },
    { x: 84, z: deck + 28, rx: 46, rz: 38 },
    { x: 14, z: roof + 112, rx: 64, rz: 46 },
    { x: 0, z: roof + 74, rx: 112, rz: 70 },
  ];
  // stumps up the trunk, all the way
  const limbs: Limb[] = [], rnd = mulberry32(trunk * 31 + 7);
  ladder(rnd, () => 0, (z) => Math.max(6, trunk - (z / top) * (trunk - 6)), STUMP_LOW, top - 4, limbs, perches);
  return frame(perches, crown, trunk, limbs, top - 6);
}

/** The picture's size: room for every perch, limb, leaf and root, with the trunk's foot at the bottom middle. */
function frame(perches: Perch[], crown: Blob[], trunk: number, limbs: Limb[], fork: number): Made {
  let reach = trunk + 6, top = 0;
  for (const p of perches) reach = Math.max(reach, -p.x0 + 4, p.x1 + 4);
  for (const l of limbs) reach = Math.max(reach, Math.abs(l.x0) + 6, Math.abs(l.x1) + 6);
  for (const b of crown) {
    // (room for the puffs of leaves, which bulge out past the mass they fill)
    reach = Math.max(reach, Math.abs(b.x) + b.rx * 1.1 + 12);
    top = Math.max(top, b.z + b.rz + 10);
  }
  return { perches, crown, trunk, limbs, fork, w: Math.ceil(reach) * 2, h: Math.ceil(top) + 1 };
}

function plan(tx: number, ty: number, i: number): TreePlan {
  const ch = tileAt(tx, ty);
  const shape: TreeShape = ch === 'P' ? 'pine' : ch === 'H' ? 'treehouse' : 'broadleaf';
  const colour = shape !== 'broadleaf' ? 0 : KIND_COLOUR[treeKindAt(ch, tx, ty)!];
  const seed = i + 1;
  // bird houses on a few of the green trees and apple trees
  const birdhouse = shape === 'broadleaf' && colour !== 2 && hash2(tx, ty, 56) < 0.3;
  const [x, y] = trunkBase(tx, ty);
  const trunk = trunkHalf(tx, ty), size = treeSizeAt(tx, ty);
  const elev = levelAt(tx, ty) * LEVEL;
  // a kind and size of tree drawn as a file: its template, as drawn (every other one mirrored), stood on where its guide says
  const painted = paintedKind(ch, tx, ty, size);
  if (painted) {
    const flip = hash2(tx, ty, 1601) < 0.5, [w, h] = paintedSize(painted, size)!;
    const tp = templatePlan(painted, size), drawn = paintedPerches(painted, size);
    if (drawn) tp.perches = drawn.map((p) => ({ ...p }));
    const { perches, limbs, crown, fork } = flip ? mirrored(tp) : tp;
    return { tx, ty, x, y, elev, shape, colour, seed, birdhouse: false, painted: { flip, kind: painted }, perches, limbs, crown, fork, trunk: tp.trunk, w, h };
  }
  const made = shape === 'pine' ? pinePlan(seed, size, trunk) : shape === 'treehouse' ? treehousePlan(trunk) : broadleafPlan(seed, size, trunk, birdhouse);
  return { tx, ty, x, y, elev, shape, colour, seed, birdhouse: false, painted: null, ...made };
}

/** The template of a kind and size of tree (world/templates.ts), planned standing at the map's corner. */
export function templatePlan(kind: TreeKind, size: number): TreePlan {
  const seed = TEMPLATE_SEED[kind][size], trunk = TEMPLATE_TRUNK[kind][size];
  const shape = kind === 'pine' ? 'pine' : 'broadleaf';
  const made = shape === 'pine' ? pinePlan(seed, size, trunk) : broadleafPlan(seed, size, trunk, false);
  return { tx: 0, ty: 0, x: 0, y: 0, elev: 0, shape, colour: KIND_COLOUR[kind], seed, birdhouse: false, painted: null, ...made };
}

/** Plan p the other way round (left for right). */
function mirrored(p: TreePlan): TreePlan {
  return {
    ...p,
    perches: p.perches.map((q) => ({ ...q, x0: -q.x1, z0: q.z1, x1: -q.x0, z1: q.z0, ...(q.zs && { zs: [...q.zs].reverse() }) })),
    limbs: p.limbs.map((l) => ({ ...l, x0: -l.x0, x1: -l.x1, bend: -l.bend })),
    crown: p.crown.map((b) => ({ ...b, x: -b.x })),
  };
}

/** Every tree in the garden, in the order of treeTiles(). */
export const TREES: TreePlan[] = treeTiles().map(([tx, ty], i) => plan(tx, ty, i));

/** Each tree's perches in the world. */
// (low down, where the trunk is solid, a perch is stood on in front of it)
const PERCHES: PerchAt[][] = TREES.map((t, tree) =>
  t.perches.map((p) => ({
    tree, x0: t.x + p.x0, z0: t.elev + p.z0, x1: t.x + p.x1, z1: t.elev + p.z1, kind: p.kind,
    y: t.y + (Math.min(p.z0, p.z1, ...(p.zs ?? [])) < FORK_Z ? TRUNK_FRONT : 0),
    ...(p.zs && { zs: p.zs.map((z) => t.elev + z) }),
  })),
);

const inBand = (t: TreePlan, y: number) => y >= t.y - BAND_BACK && y <= t.y + BAND_FRONT;

/** The trees whose band reaches into each row of tiles, so a cat only asks the few near it. */
const BY_ROW: number[][] = [];
TREES.forEach((t, i) => {
  for (let r = Math.floor((t.y - BAND_BACK) / TILE); r <= Math.floor((t.y + BAND_FRONT) / TILE); r++) (BY_ROW[r] ??= []).push(i);
});
const near = (y: number): number[] => BY_ROW[Math.floor(y / TILE)] ?? [];

/**
 * The highest perch under a cat at (x, y) whose top there is no higher than
 * its paws at height z (a hair above counts: it is landing on it), and lower
 * than `under` (to drop through the one it stood on).
 */
export function perchUnder(x: number, y: number, z: number, under = Infinity): PerchAt | null {
  let best: PerchAt | null = null, bz = -Infinity;
  for (const i of near(y)) {
    const t = TREES[i];
    if (!inBand(t, y) || Math.abs(x - t.x) > t.w / 2 + OVERHANG) continue;
    for (const p of PERCHES[i]) {
      const hang = p.kind === 'stump' ? STUMP_HANG : OVERHANG;
      if (x <= p.x0 - hang || x >= p.x1 + hang) continue;
      const pz = zAt(p, x);
      if (pz <= z + CATCH && pz < under && pz > bz) { best = p; bz = pz; }
    }
  }
  return best;
}

/**
 * A drawn branch a cat came down onto going from (xa, za) to (xb, zb) at y (in the air,
 * across it where it's steep, which a check at xb alone would miss): its height at xb, or
 * -Infinity. Only ones lower than `under` (not the one it dropped from).
 */
export function lineCrossed(xa: number, za: number, xb: number, y: number, zb: number, under = Infinity): number {
  let best = -Infinity;
  for (const i of near(y)) {
    if (!inBand(TREES[i], y)) continue;
    for (const p of PERCHES[i]) {
      if (!p.zs || xb <= p.x0 - OVERHANG || xb >= p.x1 + OVERHANG) continue;
      const pa = zAt(p, xa), pb = zAt(p, xb);
      if (za >= pa - CATCH && zb < pb && pb < under && pa < under && pb > best) best = pb;
    }
  }
  return best;
}

/** What a cat at (x, y), with its paws at height z, would stand on: the ground or a perch (not one at or above `under`). */
export function surfaceAt(x: number, y: number, z: number, under = Infinity): number {
  const x0 = x + FEET.x0, y0 = y + FEET.y0, x1 = x + FEET.x1, y1 = y + FEET.y1;
  // over a trunk (below its fork a wall to walk into), a cat dropping down comes to rest on its top, and stands on it
  const trunk = trunkTop(x0, y0, x1, y1);
  const ground = trunk > z + CATCH ? Math.max(trunk, heightUnder(x0, y0, x1, y1, trunk)) : Math.max(trunk, heightUnder(x0, y0, x1, y1, z + CATCH));
  const p = perchUnder(x, y, z, under);
  const pz = p ? zAt(p, x) : -Infinity;
  return pz > ground ? pz : ground;
}

/** The perch a cat at (x, y, z) is standing on, if it is on one. */
export function standingOn(x: number, y: number, z: number): PerchAt | null {
  const p = perchUnder(x, y, z);
  if (!p) return null;
  const pz = zAt(p, x);
  return Math.abs(pz - z) < 1 && pz > heightUnder(x + FEET.x0, y + FEET.y0, x + FEET.x1, y + FEET.y1, z + CATCH) ? p : null;
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

// Things to discover: food and eggs left about the garden, worth more than
// anything a cat can catch. Where they turn up follows from the garden's seed
// like the rest of its layout, and from the garden clock, so every cat in the
// garden has the same ones. Once eaten, a find is gone for a while; then
// there's more (a fresh lunch in the basket, a new catch in the bucket,
// another snack dropped somewhere along the paths, a new clutch of eggs).
//
// Some are in plain sight but have to be got at: a picnic basket on a table
// or a blanket, a snack dropped by a bench, an angler's bucket by the water.
// The birds' nests are hidden, low in the bushes and box hedges or up in the
// trees, and only show to a cat that comes close (game/fauna/Finds.ts).

import { hash2 } from '../art/raster.ts';
import { worldSeed } from './seed.ts';
import { FURNITURE, LEVEL, MAP_H, MAP_W, TILE, elevAt, furnished, levelAt, tileAt } from './map.ts';
import { LEGEND, groundOf, isLawnOrTall, isPath, isPond } from './legend.ts';
import { TREES, zAt } from './trees.ts';
import { Food } from './food.ts';
import { ZONE_FLOOR } from './themes.ts';

export { Food };

/** Where it is: in a basket, lying on the ground, in an angler's bucket, or in a nest (in a bush or up a tree). */
export type FindKind = 'basket' | 'snack' | 'bucket' | 'nest';

/** A place a find can be: the ground point under it (world px) and its height above that (like a cat's z). */
interface Spot {
  x: number;
  y: number;
  h: number;
  /** Up this tree (index into TREES). */
  tree?: number;
}

/**
 * Somewhere things turn up, time and again: a picnic table's basket, a
 * stretch of path, a bush. Each time round (every REFILL_MS, each slot at
 * its own moment) there may be something there, at one of its spots.
 */
export interface FindSlot {
  kind: FindKind;
  spots: Spot[];
  foods: Food[];
  /** How likely there's something there, each time round. */
  chance: number;
  /** Basket on a picnic table (drawn with the find); blankets have their own basket. */
  table?: boolean;
  /** Where its time round starts (ms). */
  phase: number;
}

export interface Find extends Spot {
  /** The slot it's in, and which time round (eaten, it's back next time). */
  id: number;
  slot: number;
  kind: FindKind;
  food: Food;
  table?: boolean;
  /** Hidden until a cat comes close. */
  hidden?: boolean;
}

/** How long a slot's find lies there (or its basket stands empty) before the next. */
export const REFILL_MS = 8 * 60000;
/** Ids: slot * ROUNDS + which time round (mod ROUNDS). */
const ROUNDS = 1 << 16;

/** Everywhere things can turn up in a garden grown from `seed`. */
export function planFinds(seed: number): FindSlot[] {
  const salt = (s: number) => Math.imul(s + 1, 0x2c1b3c6d) ^ Math.imul(seed | 0, 0x297a2d39);
  const rnd = (x: number, y: number, s: number) => hash2(x, y, salt(s));
  const out: Omit<FindSlot, 'phase'>[] = [];
  const lunch = [Food.Sausage, Food.Cheese, Food.Sandwich], snacks = [Food.Pretzel, Food.Currywurst, Food.IceCream];

  // picnic baskets: on the tables, and the ones on the blankets (most of the time with lunch in them)
  for (const f of FURNITURE) {
    const ox = f.tx * TILE, oy = f.ty * TILE;
    if (f.kind === 'picnic') out.push({ kind: 'basket', foods: lunch, chance: 0.8, table: true, spots: [{ x: ox + 22 + Math.round(rnd(f.tx, f.ty, 3) * 20), y: oy + 26, h: 10 }] });
    if (f.kind === 'blanket') out.push({ kind: 'basket', foods: lunch, chance: 0.8, spots: [{ x: ox + 45, y: oy + 29, h: 6 }] });
  }

  // snacks dropped on the path in front of a bench, and here and there along the paths
  for (const f of FURNITURE)
    if (f.kind === 'bench') {
      const spots = [0, 1, 2].map((n) => {
        const x = f.tx * TILE + 6 + Math.round(rnd(f.tx, f.ty, 11 + n) * 20), y = (f.ty + 1) * TILE + 6 + Math.round(rnd(f.tx, f.ty, 14 + n) * 6);
        return { x, y, h: elevAt(x, y) };
      });
      out.push({ kind: 'snack', foods: snacks, chance: 0.5, spots });
    }
  const paths: [number, number][] = [];
  for (let ty = 2; ty < MAP_H - 2; ty++) for (let tx = 2; tx < MAP_W - 2; tx++) if (groundOf(tileAt(tx, ty)) === 'path' && tileAt(tx, ty) !== ZONE_FLOOR && !furnished(tx, ty)) paths.push([tx, ty]);
  // (each one somewhere along its own stretch of path: the paths in reading order, cut into pieces)
  const PATH_SNACKS = 16;
  for (let n = 0; n < PATH_SNACKS && paths.length; n++) {
    const stretch = paths.slice(Math.floor((n * paths.length) / PATH_SNACKS), Math.floor(((n + 1) * paths.length) / PATH_SNACKS));
    const spots = [0, 1, 2, 3, 4, 5].map((k) => {
      const [tx, ty] = stretch[Math.floor(rnd(n, k, 21) * stretch.length)];
      const x = tx * TILE + 4 + Math.round(rnd(n, k, 23) * 8), y = ty * TILE + 6 + Math.round(rnd(n, k, 25) * 6);
      return { x, y, h: elevAt(x, y) };
    });
    out.push({ kind: 'snack', foods: snacks, chance: 0.7, spots });
  }

  // anglers' buckets on the banks, with the catch still in them
  const banks: [number, number, number, number][] = [];
  for (let ty = 2; ty < MAP_H - 2; ty++)
    for (let tx = 2; tx < MAP_W - 2; tx++) {
      const ch = tileAt(tx, ty);
      // (not in a themed zone: that's its own)
      if ((!isLawnOrTall(ch) && !isPath(ch)) || ch === ZONE_FLOOR || LEGEND[ch]?.water || furnished(tx, ty)) continue;
      const side = ([[0, 1], [0, -1], [1, 0], [-1, 0]] as const).find(([dx, dy]) => isPond(tileAt(tx + dx, ty + dy)) && levelAt(tx + dx, ty + dy) === levelAt(tx, ty));
      if (side) banks.push([tx, ty, side[0], side[1]]);
    }
  const buckets: Spot[] = [];
  for (let n = 0; n < 80 && buckets.length < 5 && banks.length; n++) {
    const [tx, ty, dx, dy] = banks[Math.floor(rnd(n, 30, 31) * banks.length)];
    const x = tx * TILE + 8 + dx * 3, y = ty * TILE + 10 + dy * 3;
    if (buckets.every((b) => Math.hypot(b.x - x, b.y - y) >= 14 * TILE)) buckets.push({ x, y, h: elevAt(x, y) });
  }
  for (const b of buckets) out.push({ kind: 'bucket', foods: [Food.Fish], chance: 0.85, spots: [b] });

  // nests in the bushes and the box hedges, on top where a cat that hops up finds them
  const nests: Spot[] = [];
  for (let ty = 1; ty < MAP_H - 1; ty++)
    for (let tx = 1; tx < MAP_W - 1; tx++) {
      const ch = tileAt(tx, ty);
      if ((ch !== 'b' && ch !== '#') || rnd(tx, ty, 40) > (ch === 'b' ? 0.3 : 0.08)) continue;
      const x = tx * TILE + 8, y = ty * TILE + 12;
      if (nests.every((f) => Math.hypot(f.x - x, f.y - y) >= 6 * TILE)) nests.push({ x, y, h: levelAt(tx, ty) * LEVEL + (LEGEND[ch].height ?? 0) });
    }
  for (const n of nests) out.push({ kind: 'nest', foods: [Food.Eggs], chance: 0.6, spots: [n] });
  // and up in the trees, on a branch half way up or higher (a different one each time)
  TREES.forEach((t, i) => {
    if (t.shape === 'treehouse' || rnd(t.tx, t.ty, 50) > 0.15) return;
    const boughs = t.perches.filter((p) => p.kind === 'branch' || p.kind === 'tier').slice(1);
    const spots = boughs.map((p, k) => {
      const x = Math.round((p.x0 + p.x1) / 2 + (p.x1 - p.x0) * 0.2 * (rnd(t.tx, k, 52) - 0.5));
      return { x: t.x + x, y: t.y, h: t.elev + zAt(p, x), tree: i };
    });
    if (spots.length) out.push({ kind: 'nest', foods: [Food.TreeEggs], chance: 0.6, spots });
  });

  return out.map((f, n) => ({ ...f, phase: Math.floor(rnd(n, 60, 61) * REFILL_MS) }));
}

/** What's in slot `n` of `slots` at garden time gt, if anything. */
export function findIn(slots: FindSlot[], n: number, gt: number, seed = worldSeed().seed): Find | null {
  const s = slots[n];
  const round = Math.floor((gt + s.phase) / REFILL_MS);
  const r = (k: number) => hash2(n, round, Math.imul(k + 7, 0x51ed27) ^ Math.imul(seed | 0, 0x2f6b9d3));
  if (r(1) >= s.chance) return null;
  const spot = s.spots[Math.floor(r(2) * s.spots.length)];
  const food = s.foods[Math.floor(r(3) * s.foods.length)];
  return { ...spot, id: n * ROUNDS + (round % ROUNDS), slot: n, kind: s.kind, food, table: s.table, hidden: s.kind === 'nest' || undefined };
}

/** This garden's places to find things. */
export const FIND_SLOTS: FindSlot[] = planFinds(worldSeed().seed);

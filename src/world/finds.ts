// Things to discover: food and eggs left about the garden, worth more than
// anything a cat can catch, and there only once (nothing brings them back
// until the garden is gone and a new one grows). Where they are follows from
// the garden's seed like the rest of its layout, so every cat in the garden
// has the same ones.
//
// Some are in plain sight but have to be got at: a picnic basket on a table
// or a blanket, a snack dropped by a bench, an angler's bucket by the water.
// The birds' nests are hidden, low in the bushes and box hedges or up in the
// trees, and only show to a cat that comes close (game/fauna/Finds.ts).

import { hash2 } from '../art/raster.ts';
import { worldSeed } from './seed.ts';
import { FURNITURE, LEVEL, MAP_H, MAP_W, TILE, elevAt, furnished, levelAt, tileAt } from './map.ts';
import { LEGEND, groundOf, isLawnOrTall, isOpenWater, isPath } from './legend.ts';
import { TREES } from './trees.ts';
import { Food } from './food.ts';

export { Food };

/** Where it is: in a basket, lying on the ground, in an angler's bucket, or in a nest (in a bush or up a tree). */
export type FindKind = 'basket' | 'snack' | 'bucket' | 'nest';

export interface Find {
  id: number;
  kind: FindKind;
  food: Food;
  /** The ground point under it (world px), and its height above that (like a cat's z). */
  x: number;
  y: number;
  h: number;
  /** Basket on a picnic table (drawn with the find); blankets have their own basket. */
  table?: boolean;
  /** Up this tree (index into TREES). */
  tree?: number;
  /** Hidden until a cat comes close. */
  hidden?: boolean;
}

/** Everything to be found in a garden grown from `seed`. */
export function placeFinds(seed: number): Find[] {
  const salt = (s: number) => Math.imul(s + 1, 0x2c1b3c6d) ^ Math.imul(seed | 0, 0x297a2d39);
  const rnd = (x: number, y: number, s: number) => hash2(x, y, salt(s));
  const out: Omit<Find, 'id'>[] = [];
  const far = (x: number, y: number, d: number, kind: FindKind) => out.every((f) => f.kind !== kind || Math.hypot(f.x - x, f.y - y) >= d);

  // picnic baskets: on the tables, and the ones on the blankets (most have lunch in them)
  for (const f of FURNITURE) {
    const ox = f.tx * TILE, oy = f.ty * TILE;
    const food = [Food.Sausage, Food.Cheese, Food.Sandwich][Math.floor(rnd(f.tx, f.ty, 1) * 3)] as Food;
    if (rnd(f.tx, f.ty, 2) > 0.8) continue;
    if (f.kind === 'picnic') out.push({ kind: 'basket', food, x: ox + 22 + Math.round(rnd(f.tx, f.ty, 3) * 20), y: oy + 26, h: 10, table: true });
    if (f.kind === 'blanket') out.push({ kind: 'basket', food, x: ox + 45, y: oy + 29, h: 6 });
  }

  // snacks dropped on the path in front of a bench, and here and there along the paths
  for (const f of FURNITURE)
    if (f.kind === 'bench' && rnd(f.tx, f.ty, 10) < 0.5) {
      const x = f.tx * TILE + 6 + Math.round(rnd(f.tx, f.ty, 11) * 20), y = (f.ty + 1) * TILE + 6 + Math.round(rnd(f.tx, f.ty, 12) * 6);
      out.push({ kind: 'snack', food: snack(rnd(f.tx, f.ty, 13)), x, y, h: elevAt(x, y) });
    }
  const paths: [number, number][] = [];
  for (let ty = 2; ty < MAP_H - 2; ty++) for (let tx = 2; tx < MAP_W - 2; tx++) if (groundOf(tileAt(tx, ty)) === 'path' && !furnished(tx, ty)) paths.push([tx, ty]);
  for (let n = 0; n < 60 && out.filter((f) => f.kind === 'snack').length < 14; n++) {
    const [tx, ty] = paths[Math.floor(rnd(n, 20, 21) * paths.length)];
    const x = tx * TILE + 4 + Math.round(rnd(n, 22, 23) * 8), y = ty * TILE + 6 + Math.round(rnd(n, 24, 25) * 6);
    if (far(x, y, 8 * TILE, 'snack')) out.push({ kind: 'snack', food: snack(rnd(n, 26, 27)), x, y, h: elevAt(x, y) });
  }

  // anglers' buckets on the banks, with the catch still in them
  const banks: [number, number, number, number][] = [];
  for (let ty = 2; ty < MAP_H - 2; ty++)
    for (let tx = 2; tx < MAP_W - 2; tx++) {
      const ch = tileAt(tx, ty);
      if ((!isLawnOrTall(ch) && !isPath(ch)) || LEGEND[ch]?.water || furnished(tx, ty)) continue;
      const side = ([[0, 1], [0, -1], [1, 0], [-1, 0]] as const).find(([dx, dy]) => isOpenWater(tileAt(tx + dx, ty + dy)) && levelAt(tx + dx, ty + dy) === levelAt(tx, ty));
      if (side) banks.push([tx, ty, side[0], side[1]]);
    }
  for (let n = 0; n < 80 && out.filter((f) => f.kind === 'bucket').length < 5; n++) {
    if (!banks.length) break;
    const [tx, ty, dx, dy] = banks[Math.floor(rnd(n, 30, 31) * banks.length)];
    const x = tx * TILE + 8 + dx * 3, y = ty * TILE + 10 + dy * 3;
    if (far(x, y, 14 * TILE, 'bucket')) out.push({ kind: 'bucket', food: Food.Fish, x, y, h: elevAt(x, y) });
  }

  // nests in the bushes and the box hedges, on top where a cat that hops up finds them
  for (let ty = 1; ty < MAP_H - 1; ty++)
    for (let tx = 1; tx < MAP_W - 1; tx++) {
      const ch = tileAt(tx, ty);
      if ((ch !== 'b' && ch !== '#') || rnd(tx, ty, 40) > (ch === 'b' ? 0.3 : 0.08)) continue;
      const x = tx * TILE + 8, y = ty * TILE + 12;
      if (far(x, y, 6 * TILE, 'nest')) out.push({ kind: 'nest', food: Food.Eggs, x, y, h: levelAt(tx, ty) * LEVEL + (LEGEND[ch].height ?? 0), hidden: true });
    }
  // and up in the trees, on a branch half way up or higher
  TREES.forEach((t, i) => {
    if (t.shape === 'treehouse' || rnd(t.tx, t.ty, 50) > 0.09) return;
    const boughs = t.perches.filter((p) => p.kind === 'branch' || p.kind === 'tier').slice(1);
    if (!boughs.length) return;
    const p = boughs[Math.floor(rnd(t.tx, t.ty, 51) * boughs.length)];
    const x = t.x + Math.round((p.x0 + p.x1) / 2 + (p.x1 - p.x0) * 0.2 * (rnd(t.tx, t.ty, 52) - 0.5));
    out.push({ kind: 'nest', food: Food.TreeEggs, x, y: t.y, h: t.elev + p.z, tree: i, hidden: true });
  });

  return out.map((f, id) => ({ ...f, id }));
}

const snack = (r: number): Food => [Food.Pretzel, Food.Currywurst, Food.IceCream][Math.floor(r * 3)] as Food;

/** This garden's finds. */
export const FINDS: Find[] = placeFinds(worldSeed().seed);

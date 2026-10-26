// Questions about the park's geometry: what is on a tile, how high the ground
// is, where a cat can stand, where the water is. The park itself (map,
// hills, furniture) is data in garden.ts; tile kinds are in legend.ts.

import { hash2 } from '../art/raster.ts';
import { SEASON } from './season.ts';
import { ROWS, ELEV, FURNITURE } from './garden.ts';
import { LEGEND, WALL, groundOf, isPond, isStairs, isTree, isWaterway } from './legend.ts';

export const TILE = 16;
/** Height of one terrain level in px: more than a jump (~14px), so cliffs can't be hopped up. */
export const LEVEL = 16;

export { WALL };

export const MAP_W = ROWS[0].length;
export const MAP_H = ROWS.length;
for (const [i, r] of ROWS.entries()) if (r.length !== MAP_W) throw new Error(`map row ${i} is ${r.length} wide`);
if (ELEV.length !== MAP_H || ELEV.some((r) => r.length !== MAP_W)) throw new Error('elevation map size mismatch');

export const WORLD_W = MAP_W * TILE;
export const WORLD_H = MAP_H * TILE;

export function tileAt(tx: number, ty: number): string {
  if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return 'F';
  return ROWS[ty][tx];
}

/** Terrain level of a tile (stairs report their lower end). */
export function levelAt(tx: number, ty: number): number {
  if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return 0;
  return ELEV[ty].charCodeAt(tx) - 48;
}

/** Terrain height in px of the tile under a world point: where things standing there are drawn. */
export const elevAt = (x: number, y: number): number => levelAt(Math.floor(x / TILE), Math.floor(y / TILE)) * LEVEL;

export const MAX_LEVEL = Math.max(...ELEV.map((r) => Math.max(...[...r].map(Number))));

// ---- height map ----
// Every tile has a surface height in pixels: its terrain level, plus whatever
// stands on it (see legend.ts). Cats can walk onto surfaces no higher than they
// currently are, so low obstacles can be reached by jumping. Water is flat but
// special: cats won't walk in, though they can jump in (see waterUnder).

const NO_INSET: [number, number, number, number] = [0, 0, 0, 0];

/** The cat's feet box, relative to its (x, y) = bottom centre. */
export const FEET = { x0: -5, x1: 5, y0: -5, y1: 0 };

/** Tree trunks block movement only where they meet the ground. */
const TRUNKS: [number, number, number, number][] = [];

/** Highest surface under a world-space box: terrain level plus whatever stands on it. */
export function heightUnder(x0: number, y0: number, x1: number, y1: number): number {
  let h = 0;
  const tx0 = Math.floor(x0 / TILE), tx1 = Math.floor((x1 - 0.01) / TILE);
  const ty0 = Math.floor(y0 / TILE), ty1 = Math.floor((y1 - 0.01) / TILE);
  for (let ty = ty0; ty <= ty1; ty++)
    for (let tx = tx0; tx <= tx1; tx++) {
      const ch = tileAt(tx, ty);
      let base = levelAt(tx, ty) * LEVEL;
      // stairs rise one pixel per pixel northwards, up to the next level
      if (isStairs(ch)) base += Math.max(0, Math.min(LEVEL, (ty + 1) * TILE - Math.max(y0, ty * TILE)));
      if (base > h) h = base;
      const kind = LEGEND[ch];
      const standing = kind?.height;
      if (!standing || base + standing <= h) continue;
      const [l, t, r, b] = kind.inset ?? NO_INSET;
      const fx0 = tx * TILE + l, fy0 = ty * TILE + t, fx1 = (tx + 1) * TILE - r, fy1 = (ty + 1) * TILE - b;
      if (x1 > fx0 && x0 < fx1 && y1 > fy0 && y0 < fy1) h = base + standing;
    }
  for (const [ax, ay, bx, by] of TRUNKS) if (x1 > ax && x0 < bx && y1 > ay && y0 < by) return WALL;
  for (const [ax, ay, bx, by, sh] of SOLIDS) if (x1 > ax && x0 < bx && y1 > ay && y0 < by && sh > h) h = sh;
  return h;
}

/** True if any part of the box is over the pond (frozen or not). */
function pondUnder(x0: number, y0: number, x1: number, y1: number): boolean {
  const tx0 = Math.floor(x0 / TILE), tx1 = Math.floor((x1 - 0.01) / TILE);
  const ty0 = Math.floor(y0 / TILE), ty1 = Math.floor((y1 - 0.01) / TILE);
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) if (isPond(tileAt(tx, ty))) return true;
  return false;
}

/** True if any part of the box is over open water (a frozen pond is solid ground). */
export const waterUnder = (x0: number, y0: number, x1: number, y1: number): boolean => !SEASON.frozen && pondUnder(x0, y0, x1, y1);

/** True if a cat standing at (x, y) is out on the ice. */
export const iceAt = (x: number, y: number): boolean => SEASON.frozen && pondUnder(x + FEET.x0, y + FEET.y0, x + FEET.x1, y + FEET.y1);

/** True if a cat standing at (x, y) has a paw in the water. */
export const wetAt = (x: number, y: number): boolean => waterUnder(x + FEET.x0, y + FEET.y0, x + FEET.x1, y + FEET.y1);

/** Surface height under a cat standing at (x, y). */
export const groundAt = (x: number, y: number): number => heightUnder(x + FEET.x0, y + FEET.y0, x + FEET.x1, y + FEET.y1);

/** World position of a tree's trunk base (bottom centre). */
export const trunkBase = (tx: number, ty: number): [number, number] => [tx * TILE + TILE / 2, ty * TILE + TILE - 1];

export function treeTiles(): [number, number][] {
  const out: [number, number][] = [];
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) if (isTree(ROWS[y][x])) out.push([x, y]);
  return out;
}

/** Walkable spawn points on the lawn paths around the middle of the park. */
export function spawnPoints(): [number, number][] {
  const out: [number, number][] = [];
  for (let y = 34; y <= 46; y++)
    for (let x = 30; x <= 48; x++)
      if (groundOf(tileAt(x, y)) === 'path' && levelAt(x, y) === 0) out.push([x * TILE + TILE / 2, y * TILE + TILE - 2]);
  return out;
}

/**
 * Raised ground is drawn shifted up by its height, so a cat standing just
 * north of a cliff can end up behind it. Returns the part of the screen (in
 * world px) where terrain in front covers a body of `w`×`h` px standing at
 * (x, y) with height z, or null if nothing does.
 */
export function terrainCover(x: number, y: number, z: number, w = 16, h = 16): { x0: number; y0: number; x1: number; y1: number } | null {
  const ty = Math.floor(y / TILE);
  const feet = y - z, head = feet - h, left = x - w / 2, right = x + w / 2;
  let c: { x0: number; y0: number; x1: number; y1: number } | null = null;
  for (let tx = Math.floor(left / TILE); tx <= Math.floor((right - 0.01) / TILE); tx++)
    for (let t = ty + 1; t <= ty + MAX_LEVEL + 1; t++) {
      const e = levelAt(tx, t) + (isStairs(tileAt(tx, t)) ? 1 : 0);
      if (!e) continue;
      // the tile's lifted top plus the cliff face hanging below it
      const top = t * TILE - e * LEVEL;
      const bottom = (t + 1) * TILE - levelAt(tx, t + 1) * LEVEL;
      if (top >= feet || bottom <= head) continue;
      const r = { x0: Math.max(left, tx * TILE), y0: Math.max(head, top), x1: Math.min(right, (tx + 1) * TILE), y1: Math.min(feet, bottom) };
      c = c ? { x0: Math.min(c.x0, r.x0), y0: Math.min(c.y0, r.y0), x1: Math.max(c.x1, r.x1), y1: Math.max(c.y1, r.y1) } : r;
    }
  // the shed hides cats behind it the same way
  for (const k of COVERS) {
    if (y >= k.front || k.x0 >= right || k.x1 <= left || k.y0 >= feet || k.y1 <= head) continue;
    const r = { x0: Math.max(left, k.x0), y0: Math.max(head, k.y0), x1: Math.min(right, k.x1), y1: Math.min(feet, k.y1) };
    c = c ? { x0: Math.min(c.x0, r.x0), y0: Math.min(c.y0, r.y0), x1: Math.max(c.x1, r.x1), y1: Math.max(c.y1, r.y1) } : r;
  }
  return c;
}

/**
 * Bounding boxes of the water, split into chunks so each one can be reflected
 * (and skipped when off screen) on its own instead of one map-sized canvas.
 */
export function waterBoxes(chunk = 8): { x: number; y: number; w: number; h: number }[] {
  const out: { x: number; y: number; w: number; h: number }[] = [];
  for (let cy = 0; cy < MAP_H; cy += chunk)
    for (let cx = 0; cx < MAP_W; cx += chunk) {
      let x0 = MAP_W, y0 = MAP_H, x1 = -1, y1 = -1;
      for (let y = cy; y < Math.min(MAP_H, cy + chunk); y++)
        for (let x = cx; x < Math.min(MAP_W, cx + chunk); x++)
          if (isWaterway(ROWS[y][x])) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      if (x1 >= 0) out.push({ x: x0 * TILE, y: y0 * TILE, w: (x1 - x0 + 1) * TILE, h: (y1 - y0 + 1) * TILE });
    }
  return out;
}

/** Bounding box of all the water in world pixels. */
export function pondBounds(): { x: number; y: number; w: number; h: number } {
  let x0 = MAP_W, y0 = MAP_H, x1 = 0, y1 = 0;
  for (let y = 0; y < MAP_H; y++)
    for (let x = 0; x < MAP_W; x++)
      if (isPond(ROWS[y][x])) {
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
  return { x: x0 * TILE, y: y0 * TILE, w: (x1 - x0 + 1) * TILE, h: (y1 - y0 + 1) * TILE };
}

for (const [tx, ty] of treeTiles()) {
  const [x, y] = trunkBase(tx, ty);
  TRUNKS.push([x - 6, y - 5, x + 6, y + 1]);
}

// ---- garden furniture ----
// Things people left in the park: a shed, benches, a picnic table, a bistro
// set, a picnic blanket and a bird bath. Each stands on a patch of plain lawn
// (`tx`, `ty` is its top-left tile); low ones can be jumped onto, the shed can't.

export type FurnitureKind = 'shed' | 'bench' | 'picnic' | 'bistro' | 'blanket' | 'birdbath';

/** Tiles each kind takes up. */
export const FURNITURE_SIZE: Record<FurnitureKind, [number, number]> = {
  shed: [3, 2], bench: [2, 1], picnic: [4, 3], bistro: [3, 2], blanket: [4, 3], birdbath: [1, 1],
};

export { FURNITURE };

/** True on tiles taken by furniture (nothing else grows or stands there). */
export function furnished(tx: number, ty: number): boolean {
  return FURNITURE.some((f) => {
    const [w, h] = FURNITURE_SIZE[f.kind];
    return tx >= f.tx && tx < f.tx + w && ty >= f.ty && ty < f.ty + h;
  });
}

/** Height of the bird bath's rim. */
export const BATH_H = 13;

/** Solid parts of the furniture in world px, relative to the spot's top-left corner, with their height. */
const FURNITURE_SOLIDS: Record<FurnitureKind, [number, number, number, number, number][]> = {
  shed: [[2, 4, 47, 31, WALL]],
  bench: [[2, 8, 30, 14, 7]],
  // back bench, table, front bench
  picnic: [[15, 16, 49, 20, 5], [12, 20, 52, 33, 10], [15, 33, 49, 40, 5]],
  // left chair, table, right chair
  bistro: [[6, 15, 14, 22, 5], [18, 14, 30, 22, 9], [34, 15, 42, 22, 5]],
  // the basket (the blanket itself is flat)
  blanket: [[39, 26, 51, 31, 6]],
  birdbath: [[3, 7, 13, 14, BATH_H]],
};

const SOLIDS: [number, number, number, number, number][] = FURNITURE.flatMap((f) =>
  FURNITURE_SOLIDS[f.kind].map(([x0, y0, x1, y1, h]) => [f.tx * TILE + x0, f.ty * TILE + y0, f.tx * TILE + x1, f.ty * TILE + y1, h] as [number, number, number, number, number]),
);

/** Screen boxes of furniture tall enough to hide a cat, and the ground y of their front. */
export const COVERS: { x0: number; y0: number; x1: number; y1: number; front: number }[] = FURNITURE
  .filter((f) => f.kind === 'shed')
  .map((f) => ({ x0: f.tx * TILE - 1, y0: f.ty * TILE - 25, x1: f.tx * TILE + 49, y1: f.ty * TILE + 31, front: f.ty * TILE + 30 }));

/** Height of the shed's roof ridge, for its shadow. */
const SHED_TALL = 30;

/**
 * How tall whatever stands on the ground at world pixel (x, y) is, above the
 * terrain, for shadows: hedges, bushes, rocks, the fountain, fences and the
 * shed (trees, lanterns, the low furniture and cats cast theirs from their sprites).
 */
export function casterHeight(x: number, y: number): number {
  const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
  const ch = tileAt(tx, ty);
  let h = 0;
  const kind = LEGEND[ch];
  const th = kind?.shadowHeight ?? kind?.height;
  if (th) {
    const [l, t, r, b] = kind.inset ?? NO_INSET;
    const lx = x - tx * TILE, ly = y - ty * TILE;
    if (lx >= l && lx < TILE - r && ly >= t && ly < TILE - b) h = th;
  }
  for (const f of FURNITURE)
    if (f.kind === 'shed') {
      const [x0, y0, x1, y1] = FURNITURE_SOLIDS.shed[0];
      if (x >= f.tx * TILE + x0 && x < f.tx * TILE + x1 && y >= f.ty * TILE + y0 && y < f.ty * TILE + y1) h = SHED_TALL;
    }
  return h;
}

// ---- lanterns ----
// Small lanterns on the grass beside the paths, a good few tiles apart.
const LANTERN_SPACING = 7;

function placeLanterns(): [number, number][] {
  /** Water, stairs, a tree or a fence right next to the tile: no room for a lantern. */
  const crowded = (tx: number, ty: number) => {
    for (let y = ty - 1; y <= ty + 1; y++)
      for (let x = tx - 1; x <= tx + 1; x++) {
        const ch = tileAt(x, y);
        if (isWaterway(ch) || isStairs(ch) || isTree(ch) || LEGEND[ch]?.height === WALL) return true;
      }
    return false;
  };
  const spots: { tx: number; ty: number; dx: number; dy: number; k: number }[] = [];
  for (let ty = 1; ty < MAP_H - 1; ty++)
    for (let tx = 1; tx < MAP_W - 1; tx++) {
      if (groundOf(tileAt(tx, ty)) !== 'lawn' || crowded(tx, ty) || [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => furnished(tx + dx, ty + dy))) continue;
      const side = ([[0, 1], [0, -1], [1, 0], [-1, 0]] as const).find(([dx, dy]) => groundOf(tileAt(tx + dx, ty + dy)) === 'path' && levelAt(tx + dx, ty + dy) === levelAt(tx, ty));
      if (side) spots.push({ tx, ty, dx: side[0], dy: side[1], k: hash2(tx, ty, 61) });
    }
  spots.sort((a, b) => a.k - b.k);
  const out: [number, number][] = [];
  const taken: [number, number][] = [];
  for (const s of spots) {
    if (taken.some(([x, y]) => Math.max(Math.abs(x - s.tx), Math.abs(y - s.ty)) < LANTERN_SPACING)) continue;
    taken.push([s.tx, s.ty]);
    // stand close to the path edge
    out.push([s.tx * TILE + 8 + s.dx * 5, s.ty * TILE + 10 + s.dy * 4]);
  }
  return out;
}

/** Lantern posts (bottom centre), the same for every visitor. */
export const LANTERNS = placeLanterns();
for (const [x, y] of LANTERNS) TRUNKS.push([x - 2, y - 3, x + 2, y + 1]);

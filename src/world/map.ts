// The garden, one character per 16x16 tile.
//   F fence   g gate   . grass   , tall grass   f flowers   p path   B footbridge
//   w water   l lily pad   # low hedge   m tall maze hedge   T tree (trunk)
//   b bush   r rock   o fountain
//
// A spring in the top-left feeds a stream that winds down into the big pond;
// the path from the gate crosses it on a little footbridge. Top-right is a
// hedge labyrinth with a fountain at its heart.

export const TILE = 16;

const ROWS = [
  'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF',
  'F................#######.mmmmmmmmmmmmm.F',
  'F..wlww..b...T...#fffff#.m.m.........m.F',
  'F..wwwwr.........#fffpf#.m.mmm.mmmmm.m.F',
  'F....w..p..fff...#fffpf#...m...m...m.m.F',
  'F.,,,w,.p..fff...####p##.m.m.......m.m.F',
  'F,T,,w,,p............p...m.m.foof....m.F',
  'F,,.,w,,pppppppppppppp...m.mm.....mmmm.F',
  'F,..,w,,,.....Tp.........m.....m.....m.F',
  'F,..,wwwwww....p.b....ff.mmmmmmmmmmm.m.F',
  'F,,,,,,,..w..,,p,.....ff.m...........m.F',
  'F.fff,,...w.,T,p,........mmmmm.mmmmmmm.F',
  'F.fff..T..w,,,.p,,....T,,.....p......b.F',
  'F....,,,,,w,,,,p,,..r.,,b,ppppp.....ff.F',
  'F...,,,.,,w.r,,p,....,,,..p.....wlw,,.,F',
  'F....,,.,,w....p......,,.,p,...rwww,,,,F',
  'F...,,,,,,w..T.pppppppppppp..T...,,,,,,F',
  'F.#####,,,w........p.............,.,,,,F',
  'F.........wwwwwwwwwBwwwwwww.......,,,T,F',
  'F..www..T...fff....p......wwwwwwww.....F',
  'F..wlw......fff....p.b...wwwwwwwwwww...F',
  'F...........#####..p....wwwlwwwwwwwww..F',
  'F.......pppppppppppp...wwwwwwwwwwwwlww.F',
  'F.....ffp.......r..p...wwwwwwwwwwwwwww.F',
  'F.....ffp..www.....p...wwwwwwwwwwlwwww.F',
  'F.,,,b..p..wlw.,ff.ppppwwwwwwwwwwwwwww.F',
  'F,,pppppp.,,,,,,ff.p....wwwwwwlwwwwww..F',
  'F,T,,,,...b.,,,,T..p..T...wwwwwwwww..T.F',
  'F.,,.,....,,,,,,...p...................F',
  'FFFFFFFFFFFFFFFFFFFggFFFFFFFFFFFFFFFFFFF',
];

export const MAP_W = ROWS[0].length;
export const MAP_H = ROWS.length;
for (const [i, r] of ROWS.entries()) if (r.length !== MAP_W) throw new Error(`map row ${i} is ${r.length} wide`);

export const WORLD_W = MAP_W * TILE;
export const WORLD_H = MAP_H * TILE;

export function tileAt(tx: number, ty: number): string {
  if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return 'F';
  return ROWS[ty][tx];
}

// ---- height map ----
// Every tile has a surface height in pixels. Cats can walk onto surfaces no
// higher than they currently are, so low obstacles can be reached by jumping.
export const WALL = 99;

// water is flat but special: cats won't walk in, though they can jump in (see waterUnder)
// maze hedges are taller than a jump (~14px), so the labyrinth can't be hopped over
const HEIGHT: Record<string, number> = { F: WALL, g: WALL, m: 20, '#': 8, b: 7, o: 6, r: 5 };
/** Footprint insets [left, top, right, bottom] for objects smaller than their tile. */
const INSET: Record<string, [number, number, number, number]> = { b: [1, 2, 1, 1], r: [1, 4, 1, 2], o: [0, 1, 0, 1] };

/** The cat's feet box, relative to its (x, y) = bottom centre. */
export const FEET = { x0: -5, x1: 5, y0: -5, y1: 0 };

/** Tree trunks block movement only where they meet the ground. */
const TRUNKS: [number, number, number, number][] = [];

/** Highest surface under a world-space box. */
export function heightUnder(x0: number, y0: number, x1: number, y1: number): number {
  let h = 0;
  const tx0 = Math.floor(x0 / TILE), tx1 = Math.floor((x1 - 0.01) / TILE);
  const ty0 = Math.floor(y0 / TILE), ty1 = Math.floor((y1 - 0.01) / TILE);
  for (let ty = ty0; ty <= ty1; ty++)
    for (let tx = tx0; tx <= tx1; tx++) {
      const ch = tileAt(tx, ty);
      const th = HEIGHT[ch];
      if (!th || th <= h) continue;
      const [l, t, r, b] = INSET[ch] ?? [0, 0, 0, 0];
      const fx0 = tx * TILE + l, fy0 = ty * TILE + t, fx1 = (tx + 1) * TILE - r, fy1 = (ty + 1) * TILE - b;
      if (x1 > fx0 && x0 < fx1 && y1 > fy0 && y0 < fy1) h = th;
    }
  for (const [ax, ay, bx, by] of TRUNKS) if (x1 > ax && x0 < bx && y1 > ay && y0 < by) return WALL;
  return h;
}

/** True if any part of the box is over the pond. */
export function waterUnder(x0: number, y0: number, x1: number, y1: number): boolean {
  const tx0 = Math.floor(x0 / TILE), tx1 = Math.floor((x1 - 0.01) / TILE);
  const ty0 = Math.floor(y0 / TILE), ty1 = Math.floor((y1 - 0.01) / TILE);
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) if ('wl'.includes(tileAt(tx, ty))) return true;
  return false;
}

/** True if a cat standing at (x, y) has a paw in the water. */
export const wetAt = (x: number, y: number): boolean => waterUnder(x + FEET.x0, y + FEET.y0, x + FEET.x1, y + FEET.y1);

/** Surface height under a cat standing at (x, y). */
export const groundAt = (x: number, y: number): number => heightUnder(x + FEET.x0, y + FEET.y0, x + FEET.x1, y + FEET.y1);

/** World position of a tree's trunk base (bottom centre). */
export const trunkBase = (tx: number, ty: number): [number, number] => [tx * TILE + TILE / 2, ty * TILE + TILE - 1];

export function treeTiles(): [number, number][] {
  const out: [number, number][] = [];
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) if (ROWS[y][x] === 'T') out.push([x, y]);
  return out;
}

/** Walkable spawn points on the paths in the middle of the garden. */
export function spawnPoints(): [number, number][] {
  const out: [number, number][] = [];
  for (let y = 12; y <= 17; y++)
    for (let x = 14; x <= 27; x++) if (tileAt(x, y) === 'p') out.push([x * TILE + TILE / 2, y * TILE + TILE - 2]);
  return out;
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
          if ('wlB'.includes(ROWS[y][x])) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      if (x1 >= 0) out.push({ x: x0 * TILE, y: y0 * TILE, w: (x1 - x0 + 1) * TILE, h: (y1 - y0 + 1) * TILE });
    }
  return out;
}

/** Bounding box of all the water in world pixels. */
export function pondBounds(): { x: number; y: number; w: number; h: number } {
  let x0 = MAP_W, y0 = MAP_H, x1 = 0, y1 = 0;
  for (let y = 0; y < MAP_H; y++)
    for (let x = 0; x < MAP_W; x++)
      if (ROWS[y][x] === 'w' || ROWS[y][x] === 'l') {
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
  return { x: x0 * TILE, y: y0 * TILE, w: (x1 - x0 + 1) * TILE, h: (y1 - y0 + 1) * TILE };
}

for (const [tx, ty] of treeTiles()) {
  const [x, y] = trunkBase(tx, ty);
  TRUNKS.push([x - 6, y - 5, x + 6, y + 1]);
}

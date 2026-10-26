// The garden, one character per 16x16 tile.
//   F fence   g gate   . grass   , tall grass   f flowers   p path
//   w water   l lily pad   # hedge   T tree (trunk)   b bush   r rock   o fountain

export const TILE = 16;

const L = (a: string, m: string, r: string) => 'F' + a + m + r + 'F';

const ROWS = [
  'F'.repeat(40),
  L('..,,,..b..,,', ',,,,,....,,,,,', ',,..b...,,,.'),
  L('.T...T....T.', '##############', '.T...T...T..'),
  L('............', '#ffffffffffff#', '............'),
  L(',,,.ff...,,.', '#ffffffffffff#', '.,,...ff.,,,'),
  L(',,,..bb..,,.', '#ffff....ffff#', '.,,..bb..,,,'),
  L('.,,.......,.', '#ffff.oo.ffff#', '.,..........'),
  L('..T..r....T.', '#ffff....ffff#', '.T....r..T..'),
  L('.......ff...', '######..######', '...ff.......'),
  L(',,...b......', '..ff..pp..ff..', '......b..,,.'),
  L('...b....T...', '..ff..pp..ff..', '..T.....b...'),
  L('.,,.........', '.f.pppppppp.f.', '.........,,.'),
  L('.r..ff......', '...pppppppp...', '......ff..r.'),
  L('.ppppppppppp', 'pppppppppppppp', 'ppppppppppp.'),
  L('.ppppppppppp', 'pppppppppppppp', 'ppppppppppp.'),
  L('..,,.bff....', '...pppppppp...', '....ffb.....'),
  L('.,,,..T....T', '.f.pppppppp.f.', '..T...T...,.'),
  L('.,,.........', '..ff..pp..ff..', '...........,'),
  L('..#########.', '......pp......', '...wwwwww...'),
  L('..#fffffff#.', '..,...pp......', '.wwwwwwwwww.'),
  L('..#fffffff#.', '.,,...pp..wwww', 'wwwwwwwwwww.'),
  L('..#fffffff#.', ',,,...pp.wwwww', 'wwwlwwwwwww.'),
  L('..#fffffff#.', '.,....pp.wwwww', 'wwwwwwwlww..'),
  L('..#ff...ff#.', '......pp..wwww', 'wlwwwwwwww,.'),
  L('..###...###.', '..b...pp...www', 'wwwwwwwww.,.'),
  L('.,..ff..,...', '.f....pp....ww', 'wwwwwww..,,.'),
  L('.T....b...T.', '..T...pp..T...', '.r..bb...T..'),
  L('..,,,,..ff..', '..f...pp...f..', '..ff....,,,.'),
  L('.,,,,,,..b..', '......pp......', '.......,,,,.'),
  'F'.repeat(19) + 'gg' + 'F'.repeat(19),
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

const HEIGHT: Record<string, number> = { F: WALL, g: WALL, w: WALL, l: WALL, '#': 8, b: 7, o: 6, r: 5 };
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

/** Surface height under a cat standing at (x, y). */
export const groundAt = (x: number, y: number): number => heightUnder(x + FEET.x0, y + FEET.y0, x + FEET.x1, y + FEET.y1);

/** World position of a tree's trunk base (bottom centre). */
export const trunkBase = (tx: number, ty: number): [number, number] => [tx * TILE + TILE / 2, ty * TILE + TILE - 1];

export function treeTiles(): [number, number][] {
  const out: [number, number][] = [];
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) if (ROWS[y][x] === 'T') out.push([x, y]);
  return out;
}

/** Walkable spawn points around the central plaza. */
export function spawnPoints(): [number, number][] {
  const out: [number, number][] = [];
  for (let y = 11; y <= 16; y++)
    for (let x = 16; x <= 23; x++) if (tileAt(x, y) === 'p') out.push([x * TILE + TILE / 2, y * TILE + TILE - 2]);
  return out;
}

/** Bounding box of the pond in world pixels. */
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

// The garden, one character per 16x16 tile.
//   F fence   g gate   . grass   , tall grass   f flowers   p path
//   w water   l lily pad   # hedge   T tree (trunk)   b bush   r rock   o fountain

export const TILE = 16;

const L = (a: string, m: string, r: string) => 'F' + a + m + r + 'F';

const ROWS = [
  'F'.repeat(40),
  L('..,,,.......', '..............', '.,,.......,,'),
  L('.T....T.....', '##############', '....T....T..'),
  L('............', '#ffffffffffff#', '............'),
  L(',,..........', '#ffffffffffff#', '..........,,'),
  L(',,,...b.....', '#ffff....ffff#', '.....b....,,'),
  L('.,,.........', '#ffff.oo.ffff#', '............'),
  L('....r.......', '#ffff....ffff#', '......r.....'),
  L('.T..........', '######..######', '..........T.'),
  L('............', '......pp......', '............'),
  L('...b....T...', '......pp......', '..T.....b...'),
  L('............', '...pppppppp...', '............'),
  L('.r..........', '...pppppppp...', '..........r.'),
  L('.ppppppppppp', 'pppppppppppppp', 'ppppppppppp.'),
  L('.ppppppppppp', 'pppppppppppppp', 'ppppppppppp.'),
  L('..,,........', '...pppppppp...', '............'),
  L('.,,,..T.....', '...pppppppp...', '......T.....'),
  L('............', '......pp......', '............'),
  L('..#########.', '......pp......', '...wwwwww...'),
  L('..#fffffff#.', '......pp......', '.wwwwwwwwww.'),
  L('..#fffffff#.', '......pp..wwww', 'wwwwwwwwwww.'),
  L('..#fffffff#.', '......pp.wwwww', 'wwwlwwwwwww.'),
  L('..#fffffff#.', '......pp.wwwww', 'wwwwwwwlww..'),
  L('..#ff...ff#.', '......pp..wwww', 'wlwwwwwwww..'),
  L('..###...###.', '......pp...www', 'wwwwwwwww...'),
  L('............', '......pp....ww', 'wwwwwww.....'),
  L('.T....b...T.', '......pp......', '.r.......T..'),
  L('..,,,,......', '......pp......', '........,,,.'),
  L('.,,,,,,.....', '......pp......', '.......,,,,.'),
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

const SOLID = new Set(['F', 'g', 'w', 'l', '#', 'T', 'b', 'r', 'o']);

export const isSolidTile = (tx: number, ty: number): boolean => SOLID.has(tileAt(tx, ty));

/** True if the world-space box overlaps any solid tile. */
export function boxHitsSolid(x0: number, y0: number, x1: number, y1: number): boolean {
  const tx0 = Math.floor(x0 / TILE), tx1 = Math.floor((x1 - 0.01) / TILE);
  const ty0 = Math.floor(y0 / TILE), ty1 = Math.floor((y1 - 0.01) / TILE);
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) if (isSolidTile(tx, ty)) return true;
  return false;
}

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

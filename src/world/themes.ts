// Themed zones: now and then a part of the park is given over to something
// (a carnival; later a farmer's market, a ren-fair …). The open lawn left
// once the fixed landscape, the maze and the tree house are in place is cut
// into cells round points scattered by the garden's seed, each tile going to
// the point it is the fewest steps from (a Voronoi diagram, measured on foot,
// so a cell never reaches across a river, a path or a terrace edge). A few
// of those cells become zones: each clears its cell for its own floor
// (nothing else grows there, it's gravelled like the paths) and is then filled with as much of its theme
// as fits (game/…, later). Like everything else in the layout it follows
// from the seed, so every cat in the garden has the same zones.

type Pt = [number, number];

/** What a zone is given over to. */
export type Theme = 'carnival';

/** Each theme, and how likely a garden is to have one. */
export const THEMES: { theme: Theme; chance: number }[] = [{ theme: 'carnival', chance: 0.55 }];

/** The most zones a garden has. */
export const MAX_ZONES = 3;

/** The floor a zone is laid with (legend.ts). */
export const ZONE_FLOOR = 'Z';

export interface ThemedZone {
  theme: Theme;
  /** The point its cell grew from. */
  site: Pt;
  /** Its tiles. */
  tiles: Pt[];
  /** The box round them: [x0, y0, x1, y1], inclusive. */
  box: [number, number, number, number];
}

/** Sites are at least this far apart (tiles), and a cell reaches at most this many steps from its site. */
const SPACING = 12, REACH = 10;
/** A cell this big at least makes a zone (tiles; and this wide and tall). */
const MIN_TILES = 70, MIN_SIDE = 7;
/** Between two zones, at least this many tiles. */
const APART = 4;

/**
 * Cut the open lawn (`.`) of the park `T` (elevations `E`) into cells and turn a few of them into
 * zones, laying their floor in `T`. `order` is every tile, shuffled by the seed; `hash(x, y, salt)`
 * the seed's random numbers.
 */
export function carveZones(T: string[][], E: number[][], order: Pt[], hash: (x: number, y: number, s: number) => number): ThemedZone[] {
  const H = T.length, W = T[0].length;
  const free = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && T[y][x] === '.';

  // the sites, scattered over the lawn
  const sites: Pt[] = [];
  for (const [x, y] of order)
    if (free(x, y) && !sites.some(([sx, sy]) => Math.max(Math.abs(sx - x), Math.abs(sy - y)) < SPACING)) sites.push([x, y]);

  // every tile to the site the fewest steps away (all sites spreading at once, a step at a time)
  const cell = Array.from({ length: H }, () => new Array<number>(W).fill(-1));
  let front: Pt[] = sites.map(([x, y], i) => {
    cell[y][x] = i;
    return [x, y];
  });
  for (let step = 0; step < REACH && front.length; step++) {
    const next: Pt[] = [];
    for (const [x, y] of front)
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (!free(nx, ny) || cell[ny][nx] >= 0 || E[ny][nx] !== E[y][x]) continue;
        cell[ny][nx] = cell[y][x];
        next.push([nx, ny]);
      }
    front = next;
  }

  // each cell's tiles, without its thin bits (a strip a tile wide is no place for anything)
  const cells: Pt[][] = sites.map(() => []);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (cell[y][x] >= 0) cells[cell[y][x]].push([x, y]);
  const tidy = (i: number): Pt[] => {
    let tiles = cells[i];
    for (let pass = 0; pass < 2; pass++) {
      const has = new Set(tiles.map(([x, y]) => y * W + x));
      tiles = tiles.filter(([x, y]) => [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => has.has((y + dy) * W + x + dx)).length >= 2);
    }
    return biggestPart(tiles, W);
  };

  // which themes this garden has, and a cell for each
  const themes = THEMES.filter((t, i) => hash(i, 0, 201) < t.chance).slice(0, MAX_ZONES);
  const zones: ThemedZone[] = [];
  const candidates = sites.map((_, i) => i).sort((a, b) => hash(a, 1, 202) - hash(b, 1, 202));
  for (const { theme } of themes)
    for (const i of candidates) {
      const tiles = tidy(i);
      if (tiles.length < MIN_TILES) continue;
      const box = boxOf(tiles);
      if (box[2] - box[0] + 1 < MIN_SIDE || box[3] - box[1] + 1 < MIN_SIDE) continue;
      if (zones.some((z) => z.site === sites[i] || near(z.tiles, tiles, APART))) continue;
      zones.push({ theme, site: sites[i], tiles, box });
      break;
    }
  for (const z of zones) for (const [x, y] of z.tiles) T[y][x] = ZONE_FLOOR;
  return zones;
}

function boxOf(tiles: Pt[]): [number, number, number, number] {
  const xs = tiles.map((t) => t[0]), ys = tiles.map((t) => t[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** Are any two tiles of `a` and `b` within `d` of each other? */
function near(a: Pt[], b: Pt[], d: number): boolean {
  const [ax0, ay0, ax1, ay1] = boxOf(a), [bx0, by0, bx1, by1] = boxOf(b);
  if (ax0 - d > bx1 || bx0 - d > ax1 || ay0 - d > by1 || by0 - d > ay1) return false;
  return a.some(([ax, ay]) => b.some(([bx, by]) => Math.max(Math.abs(ax - bx), Math.abs(ay - by)) <= d));
}

/** The largest piece of `tiles` that hangs together (side by side). */
function biggestPart(tiles: Pt[], W: number): Pt[] {
  const left = new Map(tiles.map((t) => [t[1] * W + t[0], t]));
  let best: Pt[] = [];
  while (left.size) {
    const [k, start] = left.entries().next().value!;
    left.delete(k);
    const part: Pt[] = [start];
    for (let i = 0; i < part.length; i++) {
      const [x, y] = part[i];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const t = left.get((y + dy) * W + x + dx);
        if (!t) continue;
        left.delete((y + dy) * W + x + dx);
        part.push(t);
      }
    }
    if (part.length > best.length) best = part;
  }
  return best;
}

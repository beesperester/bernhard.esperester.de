// Themed zones: now and then a part of the park is given over to something
// (a funfair; later a farmer's market, a ren-fair …). The open lawn left
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
export type Theme = 'funfair';

/** Each theme, and how likely a garden is to have one. */
export const THEMES: { theme: Theme; chance: number }[] = [{ theme: 'funfair', chance: 0.55 }];

/** The most zones a garden has. */
export const MAX_ZONES = 3;

/** The floor a zone is laid with (legend.ts). */
export const ZONE_FLOOR = 'Z';

/** What a zone is filled with: they stand in the park like the furniture (layout.ts, map.ts). */
export type ZonePiece = 'tent' | 'booth' | 'pole';

/** Tiles each piece takes up. */
export const PIECE_SIZE: Record<ZonePiece, [number, number]> = { tent: [4, 3], booth: [3, 2], pole: [1, 1] };

/** What each theme puts up, biggest first, and at most how many of each (as many as fit). */
const FILL: Record<Theme, [Exclude<ZonePiece, 'pole'>, number][]> = {
  funfair: [['tent', 2], ['booth', 3]],
};
/** Themes with bunting round the edge: on poles this far apart (tiles). */
const POLES: Partial<Record<Theme, number>> = { funfair: 4 };

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

/**
 * Fill a zone with its pieces: the big ones inside it with a tile of floor all round each (to walk
 * between them), as many as fit; poles for its bunting round its edge.
 */
export function furnishZone(z: ThemedZone, order: Pt[], W: number): { kind: ZonePiece; tx: number; ty: number }[] {
  const has = new Set(z.tiles.map(([x, y]) => y * W + x));
  const taken = new Set<number>();
  const out: { kind: ZonePiece; tx: number; ty: number }[] = [];
  const inZone = order.filter(([x, y]) => has.has(y * W + x));
  for (const [kind, most] of FILL[z.theme]) {
    const [w, h] = PIECE_SIZE[kind];
    let placed = 0;
    for (const [x, y] of inZone) {
      if (placed >= most) break;
      let ok = true;
      // (the piece and a tile round it all floor; the piece clear of the others by a tile at least)
      for (let j = -1; j <= h && ok; j++)
        for (let i = -1; i <= w && ok; i++) {
          const k = (y + j) * W + x + i, inner = i >= 0 && j >= 0 && i < w && j < h;
          if (!has.has(k)) ok = false;
          else if (inner && [-1, 0, 1].some((dy) => [-1, 0, 1].some((dx) => taken.has(k + dy * W + dx)))) ok = false;
        }
      if (!ok) continue;
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) taken.add((y + j) * W + x + i);
      out.push({ kind, tx: x, ty: y });
      placed++;
    }
  }
  // the poles: on the zone's edge, spaced out
  const apart = POLES[z.theme];
  if (apart) {
    const edge = inZone.filter(([x, y]) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !has.has((y + dy) * W + x + dx)));
    const poles: Pt[] = [];
    for (const [x, y] of edge) {
      if (taken.has(y * W + x) || poles.some(([px, py]) => Math.max(Math.abs(px - x), Math.abs(py - y)) < apart)) continue;
      poles.push([x, y]);
      taken.add(y * W + x);
      out.push({ kind: 'pole', tx: x, ty: y });
    }
  }
  return out;
}

/** Which poles the bunting hangs between: each to its nearest one or two neighbours, over the zone's own floor. */
export function buntingStrings(poles: Pt[], floor: (x: number, y: number) => boolean, reach = 7): [number, number][] {
  const pairs = new Set<string>(), out: [number, number][] = [];
  poles.forEach(([x, y], i) => {
    const near = poles
      .map(([px, py], j) => ({ j, d: Math.hypot(px - x, py - y) }))
      .filter(({ j, d }) => j !== i && d <= reach)
      .sort((a, b) => a.d - b.d)
      .slice(0, 2);
    for (const { j } of near) {
      const [a, b] = i < j ? [i, j] : [j, i];
      // (hanging over the zone, not across the lawn outside it)
      const mx = Math.round((poles[a][0] + poles[b][0]) / 2), my = Math.round((poles[a][1] + poles[b][1]) / 2);
      if (pairs.has(`${a},${b}`) || !floor(mx, my)) continue;
      pairs.add(`${a},${b}`);
      out.push([a, b]);
    }
  });
  return out;
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

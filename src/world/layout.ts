// What grows in the park. The first cat into an empty garden picks a seed;
// from it park.ts lays out the landscape (garden.ts: the water, the paths and
// bridges, the hills and their stairs, the landmark follies), and this lays
// out the rest on its open ground: lawns and
// meadows, flower beds and their box hedges, the maze, the tree house, the
// themed zones (themes.ts: a funfair, say), the trees, bushes and rocks, and
// the furniture. Every cat that joins is handed
// the seed (net.ts) and lays out the same garden; when the last cat leaves,
// the garden is gone, and the next one is a new one.
//
// Trees grow thickest in the woods (ZONES), and hardly at all out on the
// open meadows. The woods are pine, leafy or mixed by a slow field over the
// park (a wood can turn from one to the other), and deep in some of them lie
// the secret clearings (park.ts): open, flowery, walled round by trees, with
// a big old tree (or a standing stone) in the middle. Nothing grows or stands right beside the railway (track.ts):
// the trains run there.

import { hash2 } from '../art/raster.ts';
import { TEMPLATE_TRUNK, paintedKind } from './templates.ts';
import { BASE, CLEARINGS, ELEV, LANDMARK_SPOTS, ZONES } from './garden.ts';
import { LANDMARK_SIZE } from './landmarks.ts';
import { trackside } from './track.ts';
import { PIECE_SIZE, carveZones, furnishZone, type ThemedZone, type ZonePiece } from './themes.ts';

type Pt = [number, number];

/** The garden furniture, and what the themed zones put up (themes.ts). */
export type FurnitureKind = 'bench' | 'picnic' | 'bistro' | 'blanket' | 'birdbath' | 'box' | 'pump' | 'catnip' | 'bed' | 'barrow' | 'hotel' | Woodland | ZonePiece;

/** What lies about in the woods: fallen logs, old stumps, and the standing stones in some clearings. */
export type Woodland = 'log' | 'stump' | 'stone';

/** Tiles each kind of furniture takes up. */
export const FURNITURE_SIZE: Record<FurnitureKind, [number, number]> = {
  bench: [2, 1], picnic: [4, 3], bistro: [3, 2], blanket: [4, 3], birdbath: [1, 1],
  // (the pump's puddle takes the tile to its right)
  box: [2, 1], pump: [2, 1], catnip: [2, 1], bed: [3, 2], barrow: [2, 1], hotel: [1, 1],
  log: [3, 1], stump: [1, 1], stone: [2, 2],
  ...PIECE_SIZE,
};

/** How many of each piece a garden gets, in the order they are placed. */
const WANT: [FurnitureKind, number][] = [
  ['picnic', 8], ['blanket', 8], ['bistro', 6], ['birdbath', 12], ['bench', 40],
  ['bed', 6], ['pump', 6], ['hotel', 8], ['catnip', 10], ['barrow', 6], ['box', 10],
];

/** Below a clearing no tree grows for this many tiles past its edge (its crown would cover the clearing). */
const APRON = 6;

/** How many of each lie about in the woods. */
const WOODLAND: [Woodland, number][] = [['log', 70], ['stump', 90]];

const MAZE_W = 17, MAZE_H = 13;

export interface Layout {
  /** The whole park, one character per tile (see legend.ts). */
  rows: string[];
  /** Furniture by its top-left tile. */
  furniture: { kind: FurnitureKind; tx: number; ty: number }[];
  /** The themed zones (a funfair, say): their tiles are laid with their own floor in `rows`. */
  zones: ThemedZone[];
  /** What the woods are, one character per tile: 'p' pine, 'l' leafy, 'm' mixed; '.' out of the woods. */
  biomes: string[];
}

export type Biome = 'pine' | 'leafy' | 'mixed';
const BIOME_CHAR: Record<Biome, string> = { pine: 'p', leafy: 'l', mixed: 'm' };
/** A pine's share of the trees in each sort of wood (and out in the parkland). */
const PINES: Record<Biome | 'park', number> = { pine: 0.94, leafy: 0.03, mixed: 0.45, park: 0.15 };

/** The garden that grows from `seed`. */
export function layOut(seed: number): Layout {
  const H = BASE.length, W = BASE[0].length;
  const salt = (s: number) => Math.imul(s + 1, 0x9e3779b1) ^ Math.imul(seed | 0, 0x85ebca6b);
  const hash = (x: number, y: number, s: number) => hash2(x, y, salt(s));
  /** Smooth value noise, 0..1, blobs about `size` tiles across. */
  const noise = (x: number, y: number, size: number, s: number) => {
    const fx = x / size, fy = y / size, ix = Math.floor(fx), iy = Math.floor(fy), u = fx - ix, v = fy - iy;
    const sm = (t: number) => t * t * (3 - 2 * t);
    const a = hash(ix, iy, s), b = hash(ix + 1, iy, s), c = hash(ix, iy + 1, s), d = hash(ix + 1, iy + 1, s);
    return (a + (b - a) * sm(u)) * (1 - sm(v)) + (c + (d - c) * sm(u)) * sm(v);
  };

  const T = BASE.map((r) => [...r]);
  // the woods' sorts: a slow field (a wood turns pine on one side, leafy on the other, mixed between)
  const biomes = ZONES.map((r, y) => [...r].map((z, x) => {
    if (z !== 'g') return '.';
    const b = noise(x, y, 30, 81) * 0.75 + noise(x, y, 9, 82) * 0.25;
    return BIOME_CHAR[b < 0.42 ? 'pine' : b > 0.58 ? 'leafy' : 'mixed'];
  }));
  const biomeOf = (x: number, y: number): Biome | 'park' => ({ p: 'pine', l: 'leafy', m: 'mixed' } as const)[biomes[y]?.[x] as 'p'] ?? 'park';
  const E = ELEV.map((r) => [...r].map(Number));
  const inMap = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H;
  const at = (x: number, y: number) => (inMap(x, y) ? T[y][x] : 'F');
  const zone = (x: number, y: number) => (inMap(x, y) ? ZONES[y][x] : 'o');
  const open = (x: number, y: number) => at(x, y) === '.';
  const fillRect = (x0: number, y0: number, w: number, h: number, ch: string) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) T[y][x] = ch;
  };
  /** Open, flat ground (level 0) over the whole box and `margin` tiles round it. */
  const flatFree = (x0: number, y0: number, w: number, h: number, margin: number) => {
    for (let y = y0 - margin; y < y0 + h + margin; y++)
      for (let x = x0 - margin; x < x0 + w + margin; x++) if (!open(x, y) || E[y][x] !== 0) return false;
    return true;
  };
  /** No water, path, bridge, stairs or fence within r tiles. */
  const clear = (x: number, y: number, r: number) => {
    for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) if ('~wBpFlS'.includes(at(x + i, y + j))) return false;
    return true;
  };
  const nearest = (from: Pt, fits: (x: number, y: number) => boolean, max = 30): Pt | null => {
    for (let r = 0; r <= max; r++)
      for (let j = -r; j <= r; j++)
        for (let i = -r; i <= r; i++)
          if (Math.max(Math.abs(i), Math.abs(j)) === r && fits(from[0] + i, from[1] + j)) return [from[0] + i, from[1] + j];
    return null;
  };
  /** Every tile, shuffled by the seed: the order things are tried in. */
  const order: Pt[] = [];
  for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) order.push([x, y]);
  const rank = new Map<number, number>();
  for (const [x, y] of order) rank.set(y * W + x, hash(x, y, 61));
  order.sort((a, b) => rank.get(a[1] * W + a[0])! - rank.get(b[1] * W + b[0])!);
  // the follies' footprints are taken (they are lawn underneath, put back at the end)
  for (const l of LANDMARK_SPOTS) {
    const [w, h] = LANDMARK_SIZE[l.kind];
    for (let y = l.ty; y < l.ty + h; y++) for (let x = l.tx; x < l.tx + w; x++) if (T[y][x] === '.') T[y][x] = 'L';
  }
  // the clearings are kept open (lawn again at the end, flowery: art/flora.ts), the wood round them thick
  const ring = new Map<number, number>();
  for (const c of CLEARINGS) {
    const R = c.r + 3;
    for (let j = -R; j <= R; j++)
      for (let i = -R; i <= R; i++) {
        const x = c.tx + i, y = c.ty + j, d = Math.hypot(i, j * 1.15);
        if (!inMap(x, y) || T[y][x] !== '.') continue;
        if (d <= c.r) T[y][x] = 'C';
        else if (d <= R) ring.set(y * W + x, 1);
      }
  }
  // and the lawn beside the railway is kept clear for the trains (plain lawn again at the end; cats walk there)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (T[y][x] === '.' && trackside(x, y)) T[y][x] = 'K';

  // the maze, somewhere in the parks: a hedge labyrinth with the fountain in the middle
  /** Its box, and two tiles round it (no tree grows there: it would stand in its ways or its doors). */
  let maze: [number, number, number, number] | null = null;
  {
    const fits = ([x, y]: Pt) => flatFree(x, y, MAZE_W, MAZE_H, 1);
    const spot = order.find((p) => zone(p[0] + 8, p[1] + 6) === 'g' && fits(p)) ?? order.find(fits);
    if (spot) {
      const [mx, my] = spot;
      maze = [mx - 2, my - 2, mx + MAZE_W + 2, my + MAZE_H + 2];
      fillRect(mx, my, MAZE_W, MAZE_H, 'm');
      const cw = (MAZE_W - 1) / 2, ch = (MAZE_H - 1) / 2;
      const seen = new Set<number>([0]);
      const stack: Pt[] = [[0, 0]];
      T[my + 1][mx + 1] = '.';
      let n = 1;
      while (stack.length) {
        const [cx, cy] = stack[stack.length - 1];
        const next = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as Pt[])
          .map(([dx, dy]): Pt => [cx + dx, cy + dy])
          .filter(([x, y]) => x >= 0 && y >= 0 && x < cw && y < ch && !seen.has(y * cw + x));
        if (!next.length) {
          stack.pop();
          continue;
        }
        const [nx, ny] = next[Math.floor(hash(cx, cy, 77 + n++) * next.length)];
        seen.add(ny * cw + nx);
        T[my + 1 + cy + ny][mx + 1 + cx + nx] = '.';
        T[my + 1 + 2 * ny][mx + 1 + 2 * nx] = '.';
        stack.push([nx, ny]);
      }
      // the fountain court in the middle, and a way in at the bottom (and out at the top)
      const fx = mx + Math.floor(MAZE_W / 2) - 2, fy = my + Math.floor(MAZE_H / 2) - 1;
      fillRect(fx - 1, fy, 6, 3, '.');
      T[fy + 1][fx] = 'f'; T[fy + 1][fx + 1] = 'o'; T[fy + 1][fx + 2] = 'o'; T[fy + 1][fx + 3] = 'f';
      T[my + MAZE_H - 1][mx + 1 + 2 * Math.floor(cw / 2)] = '.';
      T[my][mx + 1 + 2 * Math.floor(cw / 2)] = '.';
    }
  }

  // the tree house, in a park (not for now: it's to be drawn anew with the big trees)
  if (TREE_HOUSE) {
    const fits = ([x, y]: Pt) => clear(x, y, 3) && flatFree(x - 2, y - 1, 5, 3, 0);
    const spot = order.find((p) => zone(...p) === 'g' && fits(p)) ?? order.find(fits);
    if (spot) T[spot[1]][spot[0]] = 'H';
  }

  // the themed zones, each taking a cell of the lawn left (nothing else grows there)
  const zones = carveZones(T, E, order, hash);
  // and filled with what they're about (a funfair's tents and booths, its bunting's poles)
  const furniture: Layout['furniture'] = zones.flatMap((z) => furnishZone(z, order, W, hash));

  // meadows and flower beds
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      if (!open(x, y)) continue;
      const n = noise(x, y, 7, 3);
      if (zone(x, y) === 'o' ? n > 0.35 : n > (zone(x, y) === 'g' ? 0.6 : 0.64)) T[y][x] = ',';
    }
  for (let y = 2; y < H - 3; y++)
    for (let x = 2; x < W - 3; x++) {
      if (zone(x, y) === 'o' || hash(x, y, 41) > 0.012) continue;
      // a bed beside a path
      if (![[0, -1], [0, 2], [-1, 0], [3, 0]].some(([dx, dy]) => at(x + dx, y + dy) === 'p')) continue;
      const w = 2 + Math.floor(hash(x, y, 42) * 2);
      let ok = true;
      for (let j = 0; j < 2; j++) for (let i = 0; i < w; i++) if (!'.,'.includes(at(x + i, y + j)) || E[y + j][x + i] !== E[y][x]) ok = false;
      if (!ok) continue;
      fillRect(x, y, w, 2, 'f');
      // half of them edged with low box hedge on the side away from the path
      if (hash(x, y, 43) < 0.5) continue;
      const row = at(x, y - 1) === 'p' ? y + 2 : at(x, y + 2) === 'p' ? y - 1 : -1;
      if (row >= 0) for (let i = -1; i <= w; i++) if ('.,'.includes(at(x + i, row)) && E[row][x + i] === E[y][x]) T[row][x + i] = '#';
    }

  // trees: thick in the woods, here and there in the parkland, few out on the meadows; some pines
  const trees: Pt[] = [];
  /** Trees by their tile, to keep the next one off them. */
  const treeAt = new Map<number, number>();
  // (each tree keeps room round it as big as it grows, the next tree's room besides: across more than in depth)
  const crowded = (x: number, y: number, wood: boolean) => {
    const r = (wood ? WOOD_ROOM : TREE_ROOM)[roomSizeAt(x, y)], R = r + TREE_ROOM[2];
    for (let j = -R; j <= R; j++)
      for (let i = -R; i <= R; i++) {
        const other = treeAt.get((y + j) * W + x + i);
        if (other !== undefined && Math.abs(i) < r + other && Math.abs(j) < Math.ceil((r + other) * 0.6)) return true;
      }
    return false;
  };
  // the big old tree in the middle of a clearing (or its standing stone: furniture)
  for (const c of CLEARINGS) {
    if (c.heart !== 'tree') continue;
    CHAMPIONS.add(c.ty * 4096 + c.tx);
    T[c.ty][c.tx] = biomeOf(c.tx, c.ty) === 'pine' ? 'P' : 'T';
    trees.push([c.tx, c.ty]);
    treeAt.set(c.ty * W + c.tx, TREE_ROOM[2]);
  }
  for (const [x, y] of order) {
    if (!'.,'.includes(at(x, y))) continue;
    // room round the trunk: nothing but grass beside it, and not at a terrace edge or the foot of stairs
    if ([[1, 0], [-1, 0], [0, 1], [0, -1], [0, 2]].some(([dx, dy]) => !'.,f'.includes(at(x + dx, y + dy)) || E[y + dy]?.[x + dx] !== E[y][x])) continue;
    if (E[y - 1][x] !== E[y][x] || at(x, y + 1) === 'S') continue;
    if (maze && x >= maze[0] && x < maze[2] && y >= maze[1] && y < maze[3]) continue;
    // (nor just below a clearing, where its crown would hang over the clearing and hide it: thickets wall it there)
    if (CLEARINGS.some((c) => Math.abs(x - c.tx) <= c.r + 2 && y > c.ty && y - c.ty <= c.r + APRON)) continue;
    const z = zone(x, y), wall = ring.has(y * W + x);
    const p = wall ? 0.45 : z === 'g' ? 0.11 : z === 'o' ? 0.015 : 0.03 + 0.2 * Math.max(0, noise(x, y, 9, 7) - 0.6) * 4;
    if (hash(x, y, 62) > p) continue;
    if (crowded(x, y, z === 'g' || wall)) continue;
    if (LANDMARK_SPOTS.some((s) => x >= s.tx - 3 && x < s.tx + LANDMARK_SIZE[s.kind][0] + 3 && y >= s.ty - 1 && y < s.ty + LANDMARK_SIZE[s.kind][1] + 4)) continue;
    if (nearest([x, y], (hx, hy) => at(hx, hy) === 'H', 4)) continue;
    const pine = z === 'g' ? hash(x, y, 63) < PINES[biomeOf(x, y)] : hash(x, y, 63) < (z === 'o' ? 0.45 : PINES.park) || noise(x, y, 12, 64) > 0.78;
    T[y][x] = pine ? 'P' : 'T';
    trees.push([x, y]);
    treeAt.set(y * W + x, (z === 'g' || wall ? WOOD_ROOM : TREE_ROOM)[roomSizeAt(x, y)]);
  }

  // bushes and rocks, here and there on the lawns
  for (let y = 2; y < H - 2; y++)
    for (let x = 2; x < W - 2; x++) {
      if (!open(x, y) || [-1, 0, 1].some((j) => [-1, 0, 1].some((i) => treeAt.has((y + j) * W + x + i)))) continue;
      if (![[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => '.,f'.includes(at(x + dx, y + dy)))) continue;
      const h = hash(x, y, 71);
      if (h < 0.012) T[y][x] = 'b';
      else if (h < 0.018) T[y][x] = 'r';
    }

  // garden furniture beside the paths
  for (const [kind, count] of WANT) {
    let placed = 0;
    for (const [x, y] of order) {
      if (placed >= count) break;
      const [w, h] = FURNITURE_SIZE[kind];
      if (!flatFree(x, y, w, h, 0)) continue;
      let flat = true;
      for (let j = -1; j <= h; j++) for (let i = -1; i <= w; i++) if (E[y + j]?.[x + i] !== 0 || 'TPHmLSo'.includes(at(x + i, y + j))) flat = false;
      if (!flat) continue;
      // benches face a path just below them; the rest stand near one
      const byPath = kind === 'bench' ? [0, 1].every((i) => at(x + i, y + 1) === 'p') : nearest([x, y], (px, py) => at(px, py) === 'p', 3) !== null;
      if (!byPath || furniture.some((f) => Math.abs(f.tx - x) < 8 && Math.abs(f.ty - y) < 6)) continue;
      furniture.push({ kind, tx: x, ty: y });
      placed++;
    }
  }

  // in the woods: fallen logs and old stumps here and there, well apart, clear of the trunks;
  // and the standing stone in the middle of a clearing that has no big old tree
  for (const c of CLEARINGS) if (c.heart === 'stone') furniture.push({ kind: 'stone', tx: c.tx - 1, ty: c.ty - 1 });
  const lying: Pt[] = [];
  for (const [kind, count] of WOODLAND) {
    let placed = 0;
    for (const [x, y] of order) {
      if (placed >= count) break;
      if (zone(x, y) !== 'g') continue;
      const [w, h] = FURNITURE_SIZE[kind];
      let ok = true;
      for (let j = -1; j <= h && ok; j++) for (let i = -1; i <= w && ok; i++) if (!'.,'.includes(at(x + i, y + j)) || E[y + j][x + i] !== E[y][x]) ok = false;
      if (!ok || lying.some(([lx, ly]) => Math.abs(lx - x) < 6 && Math.abs(ly - y) < 5)) continue;
      if (furniture.some((f) => {
        const [fw, fh] = FURNITURE_SIZE[f.kind];
        return x - 1 < f.tx + fw && x + w + 1 > f.tx && y - 1 < f.ty + fh && y + h + 1 > f.ty;
      })) continue;
      // (on the bare floor: no long grass under it)
      fillRect(x, y, w, h, '.');
      furniture.push({ kind, tx: x, ty: y });
      lying.push([x, y]);
      placed++;
    }
  }

  connect(T, E);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (T[y][x] === 'L' || T[y][x] === 'K' || T[y][x] === 'C') T[y][x] = '.';
  return { rows: T.map((r) => r.join('')), furniture, zones, biomes: biomes.map((r) => r.join('')) };
}

/** How big the tree on tile (tx, ty) grows: 0 small (most of them), 1 medium. */
export function treeSizeAt(tx: number, ty: number): 0 | 1 {
  return Math.min(roomSizeAt(tx, ty), 1) as 0 | 1;
}

/** The room a tree keeps round it, by the size it once grew to: 2 where the really big old ones stood, now medium (kept so they stand where they did). */
function roomSizeAt(tx: number, ty: number): 0 | 1 | 2 {
  if (CHAMPIONS.has(ty * 4096 + tx)) return 2;
  const u = hash2(tx, ty, 58);
  return u < 0.55 ? 0 : u < 0.88 ? 1 : 2;
}

/** Half the width of the trunk of a tree (tile ch) on tile (tx, ty) at its foot. */
export function trunkHalfOf(ch: string, tx: number, ty: number): number {
  if (ch === 'H') return 16;
  const size = treeSizeAt(tx, ty), u = hash2(tx, ty, 59);
  // (a painted tree: its template's trunk)
  const painted = paintedKind(ch, tx, ty, size);
  if (painted) return TEMPLATE_TRUNK[painted][size];
  return ch === 'P' ? [5, 7][size] + Math.floor(u * 2) : [5, 8][size] + Math.floor(u * 3);
}

/** Whether the park has its tree house (left out while the trees are drawn anew). */
const TREE_HOUSE = false;

/** Room a tree of each size keeps round it (tiles)... */
const TREE_ROOM = [2, 3, 5];
/** ...and in the woods, where they stand thick. */
const WOOD_ROOM = [1, 2, 4];

/** The big old trees in the middle of the clearings, by tile (ty * 4096 + tx). */
const CHAMPIONS = new Set<number>();

/** Trunks this stout (half-width, px) stand into the tiles either side of their own. */
const FAT = 11;

/**
 * Everything that grew must leave every bit of ground reachable: where trees,
 * bushes or hedges wall a patch in, clear them away.
 */
function connect(T: string[][], E: number[][]): void {
  const H = T.length, W = T[0].length;
  for (let pass = 0; pass < 60; pass++) {
    const fat = (x: number, y: number) => 'TH'.includes(T[y]?.[x] ?? '.') && trunkHalfOf(T[y][x], x, y) > FAT;
    const walk = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && !'~wlFmTPHbr#Lo'.includes(T[y][x]) && !fat(x - 1, y) && !fat(x + 1, y);
    // (level ground, or on and off stairs: cliffs only go down, and that's not much of a connection)
    const step = (ax: number, ay: number, bx: number, by: number) =>
      E[ay][ax] === E[by][bx] || (T[ay][ax] === 'S' && E[by][bx] === E[ay][ax] + 1) || (T[by][bx] === 'S' && E[ay][ax] === E[by][bx] + 1);
    const comp = Array.from({ length: H }, () => new Array<number>(W).fill(-1));
    const sizes: number[] = [];
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        if (comp[y][x] >= 0 || !walk(x, y)) continue;
        const n = sizes.length;
        const q: Pt[] = [[x, y]];
        comp[y][x] = n;
        let size = 0;
        while (q.length) {
          const [cx, cy] = q.pop()!;
          size++;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = cx + dx, ny = cy + dy;
            if (walk(nx, ny) && comp[ny][nx] < 0 && step(cx, cy, nx, ny)) {
              comp[ny][nx] = n;
              q.push([nx, ny]);
            }
          }
        }
        sizes.push(size);
      }
    if (sizes.length <= 1) return;
    const main = sizes.indexOf(Math.max(...sizes));
    const small = sizes.map((s, i) => [s, i]).filter(([, i]) => i !== main).sort((a, b) => a[0] - b[0])[0][1];
    let cleared = false;
    for (let y = 1; y < H - 1; y++)
      for (let x = 1; x < W - 1; x++)
        if (comp[y][x] === small)
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]])
            if ('TPbr#'.includes(T[y + dy][x + dx])) {
              T[y + dy][x + dx] = '.';
              cleared = true;
            } else
              // (or the stout tree beside it, standing into it)
              for (const side of [-1, 1])
                if (T[y + dy][x + dx + side] === 'T' && fat(x + dx + side, y + dy)) {
                  T[y + dy][x + dx + side] = '.';
                  cleared = true;
                }
    if (!cleared) return;
  }
}

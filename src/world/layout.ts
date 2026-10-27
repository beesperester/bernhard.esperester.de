// The part of the park that is new in every garden. The landscape is fixed
// (garden.ts: the water, the paths and bridges, the terraces and their stairs,
// the landmark follies); the first cat into an empty garden picks a seed, and
// from that seed this lays out the rest on the open ground: lawns and
// meadows, flower beds and their box hedges, the maze, the tree house, the
// trees, bushes and rocks, and the furniture. Every cat that joins is handed
// the seed (net.ts) and lays out the same garden; when the last cat leaves,
// the garden is gone, and the next one is a new one.
//
// Trees grow thickest where the real city has its parks and woods, and
// outside the Ring (ZONES), so Berlin still looks like Berlin.

import { hash2 } from '../art/raster.ts';
import { BASE, ELEV, LANDMARK_SPOTS, ZONES } from './garden.ts';
import { LANDMARK_SIZE } from './landmarks.ts';

type Pt = [number, number];

export type FurnitureKind = 'shed' | 'bench' | 'picnic' | 'bistro' | 'blanket' | 'birdbath';

/** Tiles each kind of furniture takes up. */
export const FURNITURE_SIZE: Record<FurnitureKind, [number, number]> = {
  shed: [3, 2], bench: [2, 1], picnic: [4, 3], bistro: [3, 2], blanket: [4, 3], birdbath: [1, 1],
};

/** How many of each piece a garden gets, in the order they are placed. */
const WANT: [FurnitureKind, number][] = [['shed', 1], ['picnic', 3], ['blanket', 3], ['bistro', 3], ['birdbath', 5], ['bench', 14]];

const MAZE_W = 17, MAZE_H = 13;

export interface Layout {
  /** The whole park, one character per tile (see legend.ts). */
  rows: string[];
  /** Furniture by its top-left tile. */
  furniture: { kind: FurnitureKind; tx: number; ty: number }[];
}

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

  // the maze, somewhere in the parks: a hedge labyrinth with the fountain in the middle
  {
    const fits = ([x, y]: Pt) => flatFree(x, y, MAZE_W, MAZE_H, 1);
    const spot = order.find((p) => zone(p[0] + 8, p[1] + 6) === 'g' && fits(p)) ?? order.find(fits);
    if (spot) {
      const [mx, my] = spot;
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

  // the tree house, in a park
  {
    const fits = ([x, y]: Pt) => clear(x, y, 3) && flatFree(x - 2, y - 1, 5, 3, 0);
    const spot = order.find((p) => zone(...p) === 'g' && fits(p)) ?? order.find(fits);
    if (spot) T[spot[1]][spot[0]] = 'H';
  }

  // meadows and flower beds
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      if (!open(x, y)) continue;
      const n = noise(x, y, 7, 3);
      if (zone(x, y) === 'o' ? n > 0.3 : n > (zone(x, y) === 'g' ? 0.6 : 0.68)) T[y][x] = ',';
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

  // trees: thick in the parks and woods and outside the Ring, a few along the streets; some pines
  const trees: Pt[] = [];
  for (const [x, y] of order) {
    if (!'.,'.includes(at(x, y))) continue;
    // room round the trunk: nothing but grass beside it, and not at a terrace edge or the foot of stairs
    if ([[1, 0], [-1, 0], [0, 1], [0, -1], [0, 2]].some(([dx, dy]) => !'.,f'.includes(at(x + dx, y + dy)) || E[y + dy]?.[x + dx] !== E[y][x])) continue;
    if (E[y - 1][x] !== E[y][x] || at(x, y + 1) === 'S') continue;
    const z = zone(x, y);
    const p = z === 'g' ? 0.3 : z === 'o' ? 0.16 : 0.025 + 0.2 * Math.max(0, noise(x, y, 9, 7) - 0.6) * 4;
    if (hash(x, y, 62) > p) continue;
    if (trees.some(([tx, ty]) => Math.abs(tx - x) < 5 && Math.abs(ty - y) < 4)) continue;
    if (LANDMARK_SPOTS.some((s) => x >= s.tx - 3 && x < s.tx + LANDMARK_SIZE[s.kind][0] + 3 && y >= s.ty - 1 && y < s.ty + LANDMARK_SIZE[s.kind][1] + 4)) continue;
    if (nearest([x, y], (hx, hy) => at(hx, hy) === 'H', 4)) continue;
    const pine = hash(x, y, 63) < (z === 'o' ? 0.45 : z === 'g' ? 0.3 : 0.15) || noise(x, y, 12, 64) > 0.78;
    T[y][x] = pine ? 'P' : 'T';
    trees.push([x, y]);
  }

  // bushes and rocks, here and there on the lawns
  for (let y = 2; y < H - 2; y++)
    for (let x = 2; x < W - 2; x++) {
      if (!open(x, y) || trees.some(([tx, ty]) => Math.abs(tx - x) <= 1 && Math.abs(ty - y) <= 1)) continue;
      if (![[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => '.,f'.includes(at(x + dx, y + dy)))) continue;
      const h = hash(x, y, 71);
      if (h < 0.012) T[y][x] = 'b';
      else if (h < 0.018) T[y][x] = 'r';
    }

  // garden furniture beside the paths
  const furniture: Layout['furniture'] = [];
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

  connect(T, E, furniture);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (T[y][x] === 'L') T[y][x] = '.';
  return { rows: T.map((r) => r.join('')), furniture };
}

/**
 * Everything that grew must leave every bit of ground reachable: where trees,
 * bushes or hedges wall a patch in, clear them away (and failing that, take
 * away the furniture beside it).
 */
function connect(T: string[][], E: number[][], furniture: Layout['furniture']): void {
  const H = T.length, W = T[0].length;
  for (let pass = 0; pass < 60; pass++) {
    const shed = new Set<number>();
    for (const f of furniture)
      if (f.kind === 'shed') for (let j = 0; j < FURNITURE_SIZE.shed[1]; j++) for (let i = 0; i < FURNITURE_SIZE.shed[0]; i++) shed.add((f.ty + j) * W + f.tx + i);
    const walk = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && !'~wlFmTPHbr#Lo'.includes(T[y][x]) && !shed.has(y * W + x);
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
            }
    if (cleared) continue;
    // walled in by the shed: move it out of the way (there is only the one)
    const beside = [...shed].some((k) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => comp[Math.floor(k / W) + dy]?.[(k % W) + dx] === small));
    const i = furniture.findIndex((f) => f.kind === 'shed');
    if (i < 0 || !beside) return;
    furniture.splice(i, 1);
  }
}

// The park itself, grown from the garden's seed: a big landscape park, the
// same for every cat in the garden and a new one in every garden. This lays
// out the land: the fence round it, the railway's loop, the lakes and ponds,
// a river two tiles wide running through the biggest lake, the streams
// between the ponds, the hills with their stairs, the woods, and the paths
// that tie it all together, with bridges where they cross the water, and the
// follies beside them. What grows on the open ground (lawns, meadows, trees,
// furniture, the themed zones) is laid out on top of this by layout.ts.
//
// What comes out is in the shape the rest of the game reads (see legend.ts
// for the characters):
//  - BASE: one character per tile: the water, the paths and bridges, the
//    stairs and the fence; '.' is open ground for layout.ts to fill in.
//  - ELEV: every tile's terrain level (0 the lawn, each level 16 px up).
//  - ZONES: what the land is like: 'g' woods, 'o' open meadows, '.' parkland.
//  - LANDMARK_SPOTS: where the follies (world/landmarks.ts) stand.
//  - RIVERS: the lines the running water ('~') flows along, in world px.
//  - TRACK: the railway's loop, by the tiles it turns a corner in.
//  - SPAWN: where cats arrive: the paths in this box.
//  - CLEARINGS: secret clearings deep in the woods, where no path goes.
// `npm test` checks the result for a good few seeds: everything walkable
// reachable from the spawn, straight bridges, no specks of water, and so on.

import { hash2 } from '../art/raster.ts';
import { LANDMARK_SIZE, type LandmarkKind } from './landmarks.ts';
import { MAP_H, MAP_W, TILE } from './size.ts';

type Pt = [number, number];

export interface Park {
  BASE: string[];
  ELEV: string[];
  ZONES: string[];
  LANDMARK_SPOTS: { kind: LandmarkKind; tx: number; ty: number }[];
  RIVERS: number[][];
  TRACK: number[];
  SPAWN: { x0: number; y0: number; x1: number; y1: number };
  CLEARINGS: Clearing[];
}

/** A clearing in the woods: round (r tiles) about its middle tile, with a big old tree or a standing stone there. */
export interface Clearing { tx: number; ty: number; r: number; heart: 'tree' | 'stone' }

/** The most clearings a park has, how far apart they are (tiles), and how much wood stands round one (tiles). */
const CLEARINGS_MOST = 10, CLEARING_APART = 28, CLEARING_WALL = 3, CLEARING_FROM_HUB = 14;

const W = MAP_W, H = MAP_H;
const SIDES: Pt[] = [[1, 0], [0, 1], [-1, 0], [0, -1]];
/** The four sides, then the four diagonals: the ways a path can go. */
const DIRS: Pt[] = [...SIDES, [1, 1], [-1, 1], [-1, -1], [1, -1]];
const AROUND: Pt[] = [...SIDES, [1, 1], [-1, 1], [1, -1], [-1, -1]];
const FOLLIES: LandmarkKind[] = ['pavilion', 'teahouse', 'lookout', 'catstatue', 'rotunda', 'tower', 'colonnade', 'terrace', 'obelisk', 'urn'];

/** The park that grows from `seed`. */
export function generatePark(seed: number): Park {
  const salt = (s: number) => Math.imul(s + 7, 0x9e3779b1) ^ Math.imul(seed | 0, 0x85ebca6b);
  const hash = (x: number, y: number, s: number) => hash2(x, y, salt(s));
  /** Smooth value noise, 0..1, blobs about `size` tiles across. */
  const noise = (x: number, y: number, size: number, s: number) => {
    const fx = x / size, fy = y / size, ix = Math.floor(fx), iy = Math.floor(fy), u = fx - ix, v = fy - iy;
    const sm = (t: number) => t * t * (3 - 2 * t);
    const a = hash(ix, iy, s), b = hash(ix + 1, iy, s), c = hash(ix, iy + 1, s), d = hash(ix + 1, iy + 1, s);
    return (a + (b - a) * sm(u)) * (1 - sm(v)) + (c + (d - c) * sm(u)) * sm(v);
  };
  let draws = 0;
  /** A seeded number in [lo, hi). */
  const pick = (lo: number, hi: number) => lo + hash(draws++, 0, 999) * (hi - lo);

  const T: string[][] = Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => (x === 0 || y === 0 || x === W - 1 || y === H - 1 ? 'F' : '.')));
  const E: number[][] = Array.from({ length: H }, () => new Array<number>(W).fill(0));
  const inside = (x: number, y: number) => x > 0 && y > 0 && x < W - 1 && y < H - 1;
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < W && y < H ? T[y][x] : 'F');
  const wet = (x: number, y: number) => '~wlBR'.includes(at(x, y));
  const idx = (x: number, y: number) => y * W + x;

  // ---- the railway: a loop round the park, kept in from the fence, with a few bays pushed in ----
  const track = railLoop(pick);
  const rail = new Uint8Array(W * H); // 1 on the line, 2 within a couple of tiles of it
  const corners = new Uint8Array(W * H); // within a few tiles of a corner
  for (let i = 0; i < track.length; i++) {
    const [ax, ay] = track[i], [bx, by] = track[(i + 1) % track.length];
    const n = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
    for (let k = 0; k <= n; k++) rail[idx(ax + Math.sign(bx - ax) * k, ay + Math.sign(by - ay) * k)] = 1;
    for (let j = -3; j <= 3; j++) for (let i2 = -3; i2 <= 3; i2++) if (inside(ax + i2, ay + j)) corners[idx(ax + i2, ay + j)] = 1;
  }
  const near = (grid: Uint8Array, r: number, x: number, y: number, v = 1) => {
    for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) if (x + i >= 0 && y + j >= 0 && x + i < W && y + j < H && grid[idx(x + i, y + j)] === v) return true;
    return false;
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!rail[idx(x, y)] && near(rail, 2, x, y)) rail[idx(x, y)] = 2;

  // ---- the lakes and ponds ----
  const bodies: { cx: number; cy: number; rx: number; ry: number; lake: boolean }[] = [];
  const blob = (b: { cx: number; cy: number; rx: number; ry: number }, s: number, margin: number) => {
    const out: Pt[] = [];
    for (let y = Math.floor(b.cy - b.ry - margin - 2); y <= b.cy + b.ry + margin + 2; y++)
      for (let x = Math.floor(b.cx - b.rx - margin - 2); x <= b.cx + b.rx + margin + 2; x++) {
        const dx = (x + 0.5 - b.cx) / (b.rx + margin), dy = (y + 0.5 - b.cy) / (b.ry + margin);
        if (dx * dx + dy * dy < 1 + (noise(x, y, 5, s) - 0.5) * 0.7) out.push([x, y]);
      }
    return out;
  };
  const place = (lake: boolean, tries: number) => {
    for (let t = 0; t < tries; t++) {
      const rx = lake ? pick(14, 22) : pick(2.6, 4.6), ry = lake ? pick(9, 14) : pick(2.2, 3.6);
      const b = { cx: pick(12 + rx, W - 12 - rx), cy: pick(12 + ry, H - 12 - ry), rx, ry, lake };
      const s = 300 + bodies.length;
      // room round it: off the railway, and well apart from the other water
      if (blob(b, s, 3).some(([x, y]) => !inside(x, y) || rail[idx(x, y)] || corners[idx(x, y)])) continue;
      if (bodies.some((o) => Math.hypot((o.cx - b.cx) / (o.rx + b.rx + 8), (o.cy - b.cy) / (o.ry + b.ry + 6)) < 1)) continue;
      for (const [x, y] of blob(b, s, 0)) T[y][x] = 'w';
      bodies.push(b);
      return b;
    }
    return null;
  };
  const lakes = [place(true, 80), ...(hash(1, 1, 5) < 0.6 ? [place(true, 80)] : [])].filter((b) => b !== null);
  const pondCount = 4 + Math.floor(hash(2, 2, 6) * 3);
  for (let i = 0; i < pondCount; i++) place(false, 60);
  tidyWater(T);

  /** Which body of water each wet tile belongs to (0: none). */
  const bodyOf = new Int32Array(W * H);
  const label = () => {
    bodyOf.fill(0);
    let n = 0;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        if (!wet(x, y) || bodyOf[idx(x, y)]) continue;
        n++;
        const q: Pt[] = [[x, y]];
        bodyOf[idx(x, y)] = n;
        while (q.length) {
          const [cx, cy] = q.pop()!;
          for (const [dx, dy] of SIDES) {
            const nx = cx + dx, ny = cy + dy;
            if (wet(nx, ny) && inside(nx, ny) && !bodyOf[idx(nx, ny)]) { bodyOf[idx(nx, ny)] = n; q.push([nx, ny]); }
          }
        }
      }
  };

  // ---- the river: in at one side of the park, through the biggest lake, out at another ----
  const RIVERS: number[][] = [];
  const lake = lakes[0];
  if (lake) {
    label();
    const lakeId = bodyOf[idx(Math.floor(lake.cx), Math.floor(lake.cy))];
    // (the river is two tiles wide: a step puts down the 2x2 block from (x, y))
    const block = (x: number, y: number): Pt[] => [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]];
    const riverCost = (x: number, y: number) => {
      let c = 1 + 6 * noise(x, y, 11, 21) + 2 * noise(x, y, 4, 22);
      for (const [bx, by] of block(x, y)) {
        if (!inside(bx, by) || corners[idx(bx, by)]) return Infinity;
        const b = bodyOf[idx(bx, by)];
        if (b && b !== lakeId) return Infinity;
        // other water nearby: keep off it (or it all runs together)
        if (!b && AROUND.some(([dx, dy]) => { const o = bodyOf[idx(bx + dx, by + dy)] ?? 0; return o && o !== lakeId; })) return Infinity;
        // (across the railway, not along it)
        if (rail[idx(bx, by)]) c += rail[idx(bx, by)] === 1 ? 12 : 6;
      }
      return c;
    };
    const runs: Pt[][] = [];
    // in from the left or the top...
    const fromLeft = hash(3, 3, 7) < 0.5;
    const source: Pt = fromLeft ? [1, Math.floor(pick(20, H - 22))] : [Math.floor(pick(20, W - 22)), 1];
    const touchesLake = (x: number, y: number) => block(x, y).some(([bx, by]) => bodyOf[idx(bx, by)] === lakeId);
    const into = astar([source], (x, y) => touchesLake(x, y), (x, y) => riverCost(x, y), [Math.floor(lake.cx), Math.floor(lake.cy)]);
    // ...and out at the right or the bottom, from the lake's far side
    const exitRight = hash(4, 4, 8) < 0.5;
    const shore: Pt[] = [];
    for (let y = 1; y < H - 2; y++) for (let x = 1; x < W - 2; x++) if (touchesLake(x, y) && riverCost(x, y) < Infinity && !block(x, y).every(([bx, by]) => bodyOf[idx(bx, by)] === lakeId)) shore.push([x, y]);
    shore.sort((a, b) => (exitRight ? b[0] - a[0] : b[1] - a[1]));
    const out = shore.length ? astar([shore[0]], (x, y) => (exitRight ? x >= W - 3 : y >= H - 3), (x, y) => (touchesLake(x, y) && Math.hypot(x - shore[0][0], y - shore[0][1]) > 2 ? Infinity : riverCost(x, y)), exitRight ? [W - 3, Math.floor(lake.cy)] : [Math.floor(lake.cx), H - 3]) : null;
    for (const run of [into, out]) {
      if (!run) continue;
      const kept = run.filter(([x, y]) => !block(x, y).every(([bx, by]) => bodyOf[idx(bx, by)] === lakeId));
      for (const [x, y] of kept) for (const [bx, by] of block(x, y)) if (T[by][bx] === '.') T[by][bx] = '~';
      runs.push(kept);
    }
    // the way the water runs: the middle of the channel, from where it comes in to where it goes
    for (const run of runs) {
      const pts: number[] = [];
      run.forEach(([x, y], i) => { if (i % 2 === 0 || i === run.length - 1) pts.push((x + 1) * TILE, (y + 1) * TILE); });
      if (pts.length >= 4) RIVERS.push(pts);
    }
  }

  // ---- streams: a narrow channel from most ponds to the nearest other water ----
  label();
  const streamTiles = new Uint8Array(W * H);
  for (const b of bodies) {
    if (b.lake || hash(Math.floor(b.cx), Math.floor(b.cy), 9) > 0.8) continue;
    const id = bodyOf[idx(Math.floor(b.cx), Math.floor(b.cy))];
    if (!id) continue;
    const starts: Pt[] = [];
    for (let y = 2; y < H - 2; y++)
      for (let x = 2; x < W - 2; x++)
        if (T[y][x] === '.' && SIDES.some(([dx, dy]) => bodyOf[idx(x + dx, y + dy)] === id)) starts.push([x, y]);
    const touching = (x: number, y: number, which: (b: number) => boolean) => AROUND.some(([dx, dy]) => { const o = bodyOf[idx(x + dx, y + dy)]; return o > 0 && which(o); }) || AROUND.some(([dx, dy]) => streamTiles[idx(x + dx, y + dy)] === 1);
    const isStart = new Set(starts.map(([x, y]) => idx(x, y)));
    const goal = (x: number, y: number) => SIDES.some(([dx, dy]) => { const o = bodyOf[idx(x + dx, y + dy)]; return o > 0 && o !== id; })
      && !AROUND.some(([dx, dy]) => bodyOf[idx(x + dx, y + dy)] === id);
    const cost = (x: number, y: number) => {
      if (x < 2 || y < 2 || x > W - 3 || y > H - 3 || T[y][x] !== '.' || corners[idx(x, y)]) return Infinity;
      // (beside its own pond only where it leaves it; beside other water only where it runs in)
      if (!isStart.has(idx(x, y)) && touching(x, y, (o) => o === id)) return Infinity;
      if (!goal(x, y) && touching(x, y, (o) => o !== id)) return Infinity;
      return 1 + 4 * noise(x, y, 6, 31) + (rail[idx(x, y)] === 1 ? 10 : 0);
    };
    const run = astar(starts, goal, cost, null, 2600);
    if (!run || run.length < 3) continue;
    for (const [x, y] of run) { T[y][x] = 'w'; streamTiles[idx(x, y)] = 1; }
  }

  // where the railway crosses water it runs over a bridge
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (rail[idx(x, y)] === 1 && (T[y][x] === '~' || T[y][x] === 'w')) T[y][x] = 'R';
  label();

  // ---- the woods and the open meadows ----
  const ZONES = Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => {
    const f = noise(x, y, 34, 41) * 0.7 + noise(x, y, 11, 42) * 0.3;
    return f > 0.6 ? 'g' : f < 0.33 ? 'o' : '.';
  }));

  // ---- hills: a level or two up, away from the water and the railway, every one with stairs ----
  const distToWet = bfsDistance((x, y) => wet(x, y));
  if (HILLS) for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (x < 6 || y < 6 || x > W - 7 || y > H - 7 || distToWet[idx(x, y)] < 4 || near(rail, 3, x, y) || near(rail, 3, x, y, 2)) continue;
      const n = noise(x, y, 24, 51) * 0.65 + noise(x, y, 8, 52) * 0.35;
      E[y][x] = n > 0.77 ? 2 : n > 0.67 ? 1 : 0;
    }
  tidyHills(E);

  // ---- the paths ----
  const forest = (x: number, y: number) => ZONES[y][x] === 'g';
  const land0 = (x: number, y: number) => x > 3 && y > 3 && x < W - 4 && y < H - 4 && T[y][x] === '.' && E[y][x] === 0 && !rail[idx(x, y)];

  // where cats arrive and the paths start: the middle of the park
  const centre: Pt = [W >> 1, H >> 1];
  const hub = nearestTile(centre, (x, y) => land0(x, y) && !forest(x, y) && distToWet[idx(x, y)] > 3) ?? centre;

  // ---- the secret clearings: deep in the woods, away from the water, and kept clear of the paths ----
  const inWood = bfsDistance((x, y) => !inside(x, y) || !forest(x, y));
  const CLEARINGS: Clearing[] = [];
  /** The clearings and the wood round them: no path goes in. */
  const secret = new Uint8Array(W * H);
  {
    const spots: Pt[] = [];
    for (let y = 8; y < H - 8; y++) for (let x = 8; x < W - 8; x++) if (inWood[idx(x, y)] >= 7 && distToWet[idx(x, y)] >= 9) spots.push([x, y]);
    spots.sort((a, b) => hash(a[0], a[1], 91) - hash(b[0], b[1], 91));
    for (const [x, y] of spots) {
      if (CLEARINGS.length >= CLEARINGS_MOST) break;
      const r = 5 + Math.floor(hash(x, y, 92) * 3);
      if (inWood[idx(x, y)] < r + CLEARING_WALL || distToWet[idx(x, y)] < r + CLEARING_WALL + 2) continue;
      if (CLEARINGS.some((c) => Math.hypot(c.tx - x, c.ty - y) < CLEARING_APART)) continue;
      // (not where cats arrive: the paths start there)
      if (Math.hypot(hub[0] - x, hub[1] - y) < r + CLEARING_WALL + CLEARING_FROM_HUB) continue;
      let ok = true;
      for (let j = -r; j <= r && ok; j++) for (let i = -r; i <= r && ok; i++) if (T[y + j][x + i] !== '.' || E[y + j][x + i] !== 0 || near(rail, 2, x + i, y + j)) ok = false;
      if (!ok) continue;
      CLEARINGS.push({ tx: x, ty: y, r, heart: hash(x, y, 93) < 0.55 ? 'tree' : 'stone' });
      const R = r + CLEARING_WALL;
      for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) if (i * i + j * j <= R * R && inside(x + i, y + j)) secret[idx(x + i, y + j)] = 1;
    }
  }
  // the paths join it...
  const pois: Pt[] = [hub];
  // ...the lakes' and ponds' shores...
  for (const b of bodies) {
    const id = bodyOf[idx(Math.floor(b.cx), Math.floor(b.cy))];
    const shore = (x: number, y: number) => land0(x, y) && SIDES.some(([dx, dy]) => bodyOf[idx(x + dx, y + dy)] === id) && E[y][x] === 0;
    const a = nearestTile(hub, shore, 400);
    if (a) pois.push(a);
    if (b.lake) {
      // and round the far side of a lake
      const far: Pt = [Math.round(2 * b.cx - (a?.[0] ?? b.cx)), Math.round(2 * b.cy - (a?.[1] ?? b.cy))];
      const f = nearestTile(far, shore, 30);
      if (f) pois.push(f);
    }
  }
  // ...and places all over, in the open rather than deep in the woods
  const CELL = 34;
  for (let cy = 0; cy < H; cy += CELL)
    for (let cx = 0; cx < W; cx += CELL) {
      const p = nearestTile([Math.floor(cx + pick(6, CELL - 6)), Math.floor(cy + pick(6, CELL - 6))], (x, y) => land0(x, y) && !forest(x, y) && distToWet[idx(x, y)] > 2, 10);
      if (p && pois.every(([x, y]) => Math.hypot(x - p[0], y - p[1]) > 18)) pois.push(p);
    }

  const BRIDGE_MAX = 5;
  /** What a step over each tile of open land costs: it wanders, keeps out of the woods, and crosses the railway only where it must. */
  const ground = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) ground[idx(x, y)] = 1 + 2.4 * noise(x, y, 9, 61) + 0.8 * noise(x, y, 3, 62) + (forest(x, y) ? 1.5 : 0) + (rail[idx(x, y)] === 1 ? 5 : 0);
  /**
   * The cost of a path stepping onto (x, y) (on terrain level `level`) from (fx, fy), going `d`
   * (DIRS) after `prev` (-1: the first step). Paths wander a little, go diagonally as well as straight
   * (a staircase of tiles), keep off the woods where they can, and cross water only on a bridge
   * going straight over a stream or the river.
   */
  const isWater = (c: string) => c === '~' || c === 'w' || c === 'B';
  const isBlock = (c: string) => c === 'F' || c === 'R' || c === 'S' || c === 'b';
  const pathCost = (level: number) => (x: number, y: number, d: number, prev: number, fx: number, fy: number) => {
    if (x < 2 || y < 2 || x > W - 3 || y > H - 3) return Infinity;
    const ch = T[y][x];
    if (E[y][x] !== level || isBlock(ch) || secret[idx(x, y)]) return Infinity;
    const onWater = isWater(ch), fromWater = isWater(T[fy][fx]);
    if (d >= 4) {
      // a diagonal step: by way of both tiles beside it, all of them land
      if (onWater || fromWater) return Infinity;
      const ax = x, ay = fy, bx = fx, by = y;
      if (E[ay][ax] !== level || isWater(T[ay][ax]) || isBlock(T[ay][ax]) || E[by][bx] !== level || isWater(T[by][bx]) || isBlock(T[by][bx])) return Infinity;
    }
    // bridges go straight across, from land to land
    if ((onWater || fromWater) && prev >= 0 && d !== prev) return Infinity;
    if (onWater) {
      // only over running water and streams, never out into a lake or pond, and not beside another bridge
      if (ch === 'w' && !streamTiles[idx(x, y)]) return Infinity;
      if (ch !== 'B') {
        const across = d % 2 === 0;
        if (across ? T[y - 1][x] === 'B' || T[y + 1][x] === 'B' : T[y][x - 1] === 'B' || T[y][x + 1] === 'B') return Infinity;
        if (sideWater(x, y, d) > 0) return Infinity;
      }
      return 9;
    }
    let c = ch === 'p' ? 0.35 : ground[idx(x, y)];
    if (d >= 4) c *= 1.41;
    // (a turn sharper than half a right angle costs a little)
    if (prev >= 0 && DIRS[d][0] * DIRS[prev][0] + DIRS[d][1] * DIRS[prev][1] <= 0) c += 0.8;
    return c;
  };
  /** How many tiles of water there are beside (x, y), across a path going `d` (a bridge mustn't run along the water). */
  const sideWater = (x: number, y: number, d: number) => {
    const [dx, dy] = SIDES[d];
    const water = (k: number) => '~wB'.includes(at(x + dx * k, y + dy * k));
    let f = 1, b = 1;
    while (f <= BRIDGE_MAX && water(f)) f++;
    while (b <= BRIDGE_MAX && water(-b)) b++;
    return f + b - 1 > BRIDGE_MAX ? 1 : 0;
  };
  /** Lay the path along `route`: two tiles wide where `wide` (not over the water). */
  const lay = (route: Pt[], wide: boolean) => {
    const put = (x: number, y: number) => {
      if (at(x, y) === '.' && rail[idx(x, y)] !== 1 && !secret[idx(x, y)]) T[y][x] = 'p';
    };
    route.forEach(([x, y], i) => {
      const ch = T[y][x];
      if (ch === '~' || ch === 'w') T[y][x] = 'B';
      else if (ch === '.') T[y][x] = 'p';
      if (T[y][x] === 'B') return;
      const [px, py] = route[i - 1] ?? route[i + 1] ?? [x, y];
      const dx = x - px, dy = y - py;
      // a diagonal step goes by way of a tile beside it (both, where wide)
      if (dx && dy) {
        put(px + dx, py);
        if (wide) put(px, py + dy);
        return;
      }
      if (!wide) return;
      const [sx, sy] = dx === 0 ? [x + 1, y] : [x, y + 1];
      if (E[sy]?.[sx] === E[y][x] && !SIDES.some(([ox, oy]) => '~wBR'.includes(at(sx + ox, sy + oy)))) put(sx, sy);
    });
  };
  const connectTo = (from: Pt[], to: (x: number, y: number) => boolean, level: number, target: Pt | null, wide: boolean) => {
    const route = astarDir(from, to, pathCost(level), target);
    if (route) lay(route, wide);
    return route;
  };
  // a tree of paths joining every place, the main ones wide...
  const joined = [0];
  const edges: [number, number][] = [];
  while (joined.length < pois.length) {
    let best: [number, number] | null = null, bd = Infinity;
    for (const a of joined)
      for (let b = 0; b < pois.length; b++) {
        if (joined.includes(b)) continue;
        const d = Math.hypot(pois[a][0] - pois[b][0], pois[a][1] - pois[b][1]);
        if (d < bd) { bd = d; best = [a, b]; }
      }
    joined.push(best![1]);
    edges.push(best!);
  }
  for (const [a, b] of edges) connectTo([pois[a]], (x, y) => x === pois[b][0] && y === pois[b][1], 0, pois[b], true);
  // ...and a few more, narrower, so there are rounds to walk
  for (let a = 0; a < pois.length; a++) {
    const others = pois.map((p, b) => ({ b, d: Math.hypot(p[0] - pois[a][0], p[1] - pois[a][1]) })).filter(({ b }) => b !== a && !edges.some(([i, j]) => (i === a && j === b) || (i === b && j === a))).sort((p, q) => p.d - q.d);
    const o = others[0];
    if (!o || o.d > 60 || hash(a, o.b, 62) > 0.55) continue;
    edges.push([a, o.b]);
    connectTo([pois[a]], (x, y) => x === pois[o.b][0] && y === pois[o.b][1], 0, pois[o.b], false);
  }

  // ---- stairs up every hill, and a path up to them and over the top ----
  for (const level of [1, 2]) {
    for (const comp of components((x, y) => E[y][x] >= level)) {
      const own = new Set(comp.map(([x, y]) => idx(x, y)));
      // a tile at the foot of the hill's south face, the face straight there
      const spots = comp.filter(([x, y]) => E[y][x] === level).map(([x, y]): Pt => [x, y + 1]).filter(([x, y]) =>
        T[y][x] === '.' && E[y][x] === level - 1 && !own.has(idx(x, y)) && [-1, 1].every((dx) => E[y - 1][x + dx] === level && E[y][x + dx] === level - 1)
        && at(x, y + 1) !== 'F' && E[y + 1]?.[x] === level - 1 && !'~wBR'.includes(at(x, y + 1)) && rail[idx(x, y)] !== 1);
      const reach = (x: number, y: number) => T[y][x] === 'p' && E[y][x] === level - 1;
      let done = false;
      spots.sort((a, b) => hash(a[0], a[1], 71) - hash(b[0], b[1], 71));
      for (const [x, y] of spots.slice(0, 12)) {
        T[y][x] = 'S';
        const route = connectTo([[x, y + 1]], reach, level - 1, null, false);
        if (route) {
          if (T[y + 1][x] === '.') T[y + 1][x] = 'p';
          // and over the top, to its middle
          const mx = comp.reduce((s, p) => s + p[0], 0) / comp.length, my = comp.reduce((s, p) => s + p[1], 0) / comp.length;
          const top = nearestTile([Math.round(mx), Math.round(my)], (tx, ty) => E[ty][tx] === level && T[ty][tx] === '.', 30);
          if (top) {
            const up = astarDir([[x, y - 1]], (tx, ty) => tx === top[0] && ty === top[1], pathCost(level), top);
            if (up) lay(up, false);
            if (T[y - 1][x] === '.') T[y - 1][x] = 'p';
          }
          done = true;
          break;
        }
        T[y][x] = '.';
      }
      // no way up: it isn't a hill after all
      if (!done) for (const [x, y] of comp) if (E[y][x] >= level) E[y][x] = level - 1;
    }
  }

  // ---- everything reachable: a path to every bit of land the paths don't reach yet ----
  for (let pass = 0; pass < 30; pass++) {
    const reached = reachableFrom(hub);
    const lost = components((x, y) => walkable(x, y) && !reached[idx(x, y)]);
    if (!lost.length) break;
    let fixed = false;
    for (const comp of lost) {
      const level = E[comp[0][1]][comp[0][0]];
      const route = comp.length >= 6 ? connectTo(comp.filter(([x, y]) => T[y][x] === '.' || T[y][x] === 'p').slice(0, 40), (x, y) => reached[idx(x, y)] === 1 && T[y][x] === 'p', level, null, false) : null;
      if (route) { fixed = true; break; }
      // a scrap of land cut off by the water: a thicket nobody needs to get into
      for (const [x, y] of comp) if (T[y][x] === '.' || T[y][x] === 'p') T[y][x] = 'b';
      fixed = true;
    }
    if (!fixed) break;
  }
  tidySlivers(T);

  // ---- the follies, on the lawn beside the paths, well apart ----
  const LANDMARK_SPOTS: Park['LANDMARK_SPOTS'] = [];
  const order: Pt[] = [];
  for (let y = 3; y < H - 3; y++) for (let x = 3; x < W - 3; x++) order.push([x, y]);
  order.sort((a, b) => hash(a[0], a[1], 81) - hash(b[0], b[1], 81));
  for (const kind of FOLLIES) {
    const [w, h] = LANDMARK_SIZE[kind];
    const spot = order.find(([x, y]) => {
      for (let j = -1; j <= h; j++) for (let i = -1; i <= w; i++) if (at(x + i, y + j) !== '.' || E[y + j][x + i] !== E[y][x] || rail[idx(x + i, y + j)] || secret[idx(x + i, y + j)]) return false;
      // a path just in front of it
      let path = false;
      for (let i = 0; i < w; i++) for (let j = h + 1; j <= h + 2; j++) if (at(x + i, y + j) === 'p') path = true;
      return path && LANDMARK_SPOTS.every((l) => Math.hypot(l.tx - x, l.ty - y) > 22);
    });
    if (spot) LANDMARK_SPOTS.push({ kind, tx: spot[0], ty: spot[1] });
  }

  const SPAWN = { x0: hub[0] - 8, y0: hub[1] - 6, x1: hub[0] + 8, y1: hub[1] + 6 };
  return {
    BASE: T.map((r) => r.join('')),
    ELEV: E.map((r) => r.join('')),
    ZONES: ZONES.map((r) => r.join('')),
    LANDMARK_SPOTS,
    RIVERS,
    TRACK: track.flat(),
    SPAWN,
    CLEARINGS,
  };

  // ---------------------------------------------------------------- helpers (they see T, E and the rest)

  /** Ground a cat walks on, and how high it is there. */
  function walkable(x: number, y: number): boolean {
    return inside(x, y) && '.pBS'.includes(T[y][x]);
  }

  /** Every walkable tile reachable on foot from `from` (on the level, up and down stairs, over bridges). */
  function reachableFrom(from: Pt): Uint8Array {
    const seen = new Uint8Array(W * H);
    const q: Pt[] = [from];
    seen[idx(...from)] = 1;
    while (q.length) {
      const [x, y] = q.pop()!;
      for (const [dx, dy] of SIDES) {
        const nx = x + dx, ny = y + dy;
        if (!walkable(nx, ny) || seen[idx(nx, ny)]) continue;
        const a = E[y][x], b = E[ny][nx];
        const ok = a === b || (T[y][x] === 'S' && dy === -1 && b === a + 1) || (T[ny][nx] === 'S' && dy === 1 && a === b + 1) || b < a;
        if (!ok) continue;
        seen[idx(nx, ny)] = 1;
        q.push([nx, ny]);
      }
    }
    return seen;
  }

  /** The connected groups of tiles passing `test` (4-neighbours, the same level). */
  function components(test: (x: number, y: number) => boolean): Pt[][] {
    const seen = new Uint8Array(W * H);
    const out: Pt[][] = [];
    for (let y = 1; y < H - 1; y++)
      for (let x = 1; x < W - 1; x++) {
        if (seen[idx(x, y)] || !test(x, y)) continue;
        const comp: Pt[] = [];
        const q: Pt[] = [[x, y]];
        seen[idx(x, y)] = 1;
        while (q.length) {
          const p = q.pop()!;
          comp.push(p);
          for (const [dx, dy] of SIDES) {
            const nx = p[0] + dx, ny = p[1] + dy;
            if (inside(nx, ny) && !seen[idx(nx, ny)] && test(nx, ny)) { seen[idx(nx, ny)] = 1; q.push([nx, ny]); }
          }
        }
        out.push(comp);
      }
    return out;
  }

  /** The tile nearest `from` (by rings) passing `fits`. */
  function nearestTile(from: Pt, fits: (x: number, y: number) => boolean, max = 60): Pt | null {
    for (let r = 0; r <= max; r++)
      for (let j = -r; j <= r; j++)
        for (let i = -r; i <= r; i++) {
          if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
          const x = from[0] + i, y = from[1] + j;
          if (inside(x, y) && fits(x, y)) return [x, y];
        }
    return null;
  }

  /** How far (in tiles, 4-way) every tile is from the nearest one passing `test` (capped at 255). */
  function bfsDistance(test: (x: number, y: number) => boolean): Uint8Array {
    const d = new Uint8Array(W * H).fill(255);
    const q: number[] = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (test(x, y)) { d[idx(x, y)] = 0; q.push(idx(x, y)); }
    for (let h = 0; h < q.length; h++) {
      const i = q[h], x = i % W, y = (i - x) / W;
      for (const [dx, dy] of SIDES) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || d[idx(nx, ny)] !== 255) continue;
        d[idx(nx, ny)] = Math.min(254, d[i] + 1);
        q.push(idx(nx, ny));
      }
    }
    return d;
  }
}

// ---------------------------------------------------------------- the railway

/** The railway's loop, by its corner tiles in order: a rectangle in from the fence, with bays pushed in on a few sides. */
function railLoop(pick: (lo: number, hi: number) => number): Pt[] {
  const m = 7, x0 = m, y0 = m, x1 = W - 1 - m, y1 = H - 1 - m;
  // each side: from one corner to the next, along u, inwards n
  const sides: { s: Pt; u: Pt; n: Pt; len: number }[] = [
    { s: [x0, y0], u: [1, 0], n: [0, 1], len: x1 - x0 },
    { s: [x1, y0], u: [0, 1], n: [-1, 0], len: y1 - y0 },
    { s: [x1, y1], u: [-1, 0], n: [0, -1], len: x1 - x0 },
    { s: [x0, y1], u: [0, -1], n: [1, 0], len: y1 - y0 },
  ];
  const out: Pt[] = [];
  const bays = new Set<number>();
  while (bays.size < 3) bays.add(Math.floor(pick(0, 4)));
  sides.forEach(({ s, u, n, len }, i) => {
    out.push(s);
    if (!bays.has(i)) return;
    const span = Math.floor(pick(18, Math.min(52, len - 60)));
    const a = Math.floor(pick(28, len - 28 - span)), depth = Math.floor(pick(8, 20));
    const p = (along: number, inward: number): Pt => [s[0] + u[0] * along + n[0] * inward, s[1] + u[1] * along + n[1] * inward];
    out.push(p(a, 0), p(a, depth), p(a + span, depth), p(a + span, 0));
  });
  return out;
}

// ---------------------------------------------------------------- tidying

/** Ponds and lakes without specks: water with fewer than two wet sides goes, land with three or more is flooded. */
function tidyWater(T: string[][]): void {
  const wetAt = (x: number, y: number) => T[y]?.[x] === 'w';
  for (let pass = 0; pass < 6; pass++) {
    let changed = false;
    for (let y = 2; y < H - 2; y++)
      for (let x = 2; x < W - 2; x++) {
        const n = SIDES.filter(([dx, dy]) => wetAt(x + dx, y + dy)).length;
        if (T[y][x] === 'w' && n < 2) { T[y][x] = '.'; changed = true; }
        else if (T[y][x] === '.' && n >= 3) { T[y][x] = 'w'; changed = true; }
      }
    if (!changed) break;
  }
}

/** Land left with water on three sides (in the crook of a stream, say): reeds; on all four: a rock. */
function tidySlivers(T: string[][]): void {
  const wetAt = (x: number, y: number) => '~wlBR'.includes(T[y]?.[x] ?? 'F');
  for (let y = 2; y < H - 2; y++)
    for (let x = 2; x < W - 2; x++) {
      if (T[y][x] !== '.') continue;
      const n = SIDES.filter(([dx, dy]) => wetAt(x + dx, y + dy)).length;
      if (n === 4) T[y][x] = 'r';
      else if (n === 3) T[y][x] = ',';
    }
}

/** Whether the park has hills (plateaus a level or two up): off for now, the park is flat. */
export const HILLS = false;

/** Hills without crumbs: no ledges a tile thin, no tiny knolls, and the second level well inside the first. */
function tidyHills(E: number[][]): void {
  for (const level of [1, 2]) {
    for (let pass = 0; pass < 8; pass++) {
      let changed = false;
      for (let y = 1; y < H - 1; y++)
        for (let x = 1; x < W - 1; x++) {
          if (E[y][x] < level) continue;
          const thin = (E[y][x - 1] < level && E[y][x + 1] < level) || (E[y - 1][x] < level && E[y + 1][x] < level);
          const ring = level === 2 && AROUND.some(([dx, dy]) => E[y + dy][x + dx] < 1);
          if (thin || ring) { E[y][x] = level - 1; changed = true; }
        }
      if (!changed) break;
    }
    // dips in the middle of a hill: filled in (nobody could get out of one)
    {
      const outside = new Uint8Array(W * H);
      const q: Pt[] = [];
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if ((x === 0 || y === 0 || x === W - 1 || y === H - 1) && E[y][x] < level) { outside[y * W + x] = 1; q.push([x, y]); }
      while (q.length) {
        const [x, y] = q.pop()!;
        for (const [dx, dy] of SIDES) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < W && ny < H && !outside[ny * W + nx] && E[ny][nx] < level) { outside[ny * W + nx] = 1; q.push([nx, ny]); }
        }
      }
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) if (E[y][x] < level && !outside[y * W + x]) E[y][x] = level;
    }
    // knolls too small to be worth climbing
    const seen = new Uint8Array(W * H);
    for (let y = 1; y < H - 1; y++)
      for (let x = 1; x < W - 1; x++) {
        if (seen[y * W + x] || E[y][x] < level) continue;
        const comp: Pt[] = [];
        const q: Pt[] = [[x, y]];
        seen[y * W + x] = 1;
        while (q.length) {
          const p = q.pop()!;
          comp.push(p);
          for (const [dx, dy] of SIDES) {
            const nx = p[0] + dx, ny = p[1] + dy;
            if (E[ny]?.[nx] >= level && !seen[ny * W + nx]) { seen[ny * W + nx] = 1; q.push([nx, ny]); }
          }
        }
        if (comp.length < (level === 1 ? 24 : 10)) for (const [cx, cy] of comp) E[cy][cx] = level - 1;
      }
  }
}

// ---------------------------------------------------------------- finding the way

/** A binary heap of (key, priority). */
class Heap {
  private readonly keys: number[] = [];
  private readonly pri: number[] = [];
  get size(): number { return this.keys.length; }
  push(k: number, p: number): void {
    const { keys, pri } = this;
    let i = keys.length;
    keys.push(k); pri.push(p);
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (pri[up] <= p) break;
      keys[i] = keys[up]; pri[i] = pri[up];
      i = up;
    }
    keys[i] = k; pri[i] = p;
  }
  pop(): number {
    const { keys, pri } = this;
    const top = keys[0], k = keys.pop()!, p = pri.pop()!;
    const n = keys.length;
    if (n) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && pri[c + 1] < pri[c]) c++;
        if (pri[c] >= p) break;
        keys[i] = keys[c]; pri[i] = pri[c];
        i = c;
      }
      keys[i] = k; pri[i] = p;
    }
    return top;
  }
}

/** The cheapest 4-way route from any of `starts` to a tile passing `goal` (null: none within `limit` tiles' worth of searching). */
function astar(starts: Pt[], goal: (x: number, y: number) => boolean, cost: (x: number, y: number) => number, target: Pt | null, limit = Infinity): Pt[] | null {
  const g = new Float64Array(W * H).fill(Infinity), from = new Int32Array(W * H).fill(-1), heap = new Heap();
  const h = (x: number, y: number) => (target ? (Math.abs(x - target[0]) + Math.abs(y - target[1])) * 0.9 : 0);
  for (const [x, y] of starts) { if (cost(x, y) === Infinity) continue; g[y * W + x] = 0; heap.push(y * W + x, h(x, y)); }
  let n = 0;
  while (heap.size && n++ < limit * 8) {
    const i = heap.pop(), x = i % W, y = (i - x) / W;
    if (goal(x, y)) {
      const out: Pt[] = [];
      for (let k = i; k >= 0; k = from[k]) out.push([k % W, Math.floor(k / W)]);
      return out.reverse();
    }
    for (const [dx, dy] of SIDES) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const c = cost(nx, ny);
      if (c === Infinity) continue;
      const j = ny * W + nx, ng = g[i] + c;
      if (ng < g[j]) { g[j] = ng; from[j] = i; heap.push(j, ng + h(nx, ny)); }
    }
  }
  return null;
}

/** Like astar, but over DIRS, and a step's cost may depend on the way it goes and the way the last one went. */
function astarDir(starts: Pt[], goal: (x: number, y: number) => boolean, cost: (x: number, y: number, d: number, prev: number, fx: number, fy: number) => number, target: Pt | null, limit = 150000): Pt[] | null {
  const N = W * H * 9;
  const g = new Float32Array(N).fill(Infinity), from = new Int32Array(N).fill(-1), heap = new Heap();
  const h = (x: number, y: number) => {
    if (!target) return 0;
    const a = Math.abs(x - target[0]), b = Math.abs(y - target[1]);
    return (Math.max(a, b) + 0.41 * Math.min(a, b)) * 1.8;
  };
  // state: tile * 9 + the way the last step went (8: none yet)
  for (const [x, y] of starts) { const s = (y * W + x) * 9 + 8; g[s] = 0; heap.push(s, h(x, y)); }
  let n = 0;
  while (heap.size && n++ < limit) {
    const s = heap.pop(), i = Math.floor(s / 9), prev = s % 9, x = i % W, y = (i - x) / W;
    if (goal(x, y)) {
      const out: Pt[] = [];
      for (let k = s; k >= 0; k = from[k]) { const t = Math.floor(k / 9); out.push([t % W, Math.floor(t / W)]); }
      return out.reverse();
    }
    for (let d = 0; d < 8; d++) {
      const nx = x + DIRS[d][0], ny = y + DIRS[d][1];
      if (nx < 1 || ny < 1 || nx >= W - 1 || ny >= H - 1) continue;
      const c = cost(nx, ny, d, prev === 8 ? -1 : prev, x, y);
      if (c === Infinity) continue;
      const t = (ny * W + nx) * 9 + d, ng = g[s] + c;
      if (ng < g[t]) { g[t] = ng; from[t] = s; heap.push(t, ng + h(nx, ny)); }
    }
  }
  return null;
}

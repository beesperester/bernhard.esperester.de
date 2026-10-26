import { Raster, hex, hash2, mulberry32, type RGB } from './raster.ts';
import { TILE, MAP_W, MAP_H, LEVEL, tileAt, levelAt, treeTiles, trunkBase } from '../world/map.ts';
import { SEASON, type Season } from '../world/season.ts';

const C = {
  g0: hex('#68b848'), g1: hex('#90d468'), g2: hex('#4c9a34'), g3: hex('#2e6e24'), g4: hex('#5aaa3e'), g5: hex('#78c454'),
  daisy: hex('#f8f8f0'), clover: hex('#b8e070'),
  p0: hex('#ecd8a0'), p1: hex('#d4b878'), p2: hex('#a88a52'),
  w0: hex('#4a8ce0'), w1: hex('#8cc4f8'), w2: hex('#2a5cb0'), w3: hex('#d8ecff'),
  h0: hex('#3c8c3a'), h1: hex('#5cac48'), h2: hex('#256a2a'), h3: hex('#163c1a'),
  m0: hex('#1e5424'),
  f0: hex('#f8f0d8'), f1: hex('#d0a870'), f2: hex('#7a5530'),
  r0: hex('#d8d8d0'), r1: hex('#b0b0a8'), r2: hex('#848480'), r3: hex('#4a4a48'),
  t0: hex('#a06a38'), t1: hex('#6a4220'), t2: hex('#3a2410'),
  c0: hex('#80cc58'), c1: hex('#54a83c'), c2: hex('#347c2c'), c3: hex('#1a4a1e'),
  yellow: hex('#f8d038'), orange: hex('#f89838'),
};

const FLOWERS: RGB[] = [hex('#f04858'), hex('#f8d838'), hex('#f8f8f8'), hex('#f890c8'), hex('#9878e8'), hex('#58a0f8')];

// the footbridge stands in the water, so shores don't form under it
const isWaterCh = (ch: string) => ch === 'w' || ch === 'l' || ch === 'B';
const isPathCh = (ch: string) => ch === 'p' || ch === 'B' || ch === 'g';

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
export const bayer = (x: number, y: number) => BAYER[(y & 3) * 4 + (x & 3)];

/** Smooth value noise in [0,1), deterministic. */
export function noise(x: number, y: number, s: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function grass(r: Raster, ox: number, oy: number, tx: number, ty: number, dark = 0): void {
  for (let y = 0; y < TILE; y++)
    for (let x = 0; x < TILE; x++) {
      const px = tx * TILE + x, py = ty * TILE + y;
      // large soft patches of darker and lighter green, dithered
      const n = noise(px / 56, py / 56, 2) * 0.7 + noise(px / 17, py / 17, 3) * 0.3 + dark;
      const d = bayer(px, py) * 0.16 - 0.08;
      let c = n + d > 0.62 ? C.g4 : n + d < 0.34 ? C.g5 : C.g0;
      if (n + d > 0.8) c = C.g2;
      const h = hash2(px, py, 1);
      if (h < 0.05) c = c === C.g5 ? C.g1 : C.g5;
      else if (h > 0.965) c = C.g2;
      r.set(ox + x, oy + y, c);
    }
  // little tufts and the odd daisy / clover
  for (let k = 0; k < 3; k++) {
    if (hash2(tx, ty, 10 + k) < 0.3) continue;
    const x = ox + 1 + Math.floor(hash2(tx, ty, 20 + k) * 12);
    const y = oy + 2 + Math.floor(hash2(tx, ty, 30 + k) * 11);
    r.set(x, y + 1, C.g2); r.set(x + 1, y + 2, C.g2); r.set(x + 2, y + 1, C.g2); r.set(x + 3, y, C.g2);
  }
  if (!dark && hash2(tx, ty, 90) < 0.18) {
    const x = ox + 2 + Math.floor(hash2(tx, ty, 91) * 12), y = oy + 2 + Math.floor(hash2(tx, ty, 92) * 12);
    const white = hash2(tx, ty, 93) < 0.6;
    r.set(x, y, white ? C.daisy : C.clover); r.set(x + 1, y + 1, white ? C.daisy : C.clover);
    r.set(x + 1, y, white ? C.yellow : C.clover); r.set(x, y + 1, C.g3);
  }
}


function tallGrass(r: Raster, ox: number, oy: number, tx: number, ty: number): void {
  grass(r, ox, oy, tx, ty, 0.25);
}

function flowers(r: Raster, ox: number, oy: number, tx: number, ty: number): void {
  grass(r, ox, oy, tx, ty);
  for (let y = 0; y < TILE; y++)
    for (let x = 0; x < TILE; x++) if (hash2(tx * TILE + x, ty * TILE + y, 4) < 0.12) r.set(ox + x, oy + y, C.g2);
  const spots: [number, number][] = [[3, 3], [11, 2], [7, 8], [2, 12], [12, 11]];
  for (const [i, [sx, sy]] of spots.entries()) {
    const col = FLOWERS[Math.floor(hash2(tx, ty, 40 + i) * FLOWERS.length)];
    const x = ox + sx + Math.floor(hash2(tx, ty, 50 + i) * 2);
    const y = oy + sy + Math.floor(hash2(tx, ty, 60 + i) * 2);
    r.set(x, y + 2, C.g3);
    r.set(x - 1, y, col); r.set(x + 1, y, col); r.set(x, y - 1, col); r.set(x, y + 1, col);
    r.set(x, y, col === FLOWERS[1] ? C.orange : C.yellow);
  }
}

function path(r: Raster, ox: number, oy: number, tx: number, ty: number): void {
  r.rect(ox, oy, TILE, TILE, C.p0);
  for (let y = 0; y < TILE; y++)
    for (let x = 0; x < TILE; x++) {
      const h = hash2(tx * TILE + x, ty * TILE + y, 5);
      if (h < 0.06) r.set(ox + x, oy + y, C.p1);
      else if (h < 0.075) r.set(ox + x, oy + y, C.p2);
    }
  const n = !isPathCh(tileAt(tx, ty - 1)), s = !isPathCh(tileAt(tx, ty + 1));
  const w = !isPathCh(tileAt(tx - 1, ty)), e = !isPathCh(tileAt(tx + 1, ty));
  for (let i = 0; i < TILE; i++) {
    const wob = hash2(tx * TILE + i, ty, 6) < 0.3 ? 1 : 0;
    if (n) { r.set(ox + i, oy, C.g0); r.set(ox + i, oy + wob, C.g0); r.set(ox + i, oy + 1 + wob, C.p1); }
    if (s) { r.set(ox + i, oy + 15, C.p2); r.set(ox + i, oy + 14, C.p1); }
    if (w) { r.set(ox, oy + i, C.g0); r.set(ox + wob, oy + i, C.g0); r.set(ox + 1 + wob, oy + i, C.p1); }
    if (e) { r.set(ox + 15, oy + i, C.g0); r.set(ox + 15 - wob, oy + i, C.g0); r.set(ox + 14 - wob, oy + i, C.p1); }
  }
}

function water(r: Raster, ox: number, oy: number, tx: number, ty: number, phase: number): void {
  r.rect(ox, oy, TILE, TILE, C.w0);
  for (let k = 0; k < 3; k++) {
    const x = ox + Math.floor(hash2(tx, ty, 70 + k) * 12) + (phase ? 1 : 0);
    const y = oy + 2 + k * 5 + Math.floor(hash2(tx, ty, 80 + k) * 2);
    r.set(x, y, C.w1); r.set(x + 1, y, C.w1); r.set(x + 2, y - 1 + phase, C.w1); r.set(x + 3, y, C.w1);
  }
  const n = !isWaterCh(tileAt(tx, ty - 1)), s = !isWaterCh(tileAt(tx, ty + 1));
  const w = !isWaterCh(tileAt(tx - 1, ty)), e = !isWaterCh(tileAt(tx + 1, ty));
  for (let i = 0; i < TILE; i++) {
    if (n) { r.set(ox + i, oy, C.g3); r.set(ox + i, oy + 1, C.p2); r.set(ox + i, oy + 2, C.w2); r.set(ox + i, oy + 3, C.w2); }
    if (s) { r.set(ox + i, oy + 15, C.g3); r.set(ox + i, oy + 14, C.p1); r.set(ox + i, oy + 13, C.w3); }
    if (w) { r.set(ox, oy + i, C.g3); r.set(ox + 1, oy + i, C.p1); r.set(ox + 2, oy + i, C.w3); }
    if (e) { r.set(ox + 15, oy + i, C.g3); r.set(ox + 14, oy + i, C.p1); r.set(ox + 13, oy + i, C.w3); }
  }
  // round the outside corners
  const corner = (cx: number, cy: number, dx: number, dy: number) => {
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4 - j; i++) r.set(cx + i * dx, cy + j * dy, C.g0);
    r.set(cx + 3 * dx, cy, C.g3); r.set(cx + 2 * dx, cy + dy, C.g3); r.set(cx + dx, cy + 2 * dy, C.g3); r.set(cx, cy + 3 * dy, C.g3);
    r.set(cx + 4 * dx, cy + dy, C.p1); r.set(cx + 3 * dx, cy + dy, C.p2);
    r.set(cx + 2 * dx, cy + 2 * dy, C.p1); r.set(cx + dx, cy + 3 * dy, C.p1); r.set(cx + dx, cy + 4 * dy, C.p1);
  };
  if (n && w) corner(ox, oy, 1, 1);
  if (n && e) corner(ox + 15, oy, -1, 1);
  if (s && w) corner(ox, oy + 15, 1, -1);
  if (s && e) corner(ox + 15, oy + 15, -1, -1);
}

const LILY = [
  '................',
  '................',
  '................',
  '.....oooo.......',
  '...oollllo......',
  '..olllldlo......',
  '..ollllp.lo.....',
  '..olll.pp.o.....',
  '..olldllllo.....',
  '...ollllloo.....',
  '....ooooo.......',
];

function hedge(r: Raster, ox: number, oy: number, tx: number, ty: number, tall = false): void {
  // maze hedges are a deeper green with a taller front face so they read as walls
  const [top, lit, face, line] = tall ? [C.h2, C.h0, C.m0, C.h3] : [C.h0, C.h1, C.h2, C.h3];
  const me = tileAt(tx, ty);
  r.rect(ox, oy, TILE, TILE, top);
  for (let y = 0; y < TILE; y++)
    for (let x = 0; x < TILE; x++) {
      const h = hash2(tx * TILE + x, ty * TILE + y, 7);
      if ((x + (y % 4 < 2 ? 0 : 2)) % 4 === 0 && y % 2 === 0) r.set(ox + x, oy + y, lit);
      else if (h < 0.12) r.set(ox + x, oy + y, tall ? C.h3 : C.h2);
    }
  const isH = (x: number, y: number) => tileAt(x, y) === me;
  const n = !isH(tx, ty - 1), s = !isH(tx, ty + 1), w = !isH(tx - 1, ty), e = !isH(tx + 1, ty);
  const faceTop = tall ? 6 : 10;
  for (let i = 0; i < TILE; i++) {
    if (n) { r.set(ox + i, oy, line); r.set(ox + i, oy + 1, tall ? C.h1 : C.h1); }
    if (s) {
      for (let k = faceTop; k < 15; k++) r.set(ox + i, oy + k, (i + k) % 3 === 0 ? line : face);
      if (tall) for (let k = faceTop; k < 15; k += 3) if (hash2(tx * TILE + i, ty + k, 8) < 0.3) r.set(ox + i, oy + k, C.h2);
      r.set(ox + i, oy + faceTop - 1, line);
      r.set(ox + i, oy + 15, line);
    }
    if (w) r.set(ox, oy + i, line);
    if (e) r.set(ox + 15, oy + i, line);
  }
}

/** Wooden footbridge over the stream: boards across the walking direction, rails along it. */
function bridge(r: Raster, ox: number, oy: number, tx: number, ty: number, phase: number): void {
  water(r, ox, oy, tx, ty, phase);
  const vertical = isPathCh(tileAt(tx, ty - 1)) || isPathCh(tileAt(tx, ty + 1));
  for (let a = 0; a < TILE; a++)
    for (let b = 2; b < 14; b++) {
      // a: along the walking direction, b: across it
      const board = a % 4 === 3 ? C.t2 : hash2(tx * TILE + a, ty * TILE + b, 9) < 0.12 ? C.t1 : a % 4 === 0 ? C.f1 : C.t0;
      const [x, y] = vertical ? [b, a] : [a, b];
      r.set(ox + x, oy + y, b === 2 || b === 13 ? C.t2 : board);
    }
  // rails with posts at both ends, along each side
  for (const side of [0, 14])
    for (let a = 0; a < TILE; a++) {
      const post = a < 2 || a > 13;
      for (let k = 0; k < 2; k++) {
        const c = k === 0 ? C.t0 : C.t2;
        const [x, y] = vertical ? [side + k, a] : [a, side + k];
        r.set(ox + x, oy + y, post ? C.t2 : c);
      }
    }
}

function fence(r: Raster, ox: number, oy: number, tx: number, ty: number): void {
  grass(r, ox, oy, tx, ty);
  const horiz = ty === 0 || ty === MAP_H - 1;
  const corner = (tx === 0 || tx === MAP_W - 1) && horiz;
  if (horiz && !corner) {
    // rails
    for (let x = 0; x < TILE; x++) {
      r.set(ox + x, oy + 6, C.f2); r.set(ox + x, oy + 7, C.f1); r.set(ox + x, oy + 8, C.f2);
      r.set(ox + x, oy + 11, C.f2); r.set(ox + x, oy + 12, C.f1); r.set(ox + x, oy + 13, C.f2);
    }
    // pickets
    for (let p = 0; p < 4; p++) {
      const x = ox + p * 4;
      r.set(x + 1, oy + 1, C.f2);
      for (let y = 2; y < 15; y++) { r.set(x, y + oy, C.f2); r.set(x + 1, y + oy, C.f0); r.set(x + 2, y + oy, C.f1); }
      r.set(x + 1, oy + 2, C.f0); r.set(x, oy + 2, C.f2); r.set(x + 2, oy + 2, C.f2);
      for (let k = 0; k < 3; k++) r.set(x + k, oy + 15, C.f2);
      r.set(x + 3, oy + 15, C.g3);
    }
  } else if (!corner) {
    for (let y = 0; y < TILE; y++) { r.set(ox + 6, oy + y, C.f2); r.set(ox + 7, oy + y, C.f0); r.set(ox + 8, oy + y, C.f1); r.set(ox + 9, oy + y, C.f2); }
    post(r, ox + 4, oy + 9);
  } else {
    post(r, ox + 4, oy + 4);
  }
}

function post(r: Raster, x: number, y: number): void {
  r.rect(x, y, 8, 7, C.f2);
  r.rect(x + 1, y, 6, 5, C.f0);
  r.rect(x + 1, y + 4, 6, 2, C.f1);
  r.rect(x + 1, y + 7, 7, 1, C.g3);
}

function gate(r: Raster, ox: number, oy: number, tx: number, ty: number): void {
  path(r, ox, oy, tx, ty);
  const left = tileAt(tx - 1, ty) !== 'g';
  r.rect(ox, oy + 3, TILE, 12, C.t1);
  for (let x = 0; x < TILE; x += 3) r.rect(ox + x, oy + 3, 2, 12, C.t0);
  r.rect(ox, oy + 7, TILE, 1, C.t2);
  r.rect(ox, oy + 11, TILE, 1, C.t2);
  r.rect(ox, oy + 14, TILE, 1, C.t2);
  if (left) r.rect(ox, oy + 1, 3, 14, C.t2); else r.rect(ox + 13, oy + 1, 3, 14, C.t2);
}

const BUSH = [
  '................',
  '.....oooooo.....',
  '...oollllddoo...',
  '..ollllldllddo..',
  '.olllldlllldddo.',
  '.olllllllddlddo.',
  'olldlllldldddddo',
  'olllllddlddddddo',
  'olllldllddddd2do',
  'odllldddddd2dd2o',
  'oddddddddd2dd22o',
  '.oddd2ddd2dd22o.',
  '.od2dd22d222d2o.',
  '..oo22222222oo..',
  '....oooooooo....',
  '................',
];

const ROCK = [
  '................',
  '................',
  '................',
  '.....oooooo.....',
  '...oollllmmoo...',
  '..ollllllmmmmo..',
  '.olllllmmmmmmmo.',
  '.olllmmmmmmmddo.',
  'olmmmmmmmmmddddo',
  'ommmmmmmmmdddddo',
  'ommmmmdmmddddddo',
  '.oddmmmmdddddddo',
  '.oddddddddddddo.',
  '..oooooooooooo..',
  '...gggggggggg...',
  '................',
];

function fountain(r: Raster, ox: number, oy: number): void {
  // drawn once from the left tile, spanning two tiles
  for (let y = 0; y < TILE; y++)
    for (let x = 0; x < 32; x++) {
      const dx = (x - 15.5) / 15.5, dy = (y - 7.5) / 7.5;
      const d = dx * dx + dy * dy;
      if (d > 1) continue;
      let c: RGB = C.r1;
      if (d > 0.82) c = C.r3;
      else if (d > 0.5) c = dy < 0 ? C.r0 : C.r2;
      else c = d > 0.38 && dy < 0 ? C.w2 : C.w0;
      r.set(ox + x, oy + y, c);
    }
  for (const [x, y] of [[10, 6], [19, 9], [14, 10]]) { r.set(ox + x, oy + y, C.w1); r.set(ox + x + 1, oy + y, C.w1); }
  r.rect(ox + 14, oy + 3, 4, 5, C.r2);
  r.rect(ox + 15, oy + 1, 2, 4, C.w3);
  r.set(ox + 13, oy + 2, C.w1); r.set(ox + 18, oy + 2, C.w1);
}

/** Tiles whose look changes with the water's ripple phase. */
const RIPPLING = 'wlB';

/** Draw the ground of tile (tx, ty) with its top-left at (ox, oy) in `r`. */
function drawTile(r: Raster, ox: number, oy: number, tx: number, ty: number, phase: number): void {
  switch (tileAt(tx, ty)) {
    case ',': tallGrass(r, ox, oy, tx, ty); break;
    case 'f': flowers(r, ox, oy, tx, ty); break;
    case 'p': path(r, ox, oy, tx, ty); break;
    case 'w': water(r, ox, oy, tx, ty, phase); break;
    case 'l':
      water(r, ox, oy, tx, ty, phase);
      r.paint(LILY, ox + 1, oy + 2, { o: C.h3, l: C.h1, d: C.h0, p: FLOWERS[3] });
      break;
    case '#': hedge(r, ox, oy, tx, ty); break;
    case 'm': hedge(r, ox, oy, tx, ty, true); break;
    case 'B': bridge(r, ox, oy, tx, ty, phase); break;
    case 'F': fence(r, ox, oy, tx, ty); break;
    case 'g': gate(r, ox, oy, tx, ty); break;
    case 'b':
      grass(r, ox, oy, tx, ty);
      r.paint(BUSH, ox, oy, { o: C.h3, l: C.h1, d: C.h0, 2: C.h2 });
      break;
    case 'r':
      grass(r, ox, oy, tx, ty);
      r.paint(ROCK, ox, oy, { o: C.r3, l: C.r0, m: C.r1, d: C.r2, g: C.g2 });
      break;
    case 'o':
      // the fountain spans two tiles: draw it once, from its left half
      if (tileAt(tx - 1, ty) !== 'o') {
        grass(r, ox, oy, tx, ty);
        grass(r, ox + TILE, oy, tx + 1, ty);
        fountain(r, ox, oy);
      }
      break;
    default: grass(r, ox, oy, tx, ty);
  }
}

/** The static ground of the garden. `phase` alternates the water ripples (still while frozen). */
export function buildGround(phase: number, season: Season = SEASON): Raster {
  if (season.frozen) phase = 0;
  const r = new Raster(MAP_W * TILE, MAP_H * TILE);
  for (let ty = 0; ty < MAP_H; ty++) for (let tx = 0; tx < MAP_W; tx++) drawTile(r, tx * TILE, ty * TILE, tx, ty, phase);
  shadeUnderCliffs(r);
  applySeason(r, 0, 0, season);
  scatterLitter(r, season);
  return r;
}

/**
 * Both ripple phases of the ground. The second differs only on the water, so
 * rather than drawing the whole park twice (the slowest part of starting up)
 * it is a copy of the first with just the water tiles redrawn.
 */
export function buildGrounds(season: Season = SEASON): [Raster, Raster] {
  const still = buildGround(0, season);
  // frozen ponds don't ripple
  if (season.frozen) return [still, still];
  const rippled = new Raster(still.w, still.h);
  rippled.data.set(still.data);
  // each water tile is drawn together with its left neighbour, whose fallen
  // leaves can reach a pixel over the edge, then finished exactly like the whole map
  const pair = new Raster(2 * TILE, TILE);
  for (let ty = 0; ty < MAP_H; ty++)
    for (let tx = 0; tx < MAP_W; tx++) {
      if (!RIPPLING.includes(tileAt(tx, ty))) continue;
      pair.data.fill(0);
      drawTile(pair, 0, 0, tx - 1, ty, 1);
      drawTile(pair, TILE, 0, tx, ty, 1);
      const ox = (tx - 1) * TILE, oy = ty * TILE;
      shadeUnderCliffs(pair, ox, oy);
      applySeason(pair, ox, oy, season);
      scatterLitter(pair, season, ox, oy);
      for (let y = 0; y < TILE; y++) {
        const from = (y * pair.w + TILE) * 4, to = ((ty * TILE + y) * rippled.w + tx * TILE) * 4;
        rippled.data.set(pair.data.subarray(from, from + TILE * 4), to);
      }
    }
  return [still, rippled];
}

// ---------------------------------------------------------------- seasons

const key = (c: RGB) => (c[0] << 16) | (c[1] << 8) | c[2];
const lum = (c: RGB) => c[0] * 0.3 + c[1] * 0.55 + c[2] * 0.15;
const mixRGB = (a: RGB, b: RGB, t: number): RGB => [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)];

/** Snow in four tones, shadowed blue to sunlit white. */
export const SNOW: RGB[] = ['#7a8aa8', '#a2b2ca', '#c4d0e0', '#e2eaf4'].map(hex);
const SNOW_LINE = hex('#56607a');
const ICE: [RGB, RGB][] = [[C.w0, hex('#a6d4ec')], [C.w1, hex('#e2f4ff')], [C.w2, hex('#7aa8cc')], [C.w3, hex('#f2fbff')]];
/** Everything green or earthy that snow settles on, and the flowers that are gone under it. */
const SNOWY: RGB[] = [
  C.g0, C.g1, C.g2, C.g3, C.g4, C.g5, C.daisy, C.clover, C.yellow, C.orange, C.p0, C.p1, C.p2,
  C.h0, C.h1, C.h2, C.h3, C.m0, C.c0, C.c1, C.c2, C.c3, C.r0, ...FLOWERS,
  hex('#2e6e24'), hex('#4c9a34'), hex('#90d468'), hex('#5aaa3e'),
];
const GREENS: RGB[] = [C.g0, C.g1, C.g2, C.g3, C.g4, C.g5, C.clover, C.c0, C.c1, C.c2, C.c3];
const FLOWERY = new Set([...FLOWERS, C.daisy, C.yellow, C.orange].map(key));
/** The dark ones become the outlines of the snow, the rest a snow tone by brightness. */
function snowFor(c: RGB): RGB {
  if (c === C.h3 || c === C.g3 || c === C.c3 || lum(c) < 70) return SNOW_LINE;
  const l = lum(c);
  return SNOW[l < 110 ? 0 : l < 150 ? 1 : l < 200 ? 2 : 3];
}
/** Lawns going straw-coloured. */
export function drabFor(c: RGB, t: number): RGB {
  const l = lum(c);
  return mixRGB(c, [Math.min(255, l * 1.15 + 18), l * 1.0 + 4, l * 0.5], t);
}

/**
 * Dress a piece of garden art for the season: flowers gone over, lawns dull,
 * snow over everything, ice on the water. (ox, oy) is where it sits in the world.
 */
export function applySeason(r: Raster, ox: number, oy: number, s: Season = SEASON): void {
  const snowy = new Map(SNOWY.map((c) => [key(c), snowFor(c)]));
  const greens = new Map(GREENS.map((c) => [key(c), drabFor(c, s.drab)]));
  const ice = new Map(ICE.map(([a, b]) => [key(a), b]));
  for (let y = 0; y < r.h; y++)
    for (let x = 0; x < r.w; x++) {
      const i = (y * r.w + x) * 4;
      if (!r.data[i + 3]) continue;
      const k = (r.data[i] << 16) | (r.data[i + 1] << 8) | r.data[i + 2];
      const wx = ox + x, wy = oy + y;
      let c: RGB | undefined;
      if (s.frozen) c = ice.get(k);
      // snow settles patchily at first, then everywhere
      if (!c && s.snow > 0 && noise(wx / 20, wy / 20, 1203) * 0.8 + bayer(wx, wy) * 0.2 < s.snow * 1.25 - 0.1) c = snowy.get(k);
      // flowers: some still out, some gone over
      if (!c && FLOWERY.has(k) && hash2(wx >> 2, wy >> 2, 1204) >= s.bloom) c = hash2(wx, wy, 1205) < 0.5 ? C.g0 : C.g4;
      if (c) k === key(c) || r.set(x, y, c);
      if (s.drab > 0) {
        const g = greens.get(c ? key(c) : k);
        if (g) r.set(x, y, g);
      }
    }
}

const LEAF_COLOURS: RGB[] = ['#e8b030', '#e07828', '#c84828', '#a85a28', '#f0d058'].map(hex);

/** Fallen leaves on the grass, thickest under the trees. */
function scatterLitter(r: Raster, s: Season, ox = 0, oy = 0): void {
  if (s.litter <= 0 || s.snow >= 0.6) return;
  const amount = s.litter * (1 - s.snow);
  const grassy = new Set([...GREENS].map((c) => key(drabFor(c, s.drab))));
  const trees = treeTiles().map(([tx, ty]) => trunkBase(tx, ty));
  for (let y = 0; y < r.h; y += 1)
    for (let x = 0; x < r.w; x += 1) {
      // (hashed by world position, so a piece drawn on its own gets the same leaves)
      const wx = x + ox, wy = y + oy;
      const h = hash2(wx, wy, 1206);
      if (h > 0.05) continue;
      let p = amount * 0.06;
      for (const [bx, by] of trees) {
        const dx = (wx - bx) / 34, dy = (wy - by) / 16;
        const d = dx * dx + dy * dy;
        if (d < 1) p += amount * 0.9 * (1 - d);
      }
      if (h > p * 0.05) continue;
      const i = (y * r.w + x) * 4;
      if (!grassy.has((r.data[i] << 16) | (r.data[i + 1] << 8) | r.data[i + 2])) continue;
      const c = LEAF_COLOURS[Math.floor(hash2(wx, wy, 1207) * LEAF_COLOURS.length)];
      r.set(x, y, c);
      if (hash2(wx, wy, 1208) < 0.6) r.set(x + 1, y, c);
    }
}

/**
 * Which pixels of the ground art belong to things standing up from it (bushes,
 * rocks, hedges, fences, the gate, the fountain): drawn with and without the
 * object, the pixels that differ. Used to put sunlit rims on them.
 */
export function buildUprightMask(): Raster {
  const m = new Raster(MAP_W * TILE, MAP_H * TILE);
  for (let ty = 0; ty < MAP_H; ty++)
    for (let tx = 0; tx < MAP_W; tx++) {
      const ch = tileAt(tx, ty);
      if (!'brF#mgo'.includes(ch) || (ch === 'o' && tileAt(tx - 1, ty) === 'o')) continue;
      const w = ch === 'o' ? TILE * 2 : TILE;
      const bare = new Raster(w, TILE), full = new Raster(w, TILE);
      for (const r of [bare, full]) {
        if (ch === 'g') path(r, 0, 0, tx, ty);
        else { grass(r, 0, 0, tx, ty); if (ch === 'o') grass(r, TILE, 0, tx + 1, ty); }
      }
      switch (ch) {
        case 'b': full.paint(BUSH, 0, 0, { o: C.h3, l: C.h1, d: C.h0, 2: C.h2 }); break;
        case 'r': full.paint(ROCK, 0, 0, { o: C.r3, l: C.r0, m: C.r1, d: C.r2 }); break;
        case '#': hedge(full, 0, 0, tx, ty); break;
        case 'm': hedge(full, 0, 0, tx, ty, true); break;
        case 'F': fence(full, 0, 0, tx, ty); break;
        case 'g': gate(full, 0, 0, tx, ty); break;
        case 'o': fountain(full, 0, 0); break;
      }
      for (let i = 0; i < full.data.length; i += 4)
        if (full.data[i] !== bare.data[i] || full.data[i + 1] !== bare.data[i + 1] || full.data[i + 2] !== bare.data[i + 2]) {
          const px = (i / 4) % w, py = Math.floor(i / 4 / w);
          m.set(tx * TILE + px, ty * TILE + py, [255, 255, 255]);
        }
    }
  return m;
}

/** A soft dithered shadow on the ground at the foot of every cliff face. */
/** Darken the ground at the foot of each cliff. `r` covers the world from (ox, oy). */
function shadeUnderCliffs(r: Raster, ox = 0, oy = 0): void {
  const tx0 = Math.floor(ox / TILE), ty0 = Math.floor(oy / TILE);
  const tx1 = Math.ceil((ox + r.w) / TILE), ty1 = Math.ceil((oy + r.h) / TILE);
  for (let ty = Math.max(1, ty0); ty < Math.min(MAP_H, ty1); ty++)
    for (let tx = tx0; tx < Math.min(MAP_W, tx1); tx++) {
      const drop = levelAt(tx, ty - 1) - levelAt(tx, ty);
      if (drop <= 0 || tileAt(tx, ty) === 'S') continue;
      // the face above ends exactly at the top edge of this tile as it is drawn
      const y0 = ty * TILE;
      for (let y = 0; y < 5; y++)
        for (let x = 0; x < TILE; x++) {
          const wx = tx * TILE + x, wy = y0 + y;
          const px = wx - ox, py = wy - oy;
          if (px < 0 || py < 0 || px >= r.w || py >= r.h || bayer(wx, wy) > 1 - y / 5) continue;
          const k = (py * r.w + px) * 4;
          r.data[k] *= 0.75; r.data[k + 1] *= 0.8; r.data[k + 2] *= 0.85;
        }
    }
}

export interface Prop {
  raster: Raster;
  x: number;
  y: number;
  /** y used for depth sorting against cats (their feet). */
  depthY: number;
  /** 0, 1 green trees, 2 cherry, 3 apple. */
  kind: number;
}

// [highlight, light, mid, dark, outline]
const CANOPIES: { c: RGB[]; dots?: RGB[] }[] = [
  { c: ['#a6e070', '#72c050', '#4c9c3c', '#307430', '#173f1c'].map(hex) },
  { c: ['#7cc85e', '#52a242', '#378036', '#245c2a', '#10301a'].map(hex) },
  { c: ['#fff0f6', '#f9c0d8', '#ee92b8', '#c86492', '#5c2642'].map(hex), dots: [hex('#ffffff')] },
  { c: ['#a6e070', '#72c050', '#4c9c3c', '#307430', '#173f1c'].map(hex), dots: [hex('#e83838'), hex('#ff6a50')] },
];
const BARK = ['#b88048', '#86532a', '#5a3417', '#2e1a0a'].map(hex);
/** Autumn foliage: yellow, orange, red and russet, same tone order as the canopies. */
const AUTUMN: RGB[][] = [
  ['#fff2a8', '#f8d450', '#e0a430', '#b07420', '#4a2c10'].map(hex),
  ['#ffdc98', '#f8a444', '#d87028', '#a04818', '#4a2010'].map(hex),
  ['#ffb898', '#ea6444', '#c23a2a', '#862222', '#3e1010'].map(hex),
  ['#e8c890', '#c89458', '#9c6a38', '#6e4626', '#36200e'].map(hex),
];

export const TREE_W = 64;
export const TREE_H = 84;

/** A big tree built from many shaded leaf clumps, with branches, bark and roots. */
function tree(seed: number, kind: number, season: Season): Raster {
  const W = TREE_W, H = TREE_H, cx = W / 2, base = H - 1;
  const r = new Raster(W, H);
  const rnd = mulberry32(seed * 977 + kind * 13);
  // the cherry blossoms first, then turns green like the others
  const pal = kind === 2 ? CANOPIES[0].c : CANOPIES[kind].c;
  /** Which palette each leafy pixel was painted from, for its outline. */
  const painted = new Map<number, RGB[]>();
  const rx = 24 + rnd() * 5, ry = 21 + rnd() * 4, ccy = 31;
  const trunkTop = ccy + 4;

  // trunk with bark lines, flaring into roots
  for (let y = trunkTop; y <= base; y++) {
    const flare = Math.max(0, y - (base - 5));
    const half = 4 + Math.floor((y - trunkTop) / 14) + Math.floor(flare * flare * 0.25);
    for (let x = cx - half; x < cx + half; x++) {
      const u = (x - (cx - half)) / (2 * half);
      let c = u < 0.1 ? BARK[3] : u < 0.35 ? BARK[0] : u < 0.8 ? BARK[1] : u < 0.92 ? BARK[2] : BARK[3];
      if (c !== BARK[3] && hash2(x, Math.floor(y / 3) + (x % 2), seed) < 0.18) c = BARK[2];
      if (y === base) c = BARK[3];
      r.set(x, y, c);
    }
  }
  // branches reaching up into the crown (all of them show once the leaves are gone)
  const branch = (x0: number, y0: number, x1: number, y1: number, th: number) => {
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
    for (let i = 0; i <= n; i++) {
      const t = i / n, x = Math.round(x0 + (x1 - x0) * t), y = Math.round(y0 + (y1 - y0) * t);
      const w = Math.max(1, Math.round(th * (1 - t * 0.6)));
      for (let k = 0; k < w; k++) r.set(x + k, y, k === 0 ? BARK[3] : k === 1 ? BARK[1] : BARK[2]);
    }
  };

  // the whole crown's limbs and twigs, hidden by the leaves in summer
  const limb = (x: number, y: number, a: number, len: number, th: number, depth: number) => {
    const x1 = x + Math.cos(a) * len, y1 = y + Math.sin(a) * len * 0.8;
    branch(Math.round(x), Math.round(y), Math.round(x1), Math.round(y1), th);
    if (depth >= 3) return;
    for (const da of [-0.5 - rnd() * 0.3, 0.4 + rnd() * 0.3]) limb(x1, y1, a + da, len * (0.55 + rnd() * 0.15), Math.max(1, th - 1), depth + 1);
  };
  for (const a of [-2.5, -1.95, -1.35, -0.75]) limb(cx - 1 + (a < -1.6 ? -1 : 1), trunkTop + 2, a + (rnd() - 0.5) * 0.25, 11 + rnd() * 5, 3, 0);

  // leaf clumps: an outer ring for the silhouette plus a filled interior
  type Clump = { x: number; y: number; r: number };
  const clumps: Clump[] = [];
  const ring = 13 + Math.floor(rnd() * 4);
  for (let i = 0; i < ring; i++) {
    const a = (i / ring) * Math.PI * 2 + rnd() * 0.3;
    clumps.push({ x: cx + Math.cos(a) * rx * 0.82, y: ccy + Math.sin(a) * ry * 0.82, r: 6 + rnd() * 3.5 });
  }
  for (let i = 0; i < 16; i++) {
    const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * 0.65;
    clumps.push({ x: cx + Math.cos(a) * rx * d, y: ccy + Math.sin(a) * ry * d - 2, r: 7 + rnd() * 4 });
  }
  clumps.sort((a, b) => a.y - b.y);

  const drawClump = (c: Clump, i: number) => {
    // some clumps have dropped their leaves; the rest may have turned (or be blossom)
    const roll = hash2(i, seed, 1301);
    const blossom = kind === 2 && roll < season.blossom;
    if (!blossom && roll >= season.leaves) return;
    const pal = blossom ? CANOPIES[2].c
      : hash2(i, seed, 1302) < season.turn ? AUTUMN[Math.floor(hash2(i, seed, 1303) * AUTUMN.length)]
      : kind === 2 ? CANOPIES[0].c : CANOPIES[kind].c;
    for (let y = Math.floor(c.y - c.r); y <= c.y + c.r; y++)
      for (let x = Math.floor(c.x - c.r); x <= c.x + c.r; x++) {
        const dx = x + 0.5 - c.x, dy = y + 0.5 - c.y, d = Math.hypot(dx, dy);
        if (d > c.r) continue;
        // soft dark rim only on the shadow side; the silhouette is outlined later
        if (d > c.r - 1.2 && dx + dy > -c.r * 0.2) { r.set(x, y, pal[3]); painted.set(y * W + x, pal); continue; }
        // light from the top-left plus the clump's place in the crown
        const crown = ((c.x - cx) / rx) * 0.25 + ((c.y - ccy) / ry) * 0.45;
        const l = -(dx * 0.55 + dy * 0.85) / c.r - crown + (bayer(x, y) - 0.5) * 0.35 + (hash2(x, y, seed + i) - 0.5) * 0.25;
        let tone = l > 0.55 ? 0 : l > 0.05 ? 1 : l > -0.45 ? 2 : 3;
        // leaf speckle
        const h = hash2(x, y, seed * 7 + i);
        if (h < 0.07 && tone > 0) tone--;
        else if (h > 0.95 && tone < 3) tone++;
        r.set(x, y, pal[tone]);
        painted.set(y * W + x, pal);
      }
    // a few leaf glints
    for (let k = 0; k < 2; k++) {
      const gx = Math.round(c.x - c.r * 0.4 + rnd() * 3), gy = Math.round(c.y - c.r * 0.45 + rnd() * 2);
      r.set(gx, gy, pal[0]); r.set(gx + 1, gy, pal[0]); r.set(gx + 1, gy - 1, pal[0]);
    }
  };

  const back = clumps.filter((c) => c.y < ccy - 3);
  const front = clumps.filter((c) => c.y >= ccy - 3);
  back.forEach(drawClump);
  branch(cx - 3, trunkTop + 4, cx - 14, ccy + 2, 3);
  branch(cx + 1, trunkTop + 3, cx + 12, ccy, 3);
  front.forEach((c, i) => {
    // leave a couple of gaps low in the crown so branches show through
    if (c.y > ccy + 2 && Math.abs(c.x - cx) < 10 && i % 3 === 0) return;
    drawClump(c, i + back.length);
  });

  // the apple tree: white blossom in spring, red apples late in the summer; the cherry's white highlights only in blossom
  const dots = kind === 3 ? (season.appleBlossom > 0.3 ? [hex('#ffffff'), hex('#f8d8e8')] : season.apples > 0.3 ? CANOPIES[3].dots : undefined)
    : kind === 2 && season.blossom > 0.3 ? CANOPIES[2].dots : undefined;
  if (dots)
    for (let k = 0; k < 30; k++) {
      const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * 0.9;
      const x = Math.round(cx + Math.cos(a) * rx * d), y = Math.round(ccy + Math.sin(a) * ry * d);
      if (!painted.has(y * W + x - 1) || !painted.has((y + 2) * W + x + 2)) continue;
      const c = dots[k % dots.length];
      r.set(x, y, c); r.set(x + 1, y, c); r.set(x, y + 1, c); r.set(x + 1, y + 1, painted.get(y * W + x)?.[3] ?? pal[3]);
    }

  // outline the silhouette of the crown
  const leafy = (x: number, y: number) => {
    if (!r.isSet(x, y)) return false;
    const i = (y * W + x) * 4;
    return !BARK.some((b) => b[0] === r.data[i] && b[1] === r.data[i + 1] && b[2] === r.data[i + 2]);
  };
  const edge: [number, number][] = [];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (leafy(x, y) && (!r.isSet(x - 1, y) || !r.isSet(x + 1, y) || !r.isSet(x, y - 1) || !r.isSet(x, y + 1))) edge.push([x, y]);
  for (const [x, y] of edge) r.set(x, y, (painted.get(y * W + x) ?? pal)[4]);

  // canopy shade falling onto the upper trunk
  for (let y = trunkTop; y < trunkTop + 8; y++)
    for (let x = cx - 6; x < cx + 6; x++) {
      const i = (y * W + x) * 4;
      if (r.data[i + 3] && r.data[i] < 200 && (y - trunkTop < 4 || bayer(x, y) > 0.5)) {
        const isBark = BARK.some((b) => b[0] === r.data[i] && b[1] === r.data[i + 1]);
        if (isBark) r.set(x, y, BARK[2]);
      }
    }
  // snow lying along the tops of the branches and on what's left of the leaves
  if (season.snow > 0)
    for (let x = 0; x < W; x++)
      for (let y = 1; y < base - 6; y++)
        if (r.isSet(x, y) && !r.isSet(x, y - 1) && hash2(x, y, seed + 1304) < season.snow) {
          r.set(x, y, SNOW[3]);
          if (r.isSet(x, y + 1) && hash2(x, y, seed + 1305) < 0.5) r.set(x, y + 1, SNOW[1]);
        }
  return r;
}

export function buildProps(season: Season = SEASON): Prop[] {
  return treeTiles().map(([tx, ty], i) => {
    const h = hash2(tx, ty, 55);
    const kind = h < 0.22 ? 2 : h < 0.36 ? 3 : h < 0.6 ? 1 : 0;
    const [bx, by] = trunkBase(tx, ty);
    // trees on raised ground are drawn lifted with it
    const lift = levelAt(tx, ty) * LEVEL;
    return {
      raster: tree(i + 1, kind, season),
      x: bx - TREE_W / 2,
      y: by - (TREE_H - 1) - lift,
      depthY: by,
      kind,
    };
  });
}

/** Opaque where the pond shows open water (not shore, not lily pads). */
export function buildWaterMask(g0: Raster, g1: Raster): Raster {
  const m = new Raster(g0.w, g0.h);
  const open = new Set([key(C.w0), key(C.w1)]);
  const isWater = (r: Raster, i: number) => open.has((r.data[i] << 16) | (r.data[i + 1] << 8) | r.data[i + 2]);
  for (let y = 0; y < m.h; y++)
    for (let x = 0; x < m.w; x++) {
      const i = (y * m.w + x) * 4;
      if (isWater(g0, i) || isWater(g1, i)) m.set(x, y, [255, 255, 255]);
    }
  return m;
}

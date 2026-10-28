import { Raster, hex, hash2, type RGB } from './raster.ts';
import { TILE, MAP_W, MAP_H, isChannel, tileAt, levelAt, treeTiles, trunkBase } from '../world/map.ts';
import { SEASON, type Season } from '../world/season.ts';
import { DEFAULT_LIGHT, sunLight, type ScreenLight } from './lighting.ts';
import { LEGEND, isPath, isStairs, isWaterway } from '../world/legend.ts';
import { trackPoints } from '../world/track.ts';

const C = {
  g0: hex('#68b848'), g1: hex('#90d468'), g2: hex('#4c9a34'), g3: hex('#2e6e24'), g4: hex('#5aaa3e'), g5: hex('#78c454'),
  daisy: hex('#f8f8f0'), clover: hex('#b8e070'),
  p0: hex('#ecd8a0'), p1: hex('#d4b878'), p2: hex('#a88a52'),
  w0: hex('#4a8ce0'), w1: hex('#8cc4f8'), w2: hex('#2a5cb0'), w3: hex('#d8ecff'),
  // the water's edge: in the shade of the bank, and wet earth catching the light
  wb: hex('#2b4744'), we: hex('#7d9479'),
  h0: hex('#3c8c3a'), h1: hex('#5cac48'), h2: hex('#256a2a'), h3: hex('#163c1a'),
  m0: hex('#1e5424'),
  f0: hex('#f8f0d8'), f1: hex('#d0a870'), f2: hex('#7a5530'),
  r0: hex('#d8d8d0'), r1: hex('#b0b0a8'), r2: hex('#848480'), r3: hex('#4a4a48'),
  t0: hex('#a06a38'), t1: hex('#6a4220'), t2: hex('#3a2410'),
  c0: hex('#80cc58'), c1: hex('#54a83c'), c2: hex('#347c2c'), c3: hex('#1a4a1e'),
  yellow: hex('#f8d038'), orange: hex('#f89838'),
  // a themed zone's floor: warm sand laid with worn flagstones
  z0: hex('#e6c48a'), z1: hex('#d2a868'), z2: hex('#f2dcae'),
};

const FLOWERS: RGB[] = [hex('#f04858'), hex('#f8d838'), hex('#f8f8f8'), hex('#f890c8'), hex('#9878e8'), hex('#58a0f8')];

// the footbridge stands in the water, so shores don't form under it
const isWaterCh = isWaterway;
const isPathCh = isPath;

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
export const bayer = (x: number, y: number) => BAYER[(y & 3) * 4 + (x & 3)];

/** Lattice values of the noise are remembered per seed for this many points each way (the map needs fewer). */
const LATTICE = 160;
const lattices = new Map<number, Float64Array>();

/** The noise's random value at lattice point (xi, yi): hash2, looked up once and then remembered. */
function latticeAt(xi: number, yi: number, s: number): number {
  if (xi < 0 || yi < 0 || xi >= LATTICE || yi >= LATTICE) return hash2(xi, yi, s);
  let values = lattices.get(s);
  if (!values) lattices.set(s, (values = new Float64Array(LATTICE * LATTICE).fill(-1)));
  const i = yi * LATTICE + xi;
  let v = values[i];
  if (v < 0) values[i] = v = hash2(xi, yi, s);
  return v;
}

/** Smooth value noise in [0,1), deterministic. */
export function noise(x: number, y: number, s: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = latticeAt(xi, yi, s), b = latticeAt(xi + 1, yi, s), c = latticeAt(xi, yi + 1, s), d = latticeAt(xi + 1, yi + 1, s);
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

/** A themed zone's floor: worn flagstones in rows, half a stone offset, bedded in sand, edged like a path. */
function fairground(r: Raster, ox: number, oy: number, tx: number, ty: number): void {
  r.rect(ox, oy, TILE, TILE, C.z0);
  for (let y = 0; y < TILE; y++)
    for (let x = 0; x < TILE; x++) {
      const wx = tx * TILE + x, wy = ty * TILE + y;
      // (the joints between the stones, 8×8 with every other row shifted, a few stones missing)
      const row = Math.floor(wy / 8), sx = (wx + (row & 1) * 4) & 7, sy = wy & 7;
      const stone = hash2(Math.floor((wx + (row & 1) * 4) / 8), row, 9) > 0.15;
      if (stone && (sx === 0 || sy === 0)) r.set(ox + x, oy + y, C.z1);
      else if (stone && (sx === 1 || sy === 1) && hash2(wx, wy, 10) < 0.5) r.set(ox + x, oy + y, C.z2);
      else if (!stone && hash2(wx, wy, 11) < 0.08) r.set(ox + x, oy + y, C.p2);
    }
  const n = !isPathCh(tileAt(tx, ty - 1)), s = !isPathCh(tileAt(tx, ty + 1));
  const w = !isPathCh(tileAt(tx - 1, ty)), e = !isPathCh(tileAt(tx + 1, ty));
  for (let i = 0; i < TILE; i++) {
    const wob = hash2(tx * TILE + i, ty, 6) < 0.3 ? 1 : 0;
    if (n) { r.set(ox + i, oy, C.g0); r.set(ox + i, oy + wob, C.g0); r.set(ox + i, oy + 1 + wob, C.z1); }
    if (s) { r.set(ox + i, oy + 15, C.p2); r.set(ox + i, oy + 14, C.z1); }
    if (w) { r.set(ox, oy + i, C.g0); r.set(ox + wob, oy + i, C.g0); r.set(ox + 1 + wob, oy + i, C.z1); }
    if (e) { r.set(ox + 15, oy + i, C.g0); r.set(ox + 15 - wob, oy + i, C.g0); r.set(ox + 14 - wob, oy + i, C.z1); }
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
    if (n) { r.set(ox + i, oy, C.g3); r.set(ox + i, oy + 1, C.p2); r.set(ox + i, oy + 2, C.wb); r.set(ox + i, oy + 3, C.wb); }
    if (s) { r.set(ox + i, oy + 15, C.g3); r.set(ox + i, oy + 14, C.p1); r.set(ox + i, oy + 13, C.we); }
    if (w) { r.set(ox, oy + i, C.g3); r.set(ox + 1, oy + i, C.p1); r.set(ox + 2, oy + i, C.we); }
    if (e) { r.set(ox + 15, oy + i, C.g3); r.set(ox + 14, oy + i, C.p1); r.set(ox + 13, oy + i, C.we); }
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

const RAIL_DECK = { d: hex('#4a2e1a'), b: hex('#6e4426'), l: hex('#8a5a32') };
const GIRDER = { d: hex('#2e3a4a'), b: hex('#4a5e74'), l: hex('#7088a0') };
/** Half the deck's width, and how far its girders' outer edge is off the line (px). */
const DECK_IN = 5.5, DECK_OUT = 7;

/** The track's samples near each tile (by ty * MAP_W + tx), to measure from. */
let railNear: Map<number, number[]> | null = null;
function samplesNear(tx: number, ty: number): number[] {
  if (!railNear) {
    railNear = new Map();
    const { xs, ys } = trackPoints();
    for (let i = 0; i < xs.length; i++)
      for (let y = Math.floor((ys[i] - 12) / TILE); y <= Math.floor((ys[i] + 12) / TILE); y++)
        for (let x = Math.floor((xs[i] - 12) / TILE); x <= Math.floor((xs[i] + 12) / TILE); x++) {
          const k = y * MAP_W + x;
          (railNear.get(k) ?? railNear.set(k, []).get(k)!).push(i);
        }
  }
  return railNear.get(ty * MAP_W + tx) ?? [];
}

/**
 * The railway's bridge over the water: a timber deck the width of the track, following it round
 * its bends, with a steel girder along each side. Its piers and the girders' faces stand out into
 * the water round it, so they're drawn with the rest of the railway (art/railway.ts), above the
 * water's reflections, as are the sleepers and rails.
 */
function railBridge(r: Raster, ox: number, oy: number, tx: number, ty: number, phase: number): void {
  water(r, ox, oy, tx, ty, phase);
  const near = samplesNear(tx, ty);
  if (!near.length) return;
  const { xs, ys } = trackPoints();
  const n = xs.length;
  const closest = (x: number, y: number) => near.reduce((b, i) => ((xs[i] - x) ** 2 + (ys[i] - y) ** 2 < (xs[b] - x) ** 2 + (ys[b] - y) ** 2 ? i : b), near[0]);
  for (let y = 0; y < TILE; y++)
    for (let x = 0; x < TILE; x++) {
      const wx = tx * TILE + x + 0.5, wy = ty * TILE + y + 0.5;
      const i = closest(wx, wy);
      const a = (i + n - 1) % n, b = (i + 1) % n;
      const dx = xs[b] - xs[a], dy = ys[b] - ys[a], len = Math.hypot(dx, dy) || 1;
      // across the line
      const ak = Math.abs((wx - xs[i]) * (-dy / len) + (wy - ys[i]) * (dx / len));
      let c: RGB | null = null;
      if (ak <= DECK_IN) {
        // planks along the track, a seam every third px across
        c = Math.round(ak + 100) % 3 === 0 ? RAIL_DECK.d : hash2(Math.round(wx), Math.round(wy), 1904) < 0.15 ? RAIL_DECK.l : RAIL_DECK.b;
      } else if (ak <= DECK_OUT) c = ak > DECK_OUT - 0.75 ? GIRDER.d : ak > DECK_IN + 0.75 ? GIRDER.b : GIRDER.l;
      if (c) r.set(ox + x, oy + y, c);
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
  const left = tileAt(tx - 1, ty) !== tileAt(tx, ty);
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

/**
 * A round thing (a bush, a rock) lit by the sun: `art` is its picture, whose
 * characters in `tones` are its light, mid and dark shades. Each of those
 * pixels is shaded from which way the blob curves there; the picture's own
 * specks and patches are kept as an offset from how the default light would
 * shade it, so under that light it looks exactly as drawn.
 */
function litBlob(r: Raster, ox: number, oy: number, art: string[], fixed: Record<string, RGB>, tones: string, ramp: RGB[]): void {
  r.paint(art, ox, oy, fixed);
  let x0 = 99, y0 = 99, x1 = -1, y1 = -1;
  art.forEach((row, y) => [...row].forEach((ch, x) => {
    if (!tones.includes(ch)) return;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }));
  const mx = (x0 + x1 + 1) / 2, my = (y0 + y1 + 1) / 2, rx = (x1 - x0 + 1) / 2, ry = (y1 - y0 + 1) / 2;
  const shade = (nx: number, ny: number, L: ScreenLight) => {
    const v = (nx * L.x + ny * L.y) * L.k;
    return v > 0.35 ? 0 : v > -0.25 ? 1 : 2;
  };
  art.forEach((row, y) => [...row].forEach((ch, x) => {
    const drawn = tones.indexOf(ch);
    if (drawn < 0) return;
    const nx = (x + 0.5 - mx) / rx, ny = (y + 0.5 - my) / ry;
    const tone = Math.max(0, Math.min(2, shade(nx, ny, sunLight) + drawn - shade(nx, ny, DEFAULT_LIGHT)));
    r.set(ox + x, oy + y, ramp[tone]);
  }));
}

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


/** Paints a tile's worth of ground at (ox, oy) in `r` for map tile (tx, ty). */
type Painter = (r: Raster, ox: number, oy: number, tx: number, ty: number, phase: number) => void;

/**
 * How each kind of tile (see world/legend.ts) is drawn: the ground (grass
 * unless said otherwise), and anything standing up from it, which gets sunlit
 * rims and is drawn once from its leftmost tile if it spans several. A new
 * kind of tile needs an entry here.
 */
export const TILE_ART: Record<string, { ground?: Painter; upright?: Painter }> = {
  '.': {},
  T: {},
  P: {},
  H: {},
  S: {},
  ',': { ground: (r, ox, oy, tx, ty) => tallGrass(r, ox, oy, tx, ty) },
  f: { ground: (r, ox, oy, tx, ty) => flowers(r, ox, oy, tx, ty) },
  p: { ground: (r, ox, oy, tx, ty) => path(r, ox, oy, tx, ty) },
  Z: { ground: (r, ox, oy, tx, ty) => fairground(r, ox, oy, tx, ty) },
  w: { ground: water },
  '~': { ground: water },
  l: {
    ground: (r, ox, oy, tx, ty, phase) => {
      water(r, ox, oy, tx, ty, phase);
      r.paint(LILY, ox + 1, oy + 2, { o: C.h3, l: C.h1, d: C.h0, p: FLOWERS[3] });
    },
  },
  B: { ground: bridge },
  R: { ground: railBridge },
  '#': { upright: (r, ox, oy, tx, ty) => hedge(r, ox, oy, tx, ty) },
  m: { upright: (r, ox, oy, tx, ty) => hedge(r, ox, oy, tx, ty, true) },
  F: { upright: (r, ox, oy, tx, ty) => fence(r, ox, oy, tx, ty) },
  g: { ground: (r, ox, oy, tx, ty) => path(r, ox, oy, tx, ty), upright: (r, ox, oy, tx, ty) => gate(r, ox, oy, tx, ty) },
  b: { upright: (r, ox, oy) => litBlob(r, ox, oy, BUSH, { o: C.h3 }, 'ld2', [C.h1, C.h0, C.h2]) },
  r: { upright: (r, ox, oy) => litBlob(r, ox, oy, ROCK, { o: C.r3, g: C.g2 }, 'lmd', [C.r0, C.r1, C.r2]) },
  o: { upright: (r, ox, oy) => fountain(r, ox, oy) },
};

const lawn: Painter = (r, ox, oy, tx, ty) => grass(r, ox, oy, tx, ty);

/** How many tiles wide the thing on (tx, ty) is, or 0 if it's the right part of one drawn from further left. */
function spanAt(tx: number, ty: number): number {
  const ch = tileAt(tx, ty);
  const span = LEGEND[ch]?.span ?? 1;
  return span > 1 && tileAt(tx - 1, ty) === ch ? 0 : span;
}

/** Draw tile (tx, ty) with its top-left at (ox, oy) in `r`. */
function drawTile(r: Raster, ox: number, oy: number, tx: number, ty: number, phase: number): void {
  const span = spanAt(tx, ty);
  if (!span) return;
  const art = TILE_ART[tileAt(tx, ty)] ?? {};
  for (let i = 0; i < span; i++) (art.ground ?? lawn)(r, ox + i * TILE, oy, tx + i, ty, phase);
  art.upright?.(r, ox, oy, tx, ty, phase);
}

/** The static ground of the garden. `phase` alternates the water ripples (still while frozen). */
export function buildGround(phase: number, season: Season = SEASON): Raster {
  const r = new Raster(MAP_W * TILE, MAP_H * TILE);
  for (let ty = 0; ty < MAP_H; ty++)
    for (let tx = 0; tx < MAP_W; tx++) drawTile(r, tx * TILE, ty * TILE, tx, ty, season.frozen && !isChannel(tx, ty) ? 0 : phase);
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
  const rippled = new Raster(still.w, still.h);
  rippled.data.set(still.data);
  for (let ty = 0; ty < MAP_H; ty++)
    for (let tx = 0; tx < MAP_W; tx++) {
      // frozen ponds don't ripple (the streams still run)
      if (!isWaterway(tileAt(tx, ty)) || (season.frozen && !isChannel(tx, ty))) continue;
      const tile = groundTile(tx, ty, 1, season);
      for (let y = 0; y < TILE; y++) rippled.data.set(tile.data.subarray(y * TILE * 4, (y + 1) * TILE * 4), ((ty * TILE + y) * rippled.w + tx * TILE) * 4);
    }
  return [still, rippled];
}

/**
 * One tile of the ground, finished exactly as in the whole map: drawn together
 * with its left neighbour (whose fallen leaves can reach a pixel over the
 * edge), then shaded, dressed for the season and littered.
 */
export function groundTile(tx: number, ty: number, phase: number, season: Season = SEASON): Raster {
  const pair = new Raster(2 * TILE, TILE);
  drawTile(pair, 0, 0, tx - 1, ty, phase);
  drawTile(pair, TILE, 0, tx, ty, phase);
  const ox = (tx - 1) * TILE, oy = ty * TILE;
  shadeUnderCliffs(pair, ox, oy);
  applySeason(pair, ox, oy, season);
  scatterLitter(pair, season, ox, oy);
  const tile = new Raster(TILE, TILE);
  for (let y = 0; y < TILE; y++) tile.data.set(pair.data.subarray((y * pair.w + TILE) * 4, (y * pair.w + 2 * TILE) * 4), y * TILE * 4);
  return tile;
}

/** Tiles whose art is shaded by the sun (redrawn by groundTile as it moves). */
export const SUNLIT_TILES = new Set(['b', 'r']);

// ---------------------------------------------------------------- seasons

const key = (c: RGB) => (c[0] << 16) | (c[1] << 8) | c[2];
const lum = (c: RGB) => c[0] * 0.3 + c[1] * 0.55 + c[2] * 0.15;
const mixRGB = (a: RGB, b: RGB, t: number): RGB => [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)];

/** Snow in four tones, shadowed blue to sunlit white. */
export const SNOW: RGB[] = ['#7a8aa8', '#a2b2ca', '#c4d0e0', '#e2eaf4'].map(hex);
const SNOW_LINE = hex('#56607a');
const ICE: [RGB, RGB][] = [[C.w0, hex('#a6d4ec')], [C.w1, hex('#e2f4ff')], [C.w2, hex('#7aa8cc')], [C.w3, hex('#f2fbff')], [C.wb, hex('#7aa8cc')], [C.we, hex('#f2fbff')]];
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
      if (s.frozen && !isChannel(Math.floor(wx / TILE), Math.floor(wy / TILE))) c = ice.get(k);
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
      const art = TILE_ART[tileAt(tx, ty)];
      const span = spanAt(tx, ty);
      if (!art?.upright || !span) continue;
      const w = span * TILE;
      const bare = new Raster(w, TILE);
      for (let i = 0; i < span; i++) (art.ground ?? lawn)(bare, i * TILE, 0, tx + i, ty, 0);
      const full = new Raster(w, TILE);
      full.data.set(bare.data);
      art.upright(full, 0, 0, tx, ty, 0);
      for (let i = 0; i < full.data.length; i += 4)
        if (full.data[i] !== bare.data[i] || full.data[i + 1] !== bare.data[i + 1] || full.data[i + 2] !== bare.data[i + 2]) {
          const px = (i / 4) % w, py = Math.floor(i / 4 / w);
          m.set(tx * TILE + px, ty * TILE + py, [255, 255, 255]);
        }
    }
  return m;
}

/** A soft dithered shadow on the ground at the foot of every cliff face. `r` covers the world from (ox, oy). */
function shadeUnderCliffs(r: Raster, ox = 0, oy = 0): void {
  const tx0 = Math.floor(ox / TILE), ty0 = Math.floor(oy / TILE);
  const tx1 = Math.ceil((ox + r.w) / TILE), ty1 = Math.ceil((oy + r.h) / TILE);
  for (let ty = Math.max(1, ty0); ty < Math.min(MAP_H, ty1); ty++)
    for (let tx = tx0; tx < Math.min(MAP_W, tx1); tx++) {
      const drop = levelAt(tx, ty - 1) - levelAt(tx, ty);
      if (drop <= 0 || isStairs(tileAt(tx, ty))) continue;
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

import { Raster, hex, hash2, type RGB } from './raster.ts';
import { TILE, MAP_W, MAP_H, tileAt, treeTiles } from '../world/map.ts';

const C = {
  g0: hex('#68b848'), g1: hex('#90d468'), g2: hex('#4c9a34'), g3: hex('#2e6e24'),
  p0: hex('#ecd8a0'), p1: hex('#d4b878'), p2: hex('#a88a52'),
  w0: hex('#4a8ce0'), w1: hex('#8cc4f8'), w2: hex('#2a5cb0'), w3: hex('#d8ecff'),
  h0: hex('#3c8c3a'), h1: hex('#5cac48'), h2: hex('#256a2a'), h3: hex('#163c1a'),
  f0: hex('#f8f0d8'), f1: hex('#d0a870'), f2: hex('#7a5530'),
  r0: hex('#d8d8d0'), r1: hex('#b0b0a8'), r2: hex('#848480'), r3: hex('#4a4a48'),
  t0: hex('#a06a38'), t1: hex('#6a4220'), t2: hex('#3a2410'),
  c0: hex('#80cc58'), c1: hex('#54a83c'), c2: hex('#347c2c'), c3: hex('#1a4a1e'),
  yellow: hex('#f8d038'), orange: hex('#f89838'),
};

const FLOWERS: RGB[] = [hex('#f04858'), hex('#f8d838'), hex('#f8f8f8'), hex('#f890c8'), hex('#9878e8'), hex('#58a0f8')];

const isWaterCh = (ch: string) => ch === 'w' || ch === 'l';

function grass(r: Raster, ox: number, oy: number, tx: number, ty: number): void {
  r.rect(ox, oy, TILE, TILE, C.g0);
  for (let y = 0; y < TILE; y++)
    for (let x = 0; x < TILE; x++) {
      const h = hash2(tx * TILE + x, ty * TILE + y, 1);
      if (h < 0.05) r.set(ox + x, oy + y, C.g1);
      else if (h > 0.965) r.set(ox + x, oy + y, C.g2);
    }
  // two little tufts per tile
  for (let k = 0; k < 2; k++) {
    if (hash2(tx, ty, 10 + k) < 0.35) continue;
    const x = ox + 1 + Math.floor(hash2(tx, ty, 20 + k) * 12);
    const y = oy + 2 + Math.floor(hash2(tx, ty, 30 + k) * 11);
    r.set(x, y + 1, C.g2); r.set(x + 1, y + 2, C.g2); r.set(x + 2, y + 1, C.g2); r.set(x + 3, y, C.g2);
  }
}

const TALL = [
  '................',
  '..l.....l.......',
  '.ld.l..ld.l.....',
  '.dd.ld.dd.ld....',
  'odddddoodddddo..',
  '.oooooo..ooooo..',
  '......l.....l...',
  '.....ld.l..ld.l.',
  '.....dd.ld.dd.ld',
  '....odddddoodddd',
  '.....oooooo..ooo',
  '..l.............',
  '.ld.l.....l.....',
  '.dd.ld...ld.l...',
  'odddddo..dd.ld..',
  '.oooooo.odddddo.',
];

function tallGrass(r: Raster, ox: number, oy: number, tx: number, ty: number): void {
  grass(r, ox, oy, tx, ty);
  r.paint(TALL, ox, oy, { l: C.g1, d: C.g2, o: C.g3 }, hash2(tx, ty, 3) < 0.5);
}

function flowers(r: Raster, ox: number, oy: number, tx: number, ty: number): void {
  r.rect(ox, oy, TILE, TILE, C.g2);
  for (let y = 0; y < TILE; y++)
    for (let x = 0; x < TILE; x++) if (hash2(tx * TILE + x, ty * TILE + y, 4) < 0.25) r.set(ox + x, oy + y, C.g0);
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
  const n = tileAt(tx, ty - 1) !== 'p', s = tileAt(tx, ty + 1) !== 'p';
  const w = tileAt(tx - 1, ty) !== 'p', e = tileAt(tx + 1, ty) !== 'p';
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

function hedge(r: Raster, ox: number, oy: number, tx: number, ty: number): void {
  r.rect(ox, oy, TILE, TILE, C.h0);
  for (let y = 0; y < TILE; y++)
    for (let x = 0; x < TILE; x++) {
      const h = hash2(tx * TILE + x, ty * TILE + y, 7);
      if ((x + (y % 4 < 2 ? 0 : 2)) % 4 === 0 && y % 2 === 0) r.set(ox + x, oy + y, C.h1);
      else if (h < 0.12) r.set(ox + x, oy + y, C.h2);
    }
  const isH = (x: number, y: number) => tileAt(x, y) === '#';
  const n = !isH(tx, ty - 1), s = !isH(tx, ty + 1), w = !isH(tx - 1, ty), e = !isH(tx + 1, ty);
  for (let i = 0; i < TILE; i++) {
    if (n) { r.set(ox + i, oy, C.h3); r.set(ox + i, oy + 1, C.h1); }
    if (s) { for (let k = 10; k < 15; k++) r.set(ox + i, oy + k, (i + k) % 3 === 0 ? C.h3 : C.h2); r.set(ox + i, oy + 15, C.h3); }
    if (w) r.set(ox, oy + i, C.h3);
    if (e) r.set(ox + 15, oy + i, C.h3);
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

/** The static ground of the garden. `phase` alternates the water ripples. */
export function buildGround(phase: number): Raster {
  const r = new Raster(MAP_W * TILE, MAP_H * TILE);
  for (let ty = 0; ty < MAP_H; ty++)
    for (let tx = 0; tx < MAP_W; tx++) {
      const ox = tx * TILE, oy = ty * TILE;
      const ch = tileAt(tx, ty);
      switch (ch) {
        case ',': tallGrass(r, ox, oy, tx, ty); break;
        case 'f': flowers(r, ox, oy, tx, ty); break;
        case 'p': path(r, ox, oy, tx, ty); break;
        case 'w': water(r, ox, oy, tx, ty, phase); break;
        case 'l':
          water(r, ox, oy, tx, ty, phase);
          r.paint(LILY, ox + 1, oy + 2, { o: C.h3, l: C.h1, d: C.h0, p: FLOWERS[3] });
          break;
        case '#': hedge(r, ox, oy, tx, ty); break;
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
          if (tileAt(tx - 1, ty) !== 'o') {
            grass(r, ox, oy, tx, ty);
            grass(r, ox + TILE, oy, tx + 1, ty);
            fountain(r, ox, oy);
          }
          break;
        case 'T': {
          grass(r, ox, oy, tx, ty);
          for (let x = -6; x < 22; x++) for (let y = 10; y < 18; y++) {
            const dx = (x - 8) / 14, dy = (y - 14) / 4;
            if (dx * dx + dy * dy < 1) r.set(ox + x, oy + y, C.g2);
          }
          break;
        }
        default: grass(r, ox, oy, tx, ty);
      }
    }
  return r;
}

export interface Prop {
  raster: Raster;
  x: number;
  y: number;
  /** y used for depth sorting against cats (their feet). */
  depthY: number;
}

function tree(seed: number): Raster {
  const W = 32, H = 44;
  const r = new Raster(W, H);
  // trunk
  for (let y = 26; y < H - 2; y++)
    for (let x = 12; x < 20; x++) {
      const edge = x === 12 || x === 19;
      r.set(x, y, edge ? C.t2 : x < 15 ? C.t0 : x === 17 && y % 5 === 0 ? C.t2 : C.t1);
    }
  r.set(11, H - 3, C.t2); r.set(20, H - 3, C.t2); r.rect(12, H - 2, 8, 1, C.t2);
  // canopy: union of blobs
  const blobs: [number, number, number][] = [[16, 14, 13], [7, 19, 8], [25, 19, 8], [11, 9, 8], [21, 9, 8], [16, 22, 9]];
  const inside = (x: number, y: number) => blobs.some(([bx, by, br]) => (x - bx) ** 2 + (y - by) ** 2 < br * br);
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < W; x++) {
      if (!inside(x + 0.5, y + 0.5)) continue;
      const edge = !inside(x - 0.5, y + 0.5) || !inside(x + 1.5, y + 0.5) || !inside(x + 0.5, y - 0.5) || !inside(x + 0.5, y + 1.5);
      if (edge) { r.set(x, y, C.c3); continue; }
      // light from the top-left, leafy dither
      const l = (x - 16) * 0.5 + (y - 12) + (hash2(x, y, seed) - 0.5) * 9;
      const leaf = ((x >> 2) + (y >> 2)) % 2 === 0 && (x + y) % 4 === 0;
      let c = l < -6 ? C.c0 : l < 3 ? C.c1 : l < 11 ? C.c2 : C.c3;
      if (leaf && c !== C.c0) c = c === C.c1 ? C.c0 : C.c1;
      r.set(x, y, c);
    }
  return r;
}

export function buildProps(): Prop[] {
  return treeTiles().map(([tx, ty], i) => ({
    raster: tree(i + 1),
    x: tx * TILE - 8,
    y: ty * TILE + TILE - 44 + 2,
    depthY: ty * TILE + TILE - 1,
  }));
}

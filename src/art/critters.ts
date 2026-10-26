// Small ambient creatures and effects: butterflies, bees, koi, ripples, sleep Zs, dust.
import { Raster, hex, type RGB } from './raster.ts';

const OUTLINE = hex('#202020');

// butterfly: 7x5, frame 0 wings open, frame 1 wings up
const BUTTERFLY = [
  ['.aa.aa.', 'abaoaba', '.aaoaa.', '..aoa..', '.......'],
  ['.......', '..a.a..', '..aoa..', '..aoa..', '...o...'],
];
export const BUTTERFLY_COLOURS: [string, string][] = [
  ['#f8f8f0', '#404040'],
  ['#f8e048', '#d07818'],
  ['#f89830', '#302018'],
  ['#80b8f8', '#2848a8'],
  ['#f8a8d0', '#a03868'],
];

export function buildButterfly(i: number): Raster {
  const [a, b] = BUTTERFLY_COLOURS[i].map(hex);
  const r = new Raster(14, 5);
  BUTTERFLY.forEach((rows, f) => r.paint(rows, f * 7, 0, { a, b, o: OUTLINE }));
  return r;
}

// bee: 4x3, two wing frames
export function buildBee(): Raster {
  const r = new Raster(8, 3);
  const pal = { w: hex('#e8f4ff'), y: hex('#f8c828'), k: hex('#302010') };
  r.paint(['.ww.', 'ykyk', '....'], 0, 0, pal);
  r.paint(['w..w', 'ykyk', '....'], 4, 0, pal);
  return r;
}

// koi, facing right
export function buildFish(): Raster {
  const r = new Raster(9, 5);
  r.paint(
    ['....ooo..', 'o.ooxwxo.', 'oowxxxxeo', 'o.ooxxxo.', '....ooo..'],
    0, 0,
    { o: hex('#803010'), x: hex('#f88830'), w: hex('#fff4e8'), e: hex('#201008') },
  );
  return r;
}

/** Expanding elliptical ring, one frame per radius. */
export const RIPPLE_FRAMES = 6;
export const RIPPLE_W = 30;
export const RIPPLE_H = 14;
export function buildRipples(): Raster {
  const r = new Raster(RIPPLE_W * RIPPLE_FRAMES, RIPPLE_H);
  const c = hex('#d8ecff');
  for (let f = 0; f < RIPPLE_FRAMES; f++) {
    const rx = 3 + f * 2.3, ry = rx * 0.45;
    const cx = f * RIPPLE_W + RIPPLE_W / 2, cy = RIPPLE_H / 2;
    for (let a = 0; a < Math.PI * 2; a += 0.05) {
      // leave a gap at the back so it reads as a ring on water, not a hoop
      if (f > 1 && Math.sin(a) < -0.85) continue;
      r.set(Math.round(cx + Math.cos(a) * rx - 0.5), Math.round(cy + Math.sin(a) * ry - 0.5), c);
    }
  }
  return r;
}

/** A pixel letter z at a given size (3..7), white with a dark outline. */
export const Z_SIZES = [3, 4, 5, 6, 7];
export function buildZ(size: number): Raster {
  const r = new Raster(size + 2, size + 2);
  const white = hex('#f8f8ff');
  const on = new Set<string>();
  for (let x = 0; x < size; x++) { on.add(`${x},0`); on.add(`${x},${size - 1}`); }
  for (let y = 1; y < size - 1; y++) on.add(`${Math.round((size - 1) * (1 - y / (size - 1)))},${y}`);
  outlined(r, on, white, hex('#283048'));
  return r;
}

function outlined(r: Raster, on: Set<string>, fill: RGB, line: RGB): void {
  for (const k of on) {
    const [x, y] = k.split(',').map(Number);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) r.set(x + 1 + dx, y + 1 + dy, line);
  }
  for (const k of on) {
    const [x, y] = k.split(',').map(Number);
    r.set(x + 1, y + 1, fill);
  }
}

/** Little dust puff kicked up when dashing: 3 frames, 6x5. */
export function buildDust(): Raster {
  const r = new Raster(18, 5);
  const pal = { a: hex('#f0e8d0'), b: hex('#c8b890') };
  r.paint(['......', '..aa..', '.abba.', '..aa..', '......'], 0, 0, pal);
  r.paint(['..aa..', '.abbaa', 'abbbba', '.abba.', '..a...'], 6, 0, pal);
  r.paint(['.a..a.', 'a....a', '......', 'a....a', '.a.a..'], 12, 0, pal);
  return r;
}

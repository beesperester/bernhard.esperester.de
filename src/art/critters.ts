// Small ambient creatures and effects: butterflies, bees, koi, birds, frogs,
// fireflies, lanterns, glows, ripples, sleep Zs, dust.
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

/** Dark shape of a fish just below the surface, facing right. */
export function buildFishShadow(): Raster {
  const r = new Raster(10, 4);
  r.paint(['.....sss..', 's.sssssss.', 'sssssssss.', 's.ssss....'], 0, 0, { s: hex('#1a3a78') });
  return r;
}

/** A fish held in the mouth, facing left (head at the mouth): whole, half eaten, bones. */
export const HELD_W = 8;
export function buildHeldFish(): Raster {
  const r = new Raster(HELD_W * 3, 5);
  const pal = { o: hex('#803010'), x: hex('#f88830'), w: hex('#fff4e8'), e: hex('#201008'), b: hex('#f0ece0'), k: hex('#9a948a') };
  r.paint(['..ooo..o', '.oxwxooo', 'oexxxxxo', '.oxxxooo', '..ooo..o'], 0, 0, pal);
  r.paint(['..ooo...', '.oxwxo..', 'oexxxbkb', '.oxxo.k.', '..oo....'], HELD_W, 0, pal);
  r.paint(['..k.k..k', '.kbkbkkb', 'kbbbbbbb', '.kbkbkkb', '..k.k..k'], HELD_W * 2, 0, pal);
  return r;
}

// little garden birds, 9x7, facing left:
//   frame 0 standing, 1 pecking, 2 wings up, 3 wings down, 4 asleep (puffed up, head tucked in)
//   h head  b back  l breast  w wing  t tail  k beak  e eye  f feet
export const BIRD_W = 9;
export const BIRD_H = 7;
const BIRD = [
  ['.oo......', 'ohho.....', 'kehbooooo', 'olbbwwwto', 'olllbwwo.', '.ooooooo.', '..f..f...'],
  ['.........', '....oooo.', '...obwwto', '.oobbwwo.', 'ohhblbo..', 'kehllo...', '...f.f...'],
  ['...ooo...', '..owwo...', '.ooowooo.', 'kehbbbbto', '.olllbbo.', '..ooooo..', '.........'],
  ['.........', '.oo......', 'kehoooooo', 'olbbbbbto', '.oowwoo..', '...owo...', '....o....'],
  ['.........', '..ooooo..', '.obbbbbo.', 'ohbbwwwto', 'ohllbwwo.', '.oooooo..', '...f.f...'],
];
/** [head, back, breast, wing, beak] for a sparrow, a robin, a blue tit and a blackbird. */
export const BIRD_COLOURS: [string, string, string, string, string][] = [
  ['#8a5a34', '#a07048', '#e8d8b8', '#5a3820', '#e8b040'],
  ['#e86830', '#807058', '#f08048', '#5c5040', '#383028'],
  ['#3868d0', '#78a048', '#f0d848', '#3858b8', '#383028'],
  ['#2a262c', '#38323a', '#48404a', '#1c181e', '#f0a020'],
];

export function buildBird(i: number): Raster {
  const [h, b, l, w, k] = BIRD_COLOURS[i].map(hex);
  const pal = { o: OUTLINE, h, b, l, w, t: w, k, e: hex('#101010'), f: hex('#806048') };
  const r = new Raster(BIRD_W * BIRD.length, BIRD_H);
  BIRD.forEach((rows, f) => r.paint(rows, f * BIRD_W, 0, pal));
  return r;
}

/** A bird in the mouth, facing left (head at the mouth): whole, half eaten, a last tuft. */
export function buildHeldBird(i: number): Raster {
  const [h, b, l, w, k] = BIRD_COLOURS[i].map(hex);
  const pal = { o: OUTLINE, h, b, l, w, k, e: hex('#101010') };
  const r = new Raster(HELD_W * 3, 5);
  r.paint(['..oooo..', '.obbwwoo', 'ohbbwwwt', '.olllboo', '..oooo..'], 0, 0, pal);
  r.paint(['..oo....', '.obwo...', 'ohbwo...', '.olo....', '..o.....'], HELD_W, 0, pal);
  r.paint(['........', '.w......', 'w.b.....', '.l......', '........'], HELD_W * 2, 0, pal);
  return r;
}

/** A single loose feather drifting down, 3x2. */
export function buildFeather(i: number): Raster {
  const [, b, l] = BIRD_COLOURS[i].map(hex);
  const r = new Raster(3, 2);
  r.paint(['bl.', '.lb'], 0, 0, { b, l });
  return r;
}

/** A little "!" over a bird that has spotted a cat, 3x6. */
export function buildAlert(): Raster {
  const r = new Raster(3, 6);
  r.paint(['ooo', 'owo', 'owo', 'ooo', 'owo', 'ooo'], 0, 0, { o: OUTLINE, w: hex('#f8f8f0') });
  return r;
}

// frog, 10x7, facing left: frame 0 sitting, 1 croaking (throat puffed out)
export const FROG_W = 10;
export const FROG_H = 7;
export function buildFrog(): Raster {
  const pal = { o: hex('#1c3010'), g: hex('#58a838'), d: hex('#3c7828'), y: hex('#d8e8a0'), e: hex('#101008') };
  const r = new Raster(FROG_W * 2, FROG_H);
  r.paint(['..ooo.....', '.oeegoooo.', 'oggggggggo', 'oyyggggggo', '.oyyggdggo', '.oggoodggo', 'oooo.oooo.'], 0, 0, pal);
  r.paint(['..ooo.....', '.oeegoooo.', 'oggggggggo', 'yyyggggggo', 'yyyyggdggo', '.yygoodggo', 'oooo.oooo.'], FROG_W, 0, pal);
  return r;
}

/** A frog in the mouth, facing left: whole, half, a pair of legs. */
export function buildHeldFrog(): Raster {
  const pal = { o: hex('#1c3010'), g: hex('#58a838'), d: hex('#3c7828'), y: hex('#d8e8a0') };
  const r = new Raster(HELD_W * 3, 5);
  r.paint(['..oooo..', '.ogggdoo', 'ogggggdo', '.oyyoodo', '..oo..oo'], 0, 0, pal);
  r.paint(['..oo....', '.oggo...', 'ogggo...', '.oyo....', '..o.....'], HELD_W, 0, pal);
  r.paint(['........', '........', '...dd...', '..o.o...', '........'], HELD_W * 2, 0, pal);
  return r;
}

/** A firefly's body (1x2: dark back, glowing tail); the glow itself is a separate light. */
export function buildFirefly(): Raster {
  const r = new Raster(1, 2);
  r.set(0, 0, hex('#403820'));
  r.set(0, 1, hex('#f0ff90'));
  return r;
}

/** A round light, brightest in the middle, stepped in a few bands like the rest of the art. */
export function buildGlow(w: number, h: number, colour: RGB, bands = 5): Raster {
  const r = new Raster(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = (x + 0.5 - w / 2) / (w / 2), dy = (y + 0.5 - h / 2) / (h / 2);
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d >= 1) continue;
      const a = Math.ceil((1 - d) ** 1.6 * bands) / bands;
      r.set(x, y, colour, Math.round(a * 255));
    }
  return r;
}

// garden lantern, 6x16: frame 0 unlit, 1 lit
export const LANTERN_W = 6;
export const LANTERN_H = 16;
export function buildLantern(): Raster {
  const rows = ['.oooo.', 'oooooo', 'ogllgo', 'ogllgo', 'oooooo', '..oo..', '..om..', '..om..', '..om..', '..om..', '..om..', '..om..', '..om..', '..om..', '.oooo.', 'oooooo'];
  const r = new Raster(LANTERN_W * 2, LANTERN_H);
  const base = { o: hex('#26262c'), m: hex('#4a4a54'), g: hex('#3c3c44') };
  r.paint(rows, 0, 0, { ...base, l: hex('#707060') });
  r.paint(rows, LANTERN_W, 0, { ...base, l: hex('#fff0a0') });
  return r;
}

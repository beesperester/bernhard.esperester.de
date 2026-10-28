// Small ambient creatures and effects: butterflies, bees, koi, birds, frogs,
// fireflies, lanterns, glows, ripples, sleep Zs, dust.
import { Raster, hex, type RGB } from './raster.ts';

const OUTLINE = hex('#24181c');

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

/** Cartoon cloud left behind where a cat dashes off: 5 frames, PUFF_W x PUFF_H, swelling then breaking up. */
export const PUFF_W = 20, PUFF_H = 14, PUFF_FRAMES = 5;
export function buildDashPuff(): Raster {
  const r = new Raster(PUFF_W * PUFF_FRAMES, PUFF_H);
  const line = hex('#6a7090'), fill = hex('#fbf8ee'), shade = hex('#cfd2e0'), shine = hex('#ffffff');
  // blobs per frame: [x, y, radius], around the centre bottom of the frame
  const frames: [number, number, number][][] = [
    [[10, 9, 2.6], [7, 10, 1.8], [13, 10, 1.8]],
    [[10, 8, 3.6], [6, 10, 2.6], [14, 10, 2.6], [9, 5, 2]],
    [[10, 7, 4.2], [5, 9, 3.2], [15, 9, 3.2], [8, 4, 2.6], [13, 4, 2.2]],
    [[11, 6, 3], [3.5, 9, 2.6], [16.5, 9, 2.6], [7, 3, 2], [15, 3, 1.8]],
    [[11, 4, 1.8], [2.5, 9, 1.6], [17.5, 9, 1.6], [6, 2, 1.2]],
  ];
  frames.forEach((blobs, f) => {
    const ox = f * PUFF_W;
    const inside = (x: number, y: number) => blobs.find(([bx, by, br]) => (x + 0.5 - bx) ** 2 + (y + 0.5 - by) ** 2 <= br * br);
    for (let y = 0; y < PUFF_H; y++)
      for (let x = 0; x < PUFF_W; x++) {
        const b = inside(x, y);
        if (b) {
          const [bx, by, br] = b;
          const dx = x + 0.5 - bx, dy = y + 0.5 - by;
          r.set(ox + x, y, dx + dy > br * 0.55 ? shade : dx + dy < -br * 0.9 && br > 2 ? shine : fill);
        } else if (inside(x - 1, y) || inside(x + 1, y) || inside(x, y - 1) || inside(x, y + 1)) {
          if (x > 0 && x < PUFF_W - 1 && y > 0 && y < PUFF_H) r.set(ox + x, y, line);
        }
      }
  });
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
  // (a chunky old brass lamp with a fat glass, on a wrought post: warm even unlit)
  const rows = ['..oo..', '.obbo.', 'oglsgo', 'ollsgo', 'ollsgo', 'oglggo', '.obbo.', '..om..', '..om..', '..om..', '..om..', '..om..', '..om..', '.obbo.', 'obbbbo', 'oooooo'];
  const r = new Raster(LANTERN_W * 2, LANTERN_H);
  const base = { o: hex('#2a1c1e'), m: hex('#5a3e34'), b: hex('#a0703e') };
  r.paint(rows, 0, 0, { ...base, g: hex('#4a4450'), l: hex('#7a7468'), s: hex('#b0a890') });
  r.paint(rows, LANTERN_W, 0, { ...base, g: hex('#ffb85a'), l: hex('#ffe08a'), s: hex('#fff6d0') });
  return r;
}

// bat, 11x5, seen from below as it flits about: frame 0 wings up, 1 level, 2 down
export const BAT_W = 11;
export const BAT_H = 5;
const BAT = [
  ['w.........w', 'ww..o.o..ww', '.wwwooowww.', '....ooo....', '.....o.....'],
  ['...........', '....o.o....', 'wwwwooowwww', '.ww.ooo.ww.', '.....o.....'],
  ['...........', '....o.o....', '...wooow...', '.wwwooowww.', 'ww...o...ww'],
];
export function buildBat(): Raster {
  const r = new Raster(BAT_W * BAT.length, BAT_H);
  BAT.forEach((rows, f) => r.paint(rows, f * BAT_W, 0, { o: hex('#2e2634'), w: hex('#54465c') }));
  return r;
}

// field mouse, 8x5, side on, facing left: frame 0 sitting up, 1-2 running, 3 just the ears peeking out of the grass
export const MOUSE_W = 8, MOUSE_H = 5;
const MOUSE_PAL = () => ({ o: hex('#4a3830'), f: hex('#c8b098'), l: hex('#f0e4d0'), e: hex('#101010'), p: hex('#ffb8b0') });
export function buildMouse(): Raster {
  const r = new Raster(MOUSE_W * 4, MOUSE_H);
  const pal = MOUSE_PAL();
  r.paint(['..p.....', '.offoo..', 'eoffffo.', '.olllfo.', '..o..opp'], 0, 0, pal);
  r.paint(['........', '..p.....', '.offooo.', 'eoffffop', '.o.o.o.p'], MOUSE_W, 0, pal);
  r.paint(['........', '..p.....', '.offoooo', 'eofffffp', '..oo.o..'], MOUSE_W * 2, 0, pal);
  r.paint(['........', '........', '.p..p...', '.ofefo..', '........'], MOUSE_W * 3, 0, pal);
  return r;
}

/** A mouse held in the mouth, facing left: whole, half eaten, just the tail. */
export function buildHeldMouse(): Raster {
  const r = new Raster(HELD_W * 3, 5);
  const pal = MOUSE_PAL();
  r.paint(['.p......', 'ofoffoo.', 'effffffp', '.olllo.p', '........'], 0, 0, pal);
  r.paint(['.p......', 'ofoo....', 'effo....', '.olo....', '........'], HELD_W, 0, pal);
  r.paint(['........', '........', '...pp...', '.....p..', '........'], HELD_W * 2, 0, pal);
  return r;
}

/** A bat held in the mouth, facing left: whole, half eaten, a scrap of wing. */
export function buildHeldBat(): Raster {
  const pal = { o: hex('#2e2634'), w: hex('#54465c'), e: hex('#e8d8a0') };
  const r = new Raster(HELD_W * 3, 5);
  r.paint(['.o....o.', 'owo..oww', 'oewwwwwo', '.owwwow.', '..o..o..'], 0, 0, pal);
  r.paint(['.o......', 'owo.....', 'oewwo...', '.owo....', '..o.....'], HELD_W, 0, pal);
  r.paint(['........', '........', '..ow....', '...o....', '........'], HELD_W * 2, 0, pal);
  return r;
}

/** A bat hanging upside down under a branch, 11x7: frame 0 wrapped in its wings, 1 stretching them. */
export function buildHangingBat(): Raster {
  const r = new Raster(BAT_W * 2, 7);
  const pal = { o: hex('#2e2634'), w: hex('#54465c') };
  r.paint(['....o.o....', '....www....', '...wwwww...', '...wwoww...', '....wow....', '....ooo....', '....o.o....'], 0, 0, pal);
  r.paint(['....o.o....', '.w..www..w.', 'ww.wwwww.ww', 'wwwwwowwwww', '.ww.wow.ww.', '....ooo....', '....o.o....'], BAT_W, 0, pal);
  return r;
}

// tawny owl, 15x11, facing the viewer:
//   frame 0 sitting, 1 blinking, 2 looking to the side (flip for the other side), 3 flying wings up, 4 wings down
//   o outline  b back  l breast  f face  e eye  k beak and talons  w wing
export const OWL_W = 15;
export const OWL_H = 11;
const sit = (rows: string[]) => rows.map((r) => `...${r}...`);
const OWL = [
  sit(['.oo...oo.', 'obbooobbo', 'offfbfffo', 'ofefkfefo', 'obfffffbo', 'obblllbbo', 'owblllbwo', 'owblblbwo', 'owbllbbwo', '.owbbbwo.', '..kk.kk..']),
  sit(['.oo...oo.', 'obbooobbo', 'offfbfffo', 'ofbfkfbfo', 'obfffffbo', 'obblllbbo', 'owblllbwo', 'owblblbwo', 'owbllbbwo', '.owbbbwo.', '..kk.kk..']),
  sit(['.oo...oo.', 'obboooobo', 'offfbbbbo', 'oefkfebbo', 'offffbbbo', 'obblllbbo', 'owblllbwo', 'owblblbwo', 'owbllbbwo', '.owbbbwo.', '..kk.kk..']),
  ['ww...........ww', '.ww..oo.oo..ww.', '.wwwobbbbbowww.', '..wwofekefoww..', '...wobllbbow...', '.....oblbo.....', '......obo......', '.......o.......', '...............', '...............', '...............'],
  ['...............', '.....oo.oo.....', '....obbbbbo....', '.wwwofekefowww.', 'ww.wobllbbow.ww', 'w....oblbo....w', '......obo......', '.......o.......', '...............', '...............', '...............'],
];
const OWL_PAL = { o: hex('#2a1a10'), b: hex('#9a6638'), l: hex('#d8a868'), f: hex('#ecd0a0'), e: hex('#181008'), k: hex('#e8b040'), w: hex('#6a4020') };
export function buildOwl(): Raster {
  const r = new Raster(OWL_W * OWL.length, OWL_H);
  OWL.forEach((rows, f) => r.paint(rows, f * OWL_W, 0, OWL_PAL));
  return r;
}
/** Just the owl's eyes, frame for frame, to shine through the dark. */
export function buildOwlEyes(): Raster {
  const r = new Raster(OWL_W * OWL.length, OWL_H);
  OWL.forEach((rows, f) => r.paint(rows.map((row) => row.replace(/[^e]/g, '.')), f * OWL_W, 0, { e: hex('#ffd848') }));
  return r;
}

// beetle, 7x4, side on, facing left: two walking frames (legs swapped)
//   s shell  d spot or shine  h head  l legs
export const BEETLE_W = 7;
export const BEETLE_H = 4;
/** [shell, spot, head] for a ladybird, a black ground beetle and a green rose chafer. */
export const BEETLE_COLOURS: [string, string, string][] = [
  ['#d82820', '#181010', '#181010'],
  ['#2c2a34', '#6a6880', '#141218'],
  ['#3a9a48', '#a8e070', '#1c4a24'],
];
export function buildBeetle(i: number): Raster {
  const [s, d, h] = BEETLE_COLOURS[i].map(hex);
  const pal = { s, d, h, o: OUTLINE, l: hex('#181010') };
  const r = new Raster(BEETLE_W * 2, BEETLE_H);
  r.paint(['..ooo..', '.osdso.', 'hossdso', '.l.l.l.'], 0, 0, pal);
  r.paint(['..ooo..', '.osdso.', 'hossdso', 'l.l.l..'], BEETLE_W, 0, pal);
  return r;
}

// dragonfly, 10x5, seen from above, facing left: frame 0 wings out, 1 swept back
export const DRAGONFLY_W = 10;
export const DRAGONFLY_H = 5;
export function buildDragonfly(): Raster {
  const pal = { e: hex('#40c0a8'), t: hex('#2a5aa0'), b: hex('#3c88e0'), k: hex('#1c3870'), w: hex('#e8f4ff') };
  const r = new Raster(DRAGONFLY_W * 2, DRAGONFLY_H);
  r.paint(['..ww.ww...', '..ww.ww...', 'eetbkbkbkb', '..ww.ww...', '..ww.ww...'], 0, 0, pal);
  r.paint(['....w.w...', '..www.w...', 'eetbkbkbkb', '..www.w...', '....w.w...'], DRAGONFLY_W, 0, pal);
  // see-through wings
  for (let y = 0; y < DRAGONFLY_H; y++)
    for (let x = 0; x < r.w; x++) if (y !== 2 && r.isSet(x, y)) r.set(x, y, pal.w, 150);
  return r;
}

// red squirrel, 10x8, side on, facing left:
//   frame 0 sitting up, tail curled over its back; 1-2 hopping; 3 sitting up nibbling something in its paws;
//   4 climbing a trunk, head up, tail hanging
//   o outline  f fur  k darker fur  l belly  t tail  e eye  n what it nibbles
export const SQUIRREL_W = 10, SQUIRREL_H = 8;
const SQUIRREL_PAL = () => ({ o: hex('#4a2410'), f: hex('#b85a2c'), k: hex('#8a3c1c'), l: hex('#f0d8b0'), t: hex('#d0703a'), e: hex('#101010'), n: hex('#7a4a20') });
const SQUIRREL = [
  ['.oo....tt.', 'offo..tttt', 'efffo.ttkt', '.offfotkt.', '.olfffkt..', '.olffftt..', '..lfff....', '.oo.oo....'],
  ['..........', '........tt', '.o.....ttt', 'offo..ttk.', 'efffofftt.', '.offffff..', '..lllfff..', '.oo...oo..'],
  ['.......tt.', '......tttt', '.o....tkt.', 'offo..ftt.', 'efffffff..', '.offffff..', '..llllf...', '..oo.oo...'],
  ['.oo....tt.', 'offo..tttt', 'efffo.ttkt', 'nlffo.tkt.', '.lfffokt..', '.lfffftt..', '..lfff....', '.oo.oo....'],
  ['..oo......', '.offo.....', '.efffo....', '.offfo....', '..offfo...', '..lfff....', '..offt....', '...ttt....'],
];
export function buildSquirrel(): Raster {
  const r = new Raster(SQUIRREL_W * SQUIRREL.length, SQUIRREL_H);
  SQUIRREL.forEach((rows, f) => r.paint(rows, f * SQUIRREL_W, 0, SQUIRREL_PAL()));
  return r;
}

/** A squirrel held in the mouth, facing left: whole, half eaten, just the tail. */
export function buildHeldSquirrel(): Raster {
  const r = new Raster(HELD_W * 3, 5);
  const pal = SQUIRREL_PAL();
  r.paint(['.o....tt', 'ofoo.ttt', 'effffftk', '.offlff.', '..o..o..'], 0, 0, pal);
  r.paint(['.o......', 'ofoo....', 'efffo...', '.olo....', '........'], HELD_W, 0, pal);
  r.paint(['........', '......tt', '.....ttt', '......t.', '........'], HELD_W * 2, 0, pal);
  return r;
}

// what falls from the trees, 5x5, one frame each: acorn, hazelnut, apple, cherries, pine cone
export const FRUIT_W = 5;
const FRUIT = [
  ['.....', '.ooo.', '.ddd.', '.bbb.', '..b..'],
  ['.....', '..g..', '.bbb.', '.bdb.', '..b..'],
  ['..s..', '.rrr.', 'rwrrr', 'rrrrk', '.rkr.'],
  ['..s..', '.s.s.', 's..s.', 'rr.rr', 'rk.rk'],
  ['..c..', '.cdc.', '.dcd.', '.cdc.', '..c..'],
];
export function buildFruit(): Raster {
  const r = new Raster(FRUIT_W * FRUIT.length, 5);
  const pal = {
    o: hex('#6a4a24'), d: hex('#a0703a'), b: hex('#7a4a20'), g: hex('#6a9a3a'),
    r: hex('#d83a30'), w: hex('#ffb0a0'), k: hex('#8a1c1c'), s: hex('#4a6a2a'), c: hex('#8a5a30'),
  };
  FRUIT.forEach((rows, f) => r.paint(rows, f * FRUIT_W, 0, pal));
  return r;
}

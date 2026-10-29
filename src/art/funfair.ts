// The funfair's dressing, drawn pixel by pixel like the furniture: a round
// striped tent with a pennant on top, a booth with a striped awning over its
// counter, the poles the bunting hangs from, and the bunting itself.

import { Raster, hex, hash2, outline, type RGB } from './raster.ts';

const RED = { d: hex('#a83434'), b: hex('#d84848'), l: hex('#f06c5c') };
const CREAM = { d: hex('#d8c4a4'), b: hex('#f8ecd8'), l: hex('#fffaf0') };
const BLUE = { d: hex('#2e4e98'), b: hex('#4878d0'), l: hex('#78a4f0') };
const YELLOW = { d: hex('#c89820'), b: hex('#f8c838'), l: hex('#fff090') };
const WOOD = { d: hex('#7a4522'), b: hex('#a8642e'), l: hex('#c07a3e'), s: hex('#e2a868') };
const DARK = hex('#2a1810'), INSIDE = hex('#3a2418'), OUTLINE = hex('#2a1418');

/** The colours of the bunting's pennants, in the order they hang. */
export const PENNANTS: RGB[] = [RED.b, YELLOW.b, BLUE.b, CREAM.b, hex('#58b858')];


/** Lit from the left: a stripe's tone across the width (0 left .. 1 right). */
const tone = (c: { d: RGB; b: RGB; l: RGB }, u: number): RGB => (u < 0.22 ? c.l : u > 0.78 ? c.d : c.b);

/**
 * A round funfair tent: red and cream stripes round its wall, a cone of a roof striped the same
 * way with a scalloped valance, the way in open in the middle, a pennant on top.
 * 60×58, its foot on the bottom row.
 */
export function buildTent(): Raster {
  const W = 60, H = 58, r = new Raster(W, H), cx = 30;
  // the wall: stripes round it, narrower towards the sides as it turns away
  for (let y = 30; y < H; y++)
    for (let x = 4; x < W - 4; x++) {
      const u = (x - 4) / (W - 9), a = Math.asin(Math.max(-1, Math.min(1, 2 * u - 1)));
      const stripe = Math.floor((a / Math.PI + 0.5) * 10) % 2 ? RED : CREAM;
      r.set(x, y, tone(stripe, u));
    }
  // the way in: dark inside, the flaps tied back
  for (let y = 38; y < H; y++) {
    const half = Math.min(7, Math.floor((y - 36) * 0.6));
    for (let x = cx - half; x < cx + half; x++) r.set(x, y, INSIDE);
    r.set(cx - half - 1, y, CREAM.d);
    r.set(cx + half, y, CREAM.d);
  }
  r.rect(cx - 9, 46, 2, 2, YELLOW.d);
  r.rect(cx + 7, 46, 2, 2, YELLOW.d);
  // the roof, a cone from the top of the pole out to the eaves, striped from the top
  for (let y = 7; y <= 30; y++) {
    const half = ((y - 6) / 24) * 29;
    for (let x = Math.ceil(cx - half); x < cx + half; x++) {
      const u = (x - cx) / half;
      const stripe = Math.floor((u + 1) * 4) % 2 ? CREAM : RED;
      r.set(x, y, tone(stripe, (u + 1) / 2));
    }
  }
  // the valance round the eaves: scallops, red and cream by turns
  for (let i = 0; i < 10; i++) {
    const x0 = 1 + i * 6, c = i % 2 ? CREAM : RED;
    for (let x = x0; x < x0 + 6; x++) {
      const drop = 31 + (x - x0 === 0 || x - x0 === 5 ? 0 : x - x0 === 1 || x - x0 === 4 ? 1 : 2);
      for (let y = 29; y <= drop; y++) r.set(x, y, tone(c, x / W));
    }
  }
  // the pole and its pennant
  r.rect(cx, 0, 1, 7, WOOD.d);
  for (let i = 0; i < 5; i++) for (let j = 0; j <= Math.floor((5 - i) / 2); j++) r.set(cx + 1 + i, 1 + j, i < 2 ? YELLOW.l : YELLOW.b);
  r.set(cx, 0, YELLOW.l);
  outline(r, OUTLINE);
  return r;
}

/** A little gold star, 5×5, its middle at (x, y). */
function star(r: Raster, x: number, y: number): void {
  for (const [dx, dy] of [[0, -2], [-1, -1], [0, -1], [1, -1], [-2, 0], [-1, 0], [0, 0], [1, 0], [2, 0], [-1, 1], [0, 1], [1, 1], [-1, 2], [1, 2]])
    r.set(x + dx, y + dy, dy < 0 ? YELLOW.l : YELLOW.b);
}

/**
 * A booth: under a striped canopy (rising to a flag with a star, scalloped round its edge, a rosette
 * at each corner), a row of pennants, lanterns on its two posts, prizes on a wooden counter, and the
 * counter's red front in three panels, a gold star on the middle one. 44×48, its foot on the bottom
 * row; the counter top is at rows 31–33.
 */
export function buildBooth(): Raster {
  const W = 44, H = 48, r = new Raster(W, H), cx = 22;
  // the back of the booth, in the shade under the canopy
  r.rect(4, 22, W - 8, 10, INSIDE);
  // a row of pennants hanging under the canopy's edge
  for (let i = 0; i < 9; i++) {
    const x0 = 4 + i * 4, c = i % 2 ? CREAM : RED;
    for (let k = 0; k < 4; k++) for (let x = x0 + Math.ceil(k / 2); x < x0 + 4 - Math.ceil(k / 2); x++) r.set(x, 24 + k, k ? c.b : c.l);
  }
  // the posts, with a lantern on each
  for (const x of [2, 40]) {
    r.rect(x, 20, 2, 27, WOOD.b);
    r.rect(x, 20, 1, 27, WOOD.l);
    r.rect(x - 1, 25, 4, 1, WOOD.d);
    r.rect(x - 1, 26, 4, 4, YELLOW.b);
    r.rect(x, 27, 2, 2, YELLOW.l);
    r.rect(x - 1, 30, 4, 1, WOOD.d);
  }
  // prizes on the counter: jars and boxes and a plush or two
  for (let i = 0; i < 8; i++) {
    const x = 6 + i * 4 + Math.floor(hash2(i, 0, 91) * 2), c = PENNANTS[Math.floor(hash2(i, 1, 92) * PENNANTS.length)];
    const tall = hash2(i, 2, 93) < 0.4 ? 1 : 0;
    r.rect(x, 28 - tall, 3, 3 + tall, c);
    r.set(x, 28 - tall, CREAM.l);
    r.set(x + 2, 30, DARK);
  }
  // the counter: its top, then its front in three red panels framed in wood, gold studs along the top
  r.rect(2, 31, W - 4, 1, WOOD.s);
  r.rect(2, 32, W - 4, 2, WOOD.l);
  for (let y = 34; y < H; y++)
    for (let x = 2; x < W - 2; x++) {
      const frame = y === 34 || y === H - 1 || x < 4 || x >= W - 4 || x === 15 || x === 16 || x === 27 || x === 28;
      r.set(x, y, frame ? (y === 34 ? WOOD.l : WOOD.d) : y < 37 ? RED.l : y > H - 4 ? RED.d : RED.b);
    }
  for (let x = 6; x < W - 6; x += 3) if (x < 14 || x > 30) r.set(x, 36, YELLOW.d);
  // the middle panel: a banner hanging down with the star on it
  for (let y = 35; y < H - 2; y++) for (let x = 18; x < 26; x++) if (y < H - 5 || Math.abs(x - 21.5) > H - 3 - y) r.set(x, y, y === 35 ? RED.l : RED.d);
  star(r, cx - 1, 40);
  // the canopy: a low cone rising to the flagpole, striped down from the top
  for (let y = 9; y <= 21; y++) {
    const half = 3 + ((y - 9) / 12) * 19;
    for (let x = Math.ceil(cx - half); x < cx + half; x++) {
      const u = (x + 0.5 - cx) / half, stripe = Math.floor((u + 1) * 3.5) % 2 ? CREAM : RED;
      r.set(x, y, y === 9 ? stripe.l : tone(stripe, (u + 1) / 2));
    }
  }
  // its edge, scalloped, red and cream by turns
  for (let i = 0; i < 11; i++) {
    const x0 = i * 4, c = i % 2 ? CREAM : RED;
    for (let x = x0; x < x0 + 4; x++) for (let y = 21; y <= 22 + (x === x0 || x === x0 + 3 ? 0 : 1); y++) r.set(x, y, c.d);
  }
  // a rosette at each corner
  for (const x of [2, 41]) {
    for (const [dx, dy] of [[0, -1], [-1, 0], [0, 0], [1, 0], [0, 1], [-1, -1], [1, 1], [1, -1], [-1, 1]]) r.set(x + dx, 21 + dy, RED.d);
    r.set(x, 21, YELLOW.b);
  }
  // the flag on top, with a star
  r.rect(cx, 1, 1, 9, WOOD.d);
  for (let y = 1; y < 7; y++) for (let x = cx + 1; x < cx + 9 - (y === 3 || y === 4 ? 2 : 0); x++) r.set(x, y, y === 1 ? RED.l : RED.b);
  r.set(cx + 4, 3, YELLOW.l); r.set(cx + 3, 4, YELLOW.b); r.set(cx + 4, 4, YELLOW.b); r.set(cx + 5, 4, YELLOW.b); r.set(cx + 4, 5, YELLOW.d);
  r.set(cx, 0, YELLOW.l);
  outline(r, OUTLINE);
  return r;
}

/** A bunting pole: a slim post in red and cream bands with a gold ball on top. 6×32, its foot on the bottom row. */
export function buildPole(): Raster {
  const r = new Raster(6, 32);
  for (let y = 3; y < 31; y++) {
    const c = Math.floor((y - 3) / 4) % 2 ? CREAM : RED;
    r.set(2, y, c.l);
    r.set(3, y, c.d);
  }
  r.rect(1, 30, 4, 2, DARK);
  r.rect(2, 1, 2, 2, YELLOW.b);
  r.set(2, 1, YELLOW.l);
  outline(r, OUTLINE);
  return r;
}

/** Where a pole's string is tied: above its foot (px). */
export const POLE_TOP = 27;

/**
 * A string of bunting from one pole top to another, sagging in the middle: (dx, dy) is from the first
 * to the second on screen. Returns the picture and where the first pole top is in it.
 */
export function buildBunting(dx: number, dy: number, seed: number): { r: Raster; ox: number; oy: number } {
  const len = Math.hypot(dx, dy), sag = Math.min(9, 2 + len / 12);
  const x0 = Math.min(0, dx), y0 = Math.min(0, dy), W = Math.abs(dx) + 1, H = Math.abs(dy) + Math.ceil(sag) + 6;
  const r = new Raster(Math.ceil(W), Math.ceil(H));
  const at = (t: number): [number, number] => [-x0 + t * dx, -y0 + t * dy + sag * 4 * t * (1 - t)];
  const steps = Math.max(2, Math.ceil(len * 1.5));
  for (let i = 0; i <= steps; i++) {
    const [x, y] = at(i / steps);
    r.set(Math.round(x), Math.round(y), DARK);
  }
  // pennants every few px, hanging straight down from the string
  const n = Math.floor(len / 5);
  for (let k = 1; k < n; k++) {
    const [x, y] = at(k / n), c = PENNANTS[(k + seed) % PENNANTS.length];
    const px = Math.round(x), py = Math.round(y) + 1;
    r.rect(px - 1, py, 3, 1, c);
    r.rect(px - 1, py + 1, 2, 1, c);
    r.set(px - 1, py + 2, c);
    r.set(px - 1, py, hex('#ffffff'), 90);
  }
  return { r, ox: -x0, oy: -y0 };
}

/** Where the fairy lights hang on a string like that, as fractions along it, and the sag at each. */
export function buntingLights(dx: number, dy: number): { x: number; y: number }[] {
  const len = Math.hypot(dx, dy), sag = Math.min(9, 2 + len / 12), n = Math.max(2, Math.floor(len / 9));
  const out: { x: number; y: number }[] = [];
  for (let k = 1; k < n; k++) {
    const t = k / n;
    out.push({ x: t * dx, y: t * dy + sag * 4 * t * (1 - t) });
  }
  return out;
}

const STEEL = { d: hex('#3c5a78'), b: hex('#5e86ac'), l: hex('#9cc0de') };
const RAIL = { d: hex('#8a9098'), l: hex('#f6f4ee') };
const SPINE = { d: hex('#8e2430'), b: hex('#d0404a') };
const TIMBER = { d: hex('#6e4624'), b: hex('#a8743e'), l: hex('#c89058') };
const CHAIN = hex('#2a2a30');

/** A bit of the track: a point along it (local px, every half px or so), which way it runs, its deck's height, how far round. */
interface TrackBit { x: number; y: number; z: number; dx: number; dy: number; s: number }

/**
 * A stretch of the rollercoaster's track as it stands, bold and toy-like: a fat red spine with two
 * white rails on it, carried on chunky steel columns (each with a cap under the deck, and struts
 * up to it either way along the track where it's high), a chain up the lift. Returns the picture
 * and where the local origin is in it.
 */
export function buildTrack(bits: TrackBit[], lift: (s: number) => boolean): { r: Raster; ox: number; oy: number } {
  const px = new Map<string, RGB>();
  const put = (x: number, y: number, c: RGB) => px.set(`${Math.round(x)},${Math.round(y)}`, c);
  const line = (x0: number, y0: number, x1: number, y1: number, c: RGB, w = 1) => {
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
    for (let i = 0; i <= n; i++) for (let k = 0; k < w; k++) put(x0 + ((x1 - x0) * i) / n + k, y0 + ((y1 - y0) * i) / n, c);
  };
  // the columns: one every 16 px along it, where the deck is up off the ground
  for (const b of bits) {
    if (Math.abs(b.s / 16 - Math.round(b.s / 16)) > 0.01 || b.z < 4) continue;
    const top = b.y - b.z + 3;
    // (a foot, a post three wide lit from the left, a cap across under the deck)
    line(b.x - 2, b.y, b.x + 2, b.y, STEEL.d);
    line(b.x - 1, b.y - 1, b.x - 1, top, STEEL.l);
    line(b.x, b.y - 1, b.x, top, STEEL.b);
    line(b.x + 1, b.y - 1, b.x + 1, top, STEEL.d);
    const nx = -b.dy, ny = b.dx;
    line(b.x - nx * 4 - 0.5, top - ny * 4, b.x + nx * 4 - 0.5, top + ny * 4, STEEL.d, 2);
    // struts from halfway up the post to the deck either way along the track
    if (b.z > 14)
      for (const k of [-1, 1]) {
        const u = Math.min(7, b.z / 3);
        line(b.x, b.y - b.z / 2, b.x + k * u * b.dx, b.y + k * u * b.dy - b.z + 3, STEEL.b);
      }
  }
  for (const b of bits) {
    const nx = -b.dy, ny = b.dx, sy = b.y - b.z;
    // the spine: a fat red band under the rails, darker on its underside
    for (let v = -3; v <= 3; v++) {
      put(b.x + nx * v, sy + ny * v + 1, SPINE.b);
      put(b.x + nx * v, sy + ny * v + 2, SPINE.d);
    }
    if (lift(b.s) && Math.round(b.s) % 2 === 0) put(b.x, sy, CHAIN);
  }
  // the rails, two px wide each, on top
  for (const b of bits) {
    const nx = -b.dy, ny = b.dx, sy = b.y - b.z;
    for (const v of [-4, -3, 3, 4]) {
      put(b.x + nx * v, sy + ny * v - 1, RAIL.l);
      put(b.x + nx * v, sy + ny * v, RAIL.d);
    }
  }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const k of px.keys()) {
    const [x, y] = k.split(',').map(Number);
    [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
  }
  // (a pixel of room all round for the outline)
  const r = new Raster(x1 - x0 + 3, y1 - y0 + 3);
  for (const [k, c] of px) {
    const [x, y] = k.split(',').map(Number);
    r.set(x - x0 + 1, y - y0 + 1, c);
  }
  outline(r, OUTLINE);
  return { r, ox: 1 - x0, oy: 1 - y0 };
}

/**
 * The station platform beside the track: a plank deck `w` wide and `d` deep at height `h`, its
 * front in boards, a striped railing at the back ends and a little sign. Its foot on the bottom row.
 */
export function buildPlatform(w: number, d: number, h: number): Raster {
  const r = new Raster(w, d + h + 9);
  const top = 9;
  // the deck, planks running along
  for (let y = 0; y < d; y++) for (let x = 0; x < w; x++) r.set(x, top + y, y % 3 === 2 ? TIMBER.d : x % 11 === 0 ? TIMBER.b : TIMBER.l);
  // its front
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) r.set(x, top + d + y, x % 6 === 0 ? TIMBER.d : TIMBER.b);
  // the sign on two posts at the left: red and gold
  r.rect(2, 2, 1, 8, TIMBER.d);
  r.rect(13, 2, 1, 8, TIMBER.d);
  r.rect(1, 0, 14, 5, RED.b);
  r.rect(1, 0, 14, 1, RED.l);
  for (let x = 3; x < 13; x += 2) r.set(x, 2, YELLOW.l);
  outline(r, OUTLINE);
  return r;
}

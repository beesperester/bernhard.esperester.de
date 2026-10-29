// What the water looks like: a bed under it (sand and pebbles at the shore,
// patches of weed, mud further out) and a surface over it that mirrors the
// sky. How much of the bed shows through depends on the depth (murky water
// swallows it a few px out from the bank) and on the angle the surface is
// seen at (Fresnel: the steeper the slope of a wave towards the eye, the more
// it mirrors). All of it is plain numbers here; game/WaterSurface.ts draws it.
import { Raster, hex, hash2, type Bits, type RGB } from './raster.ts';
import { bayer, noise } from './tiles.ts';

const SAND = hex('#a99c6c'), PEBBLE = hex('#cdbf92'), PEBBLE_DARK = hex('#857953');
const SILT = hex('#7b7c52'), MUD = hex('#4d5a40');
const WEED = hex('#4f7d3a'), WEED_LIGHT = hex('#6f9a48'), WEED_DARK = hex('#33582c');

/**
 * How far each water pixel is from the bank (px, counting no further than
 * `max`). Not water: 0. `floating(x, y)` says what lies on the water rather
 * than being bank (lily pads, bridges): the depth carries on under it.
 */
export function shoreDistance(mask: Bits, max = 60, floating: (x: number, y: number) => boolean = () => false): Uint8Array {
  const { w, h } = mask;
  const wet = (x: number, y: number) => mask.isSet(x, y) || floating(x, y);
  const dist = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0, tail = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!wet(x, y)) continue;
      // the water's edge is 1 px from the bank
      const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1 || !wet(x - 1, y) || !wet(x + 1, y) || !wet(x, y - 1) || !wet(x, y + 1);
      if (edge) { dist[y * w + x] = 1; queue[tail++] = y * w + x; }
    }
  while (head < tail) {
    const i = queue[head++], d = Math.min(max, dist[i] + 1);
    const x = i % w, y = (i - x) / w;
    for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1])
      if (j >= 0 && dist[j] === 0 && wet(j % w, Math.floor(j / w))) { dist[j] = d; queue[tail++] = j; }
  }
  return dist;
}

/** How much of the bed shows through at this distance from the bank (1 clear .. near 0 murky). */
export const clarity = (dist: number) => Math.max(0.07, 0.72 * Math.exp(-dist / 10));

/** The bed under the water: a picture the size of `mask`, set only where there is water; `mask` starts at world px (ox, oy). */
export function buildBed(mask: Bits, dist: Uint8Array, ox = 0, oy = 0): Raster {
  const r = new Raster(mask.w, mask.h);
  for (let my = 0; my < mask.h; my++)
    for (let mx = 0; mx < mask.w; mx++) {
      const d = dist[my * mask.w + mx];
      if (!d || !mask.isSet(mx, my)) continue;
      const x = mx + ox, y = my + oy;
      const deep = Math.min(1, d / 16), b = bayer(x, y);
      // sand at the bank, going over into silt and mud
      let c: RGB = deep + (b - 0.5) * 0.35 < 0.3 ? SAND : deep + (b - 0.5) * 0.35 < 0.7 ? SILT : MUD;
      // pebbles in the shallows
      if (d < 6 && hash2(x >> 1, y, 2101) < 0.07) c = hash2(x, y, 2102) < 0.6 ? PEBBLE : PEBBLE_DARK;
      // weed grows in patches, thickest a little way out, in strands running roughly up and down
      const patch = noise(x / 22, y / 16, 2103) * 0.75 + noise(x / 5, y / 9, 2104) * 0.25;
      if (d > 2 && patch + (b - 0.5) * 0.12 > 0.6 - Math.min(deep, 0.5) * 0.12) {
        const strand = noise(x / 2.2, y / 7, 2105);
        c = strand > 0.62 ? WEED_LIGHT : strand < 0.3 ? WEED_DARK : WEED;
      }
      r.set(mx, my, c);
    }
  return r;
}

// ---- the surface ----

/** Looking down at the garden from the south, this steeply (the eye's direction from the water, z up). */
const EYE: [number, number, number] = [0, 0.57, 0.82];
/** How much water mirrors when looked at straight on, and how sharply that rises at a slant. */
const F0 = 0.3, FRESNEL_POW = 3;

/** Fresnel: how much a surface with unit normal n mirrors, seen from the eye. */
export function reflectance(nx: number, ny: number, nz: number): number {
  const c = Math.max(0, nx * EYE[0] + ny * EYE[1] + nz * EYE[2]);
  return F0 + (1 - F0) * (1 - c) ** FRESNEL_POW;
}

/** The sky the water mirrors, for the time of day and the weather. */
export interface Sky {
  zenith: RGB; horizon: RGB; cloud: RGB;
  /** Share of the sky under cloud (0..1), and how far the clouds have drifted (px). */
  cover: number; driftX: number; driftY: number;
  /** Towards the sun (z up), and how bright its glint is (0 none). */
  sun: [number, number, number]; glint: number;
  /** How rough the water is (rain): 1 calm. */
  rough: number;
}

/** Ripples running over the water: two small trains [dx, dy, wavenumber, amplitude, speed], over a slow wobble of noise. */
const WAVES = [[0.96, 0.28, 1.1, 0.12, 2.1], [-0.45, 0.89, 1.6, 0.08, 2.9]];
/** How steep the waves look. */
const SLOPE = 0.5;

/**
 * One pixel of the surface at world (x, y), time t (s): its colour and how
 * opaque it is over the bed. `clear` is how much of the bed shows (clarity),
 * `murk` the colour of the water body itself. Writes [r, g, b, a] into out.
 */
export function surfacePixel(x: number, y: number, t: number, clear: number, murk: RGB, sky: Sky, out: number[]): void {
  // the slope of the water here
  // a lazy, irregular swell (the slope of a drifting noise)...
  const wx = x / 11 + t * 0.25, wy = y / 7 - t * 0.18;
  const h0 = noise(wx, wy, 2120);
  let gx = (noise(wx + 0.12, wy, 2120) - h0) * 2.4, gy = (noise(wx, wy + 0.12, 2120) - h0) * 3.4;
  // ...and fine ripples on it
  for (const [dx, dy, k, a, s] of WAVES) {
    const c = Math.cos((x * dx + y * dy) * k - t * s) * a * k * sky.rough;
    gx += c * dx;
    gy += c * dy;
  }
  let nx = -gx * SLOPE, ny = -gy * SLOPE, nz = 1;
  const len = Math.hypot(nx, ny, nz);
  nx /= len; ny /= len; nz /= len;
  const R = reflectance(nx, ny, nz);
  // the eye's ray, bounced off the surface, into the sky
  const c = nx * EYE[0] + ny * EYE[1] + nz * EYE[2];
  const rx = 2 * c * nx - EYE[0], ry = 2 * c * ny - EYE[1], rz = Math.max(0.05, 2 * c * nz - EYE[2]);
  const up = Math.min(1, rz) ** 0.8;
  let sr = sky.horizon[0] + (sky.zenith[0] - sky.horizon[0]) * up;
  let sg = sky.horizon[1] + (sky.zenith[1] - sky.horizon[1]) * up;
  let sb = sky.horizon[2] + (sky.zenith[2] - sky.horizon[2]) * up;
  // clouds, where the bounced ray meets them (they sit high: a little sideways shift goes a long way)
  const cu = x - (rx / rz) * 26 + sky.driftX, cv = y + (ry / rz) * 26 + sky.driftY;
  const n = noise(cu / 70, cv / 42, 2110) * 0.7 + noise(cu / 23, cv / 15, 2111) * 0.3;
  const cloud = Math.max(0, Math.min(1, (n - (1 - sky.cover) * 0.9 - 0.05) / 0.18));
  sr += (sky.cloud[0] - sr) * cloud * 0.85;
  sg += (sky.cloud[1] - sg) * cloud * 0.85;
  sb += (sky.cloud[2] - sb) * cloud * 0.85;
  // what shows over the bed: the sky as much as it mirrors, and the murk as much as the depth hides the bed
  const A = 1 - (1 - R) * clear;
  const m = (1 - R) * (1 - clear);
  let r = (R * sr + m * murk[0]) / A, g = (R * sg + m * murk[1]) / A, b = (R * sb + m * murk[2]) / A, a = A;
  // the sun glinting off a wave
  if (sky.glint > 0) {
    const [lx, ly, lz] = sky.sun;
    let hx = lx + EYE[0], hy = ly + EYE[1], hz = lz + EYE[2];
    const hl = Math.hypot(hx, hy, hz);
    hx /= hl; hy /= hl; hz /= hl;
    const spec = Math.max(0, nx * hx + ny * hy + nz * hz) ** 900 * sky.glint;
    if (spec > 0.25) {
      const s = Math.min(1, spec);
      r += (255 - r) * s; g += (250 - g) * s; b += (232 - b) * s; a = Math.max(a, s);
    }
  }
  // pixel art: the opacity in a few dithered steps
  a = Math.min(1, Math.floor(a * 6 + bayer(x, y)) / 6);
  out[0] = r; out[1] = g; out[2] = b; out[3] = a;
}

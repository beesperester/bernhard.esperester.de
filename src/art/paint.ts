// The garden's hand-painted look: instead of flat colours with an even
// dither, surfaces are mottled in little clusters of a few close tones (like
// dabs of paint), shadows lean cool and purplish and lights warm, and
// outlines are a dark version of what they're round rather than black, a
// little ragged. These are the helpers the art modules paint with. Every tone
// comes from a fixed ramp, so the seasons (tiles.ts) can still recognise and
// recolour them.

import { Raster, hash2, hex, type RGB } from './raster.ts';

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

/**
 * A ramp of `n` tones through the given colours (dark to light), evenly spaced. Give the stops
 * hue-shifted (the darks bluer or purpler, the lights yellower) for the painted look.
 */
export function ramp(n: number, ...stops: string[]): RGB[] {
  const cs = stops.map(hex);
  return Array.from({ length: n }, (_, i) => {
    const t = (i / (n - 1)) * (cs.length - 1), k = Math.min(cs.length - 2, Math.floor(t)), f = t - k;
    return cs[k].map((v, j) => Math.round(v + (cs[k + 1][j] - v) * f)) as unknown as RGB;
  });
}

/** The tone of `r` for a value v (0 dark .. 1 light). */
export const tone = (r: readonly RGB[], v: number): RGB => r[Math.max(0, Math.min(r.length - 1, Math.floor(v * r.length)))];

/**
 * Dabs of paint: a value about 0 (-0.5..0.5) that holds still over little clusters of two or three
 * pixels and changes from one to the next, with a ragged edge. Added to a surface's tone, it breaks
 * it into blotches like the brush left them.
 */
export function dab(x: number, y: number, seed: number): number {
  // (cells of 2×2, every other row of them shifted a pixel so they don't line up; a pixel's own
  // hash frays their edges)
  const cy = y >> 1, cx = (x + (cy & 1)) >> 1;
  return (hash2(cx, cy, seed) - 0.5) * 0.8 + (hash2(x, y, seed + 1) - 0.5) * 0.35;
}

/** Larger, soft patches (-0.5..0.5) over tens of px: where a lawn is lusher or a wall more weathered. */
export const patch = (x: number, y: number, seed: number, size = 40): number => noise(x / size, y / size, seed) - 0.5;

/** A colour a little lighter and warmer (k 0..1). */
export const warmer = (c: RGB, k: number): RGB => [c[0] + (255 - c[0]) * k * 1.1, c[1] + (246 - c[1]) * k, c[2] + (200 - c[2]) * k * 0.8].map(Math.round) as unknown as RGB;
/** A colour a little darker and cooler, towards blue-purple (k 0..1). */
export const cooler = (c: RGB, k: number): RGB => [c[0] * (1 - k * 1.15), c[1] * (1 - k), c[2] * (1 - k * 0.55)].map(Math.round) as unknown as RGB;

/**
 * Paint over a finished picture: everything inside its silhouette broken into dabs, some a little
 * lighter and warmer, some darker and cooler (its outline and the pixel inside it left alone, so the
 * shape stays crisp). For the things made of shapes and flat tones: furniture, follies, the funfair.
 */
export function paintOver(r: Raster, seed: number, amount = 1): void {
  const src = new Uint8ClampedArray(r.data);
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < r.w && y < r.h && src[(y * r.w + x) * 4 + 3] > 0;
  for (let y = 0; y < r.h; y++)
    for (let x = 0; x < r.w; x++) {
      if (!inside(x, y)) continue;
      // (two px in from any edge)
      let edge = false;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2]]) if (!inside(x + dx, y + dy)) edge = true;
      if (edge) continue;
      const i = (y * r.w + x) * 4, c: RGB = [src[i], src[i + 1], src[i + 2]];
      // (outlines and the darkest joints stay as drawn)
      if (c[0] + c[1] + c[2] < 120) continue;
      const v = dab(x, y, seed);
      if (v > 0.2) r.set(x, y, warmer(c, 0.13 * amount), src[i + 3]);
      else if (v < -0.22) r.set(x, y, cooler(c, 0.13 * amount), src[i + 3]);
    }
}

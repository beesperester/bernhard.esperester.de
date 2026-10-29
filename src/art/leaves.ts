// The sheet of leaves the trees are put together from: puffs of leaves, drawn
// once in a few shapes and many sizes, then stamped onto a tree wherever its
// crown wants a puff (art/trees.ts). A stamp keeps, for each of its pixels,
// which way the puff curves there and its leafy texture, not colours: the
// tree it lands on gives those (its palette, where in the crown it sits, the
// light), so the same puff serves every tree, season and sun.
import { hash2 } from './raster.ts';
import { dab, patch } from './paint.ts';

/** The sizes puffs come in (their radius, px); a puff is drawn the nearest size. */
export const PUFF_SIZES = [3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 21, 24, 28, 32];
/** And this many shapes of each size. */
export const PUFF_SHAPES = 6;

/** A puff of leaves: its size and, per pixel of a square (`w` across, centred), how it is shaded. */
export interface Puff {
  r: number;
  w: number;
  /** Inside the puff (1), or not (0). */
  on: Uint8Array;
  /** Which way it curves there (-1..1). */
  nx: Float32Array;
  ny: Float32Array;
  /** Its leafy texture (added to the light there), and the specks (0..1). */
  jit: Float32Array;
  speck: Float32Array;
  /** On its rim: shaded dark on the side away from the light. */
  rim: Uint8Array;
  /** Low on its rim, where a puff in front of others shows its round underside against them. */
  seam: Uint8Array;
}

/**
 * Single leaves, subtly drawn into the leafy texture: little pointed ovals
 * on a staggered grid, each tilted its own way, lit along its upper edge and
 * shaded along its lower one (-1 .. 1, 0 between them).
 */
function leafAt(x: number, y: number, seed: number): number {
  // (the rows of leaves wander up and down and sideways, so they never line up across a crown)
  const wx = x + patch(x, y, seed + 1336, 14) * 6, wy = y + patch(x, y, seed + 1337, 11) * 5;
  const W = 6, H = 4;
  const row = Math.floor(wy / H), col = Math.floor((wx + (row % 2) * (W / 2)) / W);
  // (here and there no leaf at all, and where the leaves show at all comes and goes in soft patches)
  const show = 0.5 + patch(x, y, seed + 1338, 18) * 1.6;
  if (hash2(col, row, seed + 1333) > show) return 0;
  // (each leaf a little off its spot, its own size)
  const cx = col * W - (row % 2) * (W / 2) + W / 2 + (hash2(col, row, seed + 1330) - 0.5) * 3;
  const cy = row * H + H / 2 + (hash2(col, row, seed + 1331) - 0.5) * 1.6;
  const tilt = (hash2(col, row, seed + 1332) - 0.5) * 1.6, big = 0.8 + hash2(col, row, seed + 1334) * 0.45;
  const dx = wx + 0.5 - cx, dy = wy + 0.5 - cy - dx * tilt * 0.5;
  // a pointed oval, about 2.6 px either way and 1.4 up and down
  const u = dx / (2.6 * big), v = dy / (1.4 * big * (1 - Math.abs(u) * 0.4));
  if (u * u + v * v > 1) return -0.1;
  return v < -0.35 ? 0.55 : v > 0.45 ? -0.4 : 0.1;
}

/** Draw puff `shape` of radius r: ragged at its edge, leaf tips poking out, swelling and pinched in broad lobes. */
function drawPuff(r: number, shape: number): Puff {
  const salt = shape * 7919 + r * 31, seed = 4000 + salt;
  const n = Math.max(8, Math.round(r * 2.2)), jag = Math.min(2.5, r * 0.3);
  const p2 = hash2(salt, 1, 1321) * 6.3, p3 = hash2(salt, 2, 1321) * 6.3;
  const edge = (dx: number, dy: number) => {
    const t = Math.atan2(dy, dx), u = ((t / (Math.PI * 2) + 1) * n) % n, k = Math.floor(u), f = u - k;
    const a = hash2(k, salt, 1320), b = hash2((k + 1) % n, salt, 1320);
    return r * (1 + 0.17 * Math.sin(2 * t + p2) + 0.11 * Math.sin(3 * t + p3)) + (a + (b - a) * f - 0.5) * jag * 2;
  };
  const R = Math.ceil(r * 1.3 + jag), w = R * 2 + 1, N = w * w;
  const puff: Puff = {
    r, w, on: new Uint8Array(N), nx: new Float32Array(N), ny: new Float32Array(N), jit: new Float32Array(N),
    speck: new Float32Array(N), rim: new Uint8Array(N), seam: new Uint8Array(N),
  };
  for (let y = 0; y < w; y++)
    for (let x = 0; x < w; x++) {
      const dx = x - R + 0.5, dy = y - R + 0.5, d = Math.hypot(dx, dy), e = edge(dx, dy);
      if (d > e) continue;
      const i = y * w + x;
      puff.on[i] = 1;
      puff.nx[i] = dx / e;
      puff.ny[i] = dy / e;
      // (leaves come in dabs, little clusters of them catching the light, with single leaves drawn in)
      puff.jit[i] = dab(x, y, seed) * 0.45 + leafAt(x, y, seed) * 0.35;
      puff.speck[i] = hash2(x, y, seed * 7);
      puff.rim[i] = d > e - 1.2 ? 1 : 0;
      puff.seam[i] = d > e - 1 && dy > e * 0.35 && Math.abs(dx) < e * 0.8 ? 1 : 0;
    }
  return puff;
}

const sheet = new Map<number, Puff>();

/** The puff nearest radius r, in shape `shape` (any number: it wraps round the shapes there are). */
export function puff(r: number, shape: number): Puff {
  let size = 0;
  for (let k = 1; k < PUFF_SIZES.length; k++) if (Math.abs(PUFF_SIZES[k] - r) < Math.abs(PUFF_SIZES[size] - r)) size = k;
  const s = ((shape % PUFF_SHAPES) + PUFF_SHAPES) % PUFF_SHAPES, key = size * PUFF_SHAPES + s;
  let p = sheet.get(key);
  if (!p) sheet.set(key, (p = drawPuff(PUFF_SIZES[size], s)));
  return p;
}

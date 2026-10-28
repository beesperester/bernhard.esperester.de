// The Ring's railway: one closed line round the city (garden.ts, after the
// real S41), in the tiles' own style: straight along a row or a column of
// tiles, turning through a right angle in a quarter circle within the corner
// tile. Measured out so that a train can be put anywhere along it by how far
// round it is (`s`, px). Kept free of Phaser: the layout keeps the trackside
// clear with it, and the train runs on it.

import { TRACK } from './garden.ts';
import { TILE } from './size.ts';

type Pt = [number, number];

/** Points along the track this far apart (px). */
const STEP = 2;
/** Lawn closer to the line than this (px) is kept clear: the trains are wider than their rails. */
export const TRACK_CLEARANCE = 12;

/** The line through the corner tiles' middles, each corner a quarter circle; sampled every STEP px of the way. */
function measure(): { xs: Float32Array; ys: Float32Array; length: number } {
  const corners: Pt[] = [];
  for (let i = 0; i + 1 < TRACK.length; i += 2) corners.push([(TRACK[i] + 0.5) * TILE, (TRACK[i + 1] + 0.5) * TILE]);
  const n = corners.length, r = TILE / 2;
  const unit = (a: Pt, b: Pt): Pt => { const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / d, (b[1] - a[1]) / d]; };
  // the way: pieces, each a point along it at `u` of its length (straight runs, and quarter circles round the corners)
  const pieces: { len: number; at: (u: number) => Pt }[] = [];
  for (let i = 0; i < n; i++) {
    const p = corners[(i + n - 1) % n], c = corners[i], q = corners[(i + 1) % n];
    const din = unit(p, c), dout = unit(c, q);
    // into the corner tile at its edge, round its middle, out at the next edge
    const a: Pt = [c[0] - din[0] * r, c[1] - din[1] * r], b: Pt = [c[0] + dout[0] * r, c[1] + dout[1] * r];
    const m: Pt = [a[0] + dout[0] * r, a[1] + dout[1] * r];
    const a0 = Math.atan2(a[1] - m[1], a[0] - m[0]);
    let sweep = Math.atan2(b[1] - m[1], b[0] - m[0]) - a0;
    if (sweep > Math.PI) sweep -= Math.PI * 2;
    if (sweep < -Math.PI) sweep += Math.PI * 2;
    pieces.push({ len: Math.abs(sweep) * r, at: (u) => [m[0] + Math.cos(a0 + sweep * u) * r, m[1] + Math.sin(a0 + sweep * u) * r] });
    // then straight on to the next corner tile's edge
    const e: Pt = [q[0] - dout[0] * r, q[1] - dout[1] * r];
    const len = Math.hypot(e[0] - b[0], e[1] - b[1]);
    if (len > 0) pieces.push({ len, at: (u) => [b[0] + (e[0] - b[0]) * u, b[1] + (e[1] - b[1]) * u] });
  }
  const xs: number[] = [], ys: number[] = [];
  let carry = 0;
  for (const { len, at } of pieces) {
    let d = carry;
    for (; d < len; d += STEP) {
      const [x, y] = at(d / len);
      xs.push(x);
      ys.push(y);
    }
    carry = d - len;
  }
  return { xs: Float32Array.from(xs), ys: Float32Array.from(ys), length: xs.length * STEP };
}

const { xs: XS, ys: YS, length } = measure();
/** How far it is all the way round (px). */
export const TRACK_LENGTH = length;

/** `s` brought into 0..TRACK_LENGTH. */
export const wrap = (s: number): number => ((s % TRACK_LENGTH) + TRACK_LENGTH) % TRACK_LENGTH;

/** The point `s` px round the track, and which way the track runs there (a unit vector). */
export function trackAt(s: number): { x: number; y: number; dx: number; dy: number } {
  const n = XS.length, f = wrap(s) / STEP, i = Math.floor(f) % n, j = (i + 1) % n, u = f - Math.floor(f);
  const x = XS[i] + (XS[j] - XS[i]) * u, y = YS[i] + (YS[j] - YS[i]) * u;
  const a = (i + n - 2) % n, b = (i + 3) % n;
  const tx = XS[b] - XS[a], ty = YS[b] - YS[a], d = Math.hypot(tx, ty) || 1;
  return { x, y, dx: tx / d, dy: ty / d };
}

/** The point on the track nearest (x, y): how far round it is, and how far off (px). */
export function nearestOnTrack(x: number, y: number): { s: number; d: number } {
  let best = 0, bd = Infinity;
  for (let i = 0; i < XS.length; i++) {
    const d = (XS[i] - x) ** 2 + (YS[i] - y) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return { s: best * STEP, d: Math.sqrt(bd) };
}

/** Every sample along the line (for drawing the rails). */
export const trackPoints = (): { xs: Float32Array; ys: Float32Array; step: number } => ({ xs: XS, ys: YS, step: STEP });

/** Tiles (y * width + x) some part of which is within TRACK_CLEARANCE of the line. */
export const TRACKSIDE: ReadonlySet<number> = (() => {
  const out = new Set<number>();
  const r = TRACK_CLEARANCE;
  for (let i = 0; i < XS.length; i++)
    for (let ty = Math.floor((YS[i] - r) / TILE); ty <= Math.floor((YS[i] + r) / TILE); ty++)
      for (let tx = Math.floor((XS[i] - r) / TILE); tx <= Math.floor((XS[i] + r) / TILE); tx++) {
        // (the nearest point of the tile to the line)
        const nx = Math.max(tx * TILE, Math.min(XS[i], (tx + 1) * TILE)), ny = Math.max(ty * TILE, Math.min(YS[i], (ty + 1) * TILE));
        if (Math.hypot(nx - XS[i], ny - YS[i]) < r) out.add(ty * 1000 + tx);
      }
  return out;
})();

/** Is tile (tx, ty) beside the track? */
export const trackside = (tx: number, ty: number): boolean => TRACKSIDE.has(ty * 1000 + tx);

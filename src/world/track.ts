// The Ring's railway: one closed line round the city (garden.ts, from the
// real S41), rounded off and measured out so that a train can be put
// anywhere along it by how far round it is (`s`, px). Kept free of Phaser:
// the layout keeps the trackside clear with it, and the train runs on it.

import { TRACK } from './garden.ts';
import { TILE } from './size.ts';

type Pt = [number, number];

/** Points along the track this far apart (px). */
const STEP = 2;
/** Lawn closer to the line than this (px) is kept clear: the trains are wider than their rails. */
export const TRACK_CLEARANCE = 12;

/** Chaikin's corner cutting on a closed line: every corner rounded off, `n` times. */
function round(pts: Pt[], n: number): Pt[] {
  for (let k = 0; k < n; k++)
    pts = pts.flatMap(([ax, ay], i) => {
      const [bx, by] = pts[(i + 1) % pts.length];
      return [[ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]] as Pt[];
    });
  return pts;
}

/** The line, rounded, then sampled every STEP px of the way. */
function measure(): { xs: Float32Array; ys: Float32Array; length: number } {
  const corners: Pt[] = [];
  for (let i = 0; i + 1 < TRACK.length; i += 2) corners.push([TRACK[i], TRACK[i + 1]]);
  const line = round(corners, 3);
  const xs: number[] = [], ys: number[] = [];
  let carry = 0;
  for (let i = 0; i < line.length; i++) {
    const [ax, ay] = line[i], [bx, by] = line[(i + 1) % line.length];
    const d = Math.hypot(bx - ax, by - ay);
    let at = carry;
    for (; at < d; at += STEP) {
      xs.push(ax + ((bx - ax) * at) / d);
      ys.push(ay + ((by - ay) * at) / d);
    }
    carry = at - d;
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

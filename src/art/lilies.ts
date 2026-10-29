// Water lilies, painted like the rest (paint.ts ramps and dabs): round pads
// lying flat on the water (seen at a slant, so wider than deep), each with
// the notch cut in to its middle, lit from the top left; and the flowers,
// cups of pointed petals with a golden heart, white or pink. In autumn the
// pads go yellow and brown at their edges.
import { Raster, hash2, type RGB } from './raster.ts';
import { dab, ramp, tone } from './paint.ts';
import { SEASON, type Season } from '../world/season.ts';

const PAD = ramp(6, '#163a36', '#245a3e', '#3a7a40', '#5e9a48', '#8cb85a', '#bcd47a');
const PAD_TURNED = ramp(6, '#3a2a22', '#6a4a26', '#9a7430', '#c09a3c', '#dcbc5a', '#ecd890');
const WHITE = ramp(5, '#8a8aa8', '#c4c4d4', '#e6e2e6', '#fbf6ee', '#ffffff');
const PINK = ramp(5, '#8a3a5a', '#c45c7c', '#e48aa0', '#f4b4c0', '#ffe0e4');
const HEART: RGB[] = [[200, 140, 30], [244, 200, 70]];

const mix = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map((k) => Math.round(a[k] + (b[k] - a[k]) * t)) as unknown as RGB;

/** The pads' sizes (w, h), one picture each. */
export const PAD_SIZES: [number, number][] = [[15, 9], [13, 8], [11, 7], [9, 6]];
export const FLOWER_W = 9, FLOWER_H = 8;

/** Pad i: an ellipse with a notch cut in from its near side (turned a little each), lit from the top left. */
export function buildPad(i: number, s: Season = SEASON): Raster {
  const [w, h] = PAD_SIZES[i], r = new Raster(w, h), seed = 7201 + i * 17;
  const cx = (w - 1) / 2, cy = (h - 1) / 2, rx = w / 2 - 0.3, ry = h / 2 - 0.3;
  // (the notch: a wedge from the middle out towards this angle)
  const notch = 0.6 + i * 0.9, turned = Math.min(1, s.turn * 0.8 + (1 - s.leaves) * 0.5);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const nx = (x - cx) / rx, ny = (y - cy) / ry, d = Math.hypot(nx, ny);
      if (d > 1) continue;
      let a = Math.atan2(ny, nx) - notch;
      a = Math.atan2(Math.sin(a), Math.cos(a));
      if (Math.abs(a) < 0.28 && d > 0.15) continue;
      // lit from the top left, darker towards the rim at the bottom right; veins from the middle
      const vein = Math.abs(Math.sin(Math.atan2(ny, nx) * 4)) < 0.18 && d > 0.3 && d < 0.85;
      let v = 0.55 - nx * 0.15 - ny * 0.25 + dab(x, y, seed) * 0.3 - (vein ? 0.12 : 0);
      if (d > 0.8) v -= 0.15 + (ny > 0 ? 0.1 : -0.1);
      // (autumn eats in from the edges)
      const brown = Math.max(0, Math.min(1, turned * 1.3 - (1 - d) * 1.4 + (hash2(x, y, seed) - 0.5) * 0.3));
      r.set(x, y, mix(tone(PAD, v), tone(PAD_TURNED, v), brown));
    }
  // a dark lip under its near edge, where it meets the water
  for (let x = 0; x < w; x++)
    for (let y = h - 1; y >= 0; y--)
      if (r.isSet(x, y)) {
        if (y + 1 < h) r.set(x, y + 1, PAD[0]);
        break;
      }
  return r;
}

/** Flower i: white (0, 1) or pink (2, 3), open wide (even) or a deeper cup (odd). */
export function buildFlower(i: number): Raster {
  const r = new Raster(FLOWER_W, FLOWER_H), seed = 7301 + i * 13;
  const pal = i < 2 ? WHITE : PINK, open = i % 2 === 0;
  // the petals: pointed, fanning out from the heart, the back ones first (darker), then the front
  const petal = (angle: number, len: number, v: number) => {
    for (let t = 0; t <= len; t += 0.5) {
      const width = Math.sin((t / len) * Math.PI) * 1.2;
      for (let k = -width; k <= width; k += 0.5) {
        const x = Math.round(4 + Math.cos(angle) * t - Math.sin(angle) * k);
        const y = Math.round(5.5 - Math.sin(angle) * t * 0.9 + Math.cos(angle) * k * 0.5);
        if (x < 0 || y < 0 || x >= FLOWER_W || y >= FLOWER_H) continue;
        r.set(x, y, tone(pal, v + t / len * 0.25 - Math.abs(k) * 0.1 + dab(x, y, seed) * 0.2));
      }
    }
  };
  const spread = open ? 1 : 0.7;
  for (const a of [0.25, 2.9, 1.0, 2.15]) petal(Math.PI / 2 + (a - Math.PI / 2) * spread, open ? 4 : 4.5, 0.35);
  for (const a of [0.55, 2.6, 1.57]) petal(Math.PI / 2 + (a - Math.PI / 2) * spread, open ? 3.6 : 4.2, 0.6);
  // the golden heart
  r.set(4, 5, HEART[1]);
  r.set(3, 5, HEART[0]);
  r.set(5, 5, HEART[0]);
  if (open) r.set(4, 4, HEART[1]);
  // low front petals, lying out over the pad
  for (const dx of [-1, 1]) for (let k = 1; k <= 3; k++) r.set(4 + dx * k, 6 + (k > 2 ? 1 : 0), tone(pal, 0.75 - k * 0.08));
  return r;
}

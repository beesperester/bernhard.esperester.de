// Sun shafts falling in from where the sun is (`sun`: the direction on screen
// towards it), dithered to a few alpha steps so they read as pixel art. Two
// variants are cross-faded for a slow shimmer.
import { Raster, hex, mulberry32 } from './raster.ts';
import { bayer } from './tiles.ts';

const LIGHT = hex('#fff0b8');
const MAX_ALPHA = 0.3;
const STEPS = 5;

export interface Rays { raster: Raster; intensity: Float32Array }

export function buildRays(w: number, h: number, variant: number, sun: [number, number] = [-0.55, -0.85]): Rays {
  const rnd = mulberry32(7 + variant * 31);
  const diag = Math.hypot(w, h);
  // they fan out from a point off screen towards the sun, across the view
  const len = Math.hypot(sun[0], sun[1]) || 1;
  const ox = w / 2 + (sun[0] / len) * diag * 0.62, oy = h / 2 + (sun[1] / len) * diag * 0.62;
  const towards = Math.atan2(h / 2 - oy, w / 2 - ox);
  const rays = Array.from({ length: 8 }, (_, i) => ({
    a: towards - 0.55 + (i / 7) * 1.1 + (rnd() - 0.5) * 0.12,
    hw: 0.012 + rnd() * 0.035,
    s: 0.35 + rnd() * 0.65,
  }));
  const raster = new Raster(w, h);
  const intensity = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = x - ox, dy = y - oy;
      // (the angle from the fan's middle, so it never wraps round)
      const ang = towards + Math.atan2(Math.sin(Math.atan2(dy, dx) - towards), Math.cos(Math.atan2(dy, dx) - towards));
      const dist = Math.hypot(dx, dy);
      let i = 0;
      for (const r of rays) {
        const t = Math.abs(ang - r.a) / r.hw;
        if (t < 1) i += r.s * (1 - t * t);
      }
      // fading with the distance from where they come in
      const fall = Math.max(0, Math.min(1, 1 - (dist - diag * 0.3) / (1.15 * diag))) ** 1.6;
      const glow = Math.max(0, Math.min(1, 1 - (dist - diag * 0.3) / (0.55 * diag))) ** 2 * 0.45;
      const v = Math.min(1, i * fall + glow);
      intensity[y * w + x] = v;
      const q = Math.floor(v * STEPS + bayer(x, y)) / STEPS;
      if (q > 0) raster.set(x, y, LIGHT, Math.round(Math.min(1, q) * MAX_ALPHA * 255));
    }
  return { raster, intensity };
}

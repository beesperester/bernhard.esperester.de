// Soft cloud shadows: lumpy blobs with a dithered falloff so they stay pixel-crisp.
import { Raster, hex, mulberry32 } from './raster.ts';
import { bayer } from './tiles.ts';

const SHADE = hex('#0c2430');
/** Alpha steps from the rim inwards; the dither picks between neighbouring steps. */
const STEPS = [0, 22, 40, 56];

export interface CloudShape {
  raster: Raster;
  /** Shadow strength per pixel in [0,1], for sampling cover without reading the texture. */
  cover: Float32Array;
}

export function buildCloud(seed: number, w: number, h: number): CloudShape {
  const rnd = mulberry32(seed * 7919 + 13);
  // a cloud is a cluster of overlapping puffs, flatter than it is wide
  const puffs = Array.from({ length: 6 + Math.floor(rnd() * 4) }, () => ({
    x: w * (0.22 + rnd() * 0.56),
    y: h * (0.3 + rnd() * 0.4),
    r: Math.min(w, h) * (0.22 + rnd() * 0.16),
  }));
  const raster = new Raster(w, h);
  const cover = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let field = 0;
      for (const p of puffs) {
        const d = Math.hypot((x - p.x) / 1.35, y - p.y) / p.r;
        field += Math.max(0, 1 - d * d);
      }
      const v = Math.min(1, field * 0.8);
      const soft = v * v * (3 - 2 * v);
      cover[y * w + x] = soft;
      const s = soft * (STEPS.length - 1);
      const step = Math.min(STEPS.length - 1, Math.floor(s) + (s % 1 > bayer(x, y) ? 1 : 0));
      if (step > 0) raster.set(x, y, SHADE, STEPS[step]);
    }
  return { raster, cover };
}

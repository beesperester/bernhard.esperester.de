import type Phaser from 'phaser';
import type { Hole } from './Trees.ts';
import { defineShader, shade } from './gpu.ts';

// The hole round your cat in the trees in front of it, cut on the GPU: a
// shader over a tree's picture (and its rim) leaves out what lies in the
// hole, dithered at its edge the same way the world's other dithers are.
// Moving the hole is then a few numbers a frame, not a picture cut and sent
// anew.

const HOLE = defineShader('FilterHole', `
/** The hole: its middle in the world, how wide, and how much of it is clear before the dither. */
uniform vec4 uHole;

void main() {
  vec4 c = texture2D(uMainSampler, outTexCoord);
  vec2 w = worldPx();
  float r = uHole.z, d = distance(w, uHole.xy);
  if (d < r && (d < r * uHole.w || bayer(w) < (r - d) / (r * (1.0 - uHole.w)))) c = vec4(0.0);
  gl_FragColor = c;
}
`);

const holes = new WeakMap<Phaser.GameObjects.Image, { uHole: number[] }>();

/** Cut `hole` (null: none) out of picture img, clear out to `clear` of it and dithered beyond. */
export function holeIn(img: Phaser.GameObjects.Image, hole: Hole | null, clear: number): void {
  if (!hole) {
    shade(img, HOLE, null);
    return;
  }
  let u = holes.get(img);
  if (!u) holes.set(img, (u = { uHole: [0, 0, 0, 0] }));
  u.uHole[0] = hole.x;
  u.uHole[1] = hole.y;
  u.uHole[2] = hole.r;
  u.uHole[3] = clear;
  shade(img, HOLE, u);
}

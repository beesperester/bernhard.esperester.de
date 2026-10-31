import type Phaser from 'phaser';
import { FADE_GLSL, type Opening, type Tall } from '../art/fade.ts';
import { defineShader, shade } from './gpu.ts';

// The hole round your cat in the trees in front of it, cut on the GPU (the
// rule is art/fade.ts'): a shader over a tree's picture (and its rim) leaves
// out what lies in the hole, a puff of leaves at a time where the tree's puff
// map says which puff a pixel is in, and thins the rest of the tree with a
// dither. Moving the hole is then a few numbers a frame, not a picture cut
// and sent anew.

const CUT = defineShader('FilterTreeCut', `
uniform sampler2D uPuffs;
/** 1 if the picture has a puff map in uPuffs. */
uniform float uPuffed;
${FADE_GLSL}
void main() {
  vec4 c = texture2D(uMainSampler, outTexCoord);
  vec2 w = worldPx();
  vec4 puff = uPuffed > 0.5 ? texture2D(uPuffs, (w - uOrigin + 0.5) / uSize) : vec4(0.0);
  gl_FragColor = shows(w, puff) ? c : vec4(0.0);
}
`);

/** A cut through a tree: the hole (null: none), how thin the rest of it is (0..1), how it thins with height (null: not), and the texture of its puff map, if any. */
export interface Cut { hole: Opening | null; rest: number; tall: Tall | null; puffs: string | null }

/** Whether cut leaves anything out. */
export const cuts = (cut: Cut | null): boolean => !!cut && (!!cut.hole || cut.rest > 0 || (cut.tall?.most ?? 0) > 0);

/** cut.tall as the shaders' uTall. */
export const tallUniform = (cut: Cut | null): number[] => {
  const t = cut?.tall;
  return t ? [t.foot, t.from, t.span, t.most] : [0, 0, 1, 0];
};

const uniforms = new WeakMap<Phaser.GameObjects.Image, { uHole: number[]; uRest: number; uTall: number[]; uPuffed: number }>();

/** Cut picture img as `cut` says (null: not at all). */
export function cutIn(img: Phaser.GameObjects.Image, cut: Cut | null): void {
  if (!cut || !cuts(cut)) {
    shade(img, CUT, null);
    return;
  }
  let u = uniforms.get(img);
  if (!u) uniforms.set(img, (u = { uHole: [0, 0, 0, 1], uRest: 0, uTall: [0, 0, 1, 0], uPuffed: 0 }));
  const h = cut.hole;
  u.uHole[0] = h?.x ?? 0;
  u.uHole[1] = h?.y ?? 0;
  u.uHole[2] = h?.r ?? 0;
  u.uHole[3] = h?.up ?? 1;
  u.uRest = cut.rest;
  u.uTall = tallUniform(cut);
  u.uPuffed = cut.puffs ? 1 : 0;
  // (a picture without a puff map still needs something bound there)
  shade(img, CUT, u, { uPuffs: cut.puffs ?? '__DEFAULT' });
}

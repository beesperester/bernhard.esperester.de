// How the hole round your cat opens through a tree in front of it. Bark is
// cut as it always was: clear in the middle of the hole, dithered towards its
// edge. Leaves go a puff at a time instead: each puff (art/trees.ts' Puffs)
// goes as a whole, dithered away over a few px, once the hole reaches it, the
// puffs nearer your cat first and, among those as near, in no particular
// order, so the hole's edge is the leaves' own and it opens in a ragged,
// staggered way. Over the tree you stand behind, the hole reaches on up to its
// top if little of the tree is left above it; and the rest of that tree is
// dithered thin (`rest`), so nothing of it stands solid in front of your cat.
//
// The game cuts the hole on the GPU (game/HoleFilter.ts, FADE_GLSL below); the
// same in TypeScript (keeps()) answers what's seen where, and draws the sheet.
import { bayer } from './tiles.ts';
import type { Puffs } from './trees.ts';

/** A hole: its middle (world px), how wide, and how far above its middle it reaches (r: round). */
export interface Opening { x: number; y: number; r: number; up: number }

/**
 * A tall tree thinned the higher up it is, so what's behind its crown shows: from `from` px above its
 * foot (world y `foot`, as drawn) to `from + span`, more and more of it left out, up to `most` (0..1).
 */
export interface Tall { foot: number; from: number; span: number; most: number }

/** How much of a tree is left out at world y for its height (0..1, dithered by shows()). */
export function tallRest(t: Tall | null, y: number): number {
  if (!t || t.most <= 0) return 0;
  return t.most * Math.max(0, Math.min(1, (t.foot - y - t.from) / t.span));
}

/** Bark is cut clear out to this much of the hole, and dithered beyond. */
export const CLEAR = 0.6;
/** A puff is gone once the hole reaches somewhere between this much of its width and all of it... */
const PUFF_NEAR = 0.5;
/** ...counting from this much of the way in from the puff's middle to its edge... */
const PUFF_IN = 0.45;
/** ...and dithers away over this many px. */
const PUFF_BAND = 10;
/** Over the tree you stand behind, the hole reaches up to its top while that's within this many holes' width above... */
const REACH_ALL = 1.25;
/** ...and less and less, until it's this many: then it's round again. */
const REACH_NONE = 1.75;

/** How far a hole at height `y` reaches up through a tree whose top is at `top` (world y). */
export function reachUp(y: number, r: number, top: number): number {
  const above = y - top + 8;
  if (above <= r * REACH_ALL) return Math.max(r, above);
  if (above >= r * REACH_NONE) return r;
  const f = (above - r * REACH_ALL) / (r * (REACH_NONE - REACH_ALL));
  return r * REACH_ALL + (r - r * REACH_ALL) * f;
}

/** How far world point (x, y) is from the hole's middle, as if the hole were round (stretched up above it). */
function distance(o: Opening, x: number, y: number): number {
  const dx = x - o.x, dy = y - o.y;
  return Math.hypot(dx, dy < 0 ? (dy * o.r) / o.up : dy);
}

const f = Math.fround, fract = (v: number) => f(v - Math.floor(v));

/** A puff's place in the order (0..1), from where it is: a float hash the GPU works out alike (Dave Hoskins' hash12). */
export function stagger(x: number, y: number): number {
  let a = fract(f(x * 0.1031)), b = fract(f(y * 0.1031)), c = a;
  const d = f(f(a * f(b + 33.33)) + f(f(b * f(c + 33.33)) + f(c * f(a + 33.33))));
  a = f(a + d); b = f(b + d); c = f(c + d);
  return fract(f(f(a + b) * c));
}

/**
 * Whether the pixel at world (x, y) still shows through hole `o`; `puffs` and `i` (the
 * pixel's number in its picture) say which puff of leaves it is part of, if any.
 */
export function keeps(o: Opening, x: number, y: number, puffs: Puffs | null, i: number): boolean {
  if (o.r <= 0) return true;
  if (puffs && puffs[i * 4 + 3]) {
    const k = i * 4, cx = x + puffs[k] - 128, cy = y + puffs[k + 1] - 128;
    const d = distance(o, cx, cy) - puffs[k + 2] * PUFF_IN;
    const reach = o.r * (PUFF_NEAR + (1 - PUFF_NEAR) * stagger(cx, cy));
    const gone = (reach - d) / PUFF_BAND;
    return gone <= 0 || (gone < 1 && bayer(x, y) >= gone);
  }
  const d = distance(o, x, y);
  if (d >= o.r) return true;
  if (d < o.r * CLEAR) return false;
  return bayer(x, y) >= (o.r - d) / (o.r * (1 - CLEAR));
}

/** How much of the pixel at world (x, y) is left by hole `o` (0..1): keeps() without the dither. */
export function kept(o: Opening, x: number, y: number, puffs: Puffs | null, i: number): number {
  if (o.r <= 0) return 1;
  if (puffs && puffs[i * 4 + 3]) {
    const k = i * 4, cx = x + puffs[k] - 128, cy = y + puffs[k + 1] - 128;
    const d = distance(o, cx, cy) - puffs[k + 2] * PUFF_IN;
    const reach = o.r * (PUFF_NEAR + (1 - PUFF_NEAR) * stagger(cx, cy));
    return 1 - Math.max(0, Math.min(1, (reach - d) / PUFF_BAND));
  }
  const d = distance(o, x, y);
  return Math.max(0, Math.min(1, (d - o.r * CLEAR) / (o.r * (1 - CLEAR))));
}

/** Whether the pixel shows at all: through the hole (keeps()), and through the dither thinning the rest of the tree (0..1) and its height (tall). */
export function shows(o: Opening, rest: number, x: number, y: number, puffs: Puffs | null, i: number, tall: Tall | null = null): boolean {
  return keeps(o, x, y, puffs, i) && bayer(x, y) >= Math.max(rest, tallRest(tall, y));
}

/**
 * The same for the GPU: keeps(w, puff) with the hole in uniforms uHole (x, y, r, up), and shows(w, puff)
 * with the rest's dither in uRest and the height's in uTall (foot, from, span, most). `puff` is the pixel's puff map texel (0..1 as sampled). Needs
 * COMMON's bayer (game/gpu.ts).
 */
export const FADE_GLSL = `
uniform vec4 uHole;
float holeDistance(vec2 p) {
  vec2 d = p - uHole.xy;
  if (d.y < 0.0) d.y *= uHole.z / uHole.w;
  return length(d);
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
bool keeps(vec2 w, vec4 puff) {
  float r = uHole.z;
  if (r <= 0.0) return true;
  if (puff.a > 0.5) {
    vec2 c = w + floor(puff.rg * 255.0 + 0.5) - 128.0;
    float d = holeDistance(c) - floor(puff.b * 255.0 + 0.5) * ${PUFF_IN.toFixed(4)};
    float reach = r * (${PUFF_NEAR.toFixed(4)} + ${(1 - PUFF_NEAR).toFixed(4)} * hash12(c));
    float gone = (reach - d) / ${PUFF_BAND.toFixed(1)};
    return gone <= 0.0 || (gone < 1.0 && bayer(w) >= gone);
  }
  float d = holeDistance(w);
  if (d >= r) return true;
  if (d < r * ${CLEAR.toFixed(4)}) return false;
  return bayer(w) >= (r - d) / (r * ${(1 - CLEAR).toFixed(4)});
}
uniform float uRest;
uniform vec4 uTall;
bool shows(vec2 w, vec4 puff) {
  float tall = uTall.w > 0.0 ? uTall.w * clamp((uTall.x - w.y - uTall.y) / uTall.z, 0.0, 1.0) : 0.0;
  return keeps(w, puff) && bayer(w) >= max(uRest, tall);
}
`;

import Phaser from 'phaser';
import { Kind, ramps } from '../art/painted.ts';
import { paintedMaps, type Prop } from '../art/trees.ts';
import type { Light } from '../world/sky.ts';
import { TREES } from '../world/trees.ts';
import { MAP_H, MAP_W, TILE, casterBox } from '../world/map.ts';
import { FADE_GLSL } from '../art/fade.ts';
import { HEADER, MAX_LAMPS, paintLight, syncRamps } from './Painted.ts';
import type { Cut } from './HoleFilter.ts';
import { isSolid } from './solid.ts';
import { SILHOUETTE } from './CatView.ts';

// The world drawn as cards in 3D. Everything standing in it (trees, plants,
// furniture, follies, fauna, cats) is a card upright at its foot, and the
// ground lies under them; a depth buffer, not sorting, decides what's in
// front. The view is the slanted one the art is drawn for (a pixel h high
// is drawn h px up the screen), so every picture lands 1:1 on the screen.
//
// A card's pixels lie at its depth (Phaser's depth: its foot's y, give or
// take); on a tree they lie at the depth of the leaves there, in front of
// the trunk or behind it, as its crown's balls are round. Pictures with no
// soft edges are drawn in any order, batched by texture; those that are see-
// through (fading, glowing) after them, back to front.
//
// The sun's shadows come from a shadow map: the crowns' balls and trunks
// drawn from the sun, as ellipsoids, what stands on the tiles (hedges,
// fences, bushes, rocks: world/map.ts' casterBox) as boxes, and everything else standing as its
// card turned to face the sun, into a map of how near the sun each is;
// everything drawn looks itself up in it, ignoring its own shadow (a tree's
// leaves their own crown's: its ramps shade it). Where a tree stands in front of your
// cat, it opens round it (game/Trees.ts says how far; art/fade.ts how), in
// the shader. Effects drawn by a shader of their own (shafts of light, banks
// of fog: Phaser Shaders) are cards too, standing on their row, drawn after
// all the rest with that shader (see Effects). Where something solid
// (game/solid.ts: not leaves) is the nearest thing in front of your cat, the
// cat shows through it as a green silhouette: a stencil keeps which pixels
// are solid things'.
//
// It takes over Phaser's pictures: they are kept up to date as ever by
// their systems, but hidden from the camera, and drawn here instead, in two
// passes (Phaser externs, which hand over the GL context and take it back):
// the ground, under what lies on it (water, reflections), and all that
// stands, over that. (?flat: Phaser draws them, sorted, as it used to.)

const RAD = Math.PI / 180;
const MIN_EL = 15;
const COLOUR = [22 / 255, 34 / 255, 78 / 255];
const ALPHA = 0.32;
/** The shadow map's size (texels square). */
const MAP = 1024;
/** The shadow map's size and depth range change in steps of this many px. */
const SNAP = 64;
/** How tall anything is, at most (px), for the shadow map's reach. */
const TALL = 340;
/** Depths: a card's pixels are this far (px) either side of its foot, at most. */
const OFF = 512;
/** Phaser's depths: the ground's pieces, and what stands (between these). */
const GROUND = -100000, STANDING = [-1000, 89000] as const;
/** The passes' places among Phaser's. */
const GROUND_PASS = -99999.5, STANDING_PASS = 89500;
/** The tiles' boxes' id in the shadow map (the ground ignores them on their own tiles: they are drawn in it). */
const BOX_ID = 65535;
/** Floats per vertex: x, y, u, v; foot, depth, id, alpha; tint r, g, b, mode. */
const STRIDE = 12;
/** At most this many cards in one draw. */
const MAX_QUADS = 16384;

type Pic = Phaser.GameObjects.Image | Phaser.GameObjects.Sprite;

/** Pictures drawn together: on one texture, and alike. */
interface Batch {
  main: WebGLTexture;
  normal: WebGLTexture | null;
  depth: WebGLTexture | null;
  tw: number;
  th: number;
  pics: Pic[];
  /** A tree's (its foot's y, its id in the shadow map, and how it's cut round your cat), or anything else's (its own depth, id 0). */
  tree: { foot: number; id: number; cut: Cut | null } | null;
}

/** A see-through picture: drawn in order, its blend mode, alone or with those next to it alike. */
interface Soft { pic: Pic; main: WebGLTexture; normal: WebGLTexture | null; tw: number; th: number }

const VERT = `
precision highp float;
attribute vec4 aPos;
attribute vec4 aInfo;
attribute vec4 aTint;
uniform vec4 uTarget;
varying vec2 vTex;
varying vec2 outView;
varying vec4 vInfo;
varying vec4 vTint;
void main() {
  outView = aPos.xy - uTarget.xy;
  vTex = aPos.zw;
  vInfo = aInfo;
  vTint = aTint;
  gl_Position = vec4(outView.x / uTarget.z * 2.0 - 1.0, 1.0 - outView.y / uTarget.w * 2.0, 0.0, 1.0);
}`;

const FRAG = `
#extension GL_EXT_frag_depth : enable
precision highp float;
uniform sampler2D uMainSampler[1];
uniform vec2 uTexRes;
vec2 getTexRes() { return uTexRes; }
varying vec2 vTex;
varying vec2 outView;
varying vec4 vInfo;
varying vec4 vTint;
${HEADER}
uniform sampler2D uDepth;
uniform float uHasDepth;
uniform float uPainted;
uniform float uGround;
uniform float uSoft;
uniform float uShade;
uniform vec2 uDepthRange;
float m2(vec2 p) { return mod(2.0 * p.x + 3.0 * p.y, 4.0); }
float bayer(vec2 p) {
  vec2 a = mod(p, 4.0);
  return (4.0 * m2(mod(a, 2.0)) + m2(floor(a / 2.0)) + 0.5) / 16.0;
}
${FADE_GLSL}
uniform float uCut;
uniform sampler2D uPuffs;
uniform float uPuffed;
uniform vec4 uPuffUV;
uniform vec4 uPicRect;
uniform sampler2D uShadow;
uniform sampler2D uBoxTiles;
// whether the ground here is a tile's box's (or one drawn up over the tile above it)
bool onBox(vec2 w) {
  vec2 n = vec2(${MAP_W}.0, ${MAP_H}.0);
  return texture2D(uBoxTiles, (floor(w / ${TILE}.0) + 0.5) / n).r > 0.5 || texture2D(uBoxTiles, (floor((w + vec2(0.0, ${TILE / 2}.0)) / ${TILE}.0) + 0.5) / n).r > 0.5;
}
uniform vec3 uU;
uniform vec3 uV;
uniform vec3 uL;
uniform vec4 uBox;
uniform vec2 uDRange;
uniform float uStrength;
void main() {
  vec4 c = texture2D(uMainSampler[0], vTex);
  float alpha = vInfo.w;
  if (uSoft < 0.5 ? c.a < 0.5 : c.a * alpha < 0.004) discard;
  vec2 world = uView.xy + outView;
  float off = 0.0;
  if (uHasDepth > 0.5) {
    vec4 d = texture2D(uDepth, vTex);
    off = floor(d.r * 255.0 + 0.5) * 4.0 + floor(d.g * 255.0 + 0.5) / 64.0 - ${OFF}.0;
  }
  float foot = vInfo.x, D = vInfo.y + off;
  // a tree cut round your cat: what's in the hole left out, a puff of leaves at a time, and the rest thinned
  if (uCut > 0.5) {
    vec2 w = floor(world);
    vec4 puff = uPuffed > 0.5 ? texture2D(uPuffs, mix(uPuffUV.xy, uPuffUV.zw, (w + 0.5 - uPicRect.xy) / uPicRect.zw)) : vec4(0.0);
    if (!shows(w, puff)) discard;
  }
  gl_FragDepthEXT = clamp(0.5 - (D - uDepthRange.x) * uDepthRange.y, 0.0, 1.0);
  // the sun's shadow: what is nearer the sun than this pixel, along its ray (no sunlit rim in it)
  bool shadowed = false;
  if (uShade > 0.5 && uStrength > 0.0) {
    vec3 P = uGround > 0.5 ? vec3(world, 0.0) : vec3(world.x, foot + off, foot - world.y);
    vec2 st = vec2((dot(P, uU) - uBox.x) / uBox.z, (dot(P, uV) - uBox.y) / uBox.w);
    if (st.x > 0.0 && st.y > 0.0 && st.x < 1.0 && st.y < 1.0) {
      vec4 s = texture2D(uShadow, st);
      float sd = uDRange.x + (floor(s.r * 255.0 + 0.5) * 256.0 + floor(s.g * 255.0 + 0.5)) / 65535.0 * uDRange.y;
      float id = floor(s.b * 255.0 + 0.5) * 256.0 + floor(s.a * 255.0 + 0.5);
      bool own = abs(id - vInfo.z) < 0.5 || (uGround > 0.5 && id > ${BOX_ID - 0.5} && onBox(world));
      shadowed = id > 0.5 && !own && sd > dot(P, uL) + 2.0;
    }
  }
  gLit = shadowed ? 0.0 : 1.0;
  vec4 col = uPainted > 0.5 ? painted(c, vTex) : c;
  // tinted: multiplied, or filled
  col.rgb = vTint.w > 0.5 ? vTint.rgb * col.a : col.rgb * vTint.rgb;
  if (shadowed) col.rgb = mix(col.rgb, vec3(${COLOUR.join(', ')}) * col.a, ${ALPHA} * uStrength);
  gl_FragColor = uSoft > 0.5 ? col * alpha : vec4(col.rgb, 1.0);
}`;

/** The crowns' balls drawn from the sun: each a square in the sun's view, and in it the ellipsoid, at its depth. */
const SHADOW_VERT = `
precision highp float;
attribute vec2 aCorner;
attribute vec3 aCentre;
attribute vec3 aRadii;
uniform vec3 uU;
uniform vec3 uV;
uniform vec4 uBox;
varying vec2 vUV;
varying vec3 vCentre;
varying vec3 vRadii;
void main() {
  float r = max(aRadii.x, aRadii.y);
  vUV = vec2(dot(aCentre, uU), dot(aCentre, uV)) + aCorner * r;
  vCentre = aCentre;
  vRadii = aRadii;
  gl_Position = vec4((vUV.x - uBox.x) / uBox.z * 2.0 - 1.0, (vUV.y - uBox.y) / uBox.w * 2.0 - 1.0, 0.0, 1.0);
}`;

const SHADOW_FRAG = `
#extension GL_EXT_frag_depth : enable
precision highp float;
uniform vec3 uU;
uniform vec3 uV;
uniform vec3 uL;
uniform vec2 uDRange;
varying vec2 vUV;
varying vec3 vCentre;
varying vec3 vRadii;
void main() {
  // a ray from the sun's side down through this texel, against the ellipsoid (rx round, rz tall)
  float top = uDRange.x + uDRange.y;
  vec3 o = vUV.x * uU + vUV.y * uV + top * uL - vCentre;
  vec3 sc = vec3(vRadii.x, vRadii.x, vRadii.y);
  vec3 os = o / sc, ds = -uL / sc;
  float a = dot(ds, ds), b = 2.0 * dot(os, ds), c = dot(os, os) - 1.0, disc = b * b - 4.0 * a * c;
  if (disc < 0.0) discard;
  float t = (-b - sqrt(disc)) / (2.0 * a);
  float n = clamp((top - t - uDRange.x) / uDRange.y, 0.0, 1.0);
  float q = floor(n * 65535.0);
  gl_FragColor = vec4(floor(q / 256.0) / 255.0, mod(q, 256.0) / 255.0, floor(vRadii.z / 256.0) / 255.0, mod(vRadii.z, 256.0) / 255.0);
  gl_FragDepthEXT = 1.0 - n;
}`;

/** Standing pictures drawn from the sun: each card stood at its foot (its pixels as high above it as they're drawn up), turned to face the sun. */
const CAST_VERT = `
precision highp float;
attribute vec4 aPos;
attribute vec4 aInfo;
attribute vec4 aTint;
uniform vec3 uU;
uniform vec3 uV;
uniform vec3 uL;
uniform vec4 uBox;
uniform vec2 uDRange;
varying vec2 vTex;
varying float vId;
void main() {
  vec3 P = vec3(aTint.x, aInfo.x, aInfo.x - aPos.y) + (aPos.x - aTint.x) * uU;
  vTex = aPos.zw;
  vId = aInfo.z;
  vec2 s = vec2(dot(P, uU), dot(P, uV));
  float n = clamp((dot(P, uL) - uDRange.x) / uDRange.y, 0.0, 1.0);
  gl_Position = vec4((s.x - uBox.x) / uBox.z * 2.0 - 1.0, (s.y - uBox.y) / uBox.w * 2.0 - 1.0, 1.0 - 2.0 * n, 1.0);
}`;

const CAST_FRAG = `
precision highp float;
uniform sampler2D uTex;
varying vec2 vTex;
varying float vId;
void main() {
  if (texture2D(uTex, vTex).a < 0.5) discard;
  float q = floor(clamp(1.0 - gl_FragCoord.z, 0.0, 1.0) * 65535.0);
  gl_FragColor = vec4(floor(q / 256.0) / 255.0, mod(q, 256.0) / 255.0, floor(vId / 256.0) / 255.0, mod(vId, 256.0) / 255.0);
}`;

/** The tiles' boxes drawn from the sun: each a square in the sun's view round it, and in it the box, at its depth. */
const BOXES_VERT = `
precision highp float;
attribute vec2 aCorner;
attribute vec3 aCentre;
attribute vec3 aHalf;
uniform vec3 uU;
uniform vec3 uV;
uniform vec4 uBox;
varying vec2 vUV;
varying vec3 vCentre;
varying vec3 vHalf;
void main() {
  vUV = vec2(dot(aCentre, uU), dot(aCentre, uV)) + aCorner * length(aHalf);
  vCentre = aCentre;
  vHalf = aHalf;
  gl_Position = vec4((vUV.x - uBox.x) / uBox.z * 2.0 - 1.0, (vUV.y - uBox.y) / uBox.w * 2.0 - 1.0, 0.0, 1.0);
}`;

const BOXES_FRAG = `
#extension GL_EXT_frag_depth : enable
precision highp float;
uniform vec3 uU;
uniform vec3 uV;
uniform vec3 uL;
uniform vec2 uDRange;
varying vec2 vUV;
varying vec3 vCentre;
varying vec3 vHalf;
void main() {
  // a ray from the sun's side down through this texel, against the box (slab by slab)
  float top = uDRange.x + uDRange.y;
  vec3 o = vUV.x * uU + vUV.y * uV + top * uL - vCentre, d = -uL;
  vec3 inv = 1.0 / (d + vec3(equal(d, vec3(0.0))) * 1e-6);
  vec3 a = (-vHalf - o) * inv, b = (vHalf - o) * inv;
  vec3 lo = min(a, b), hi = max(a, b);
  float t0 = max(max(lo.x, lo.y), lo.z), t1 = min(min(hi.x, hi.y), hi.z);
  if (t0 > t1 || t1 < 0.0) discard;
  float n = clamp((top - t0 - uDRange.x) / uDRange.y, 0.0, 1.0);
  float q = floor(n * 65535.0);
  gl_FragColor = vec4(floor(q / 256.0) / 255.0, mod(q, 256.0) / 255.0, ${Math.floor(BOX_ID / 256)}.0 / 255.0, ${BOX_ID % 256}.0 / 255.0);
  gl_FragDepthEXT = 1.0 - n;
}`;

const COMP_VERT = `
precision highp float;
attribute vec2 aCorner;
uniform vec4 uRect;
varying vec2 vTex;
void main() {
  vTex = vec2(aCorner.x, 1.0 - aCorner.y);
  gl_Position = vec4(uRect.x + aCorner.x * uRect.z, uRect.y - aCorner.y * uRect.w, 0.0, 1.0);
}`;

const COMP_FRAG = `
precision highp float;
uniform sampler2D uTex;
varying vec2 vTex;
void main() { gl_FragColor = texture2D(uTex, vTex); }`;

/** An effect drawn by a shader of its own (a Phaser Shader): its quad standing on row `foot`, and its shader's numbers. */
export interface Effect { quad: Phaser.GameObjects.Shader; foot: number; uniforms: Record<string, number | number[]> }

/** Effects of a kind: their shader (as a Phaser Shader's: outTexCoord across uBox, the quad's world box), the textures it samples (its sampler's name: the texture's key), whether their light adds, and those drawn now. */
export interface Effects { source: string; textures?: Record<string, string>; add: boolean; now(): Effect[] }

/** An effect's quad, over its box (world px), its shader's outTexCoord as a Phaser Shader has it. */
const EFFECT_VERT = `
precision highp float;
attribute vec2 aCorner;
uniform vec4 uBox;
uniform vec4 uTarget;
varying vec2 outTexCoord;
void main() {
  outTexCoord = vec2(aCorner.x, 1.0 - aCorner.y);
  vec2 v = uBox.xy + aCorner * uBox.zw - uTarget.xy;
  gl_Position = vec4(v.x / uTarget.z * 2.0 - 1.0, 1.0 - v.y / uTarget.w * 2.0, 0.0, 1.0);
}`;

/** An effect's own shader, at its card's depth. */
const effectFrag = (source: string) => `#extension GL_EXT_frag_depth : enable
precision highp float;
uniform float uCardDepth;
${source.replace(/gl_FragColor = ([^;]*);/, 'gl_FragColor = $1;\n  gl_FragDepthEXT = uCardDepth;')}`;

interface Target { fb: WebGLFramebuffer; tex: WebGLTexture; depth: WebGLRenderbuffer; w: number; h: number }

export class Cards {
  private readonly scene: Phaser.Scene;
  private readonly src: { ground: unknown; trees: unknown; effects: Effects[]; me: () => Pic | null };
  private readonly gl: WebGLRenderingContext;
  private readonly renderer: Phaser.Renderer.WebGL.WebGLRenderer;
  private readonly prog: WebGLProgram;
  private readonly shadowProg: WebGLProgram;
  private readonly castProg: WebGLProgram;
  private readonly compProg: WebGLProgram;
  private readonly effectProgs: WebGLProgram[];
  private effects: Effect[][] = [];
  private readonly quad: WebGLBuffer;
  private readonly verts: WebGLBuffer;
  private readonly indices: WebGLBuffer;
  private readonly balls: WebGLBuffer;
  private readonly boxesProg: WebGLProgram;
  private readonly boxBuf: WebGLBuffer;
  /** Which tiles have a box (a texel a tile). */
  private readonly boxTiles: WebGLTexture;
  private boxData = new Float32Array(0);
  private readonly scratch = new Float32Array(MAX_QUADS * 4 * STRIDE);
  /** A texture for the units a picture has nothing for. */
  private readonly blank: WebGLTexture;
  private ground: Target | null = null;
  private things: Target | null = null;
  private shadow: Target | null = null;
  private readonly depths = new WeakMap<object, WebGLTexture>();
  /** This frame: the view's corner and size (whole world px), and what's drawn. */
  private ox = 0;
  private oy = 0;
  private w = 0;
  private h = 0;
  private readonly groundBatches = new Map<WebGLTexture, Batch>();
  private readonly batches = new Map<WebGLTexture, Batch>();
  /** The solid things' (game/solid.ts). */
  private readonly solids = new Map<WebGLTexture, Batch>();
  private treeBatches: Batch[] = [];
  private softs: Soft[] = [];
  /** Each standing picture's id in the shadow map (after the trees'). */
  private readonly ids = new Map<Pic, number>();
  private strength = 0;
  private U = [1, 0, 0];
  private V = [0, 1, 0];
  private L = [0, 0, 1];
  private box = [0, 0, 1, 1];
  private dRange = [0, 1];
  private ballData = new Float32Array(0);
  private ballCount = 0;
  private shadowDrawn = false;
  private locs: number[] = [];
  /** ms of CPU the passes took, the last few frames (for measuring). */
  readonly ms: number[] = [];

  constructor(scene: Phaser.Scene, src: { ground: unknown; trees: unknown; effects: Effects[]; me: () => Pic | null }) {
    this.scene = scene;
    this.src = src;
    this.renderer = scene.game.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
    const gl = (this.gl = this.renderer.gl);
    if (!gl.getExtension('EXT_frag_depth')) throw new Error('cards: no EXT_frag_depth');
    this.prog = program(gl, VERT, FRAG);
    this.shadowProg = program(gl, SHADOW_VERT, SHADOW_FRAG);
    this.castProg = program(gl, CAST_VERT, CAST_FRAG);
    this.compProg = program(gl, COMP_VERT, COMP_FRAG);
    this.effectProgs = src.effects.map((e) => program(gl, EFFECT_VERT, effectFrag(e.source)));
    this.quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);
    this.verts = gl.createBuffer()!;
    this.balls = gl.createBuffer()!;
    this.boxesProg = program(gl, BOXES_VERT, BOXES_FRAG);
    this.boxBuf = gl.createBuffer()!;
    const tiles = new Uint8Array(MAP_W * MAP_H);
    for (let ty = 0; ty < MAP_H; ty++) for (let tx = 0; tx < MAP_W; tx++) if (casterBox(tx, ty)) tiles[ty * MAP_W + tx] = 255;
    this.boxTiles = this.renderer.createTexture2D(0, gl.NEAREST, gl.NEAREST, gl.CLAMP_TO_EDGE, gl.CLAMP_TO_EDGE, gl.LUMINANCE, tiles, MAP_W, MAP_H, false, false, false).webGLTexture!;
    // each card two triangles: top left, bottom left, bottom right; top left, bottom right, top right
    const idx = new Uint16Array(MAX_QUADS * 6);
    for (let q = 0; q < MAX_QUADS; q++) idx.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3], q * 6);
    this.indices = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indices);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
    this.blank = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.blank);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    const ground = scene.add.extern().setDepth(GROUND_PASS);
    (ground as unknown as { render: () => void }).render = () => this.drawGround();
    const things = scene.add.extern().setDepth(STANDING_PASS);
    (things as unknown as { render: () => void }).render = () => this.drawThings();
  }

  /** Gather what's drawn this frame (and hide it from Phaser's camera). */
  update(view: Phaser.Geom.Rectangle, light: Light, overcast: number): void {
    this.ox = Math.floor(view.x);
    this.oy = Math.floor(view.y);
    this.w = Math.ceil(view.right) - this.ox;
    this.h = Math.ceil(view.bottom) - this.oy;
    const cam = this.scene.cameras.main.id;
    const pad = 64, x0 = view.x - pad, x1 = view.right + pad, y0 = view.y - pad, y1 = view.bottom + pad;
    for (const b of this.groundBatches.values()) b.pics.length = 0;
    for (const b of this.batches.values()) b.pics.length = 0;
    for (const b of this.solids.values()) b.pics.length = 0;
    this.treeBatches = [];
    this.softs = [];
    this.ids.clear();

    // the trees: back and front pictures, their leaves at the depth of their crown's balls
    // (cut round your cat as game/Trees.ts says; their trunk and branches shown over your cat up one aren't needed here)
    const trees = new Set<Pic>();
    const live = (this.src.trees as { live: Map<number, { p: Prop; base: { img: Phaser.GameObjects.Image }; front: { img: Phaser.GameObjects.Image } | null; mid: { img: Phaser.GameObjects.Image } | null; cutBase: Cut | null; cutFrontAs: Cut | null }> }).live;
    for (const [i, t] of live) {
      if (t.mid) trees.add(t.mid.img);
      for (const which of ['base', 'front'] as const) {
        const pic = t[which];
        if (!pic) continue;
        const img = pic.img;
        trees.add(img);
        if (img.x + img.width < x0 || img.x > x1 || img.y + img.height < y0 || img.y > y1) continue;
        const r = which === 'base' ? t.p.raster : t.p.front!.raster, lit = which === 'base' ? t.p.lit : t.p.front!.lit;
        let depth = this.depths.get(img);
        if (!depth) this.depths.set(img, (depth = this.treeDepth(i, r, lit, img.x, img.y, which === 'front')));
        const src = img.frame.source;
        this.treeBatches.push({ main: src.glTexture!.webGLTexture!, normal: normalOf(img), depth, tw: src.width, th: src.height, pics: [img], tree: { foot: TREES[i].y, id: i + 1, cut: which === 'base' ? t.cutBase : t.cutFrontAs } });
      }
    }

    // the ground's pieces, and everything standing
    for (const o of this.scene.children.list) {
      if (!(o instanceof Phaser.GameObjects.Image) && !(o instanceof Phaser.GameObjects.Sprite)) continue;
      const d = o.depth;
      if (d !== GROUND && (d < STANDING[0] || d >= STANDING[1])) continue;
      o.cameraFilter = cam;
      if (trees.has(o) || !o.visible || o.alpha <= 0 || !o.frame?.source?.glTexture) continue;
      const pic = o as Pic, r = Math.max(pic.displayWidth, pic.displayHeight);
      if (pic.x + r < x0 || pic.x - r > x1 || pic.y + r < y0 || pic.y - r > y1) continue;
      const src = pic.frame.source, main = src.glTexture!.webGLTexture!;
      if (d !== GROUND && (pic.alpha < 1 || pic.blendMode !== 0)) {
        this.softs.push({ pic, main, normal: normalOf(pic), tw: src.width, th: src.height });
        continue;
      }
      const into = d === GROUND ? this.groundBatches : isSolid(o) ? this.solids : this.batches;
      let b = into.get(main);
      if (!b) into.set(main, (b = { main, normal: normalOf(pic), depth: null, tw: src.width, th: src.height, pics: [], tree: null }));
      b.pics.push(pic);
      if (d !== GROUND) this.ids.set(pic, Math.min(65535, TREES.length + 1 + this.ids.size));
    }
    this.softs.sort((a, b) => a.pic.depth - b.pic.depth);
    this.effects = this.src.effects.map((e) => e.now());
    for (const list of this.effects) for (const e of list) e.quad.cameraFilter = cam;

    this.strength = Math.max(0, Math.min(1, light.elevation / 10)) * (1 - overcast * 0.85);
    this.sun(light, view);
  }

  /** Tree i's picture (r, placed at x, y): how far in front of its trunk (px) each pixel is, as a texture. */
  private treeDepth(i: number, r: Prop['raster'], lit: Prop['lit'], x: number, y: number, front: boolean): WebGLTexture {
    const t = TREES[i], { main, normal } = paintedMaps(r, lit), out = new Uint8Array(r.w * r.h * 4);
    for (let py = 0; py < r.h; py++)
      for (let px = 0; px < r.w; px++) {
        const o = (py * r.w + px) * 4;
        let off = 0;
        const f = normal[o + 3];
        if (f > 0 && f < 128 && ramps.rows[main[o]]?.kind === Kind.Leaf) {
          // the surface of the crown's balls here: in front, or (the leaves at the back) behind
          const xr = x + px - t.x, hz = t.y - (y + py);
          let best = 0;
          for (const b of t.crown) {
            const q = 1 - ((xr - b.x) / b.rx) ** 2 - ((hz - b.z) / b.rz) ** 2;
            if (q > 0) best = Math.max(best, b.rx * Math.sqrt(q));
          }
          off = front ? best : -best;
        }
        const v = Math.round((off + OFF) * 64);
        out[o] = v >> 8;
        out[o + 1] = v & 255;
        out[o + 3] = 255;
      }
    const gl = this.gl;
    return this.renderer.createTexture2D(0, gl.NEAREST, gl.NEAREST, gl.CLAMP_TO_EDGE, gl.CLAMP_TO_EDGE, gl.RGBA, out, r.w, r.h, false, false, true).webGLTexture!;
  }

  /** The sun's view: its directions, the part of it the view needs, and the crowns' balls in it. */
  private sun(light: Light, view: Phaser.Geom.Rectangle): void {
    const A = light.azimuth * RAD, el = Math.max(MIN_EL, Math.min(light.elevation, 70)) * RAD;
    const gx = Math.sin(A), gy = -Math.cos(A);
    const L = [gx * Math.cos(el), gy * Math.cos(el), Math.sin(el)];
    const U = [-gy, gx, 0];
    const V = [L[1] * U[2] - L[2] * U[1], L[2] * U[0] - L[0] * U[2], L[0] * U[1] - L[1] * U[0]];
    this.L = L;
    this.U = U;
    this.V = V;
    const dot = (p: number[], q: number[]) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
    // everything drawn: the view's ground, and as high as anything stands over it
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity, d0 = Infinity, d1 = -Infinity;
    for (const x of [view.x - 50, view.right + 50])
      for (const y of [view.y - 50, view.bottom + TALL + 50])
        for (const z of [0, TALL]) {
          const P = [x, y, z], u = dot(P, U), v = dot(P, V), d = dot(P, L);
          u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); d0 = Math.min(d0, d); d1 = Math.max(d1, d);
        }
    // (its size in steps, and its corner on whole texels: so its texels stay put in the world as the view moves, and
    // the shadows of small things don't shimmer)
    const su = Math.ceil((u1 - u0) / SNAP) * SNAP + SNAP, sv = Math.ceil((v1 - v0) / SNAP) * SNAP + SNAP;
    const tu = su / MAP, tv = sv / MAP;
    this.box = [Math.floor(u0 / tu) * tu, Math.floor(v0 / tv) * tv, su, sv];
    this.dRange = [Math.floor((d0 - 400) / SNAP) * SNAP, Math.ceil((d1 - d0 + 1200) / SNAP) * SNAP + SNAP];
    // the balls that fall in it
    const data: number[] = [];
    for (let i = 0; i < TREES.length; i++) {
      const t = TREES[i];
      if (t.x + t.w < view.x - 900 || t.x - t.w > view.right + 900 || t.y < view.y - 300 || t.y > view.bottom + 1200) continue;
      for (const b of t.crown) {
        const C = [t.x + b.x, t.y, b.z], u = dot(C, U), v = dot(C, V), r = Math.max(b.rx, b.rz);
        if (u + r < u0 || u - r > u1 || v + r < v0 || v - r > v1) continue;
        for (const [cx, cy] of [[-1, -1], [1, -1], [-1, 1], [-1, 1], [1, -1], [1, 1]]) data.push(cx, cy, C[0], C[1], C[2], b.rx, b.rz, i + 1);
      }
      // its trunk: widest at its foot, up to where it parts
      for (const [cx, cy] of [[-1, -1], [1, -1], [-1, 1], [-1, 1], [1, -1], [1, 1]]) data.push(cx, cy, t.x, t.y, 0, t.trunk, t.fork, i + 1);
    }
    this.ballData = new Float32Array(data);
    this.ballCount = data.length / 8;
    // the tiles' boxes that fall in it (their shadows reach as far as the sun is low)
    const boxes: number[] = [], reach = 40 / Math.tan(Math.max(MIN_EL, light.elevation) * RAD);
    const tx0 = Math.max(0, Math.floor((view.x - reach) / TILE)), tx1 = Math.min(MAP_W - 1, Math.floor((view.right + reach) / TILE));
    const ty0 = Math.max(0, Math.floor((view.y - reach) / TILE)), ty1 = Math.min(MAP_H - 1, Math.floor((view.bottom + reach) / TILE));
    for (let ty = ty0; ty <= ty1; ty++)
      for (let tx = tx0; tx <= tx1; tx++) {
        const b = casterBox(tx, ty);
        if (!b) continue;
        const [l, t, r, bt, h] = b;
        for (const [cx, cy] of [[-1, -1], [1, -1], [-1, 1], [-1, 1], [1, -1], [1, 1]]) boxes.push(cx, cy, (l + r) / 2, (t + bt) / 2, h / 2, (r - l) / 2, (bt - t) / 2, h / 2);
      }
    this.boxData = new Float32Array(boxes);
    this.shadowDrawn = false;
  }

  private target(t: Target | null, w: number, h: number): Target {
    const gl = this.gl;
    if (t && t.w === w && t.h === h) return t;
    if (t) {
      gl.deleteFramebuffer(t.fb);
      gl.deleteTexture(t.tex);
      gl.deleteRenderbuffer(t.depth);
    }
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    const depth = gl.createRenderbuffer()!;
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_STENCIL, w, h);
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, depth);
    return { fb, tex, depth, w, h };
  }

  /** The sun's shadow map, once a frame. */
  private drawShadow(): void {
    if (this.shadowDrawn) return;
    this.shadowDrawn = true;
    const gl = this.gl, p = this.shadowProg;
    this.shadow = this.target(this.shadow, MAP, MAP);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadow.fb);
    gl.viewport(0, 0, MAP, MAP);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (this.strength <= 0) return;
    gl.useProgram(p);
    this.uniforms(p, { uU: this.U, uV: this.V, uL: this.L, uBox: this.box, uDRange: this.dRange });
    gl.bindBuffer(gl.ARRAY_BUFFER, this.balls);
    gl.bufferData(gl.ARRAY_BUFFER, this.ballData, gl.STREAM_DRAW);
    const locs = [this.attr(p, 'aCorner', 2, 32, 0), this.attr(p, 'aCentre', 3, 32, 2), this.attr(p, 'aRadii', 3, 32, 5)];
    if (this.ballCount) gl.drawArrays(gl.TRIANGLES, 0, this.ballCount);
    for (const l of locs) gl.disableVertexAttribArray(l);
    this.drawBoxes();
    this.drawCasters();
  }

  /** The tiles' boxes into the shadow map. */
  private drawBoxes(): void {
    if (!this.boxData.length) return;
    const gl = this.gl, p = this.boxesProg;
    gl.useProgram(p);
    this.uniforms(p, { uU: this.U, uV: this.V, uL: this.L, uBox: this.box, uDRange: this.dRange });
    gl.bindBuffer(gl.ARRAY_BUFFER, this.boxBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.boxData, gl.STREAM_DRAW);
    const locs = [this.attr(p, 'aCorner', 2, 32, 0), this.attr(p, 'aCentre', 3, 32, 2), this.attr(p, 'aHalf', 3, 32, 5)];
    gl.drawArrays(gl.TRIANGLES, 0, this.boxData.length / 8);
    for (const l of locs) gl.disableVertexAttribArray(l);
  }

  /** Everything standing, but the trees, into the shadow map: its card, turned to face the sun. */
  private drawCasters(): void {
    const gl = this.gl, p = this.castProg, out = this.scratch;
    gl.useProgram(p);
    this.uniforms(p, { uU: this.U, uV: this.V, uL: this.L, uBox: this.box, uDRange: this.dRange });
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(gl.getUniformLocation(p, 'uTex'), 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.verts);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indices);
    const locs = [this.attr(p, 'aPos', 4, STRIDE * 4, 0), this.attr(p, 'aInfo', 4, STRIDE * 4, 4), this.attr(p, 'aTint', 4, STRIDE * 4, 8)];
    for (const b of [...this.batches.values(), ...this.solids.values()]) {
      if (!b.pics.length) continue;
      gl.bindTexture(gl.TEXTURE_2D, b.main);
      for (let start = 0; start < b.pics.length; start += MAX_QUADS) {
        const n = Math.min(MAX_QUADS, b.pics.length - start);
        for (let k = 0; k < n; k++) {
          const pic = b.pics[start + k], at = k * 4 * STRIDE;
          writeQuad(out, at, pic, pic.depth, pic.depth, this.ids.get(pic) ?? 0);
          // the card turns round its middle
          const mid = (out[at] + out[at + STRIDE] + out[at + 2 * STRIDE] + out[at + 3 * STRIDE]) / 4;
          for (let c = 0; c < 4; c++) out[at + c * STRIDE + 8] = mid;
        }
        gl.bufferData(gl.ARRAY_BUFFER, out.subarray(0, n * 4 * STRIDE), gl.STREAM_DRAW);
        gl.drawElements(gl.TRIANGLES, n * 6, gl.UNSIGNED_SHORT, 0);
      }
    }
    for (const l of locs) gl.disableVertexAttribArray(l);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
  }

  private attr(p: WebGLProgram, name: string, size: number, stride: number, at: number): number {
    const gl = this.gl, loc = gl.getAttribLocation(p, name);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, at * 4);
    return loc;
  }

  private drawGround(): void {
    const t0 = performance.now(), gl = this.gl;
    const back = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null, vp = gl.getParameter(gl.VIEWPORT) as Int32Array;
    this.drawShadow();
    this.ground = this.target(this.ground, this.w, this.h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.ground.fb);
    gl.viewport(0, 0, this.w, this.h);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.BLEND);
    this.begin(true);
    for (const b of this.groundBatches.values()) this.drawBatch(b, false);
    this.end();
    this.composite(this.ground.tex, back, vp, false);
    this.ms.push(performance.now() - t0);
  }

  private drawThings(): void {
    const t0 = performance.now(), gl = this.gl;
    const back = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null, vp = gl.getParameter(gl.VIEWPORT) as Int32Array;
    this.drawShadow();
    this.things = this.target(this.things, this.w, this.h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.things.fb);
    gl.viewport(0, 0, this.w, this.h);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    gl.depthMask(true);
    gl.clearStencil(0);
    gl.stencilMask(0xff);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.BLEND);
    // (the stencil: 1 where the nearest thing is solid)
    gl.enable(gl.STENCIL_TEST);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
    gl.stencilFunc(gl.ALWAYS, 0, 0xff);
    this.begin(false);
    for (const b of this.treeBatches) this.drawBatch(b, false);
    for (const b of this.batches.values()) this.drawBatch(b, false);
    gl.stencilFunc(gl.ALWAYS, 1, 0xff);
    for (const b of this.solids.values()) this.drawBatch(b, false);
    gl.stencilMask(0);
    // the see-through ones, back to front, not hiding what's behind them
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    const softs = this.softs;
    for (let i = 0; i < softs.length; ) {
      const s = softs[i], mode = s.pic.blendMode as number;
      let j = i + 1;
      while (j < softs.length && softs[j].main === s.main && softs[j].pic.blendMode === mode) j++;
      if (mode === Phaser.BlendModes.ADD) gl.blendFunc(gl.ONE, gl.ONE);
      else if (mode === Phaser.BlendModes.MULTIPLY) gl.blendFunc(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA);
      else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      this.drawBatch({ main: s.main, normal: s.normal, depth: null, tw: s.tw, th: s.th, pics: softs.slice(i, j).map((x) => x.pic), tree: null }, true, mode !== Phaser.BlendModes.ADD);
      i = j;
    }
    this.end();
    this.drawEffects();
    this.drawSilhouette();
    gl.disable(gl.STENCIL_TEST);
    gl.stencilMask(0xff);
    gl.disable(gl.DEPTH_TEST);
    this.composite(this.things.tex, back, vp, true);
    this.ms[this.ms.length - 1] += performance.now() - t0;
    if (this.ms.length > 240) this.ms.shift();
  }

  /** Your cat, filled green, where the nearest thing in front of it is solid. */
  private drawSilhouette(): void {
    const me = this.src.me();
    if (!me) return;
    const gl = this.gl, out = this.scratch;
    gl.stencilFunc(gl.EQUAL, 1, 0xff);
    gl.depthFunc(gl.GREATER);
    gl.disable(gl.BLEND);
    this.begin(false);
    this.unit(0, me.frame.source.glTexture!.webGLTexture!, 'uMainSampler[0]');
    this.uniforms(this.prog, { uTexRes: [me.frame.source.width, me.frame.source.height], uHasDepth: 0, uPainted: 0, uSoft: 0, uShade: 0 });
    this.cut(null, me);
    writeQuad(out, 0, me, me.depth, me.depth, 0);
    const r = ((SILHOUETTE >> 16) & 255) / 255, g = ((SILHOUETTE >> 8) & 255) / 255, b = (SILHOUETTE & 255) / 255;
    for (let c = 0; c < 4; c++) out.set([1, r, g, b, 1], c * STRIDE + 7);
    gl.bufferData(gl.ARRAY_BUFFER, out.subarray(0, 4 * STRIDE), gl.STREAM_DRAW);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    this.end();
    gl.depthFunc(gl.LEQUAL);
  }

  /** The effects (fog, then shafts of light), each at its row's depth: hidden by what stands in front of it, over what's behind. */
  private drawEffects(): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    this.src.effects.forEach((kind, k) => {
      const list = this.effects[k];
      if (!list.length) return;
      const p = this.effectProgs[k];
      gl.useProgram(p);
      // (light added, not covering: what's under it stays as it is)
      if (kind.add) gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE);
      else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      Object.entries(kind.textures ?? {}).forEach(([name, key], n) => {
        gl.activeTexture(gl.TEXTURE0 + n);
        gl.bindTexture(gl.TEXTURE_2D, this.scene.textures.get(key).source[0].glTexture?.webGLTexture ?? this.blank);
        gl.uniform1i(gl.getUniformLocation(p, name), n);
      });
      const loc = this.attr(p, 'aCorner', 2, 0, 0);
      this.uniforms(p, { uTarget: [this.ox, this.oy, this.w, this.h] });
      for (const e of list) {
        this.uniforms(p, { ...e.uniforms, uCardDepth: Math.max(0, Math.min(1, 0.5 - (e.foot - this.oy) / 4096)) });
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
      gl.disableVertexAttribArray(loc);
    });
  }

  /** Set up the cards' program for a pass. */
  private begin(ground: boolean): void {
    const gl = this.gl, p = this.prog;
    gl.useProgram(p);
    this.unit(2, syncRamps(this.renderer).webGLTexture!, 'uRamps');
    this.unit(4, this.shadow!.tex, 'uShadow');
    this.unit(6, this.boxTiles, 'uBoxTiles');
    this.uniforms(p, {
      uTarget: [this.ox, this.oy, this.w, this.h], uView: [this.ox, this.oy, 1], uSun: paintLight.sun, uRimDir: paintLight.rimDir, uRim: paintLight.rim,
      uGround: ground ? 1 : 0, uDepthRange: [this.oy, 1 / 4096], uU: this.U, uV: this.V, uL: this.L, uBox: this.box, uDRange: this.dRange,
      uStrength: this.strength,
    });
    gl.uniform4fv(gl.getUniformLocation(p, 'uLamps[0]'), paintLight.lamps);
    gl.uniform1i(gl.getUniformLocation(p, 'uLampCount'), Math.min(MAX_LAMPS, paintLight.lampCount));
    gl.bindBuffer(gl.ARRAY_BUFFER, this.verts);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indices);
    this.locs = [this.attr(p, 'aPos', 4, STRIDE * 4, 0), this.attr(p, 'aInfo', 4, STRIDE * 4, 4), this.attr(p, 'aTint', 4, STRIDE * 4, 8)];
  }

  private end(): void {
    for (const l of this.locs) this.gl.disableVertexAttribArray(l);
    this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, null);
  }

  private unit(n: number, tex: WebGLTexture | null, name: string): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + n);
    gl.bindTexture(gl.TEXTURE_2D, tex ?? this.blank);
    gl.uniform1i(gl.getUniformLocation(this.prog, name), n);
  }

  /** Draw batch b's cards (soft: see-through, blended; shade: in the sun's shadow). */
  private drawBatch(b: Batch, soft: boolean, shade = true): void {
    if (!b.pics.length) return;
    const gl = this.gl, p = this.prog;
    this.unit(0, b.main, 'uMainSampler[0]');
    this.unit(1, b.normal, 'uNormSampler');
    this.unit(3, b.depth, 'uDepth');
    this.uniforms(p, { uTexRes: [b.tw, b.th], uHasDepth: b.depth ? 1 : 0, uPainted: b.normal ? 1 : 0, uSoft: soft ? 1 : 0, uShade: shade ? 1 : 0 });
    this.cut(b.tree?.cut ?? null, b.pics[0]);
    const out = this.scratch;
    for (let start = 0; start < b.pics.length; start += MAX_QUADS) {
      const n = Math.min(MAX_QUADS, b.pics.length - start);
      for (let k = 0; k < n; k++) {
        const pic = b.pics[start + k];
        const foot = b.tree ? b.tree.foot : pic.depth;
        writeQuad(out, k * 4 * STRIDE, pic, foot, foot, b.tree ? b.tree.id : (this.ids.get(pic) ?? 0));
      }
      gl.bufferData(gl.ARRAY_BUFFER, out.subarray(0, n * 4 * STRIDE), gl.STREAM_DRAW);
      gl.drawElements(gl.TRIANGLES, n * 6, gl.UNSIGNED_SHORT, 0);
    }
  }

  /** Cut the tree picture `pic` as `cut` says (null: not at all): art/fade.ts' hole and thinning, with its puff map. */
  private cut(cut: Cut | null, pic: Pic): void {
    const on = !!cut && (!!cut.hole || cut.rest > 0);
    const puffs = on && cut!.puffs ? this.scene.textures.get(cut!.puffs) : null, f = puffs?.get();
    this.unit(5, f?.source.glTexture?.webGLTexture ?? null, 'uPuffs');
    const h = cut?.hole;
    this.uniforms(this.prog, {
      uCut: on ? 1 : 0, uHole: [h?.x ?? 0, h?.y ?? 0, h?.r ?? 0, h?.up ?? 1], uRest: cut?.rest ?? 0, uPuffed: f ? 1 : 0,
      uPuffUV: f ? [f.u0, f.v0, f.u1, f.v1] : [0, 0, 1, 1], uPicRect: [pic.x, pic.y, pic.width, pic.height],
    });
  }

  /** Lay picture `tex` (the view, in world px) over the camera's framebuffer. */
  private composite(tex: WebGLTexture, back: WebGLFramebuffer | null, vp: Int32Array, blend: boolean): void {
    const gl = this.gl, p = this.compProg, cam = this.scene.cameras.main, view = cam.worldView, z = cam.zoom;
    gl.bindFramebuffer(gl.FRAMEBUFFER, back);
    gl.viewport(vp[0], vp[1], vp[2], vp[3]);
    gl.useProgram(p);
    if (blend) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    } else gl.disable(gl.BLEND);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(gl.getUniformLocation(p, 'uTex'), 0);
    const sx = ((this.ox - view.x) * z) / vp[2] * 2 - 1, sy = 1 - ((this.oy - view.y) * z) / vp[3] * 2;
    gl.uniform4f(gl.getUniformLocation(p, 'uRect'), sx, sy, (this.w * z) / vp[2] * 2, (this.h * z) / vp[3] * 2);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    const loc = this.attr(p, 'aCorner', 2, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.disableVertexAttribArray(loc);
  }

  private uniforms(p: WebGLProgram, u: Record<string, number | number[]>): void {
    const gl = this.gl;
    for (const [name, v] of Object.entries(u)) {
      const loc = gl.getUniformLocation(p, name);
      if (!loc) continue;
      if (typeof v === 'number') gl.uniform1f(loc, v);
      else if (v.length === 2) gl.uniform2fv(loc, v);
      else if (v.length === 3) gl.uniform3fv(loc, v);
      else gl.uniform4fv(loc, v);
    }
  }
}

/** A painted picture's normal map (null: it isn't painted). */
function normalOf(pic: Pic): WebGLTexture | null {
  const ds = (pic.texture.dataSource as unknown as ({ glTexture?: { webGLTexture?: WebGLTexture } } | undefined)[])[0];
  return ds?.glTexture?.webGLTexture ?? null;
}

/** Picture `pic`'s card as Phaser would place it (its frame or crop, flipped, turned, scaled), into `out` at `at`. */
function writeQuad(out: Float32Array, at: number, pic: Pic, foot: number, depth: number, id: number): void {
  const f = pic.frame;
  let uv: { x: number; y: number; u0: number; v0: number; u1: number; v1: number } = f, fw = f.cutWidth, fh = f.cutHeight;
  if (pic.isCropped) {
    const crop = (pic as unknown as { _crop: typeof uv & { width: number; height: number; flipX: boolean; flipY: boolean } })._crop;
    if (crop.flipX !== pic.flipX || crop.flipY !== pic.flipY) f.updateCropUVs(crop as never, pic.flipX, pic.flipY);
    uv = crop;
    fw = crop.width;
    fh = crop.height;
  }
  const ox = pic.displayOriginX, oy = pic.displayOriginY;
  let x = -ox + uv.x, y = -oy + uv.y, fx = 1, fy = 1;
  if (pic.flipX) { x += -f.realWidth + ox * 2; fx = -1; }
  if (pic.flipY) { y += -f.realHeight + oy * 2; fy = -1; }
  const sx = pic.scaleX * fx, sy = pic.scaleY * fy, r = pic.rotation, cos = Math.cos(r), sin = Math.sin(r);
  const a = cos * sx, b = sin * sx, c = -sin * sy, d = cos * sy, e = pic.x, g = pic.y;
  const round = r === 0 && Math.abs(sx) === 1 && Math.abs(sy) === 1;
  const tint = pic.tintTopLeft, tr = ((tint >> 16) & 255) / 255, tg = ((tint >> 8) & 255) / 255, tb = (tint & 255) / 255;
  const mode = pic.tintMode === Phaser.TintModes.FILL ? 1 : 0, alpha = pic.alpha;
  const corner = (k: number, px: number, py: number, u: number, v: number) => {
    let wx = a * px + c * py + e, wy = b * px + d * py + g;
    if (round) { wx = Math.round(wx); wy = Math.round(wy); }
    const o = at + k * STRIDE;
    out[o] = wx; out[o + 1] = wy; out[o + 2] = u; out[o + 3] = v;
    out[o + 4] = foot; out[o + 5] = depth; out[o + 6] = id; out[o + 7] = alpha;
    out[o + 8] = tr; out[o + 9] = tg; out[o + 10] = tb; out[o + 11] = mode;
  };
  corner(0, x, y, uv.u0, uv.v0);
  corner(1, x, y + fh, uv.u0, uv.v1);
  corner(2, x + fw, y + fh, uv.u1, uv.v1);
  corner(3, x + fw, y, uv.u1, uv.v0);
}

function program(gl: WebGLRenderingContext, vs: string, fs: string): WebGLProgram {
  const make = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`cards shader: ${gl.getShaderInfoLog(s)}`);
    return s;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, make(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, make(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`cards program: ${gl.getProgramInfoLog(p)}`);
  return p;
}

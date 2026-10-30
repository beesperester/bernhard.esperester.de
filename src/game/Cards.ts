import Phaser from 'phaser';
import { Kind, ramps } from '../art/painted.ts';
import { paintedMaps, type Prop } from '../art/trees.ts';
import type { Light } from '../world/sky.ts';
import { TREES, treeHolding } from '../world/trees.ts';
import type { CatView } from './CatView.ts';
import { HEADER, MAX_LAMPS, paintLight, syncRamps } from './Painted.ts';

// SPIKE (?cards): the world drawn as cards in 3D, to see what it buys us.
//
// The ground, the trees and the cats are not drawn as Phaser images sorted
// by depth, but by our own renderer, with a depth buffer: every card stands
// upright at its foot, and its pixels lie at their foot's depth, or, on a
// tree, at the depth of the leaves there (in front of the trunk or behind
// it, as the crown's balls are round). The view is the same slanted one as
// ever (a pixel h high is drawn h px up the screen), so the art lands 1:1.
//
// The sun's shadows come from a shadow map: the crowns' balls drawn from the
// sun, as ellipsoids, into a map of how near the sun each is; everything
// drawn looks itself up in it, the ground, the trees and the cats alike, and
// a tree's leaves ignore the shadow of their own crown (its ramps shade it).
//
// Where leaves stand in front of your cat, round it, they are dithered away
// in the shader.
//
// (Phaser's externs hand the GL context over and take it back round their render().)
//
// Two passes, as Phaser externs: the ground (under everything Phaser still
// draws), and the trees and cats (over it all: furniture, fauna and water
// are still Phaser's, and not sorted against the trees yet).

const RAD = Math.PI / 180;
const MIN_EL = 15;
const COLOUR = [22 / 255, 34 / 255, 78 / 255];
const ALPHA = 0.32;
/** The shadow map's size (texels square). */
const MAP = 1024;
/** How tall anything is, at most (px), for the shadow map's reach. */
const TALL = 340;
/** Depths: a card's pixels are this far (px) either side of its foot, at most. */
const OFF = 512;
/** The hole round your cat in leaves in front of it (px). */
const HOLE_R = 64;

/** What one card is drawn with: its textures, where it is, and its depth. */
interface Card {
  main: WebGLTexture;
  normal: WebGLTexture;
  depth: WebGLTexture | null;
  /** Its picture's top-left corner and size (world px, as drawn). */
  x: number; y: number; w: number; h: number;
  /** Its frame on the texture (u0, v0 top left; u1, v1 bottom right) and the texture's size. */
  u0: number; v0: number; u1: number; v1: number;
  tw: number; th: number;
  /** Ground y of its foot; and its depth there. */
  foot: number;
  base: number;
  /** In the shadow map, the id of what it is (0: nothing), and whether it takes its own shadow too. */
  id: number;
  self: boolean;
  /** A tree's leaves (fade round your cat). */
  leaves: boolean;
}

const VERT = `
precision highp float;
attribute vec2 aCorner;
uniform vec4 uRect;
uniform vec4 uFrame;
uniform vec4 uTarget;
varying vec2 vTex;
varying vec2 outView;
void main() {
  vec2 w = uRect.xy + aCorner * uRect.zw;
  outView = w - uTarget.xy;
  vTex = mix(uFrame.xy, uFrame.zw, aCorner);
  gl_Position = vec4((w.x - uTarget.x) / uTarget.z * 2.0 - 1.0, 1.0 - (w.y - uTarget.y) / uTarget.w * 2.0, 0.0, 1.0);
}`;

const FRAG = `
#extension GL_EXT_frag_depth : enable
precision highp float;
uniform sampler2D uMainSampler[1];
uniform vec2 uTexRes;
vec2 getTexRes() { return uTexRes; }
varying vec2 vTex;
varying vec2 outView;
${HEADER}
uniform sampler2D uDepth;
uniform float uHasDepth;
uniform float uGround;
uniform float uFoot;
uniform float uBase;
uniform vec2 uDepthRange;
uniform vec4 uHole;
uniform float uLeaves;
uniform sampler2D uShadow;
uniform vec3 uU;
uniform vec3 uV;
uniform vec3 uL;
uniform vec4 uBox;
uniform vec2 uDRange;
uniform float uId;
uniform float uSelf;
uniform float uStrength;
float bayer4(vec2 p) {
  vec2 q = mod(floor(p), 4.0);
  float a = mod(q.x, 2.0), b = mod(q.y, 2.0), c = floor(q.x / 2.0), d = floor(q.y / 2.0);
  float v = 8.0 * mod(a + b, 2.0) + 4.0 * b + 2.0 * mod(c + d, 2.0) + d;
  return (v + 0.5) / 16.0;
}
void main() {
  vec4 c = texture2D(uMainSampler[0], vTex);
  if (c.a < 0.5) discard;
  vec2 world = uView.xy + outView;
  float off = 0.0;
  if (uHasDepth > 0.5) {
    vec4 d = texture2D(uDepth, vTex);
    off = floor(d.r * 255.0 + 0.5) * 4.0 + floor(d.g * 255.0 + 0.5) / 64.0 - ${OFF}.0;
  }
  float D = uBase + off;
  if (uGround < 0.5) {
    // leaves in front of your cat, round it, dithered away
    if (uLeaves > 0.5 && D > uHole.w + 1.0) {
      float k = length(world - uHole.xy) / uHole.z;
      if (k < 1.0 && bayer4(world) > (k - 0.7) * 3.3) discard;
    }
    gl_FragDepthEXT = clamp(0.5 - (D - uDepthRange.x) * uDepthRange.y, 0.0, 1.0);
  }
  vec4 col = painted(c, vTex);
  // the sun's shadow: what is nearer the sun than this pixel, along its ray
  vec3 P = vec3(world.x, uGround > 0.5 ? world.y : uFoot + off, uGround > 0.5 ? 0.0 : uFoot - world.y);
  vec2 st = vec2((dot(P, uU) - uBox.x) / uBox.z, (dot(P, uV) - uBox.y) / uBox.w);
  if (uStrength > 0.0 && st.x > 0.0 && st.y > 0.0 && st.x < 1.0 && st.y < 1.0) {
    vec4 s = texture2D(uShadow, st);
    float sd = uDRange.x + (floor(s.r * 255.0 + 0.5) * 256.0 + floor(s.g * 255.0 + 0.5)) / 65535.0 * uDRange.y;
    float id = floor(s.b * 255.0 + 0.5);
    if (id > 0.5 && (uSelf > 0.5 || abs(id - uId) > 0.5) && sd > dot(P, uL) + 2.0) col.rgb = mix(col.rgb, vec3(${COLOUR.join(', ')}), ${ALPHA} * uStrength);
  }
  gl_FragColor = vec4(col.rgb, 1.0);
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
  gl_FragColor = vec4(floor(q / 256.0) / 255.0, mod(q, 256.0) / 255.0, vRadii.z / 255.0, 1.0);
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

interface Target { fb: WebGLFramebuffer; tex: WebGLTexture; depth: WebGLRenderbuffer; w: number; h: number }

export class Cards {
  private readonly scene: Phaser.Scene;
  private readonly src: { ground: unknown; trees: unknown; shadows: unknown };
  private readonly gl: WebGLRenderingContext;
  private readonly renderer: Phaser.Renderer.WebGL.WebGLRenderer;
  private readonly prog: WebGLProgram;
  private readonly shadowProg: WebGLProgram;
  private readonly compProg: WebGLProgram;
  private readonly quad: WebGLBuffer;
  private readonly balls: WebGLBuffer;
  private ground: Target | null = null;
  private things: Target | null = null;
  private shadow: Target | null = null;
  private readonly depths = new WeakMap<object, WebGLTexture>();
  /** This frame: the view's corner and size (whole world px), the cards, and the sun. */
  private ox = 0;
  private oy = 0;
  private w = 0;
  private h = 0;
  private groundCards: Card[] = [];
  private cards: Card[] = [];
  private hole = [0, 0, 0, -1e9];
  private strength = 0;
  private U = [1, 0, 0];
  private V = [0, 1, 0];
  private L = [0, 0, 1];
  private box = [0, 0, 1, 1];
  private dRange = [0, 1];
  private ballData = new Float32Array(0);
  private ballCount = 0;
  private shadowDrawn = false;
  /** Draw-time ms of the last few frames (both passes), for measuring. */
  readonly ms: number[] = [];

  constructor(scene: Phaser.Scene, src: { ground: unknown; trees: unknown; shadows: unknown }) {
    this.scene = scene;
    this.src = src;
    this.renderer = scene.game.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
    const gl = (this.gl = this.renderer.gl);
    if (!gl.getExtension('EXT_frag_depth')) throw new Error('cards: no EXT_frag_depth');
    this.prog = program(gl, VERT, FRAG);
    this.shadowProg = program(gl, SHADOW_VERT, SHADOW_FRAG);
    this.compProg = program(gl, COMP_VERT, COMP_FRAG);
    this.quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);
    this.balls = gl.createBuffer()!;
    const ground = scene.add.extern().setDepth(-99999.5);
    (ground as unknown as { render: () => void }).render = () => this.drawGround();
    const things = scene.add.extern().setDepth(90000);
    (things as unknown as { render: () => void }).render = () => this.drawThings();
  }

  /** Gather what's drawn this frame (and hide it from Phaser). */
  update(view: Phaser.Geom.Rectangle, cats: CatView[], me: CatView, light: Light, overcast: number): void {
    this.ox = Math.floor(view.x);
    this.oy = Math.floor(view.y);
    this.w = Math.ceil(view.right) - this.ox;
    this.h = Math.ceil(view.bottom) - this.oy;
    const pad = 400;
    const near = (x: number, y: number, w: number, h: number) => x + w > view.x - pad && x < view.right + pad && y + h > view.y - pad && y < view.bottom + pad;

    // the ground's pieces
    this.groundCards = [];
    const pieces = (this.src.ground as { pieces: Map<number, { imgs: Phaser.GameObjects.Image[] }> }).pieces;
    for (const p of pieces.values())
      for (const img of p.imgs) {
        img.setAlpha(0);
        if (img.visible && near(img.x, img.y, img.width, img.height)) this.groundCards.push(this.cardOf(img, img.y + img.height, -1e6, 0, false, null));
      }

    // the trees: back and front pictures, their leaves at the depth of their crown's balls
    this.cards = [];
    const live = (this.src.trees as { live: Map<number, { p: Prop; base: { img: Phaser.GameObjects.Image }; front: { img: Phaser.GameObjects.Image } | null; mid: { img: Phaser.GameObjects.Image } | null }> }).live;
    for (const [i, t] of live) {
      const t3 = TREES[i];
      for (const which of ['base', 'front'] as const) {
        const pic = t[which];
        if (!pic) continue;
        pic.img.setAlpha(0);
        if (!near(pic.img.x, pic.img.y, pic.img.width, pic.img.height)) continue;
        const r = which === 'base' ? t.p.raster : t.p.front!.raster, lit = which === 'base' ? t.p.lit : t.p.front!.lit;
        let depth = this.depths.get(pic.img);
        if (!depth) this.depths.set(pic.img, (depth = this.treeDepth(i, r, lit, pic.img.x, pic.img.y, which === 'front')));
        this.cards.push(this.cardOf(pic.img, t3.y, t3.y, (i % 254) + 1, true, depth));
      }
      t.mid?.img.setAlpha(0);
    }

    // the cats
    for (const cat of cats) {
      const c = cat as unknown as { sprite: Phaser.GameObjects.Sprite; rim: Phaser.GameObjects.Image; shadow: Phaser.GameObjects.Image };
      const s = c.sprite;
      const seen = s.alpha;
      s.setAlpha(0);
      c.rim.setVisible(false);
      if (!s.visible || seen <= 0) continue;
      const card = this.cardOf(s, cat.y, cat.depth, 0, true, null);
      card.leaves = false;
      this.cards.push(card);
    }

    // your cat: where the leaves in front of it open
    this.hole = [me.x, me.y - me.z - 8, HOLE_R, treeHolding(me.x, me.y, me.z) >= 0 ? me.depth - 0.5 : me.depth];

    // the sun
    (this.src.shadows as { map: Phaser.GameObjects.RenderTexture }).map.setVisible(false);
    this.strength = Math.max(0, Math.min(1, light.elevation / 10)) * (1 - overcast * 0.85);
    this.sun(light, view);
  }

  /** The card of image `img` as drawn now. */
  private cardOf(img: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite, foot: number, base: number, id: number, self: boolean, depth: WebGLTexture | null): Card {
    const f = img.frame, src = f.source;
    const w = img.displayWidth, h = img.displayHeight;
    const x = img.x - img.displayOriginX * img.scaleX, y = img.y - img.displayOriginY * img.scaleY;
    const main = src.glTexture!.webGLTexture!;
    const normal = (img.texture.dataSource[0] as unknown as { glTexture: { webGLTexture: WebGLTexture } }).glTexture.webGLTexture;
    return { main, normal, depth, x, y, w, h, u0: f.u0, v0: f.v0, u1: f.u1, v1: f.v1, tw: src.width, th: src.height, foot, base, id, self, leaves: !!depth };
  }

  /** Tree i's picture (r, placed at x, y): how far in front of its trunk (px) each pixel is, as a texture. */
  private treeDepth(i: number, r: Prop['raster'], lit: Prop['lit'], x: number, y: number, front: boolean): WebGLTexture {
    const t = TREES[i], { main, normal } = paintedMaps(r, lit), out = new Uint8Array(r.w * r.h * 4);
    for (let py = 0; py < r.h; py++)
      for (let px = 0; px < r.w; px++) {
        const o = (py * r.w + px) * 4;
        let off = 0;
        const f = normal[o + 3];
        const leaf = f > 0 && f < 128 && ramps.rows[main[o]]?.kind === Kind.Leaf;
        if (leaf) {
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
    this.box = [u0, v0, u1 - u0, v1 - v0];
    this.dRange = [d0 - 400, d1 - d0 + 1200];
    // the balls that fall in it
    const data: number[] = [];
    for (let i = 0; i < TREES.length; i++) {
      const t = TREES[i];
      if (t.x + t.w < view.x - 900 || t.x - t.w > view.right + 900 || t.y < view.y - 300 || t.y > view.bottom + 1200) continue;
      for (const b of t.crown) {
        const C = [t.x + b.x, t.y, b.z], u = dot(C, U), v = dot(C, V), r = Math.max(b.rx, b.rz);
        if (u + r < u0 || u - r > u1 || v + r < v0 || v - r > v1) continue;
        for (const [cx, cy] of [[-1, -1], [1, -1], [-1, 1], [-1, 1], [1, -1], [1, 1]]) data.push(cx, cy, C[0], C[1], C[2], b.rx, b.rz, (i % 254) + 1);
      }
    }
    this.ballData = new Float32Array(data);
    this.ballCount = data.length / 8;
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
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
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
    if (!this.ballCount || this.strength <= 0) return;
    gl.useProgram(p);
    this.uniforms(p, { uU: this.U, uV: this.V, uL: this.L, uBox: this.box, uDRange: this.dRange });
    gl.bindBuffer(gl.ARRAY_BUFFER, this.balls);
    gl.bufferData(gl.ARRAY_BUFFER, this.ballData, gl.STREAM_DRAW);
    const attr = (name: string, size: number, at: number) => {
      const loc = gl.getAttribLocation(p, name);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 32, at * 4);
      return loc;
    };
    const locs = [attr('aCorner', 2, 0), attr('aCentre', 3, 2)];
    // (radii and id in one vec3)
    locs.push(attr('aRadii', 3, 5));
    gl.drawArrays(gl.TRIANGLES, 0, this.ballCount);
    for (const l of locs) gl.disableVertexAttribArray(l);
  }

  private drawGround(): void {
    const t0 = performance.now();
    const gl = this.gl, back = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null, vp = gl.getParameter(gl.VIEWPORT) as Int32Array;
    this.drawShadow();
    this.ground = this.target(this.ground, this.w, this.h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.ground.fb);
    gl.viewport(0, 0, this.w, this.h);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.BLEND);
    this.drawCards(this.groundCards, true);
    this.composite(this.ground.tex, back, vp, false);
    this.ms.push(performance.now() - t0);
  }

  private drawThings(): void {
    const t0 = performance.now();
    const gl = this.gl, back = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null, vp = gl.getParameter(gl.VIEWPORT) as Int32Array;
    this.drawShadow();
    this.things = this.target(this.things, this.w, this.h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.things.fb);
    gl.viewport(0, 0, this.w, this.h);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.BLEND);
    this.drawCards(this.cards, false);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    this.composite(this.things.tex, back, vp, true);
    this.ms[this.ms.length - 1] += performance.now() - t0;
    if (this.ms.length > 240) this.ms.shift();
  }

  private drawCards(cards: Card[], ground: boolean): void {
    const gl = this.gl, p = this.prog;
    gl.useProgram(p);
    const ramp = syncRamps(this.renderer).webGLTexture!;
    const unit = (n: number, tex: WebGLTexture | null, name: string) => {
      gl.activeTexture(gl.TEXTURE0 + n);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(gl.getUniformLocation(p, name), n);
    };
    unit(2, ramp, 'uRamps');
    unit(4, this.shadow!.tex, 'uShadow');
    this.uniforms(p, {
      uTarget: [this.ox, this.oy, this.w, this.h], uView: [this.ox, this.oy, 1], uSun: paintLight.sun, uRimDir: paintLight.rimDir, uRim: paintLight.rim,
      uGround: ground ? 1 : 0, uDepthRange: [this.oy, 1 / 4096], uHole: this.hole, uU: this.U, uV: this.V, uL: this.L, uBox: this.box, uDRange: this.dRange,
      uStrength: this.strength,
    });
    gl.uniform4fv(gl.getUniformLocation(p, 'uLamps[0]'), paintLight.lamps);
    gl.uniform1i(gl.getUniformLocation(p, 'uLampCount'), Math.min(MAX_LAMPS, paintLight.lampCount));
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    const loc = gl.getAttribLocation(p, 'aCorner');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    for (const c of cards) {
      unit(0, c.main, 'uMainSampler[0]');
      unit(1, c.normal, 'uNormSampler');
      unit(3, c.depth, 'uDepth');
      this.uniforms(p, {
        uRect: [c.x, c.y, c.w, c.h], uFrame: [c.u0, c.v0, c.u1, c.v1], uTexRes: [c.tw, c.th], uHasDepth: c.depth ? 1 : 0,
        uFoot: c.foot, uBase: c.base, uId: c.id, uSelf: c.self ? 1 : 0, uLeaves: c.leaves ? 1 : 0,
      });
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    gl.disableVertexAttribArray(loc);
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
    const loc = gl.getAttribLocation(p, 'aCorner');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
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

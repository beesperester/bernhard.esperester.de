import Phaser from 'phaser';

// Work done on the GPU: a fragment shader run over a picture as it is drawn
// (a Phaser filter on it), its numbers set each frame from the CPU. Pictures
// that would otherwise be redrawn pixel by pixel and sent anew (the water,
// the hole through the trees) are then left alone, and only numbers move.

/** The numbers a shader is given, by name: a number or a vector of 2 to 4. */
export type Uniforms = Record<string, number | number[]>;

/**
 * The dither and noise every shader can use. bayer(p) is art/tiles.ts' 4×4 ordered dither,
 * built up from the 2×2 one; vnoise(p, s) is smooth value noise in [0,1) like paint.ts' noise()
 * (not the same values: a GPU hash, not hash2).
 */
const COMMON = `
float m2(vec2 p) { return mod(2.0 * p.x + 3.0 * p.y, 4.0); }
float bayer(vec2 p) {
  vec2 a = mod(p, 4.0);
  return (4.0 * m2(mod(a, 2.0)) + m2(floor(a / 2.0)) + 0.5) / 16.0;
}
float hash(vec2 p, float s) { return fract(sin(dot(p, vec2(127.1, 311.7)) + s * 17.23) * 43758.5453); }
float vnoise(vec2 p, float s) {
  vec2 i = floor(p), f = p - i, u = f * f * (3.0 - 2.0 * f);
  float a = hash(i, s), b = hash(i + vec2(1.0, 0.0), s), c = hash(i + vec2(0.0, 1.0), s), d = hash(i + vec2(1.0, 1.0), s);
  return a + (b - a) * u.x + (c - a) * u.y + (a - b - c + d) * u.x * u.y;
}
/** The world px under this fragment of a picture uSize px big with its top left at uOrigin. */
vec2 worldPx() { return uOrigin + floor(vec2(outTexCoord.x, 1.0 - outTexCoord.y) * uSize); }
`;

class Shaded extends Phaser.Filters.Controller {
  /** The picture's own size and place... */
  readonly own: Uniforms;
  /** ...and the numbers given. */
  uniforms: Uniforms = {};

  constructor(camera: Phaser.Cameras.Scene2D.Camera, node: string, own: Uniforms) {
    super(camera, node);
    this.own = own;
  }
}

/**
 * A shader filter called `name`. `body` is GLSL with the uniforms declared and a main(); it can use
 * uMainSampler and outTexCoord, the picture's uSize and uOrigin (set by shade()), and COMMON above.
 */
export function defineShader(name: string, body: string): string {
  const source = `#pragma phaserTemplate(shaderName)
precision highp float;
uniform sampler2D uMainSampler;
uniform vec2 uSize;
uniform vec2 uOrigin;
varying vec2 outTexCoord;
${COMMON}
${body}`;
  shaders.set(name, source);
  return name;
}

const shaders = new Map<string, string>();
const ready = new WeakMap<Phaser.Game, Set<string>>();
const filters = new WeakMap<Phaser.GameObjects.Image, Map<string, Shaded>>();

function node(name: string, source: string) {
  return class extends Phaser.Renderer.WebGL.RenderNodes.BaseFilterShader {
    constructor(manager: Phaser.Renderer.WebGL.RenderNodes.RenderNodeManager) {
      super(name, manager, undefined, source);
    }

    setupUniforms(controller: Shaded): void {
      for (const u of [controller.own, controller.uniforms]) for (const k in u) this.programManager.setUniform(k, u[k]);
    }
  };
}

/**
 * Run shader `name` over picture img (null uniforms: stop). `uniforms` is kept, not copied: the same
 * object can be shared by many pictures and changed in place each frame.
 */
export function shade(img: Phaser.GameObjects.Image, name: string, uniforms: Uniforms | null): void {
  let c = filters.get(img)?.get(name);
  if (!uniforms) {
    if (c) c.active = false;
    return;
  }
  if (!c) {
    const game = img.scene.game, renderer = game.renderer;
    if (!(renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer)) return;
    let names = ready.get(game);
    if (!names) ready.set(game, (names = new Set()));
    if (!names.has(name)) {
      renderer.renderNodes.addNodeConstructor(name, node(name, shaders.get(name)!));
      names.add(name);
    }
    img.enableFilters();
    c = new Shaded(img.filterCamera!, name, { uSize: [img.width, img.height], uOrigin: [img.x - img.displayOriginX, img.y - img.displayOriginY] });
    img.filters!.internal.add(c);
    let byName = filters.get(img);
    if (!byName) filters.set(img, (byName = new Map()));
    byName.set(name, c);
  }
  c.active = true;
  c.uniforms = uniforms;
}

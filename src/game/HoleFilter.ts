import Phaser from 'phaser';
import type { Hole } from './Trees.ts';

// The hole round your cat in the trees in front of it, cut on the GPU: a
// filter on a tree's picture (and its rim) leaves out what lies in the hole,
// dithered at its edge the same way the world's other dithers are. Moving
// the hole is then a few numbers a frame, not a picture cut and sent anew.

/** As art/tiles.ts' bayer(): the 4×4 ordered dither, built up from the 2×2 one. */
const FRAG = `
#pragma phaserTemplate(shaderName)
precision highp float;
uniform sampler2D uMainSampler;
/** The picture's size, and where its top left is in the world (px). */
uniform vec2 uSize;
uniform vec2 uOrigin;
/** The hole: its middle in the world, how wide, and how much of it is clear before the dither. */
uniform vec4 uHole;
varying vec2 outTexCoord;

float m2(vec2 p) { return mod(2.0 * p.x + 3.0 * p.y, 4.0); }

float bayer(vec2 p) {
  vec2 a = mod(p, 4.0);
  return (4.0 * m2(mod(a, 2.0)) + m2(floor(a / 2.0)) + 0.5) / 16.0;
}

void main() {
  vec4 c = texture2D(uMainSampler, outTexCoord);
  vec2 w = uOrigin + floor(vec2(outTexCoord.x, 1.0 - outTexCoord.y) * uSize);
  float r = uHole.z, d = distance(w, uHole.xy);
  if (d < r && (d < r * uHole.w || bayer(w) < (r - d) / (r * (1.0 - uHole.w)))) c = vec4(0.0);
  gl_FragColor = c;
}
`;

class HoleController extends Phaser.Filters.Controller {
  size = [1, 1];
  origin = [0, 0];
  hole = [0, 0, 0, 0.6];

  constructor(camera: Phaser.Cameras.Scene2D.Camera) {
    super(camera, 'FilterHole');
  }
}

class FilterHole extends Phaser.Renderer.WebGL.RenderNodes.BaseFilterShader {
  constructor(manager: Phaser.Renderer.WebGL.RenderNodes.RenderNodeManager) {
    super('FilterHole', manager, undefined, FRAG);
  }

  setupUniforms(controller: HoleController): void {
    const pm = this.programManager;
    pm.setUniform('uSize', controller.size);
    pm.setUniform('uOrigin', controller.origin);
    pm.setUniform('uHole', controller.hole);
  }
}

const ready = new WeakSet<Phaser.Game>();
const holes = new WeakMap<Phaser.GameObjects.Image, HoleController>();

/** Cut `hole` (null: none) out of picture img, clear out to `clear` of it and dithered beyond. */
export function holeIn(img: Phaser.GameObjects.Image, hole: Hole | null, clear: number): void {
  let c = holes.get(img);
  if (!hole) {
    if (c) c.active = false;
    return;
  }
  if (!c) {
    const game = img.scene.game, renderer = game.renderer;
    if (!(renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer)) return;
    if (!ready.has(game)) {
      renderer.renderNodes.addNodeConstructor('FilterHole', FilterHole);
      ready.add(game);
    }
    img.enableFilters();
    c = new HoleController(img.filterCamera!);
    img.filters!.internal.add(c);
    holes.set(img, c);
  }
  c.active = true;
  c.size[0] = img.width;
  c.size[1] = img.height;
  c.origin[0] = img.x - img.displayOriginX;
  c.origin[1] = img.y - img.displayOriginY;
  c.hole[0] = hole.x;
  c.hole[1] = hole.y;
  c.hole[2] = hole.r;
  c.hole[3] = clear;
}

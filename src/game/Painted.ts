import Phaser from 'phaser';
import { COAT, PLAIN, RAMP_ROWS, RAMP_W, RIM_BIT, SPECK, ramps } from '../art/painted.ts';
import { COAT_H } from '../art/coat.ts';

// The engine's painted shading (art/painted.ts says what the pictures hold):
// pictures drawn with it are batched as Phaser batches any image, with their
// normal map beside them (Phaser's lit path) and the ramps as a third
// texture, and a fragment shader picks each pixel's tone of its ramp from
// the light. The sunlit rim on their outline is lit in the same pass. The
// light is a few numbers a frame, set in `paintLight`.

const NODE = 'BatchHandlerPainted';

/** The light the painted pictures are shaded in, set each frame. */
export const paintLight = {
  /** Unit direction on screen towards the light, and how strongly it models (art/lighting.ts' ScreenLight). */
  sun: [-0.55, -0.85, 1],
  /** The rims: the two steps (px, y down) towards the sun that find an edge, outer then inner. */
  rimDir: [0, -1, 0, -2],
  /** The rims' colour (0..1) and strength (0: none). */
  rim: [1, 1, 1, 0],
};

/** Rims are blended over what's under them: the outer and inner rim pixel this strong, and all of it this much stronger. */
const OUTER = 1, INNER = 110 / 255, BOOST = 1.25;

const HEADER = `
uniform sampler2D uNormSampler;
uniform sampler2D uRamps;
uniform vec3 uSun;
uniform vec4 uRimDir;
uniform vec4 uRim;
const float RAMP_W = ${RAMP_W}.0, RAMP_ROWS = ${RAMP_ROWS}.0;
float byteOf(float c) { return floor(c * 255.0 + 0.5); }
/** art/painted.ts' fromByte. */
float unbyte(float c, float range) { return (byteOf(c) / 255.0 - 0.5) * 2.0 * range; }
vec4 rampAt(float row, float t) { return texture2D(uRamps, vec2((t + 0.5) / RAMP_W, (row + 0.5) / RAMP_ROWS)); }
/** Whether something stands at this many px (x right, y down) from texCoord. */
float solidAt(vec2 texCoord, vec2 d) {
  vec2 uv = texCoord + vec2(d.x, -d.y) / getTexRes();
  return uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0 ? 0.0 : step(0.5 / 255.0, texture2D(uNormSampler, uv).a);
}
vec4 painted(vec4 c, vec2 texCoord) {
  if (c.a < 0.5) return c;
  vec4 n = texture2D(uNormSampler, texCoord);
  float flags = byteOf(n.a);
  vec2 L = uSun.xy;
  float k = uSun.z;
  if (flags == ${COAT}.0) {
    // fur: its colour from the coat, under the frames (art/coat.ts), a tone lighter facing the light, darker away
    vec2 res = getTexRes();
    vec3 fur = texture2D(uMainSampler[0], vec2((byteOf(c.r) + 0.5) / res.x, (${COAT_H}.0 - byteOf(c.g) - 0.5) / res.y)).rgb;
    float l = (unbyte(n.r, 1.0) * L.x + unbyte(n.g, 1.0) * L.y) * k;
    // (not the outline)
    if (byteOf(c.b) > 0.5) fur = l > 0.35 ? mix(fur, vec3(1.0, 0.95, 0.82), 0.22) : l < -0.3 ? mix(fur, vec3(0.16, 0.1, 0.24), 0.28) : fur;
    return vec4(fur, 1.0);
  }
  if (flags > 0.5 && flags < ${PLAIN}.0) {
    float row = byteOf(c.r), kind = byteOf(rampAt(row, RAMP_W - 1.0).r), tone;
    if (kind < 0.5) {
      // leaves (art/trees.ts' shade())
      float nx = unbyte(n.r, 1.0), ny = unbyte(n.g, 1.0), jit = unbyte(n.b, 2.0);
      bool rim = flags >= ${RIM_BIT}.0;
      float speck = (flags - (rim ? ${RIM_BIT}.0 : 0.0) - 1.0) / ${SPECK}.0;
      float facing = nx * L.x + ny * L.y;
      if (rim && facing < 0.15) tone = 3.0;
      else {
        float l = facing * k + (unbyte(c.g, 2.0) * L.x + unbyte(c.b, 2.0) * L.y) * 0.8 * k + jit;
        tone = l > 0.55 ? 0.0 : l > 0.05 ? 1.0 : l > -0.45 ? 2.0 : 3.0;
        if ((speck < 0.07 || (speck < 0.16 && ny < -0.25)) && tone > 0.0) tone -= 1.0;
        else if (speck > 0.95 && tone < 3.0) tone += 1.0;
      }
    } else if (kind > 2.5) {
      // a bush or a rock in the ground, round, in dabs; drawn a tone lighter or darker here and there (art/tiles.ts' litBlob())
      float v = (unbyte(n.r, 1.0) * L.x + unbyte(n.g, 1.0) * L.y) * k + unbyte(c.b, 2.0);
      tone = clamp((v > 0.35 ? 0.0 : v > -0.25 ? 1.0 : 2.0) + byteOf(c.g) - 2.0, 0.0, 2.0);
    } else {
      // bark, round across its trunk and rough; or the moss on it
      float u = (unbyte(n.r, 1.0) + 1.0) * 0.5, g = unbyte(n.g, 1.0), v = (u - 0.5) * 2.0 * L.x * k + g;
      if (kind > 1.5) tone = v > 0.3 ? 0.0 : v > -0.1 ? 1.0 : v > -0.5 ? 2.0 : 3.0;
      else tone = g < -0.45 ? 4.0 : v > 0.55 ? 0.0 : v > 0.12 ? 1.0 : v > -0.35 ? 2.0 : 3.0;
    }
    c = vec4(rampAt(row, tone).rgb, 1.0);
  }
  // the sunlit rim on what stands: where the next pixel or the one after towards the sun is empty
  if (uRim.a > 0.0 && n.a > 0.0) {
    float r = solidAt(texCoord, uRimDir.xy) < 0.5 ? ${OUTER.toFixed(4)} : solidAt(texCoord, uRimDir.zw) < 0.5 ? ${INNER.toFixed(4)} : 0.0;
    c.rgb = mix(c.rgb, uRim.rgb, r * min(1.0, uRim.a * ${BOOST.toFixed(2)}));
  }
  return c;
}
`;

const M = Phaser.Renderer.WebGL.ShaderAdditionMakers;

/** The ramps as a texture (made again as ramps are added: rarely, as new kinds of tree come into view). */
let rampTexture: Phaser.Renderer.WebGL.Wrappers.WebGLTextureWrapper | null = null;
let rampRows = -1;

function syncRamps(renderer: Phaser.Renderer.WebGL.WebGLRenderer): void {
  if (rampRows === ramps.rows.length) return;
  rampRows = ramps.rows.length;
  if (rampTexture) renderer.deleteTexture(rampTexture);
  const gl = renderer.gl;
  rampTexture = renderer.createTexture2D(0, gl.NEAREST, gl.NEAREST, gl.CLAMP_TO_EDGE, gl.CLAMP_TO_EDGE, gl.RGBA,
    new Uint8Array(ramps.pixels().buffer), RAMP_W, RAMP_ROWS, false, false, false);
}

class PaintedBatch extends Phaser.Renderer.WebGL.RenderNodes.BatchHandlerQuad {
  constructor(manager: Phaser.Renderer.WebGL.RenderNodes.RenderNodeManager) {
    super(manager, {
      name: NODE,
      shaderName: 'PAINTED',
      shaderAdditions: [
        M.MakeGetTexCoordOut(),
        M.MakeGetTexRes(),
        M.MakeDefineTexCount(1),
        M.MakeGetTexture(),
        // (in the places of Phaser's own lighting, so they come on with it)
        { name: 'DefineLights', additions: { fragmentDefine: '', fragmentHeader: HEADER }, tags: ['LIGHTING'], disable: true },
        { name: 'Painted', additions: { fragmentProcess: 'fragColor = painted(fragColor, texCoord);' }, tags: ['LIGHTING'], disable: true },
        M.MakeApplyTint(),
      ],
    } as Phaser.Types.Renderer.WebGL.RenderNodes.BatchHandlerConfig);
    // (the rims need the picture's size)
    for (const o of [this.renderOptions, this.nextRenderOptions]) (o as typeof o & { texRes: boolean }).texRes = true;
  }

  setupUniforms(drawingContext: Phaser.Renderer.WebGL.DrawingContext): void {
    super.setupUniforms(drawingContext);
    const pm = this.programManager;
    pm.setUniform('uNormSampler', 1);
    pm.setUniform('uRamps', 2);
    pm.setUniform('uSun', paintLight.sun);
    pm.setUniform('uRimDir', paintLight.rimDir);
    pm.setUniform('uRim', paintLight.rim);
  }

  pushCurrentBatchEntry(): void {
    // the ramps go along with every batch, on the unit after the normal map
    const e = this.currentBatchEntry;
    if (e.count > 0) {
      syncRamps(this.manager.renderer);
      e.texture[2] = rampTexture!;
      e.unit = 3;
    }
    super.pushCurrentBatchEntry();
  }
}

const ready = new WeakSet<Phaser.Game>();

/** Add a painted picture as texture `key`: its main picture and normal map (art/painted.ts), w x h. */
export function addPainted(scene: Phaser.Scene, key: string, main: Uint8ClampedArray, normal: Uint8Array, w: number, h: number): void {
  const tex = scene.textures.addUint8Array(key, new Uint8Array(main.buffer, main.byteOffset, main.byteLength), w, h)!;
  const renderer = scene.game.renderer;
  if (!(renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer)) return;
  const gl = renderer.gl;
  // (raw, not premultiplied by its alpha: that holds numbers)
  tex.setDataSource(renderer.createTexture2D(0, gl.NEAREST, gl.NEAREST, gl.CLAMP_TO_EDGE, gl.CLAMP_TO_EDGE, gl.RGBA, normal, w, h, false, false, true));
}

/** Draw img (of a texture from addPainted) with painted shading. */
export function paint<T extends Phaser.GameObjects.Image | Phaser.GameObjects.Sprite>(img: T): T {
  const game = img.scene.game, renderer = game.renderer;
  if (!(renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer)) return img;
  if (!ready.has(game)) {
    renderer.renderNodes.addNodeConstructor(NODE, PaintedBatch);
    ready.add(game);
  }
  img.setLighting(true).setRenderNodeRole('BatchHandler', NODE);
  return img;
}

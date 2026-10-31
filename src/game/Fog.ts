import Phaser from 'phaser';
import { MAP_H, MAP_W, WORLD_H, WORLD_W, tileAt } from '../world/map.ts';
import { isPond, isWaterway } from '../world/legend.ts';
import { COMMON } from './gpu.ts';
import { hash2 } from '../art/raster.ts';
import type { Effect } from './Cards.ts';

// Banks of fog lying low over the ground (how thick: world/fog.ts), drifting
// slowly, gathered over the water. Things stand in it: it is drawn in thin
// horizontal slices, each the fog standing on one row of the ground, up to
// FOG_H high, at that row's depth, so a cat or a tree behind a bank sinks
// into it, thickest at its feet, and one in front of it stands clear. Each slice is
// a quad drawn by a shader (a Phaser Shader; or, drawn as cards, by
// game/Cards.ts with this shader, as a card standing on its row: see now()).

/** A slice for every this many rows (px)... */
const STEP = 5;
/** ...each the fog this high (px) over its row (FOG_H / STEP slices overlap). */
const FOG_H = 30;
/**
 * The most one slice adds (alpha, halfway up it: fading to nothing at its row and at its top, so
 * over open ground the slices add up evenly), in this many dithered steps. (Faded so: a thing
 * standing in the fog, a blade of tall grass, has a slice fewer in front of it as its row passes
 * that slice's, and that slice is faint just above its own row, where it met the thing; so the fog
 * over things doesn't come in bands a slice apart.)
 */
const MAX_ALPHA = 0.36, STEPS = 4;
/** The noise the banks are made of: a tiling texture this big (px, a power of two), CELLS lattice cells across. */
const NOISE = 128, CELLS = 8;
/** One noise cell is this big in the world (px), across and down: the banks' long, low shape (and a finer one curling in them). */
const BANK = [110, 30], CURL = [28, 12];
/** How far (tiles) fog gathers round the water. */
const WET_REACH = 3;

const COLOUR = [0.86, 0.88, 0.9];
/** The textures its shader samples: the wet map, and the noise. */
export const FOG_TEXTURES = { uWet: 'fog-wet', uNoise: 'fog-noise' };

/** A slice's shader: its quad covers uBox (world px), outTexCoord across it (y up); its textures FOG_TEXTURES. */
export const FOG_SOURCE = `
precision highp float;
uniform vec4 uBox;
uniform float uGround;
uniform float uTime;
uniform float uFog;
uniform vec3 uColour;
uniform vec2 uWorld;
uniform sampler2D uWet;
uniform sampler2D uNoise;
varying vec2 outTexCoord;
${COMMON.replace(/vec2 worldPx\(\)[^\n]*\n/, '')}
void main() {
  vec2 w = uBox.xy + floor(vec2(outTexCoord.x, 1.0 - outTexCoord.y) * uBox.zw);
  // (the slices overlap evenly over open ground, and a thing standing in the fog has fewer of them over it
  // the higher up it is; each fades out down to its row, so losing one as a row passes it is hardly to be seen)
  // the banks: long and low, drifting slowly sideways, curling as they go; thicker by the water
  // (where on the ground this pixel's fog is: the same for every slice over it, so they don't step)
  vec2 g = vec2(w.x, w.y + ${(FOG_H / 2).toFixed(1)});
  float n = texture2D(uNoise, vec2(g.x / ${BANK[0].toFixed(1)} - uTime * 0.012, g.y / ${BANK[1].toFixed(1)}) / ${CELLS.toFixed(1)}).r * 0.7
          + texture2D(uNoise, vec2(g.x / ${CURL[0].toFixed(1)} + uTime * 0.025, g.y / ${CURL[1].toFixed(1)} + uTime * 0.008) / ${CELLS.toFixed(1)} + 0.37).r * 0.3;
  float wet = texture2D(uWet, g / uWorld).r;
  float a = uFog * smoothstep(0.47, 0.66, n + wet * 0.3) * (1.0 - abs((uGround - w.y) / ${(FOG_H / 2).toFixed(1)} - 1.0));
  float q = floor(a * ${STEPS.toFixed(1)} + bayer(w)) / ${STEPS.toFixed(1)} * ${MAX_ALPHA.toFixed(3)};
  if (q <= 0.0) discard;
  gl_FragColor = vec4(uColour * q, q);
}
`;

interface Slice {
  quad: Phaser.GameObjects.Shader;
  /** The row it stands on, and the world box it covers (read by its shader). */
  ground: number;
  box: number[];
}

export class Fog {
  private readonly scene: Phaser.Scene;
  private readonly slices: Slice[] = [];
  private fog = 0;
  private time = 0;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    // where the water is, spread a few tiles round it (a tile a texel, sampled smoothly)
    const wet = new Float32Array(MAP_W * MAP_H);
    for (let ty = 0; ty < MAP_H; ty++)
      for (let tx = 0; tx < MAP_W; tx++) {
        const ch = tileAt(tx, ty);
        if (isPond(ch) || isWaterway(ch)) wet[ty * MAP_W + tx] = 1;
      }
    const spread = blur(blur(wet, WET_REACH), WET_REACH);
    const canvas = document.createElement('canvas');
    canvas.width = MAP_W;
    canvas.height = MAP_H;
    const g = canvas.getContext('2d')!, img = g.createImageData(MAP_W, MAP_H);
    for (let i = 0; i < spread.length; i++) {
      const v = Math.round(Math.min(1, spread[i] * 1.6) * 255);
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    scene.textures.addCanvas('fog-wet', canvas)!.setFilter(Phaser.Textures.FilterMode.LINEAR);
    const noise = scene.textures.addCanvas('fog-noise', noiseCanvas())!;
    noise.setFilter(Phaser.Textures.FilterMode.LINEAR);
    noise.setWrap(Phaser.Textures.WrapMode.REPEAT, Phaser.Textures.WrapMode.REPEAT);
  }

  /** `fog`: how thick it lies (world/fog.ts). */
  update(fog: number, time: number, view: Phaser.Geom.Rectangle): void {
    this.fog = fog;
    this.time = time / 1000;
    const rows: number[] = [];
    if (fog > 0.01) for (let y = Math.floor(view.y / STEP) * STEP; y <= view.bottom + FOG_H; y += STEP) rows.push(y);
    while (this.slices.length < rows.length) this.slices.push(this.make());
    this.slices.forEach((s, k) => {
      const y = rows[k];
      s.quad.setVisible(y !== undefined);
      if (y === undefined) return;
      const x0 = Math.floor(view.x) - 8, x1 = Math.ceil(view.right) + 8, y0 = y - FOG_H;
      s.ground = y;
      s.box[0] = x0; s.box[1] = y0; s.box[2] = x1 - x0; s.box[3] = FOG_H;
      // (a hair behind whatever stands on its row: it's the fog in front of what's behind)
      s.quad.setDepth(y - 0.01);
      if (s.quad.x !== x0 || s.quad.y !== y0 || s.quad.width !== x1 - x0) s.quad.setPosition(x0, y0).setSize(x1 - x0, FOG_H);
    });
  }

  /** The slices drawn now, for game/Cards.ts (their textures: FOG_TEXTURES). */
  now(): Effect[] {
    const out: Effect[] = [];
    for (const s of this.slices) {
      if (!s.quad.visible) continue;
      out.push({ quad: s.quad, foot: s.ground - 0.01, uniforms: { uBox: s.box, uGround: s.ground, uTime: this.time, uFog: this.fog, uColour: COLOUR, uWorld: [WORLD_W, WORLD_H] } });
    }
    return out;
  }

  private make(): Slice {
    const s: Slice = { quad: null!, ground: 0, box: [0, 0, 1, 1] };
    s.quad = this.scene.add.shader({
      name: 'fog',
      fragmentSource: FOG_SOURCE,
      setupUniforms: (set: (name: string, value: unknown) => void) => {
        set('uBox', s.box);
        set('uGround', s.ground);
        set('uTime', this.time);
        set('uFog', this.fog);
        set('uColour', COLOUR);
        set('uWorld', [WORLD_W, WORLD_H]);
        set('uWet', 0);
        set('uNoise', 1);
      },
    }, 0, 0, 1, 1, Object.values(FOG_TEXTURES)).setOrigin(0);
    return s;
  }
}

/** Smooth value noise that tiles: CELLS random heights across and down, eased between (0..255 in red). */
function noiseCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = NOISE;
  const g = canvas.getContext('2d')!, img = g.createImageData(NOISE, NOISE);
  const at = (i: number, j: number) => hash2(((i % CELLS) + CELLS) % CELLS, ((j % CELLS) + CELLS) % CELLS, 2301);
  const ease = (t: number) => t * t * (3 - 2 * t), cell = NOISE / CELLS;
  for (let y = 0; y < NOISE; y++)
    for (let x = 0; x < NOISE; x++) {
      const i = Math.floor(x / cell), j = Math.floor(y / cell), u = ease(x / cell - i), v = ease(y / cell - j);
      const top = at(i, j) + (at(i + 1, j) - at(i, j)) * u, bottom = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * u;
      const k = (y * NOISE + x) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = Math.round((top + (bottom - top) * v) * 255);
      img.data[k + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  return canvas;
}

/** A box blur of a map-sized grid, r tiles each way. */
function blur(src: Float32Array, r: number): Float32Array {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  for (let y = 0; y < MAP_H; y++)
    for (let x = 0; x < MAP_W; x++) {
      let s = 0, n = 0;
      for (let d = -r; d <= r; d++) if (x + d >= 0 && x + d < MAP_W) { s += src[y * MAP_W + x + d]; n++; }
      tmp[y * MAP_W + x] = s / n;
    }
  for (let y = 0; y < MAP_H; y++)
    for (let x = 0; x < MAP_W; x++) {
      let s = 0, n = 0;
      for (let d = -r; d <= r; d++) if (y + d >= 0 && y + d < MAP_H) { s += tmp[(y + d) * MAP_W + x]; n++; }
      out[y * MAP_W + x] = s / n;
    }
  return out;
}


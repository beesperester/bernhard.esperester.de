import Phaser from 'phaser';
import { SHAFTS, type Shaft } from '../world/shafts.ts';
import type { Light } from '../world/sky.ts';
import { COMMON } from './gpu.ts';

// Shafts of light falling into the woods through gaps in the canopy
// (world/shafts.ts says where): a beam slanting down away from the sun, with
// streaks in it and dust motes drifting down it, and a dappled pool of light
// where it lands. Strongest when the sun is low, at the golden hours; fainter
// at noon, gone under rain clouds; and at night, by moonlight, faint and
// blue. Each is a quad drawn by a shader (a Phaser Shader), standing in the
// world at the depth of where it lands: trees in front of it hide it, and
// what's behind it is lit.

/** Shafts landing this far (px) beyond the view are drawn. */
const AHEAD = 260;
/** How high the canopy is that the light comes through (px)... */
const CANOPY = 150;
/** ...and the sun is taken to be at least this high (degrees), and its beam to reach at most this far sideways (px). */
const LOW_SUN = 16, REACH = 230;
/** The moon is taken to stand this high (degrees). */
const MOON_EL = 50;
/** The brightest a shaft gets (its alpha), in this many dithered steps. */
const MAX_ALPHA = 0.34, STEPS = 4;
/** How bright a shaft is for the light's strength (the scene's tint dims it further: it stands in the world). */
const GAIN = 2.2;

const SUN_HIGH: number[] = [1, 0.96, 0.8], SUN_LOW: number[] = [1, 0.72, 0.38], MOON: number[] = [0.66, 0.78, 1];

const SOURCE = `
precision highp float;
uniform vec4 uBox;
uniform vec2 uTop;
uniform vec2 uFoot;
uniform float uWidth;
uniform float uTime;
uniform float uStrength;
uniform vec3 uColour;
uniform float uSeed;
varying vec2 outTexCoord;
${COMMON.replace(/vec2 worldPx\(\)[^\n]*\n/, '')}
void main() {
  vec2 w = uBox.xy + floor(vec2(outTexCoord.x, 1.0 - outTexCoord.y) * uBox.zw), p = w + 0.5;
  vec2 ax = uFoot - uTop;
  float L = length(ax);
  vec2 u = ax / L, n = vec2(-u.y, u.x);
  // along the beam (0 where it comes through the leaves, 1 where it lands) and across it (px)
  float t = dot(p - uTop, u) / L, s = dot(p - uTop, n);
  float I = 0.0;
  if (t > 0.0 && t < 1.08) {
    float hw = uWidth * 0.5 * mix(0.6, 1.0, t), e = abs(s) / hw;
    if (e < 1.0) {
      // brighter down its middle, in streaks that drift slowly across it, faint up where it comes in
      float streak = 0.45 + 0.55 * vnoise(vec2(s * 0.2 + uTime * 0.12, uSeed), 3.0);
      I = (1.0 - e * e) * streak * smoothstep(0.0, 0.4, t) * (1.0 - smoothstep(0.95, 1.08, t)) * mix(0.5, 1.0, t);
      // dust, drifting down it, twinkling
      vec2 q = vec2(s, t * L - uTime * 5.0) / 3.0, c = floor(q);
      float m = hash(c, uSeed + 5.0);
      if (m > 0.96 && all(lessThan(abs(q - c - 0.5), vec2(0.2)))) I += (0.6 + 0.4 * sin(uTime * 3.0 + m * 60.0)) * (1.0 - e);
    }
  }
  // the pool where it lands, dappled by the leaves it came through
  vec2 d = (p - uFoot) / vec2(uWidth * 0.9, uWidth * 0.42);
  float r = dot(d, d);
  if (r < 1.0) I = max(I, (1.0 - r) * (0.5 + 0.7 * vnoise(p / 4.0 + vec2(uTime * 0.07, 0.0), 7.0)));
  float a = floor(min(1.0, I * uStrength) * ${STEPS.toFixed(1)} + bayer(w)) / ${STEPS.toFixed(1)} * ${MAX_ALPHA.toFixed(3)};
  gl_FragColor = vec4(uColour * a, a);
}
`;

interface Drawn {
  quad: Phaser.GameObjects.Shader;
  /** Its numbers, read by its shader each time it is drawn. */
  u: { box: number[]; top: number[]; strength: number };
}

export class Shafts {
  private readonly scene: Phaser.Scene;
  private readonly drawn = new Map<number, Drawn>();
  /** Where the light comes from on the ground (unit vector towards it), how far a beam leans per px it falls, its colour and strength. */
  private dir: [number, number] = [0, -1];
  private lean = 0;
  private colour = SUN_HIGH;
  private strength = 0;
  private time = 0;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  /** `cover` (0..1): rain or a cloud over the view. */
  update(light: Light, cover: number, time: number, view: Phaser.Geom.Rectangle): void {
    this.time = time / 1000;
    const el = light.elevation, clear = 1 - 0.9 * cover;
    // the sun: strongest low in the sky (but up), weaker as it climbs
    const golden = Math.max(0, Math.min(1, el / 4)) * (1 - 0.55 * Math.max(0, Math.min(1, (el - 12) / 35)));
    const sun = light.day * golden * clear;
    // the moon: by its phase (full at 0.5), faint
    const moon = light.night * (0.2 + 0.8 * (1 - Math.abs(light.moonPhase - 0.5) * 2)) * 0.6 * clear;
    const byMoon = moon > sun;
    const a = ((light.azimuth + (byMoon ? 180 : 0)) * Math.PI) / 180;
    this.dir = [Math.sin(a), -Math.cos(a)];
    this.lean = 1 / Math.tan(((byMoon ? MOON_EL : Math.max(LOW_SUN, el)) * Math.PI) / 180);
    const low = Math.max(0, Math.min(1, 1 - (el - 4) / 26));
    this.colour = byMoon ? MOON : SUN_HIGH.map((c, k) => c + (SUN_LOW[k] - c) * low);
    this.strength = Math.max(sun, moon);

    const on = this.strength > 0.02;
    for (const [i, d] of this.drawn) {
      const s = SHAFTS[i];
      if (!on || s.x < view.x - AHEAD || s.x > view.right + AHEAD || s.y < view.y - AHEAD || s.y > view.bottom + AHEAD) {
        d.quad.destroy();
        this.drawn.delete(i);
      }
    }
    if (!on) return;
    SHAFTS.forEach((s, i) => {
      if (s.x < view.x - AHEAD || s.x > view.right + AHEAD || s.y < view.y - AHEAD || s.y > view.bottom + AHEAD) return;
      const d = this.drawn.get(i) ?? this.make(i, s);
      this.place(d, s);
    });
  }

  private make(i: number, s: Shaft): Drawn {
    const u = { box: [0, 0, 1, 1], top: [0, 0], strength: 0 };
    const quad = this.scene.add.shader({
      name: 'shaft',
      fragmentSource: SOURCE,
      setupUniforms: (set: (name: string, value: unknown) => void) => {
        set('uBox', u.box);
        set('uTop', u.top);
        set('uFoot', [s.x, s.y]);
        set('uWidth', s.w);
        set('uTime', this.time);
        set('uStrength', u.strength);
        set('uColour', this.colour);
        set('uSeed', i % 97);
      },
    }, 0, 0, 1, 1).setOrigin(0).setDepth(s.y + 0.5).setBlendMode(Phaser.BlendModes.ADD);
    const d = { quad, u };
    this.drawn.set(i, d);
    return d;
  }

  /** Lean shaft s's beam away from the light, and put its quad round it. */
  private place(d: Drawn, s: Shaft): void {
    // (its own canopy a little higher or lower, and its own slow breathing)
    const h = CANOPY * (0.8 + 0.4 * s.phase);
    let ox = this.dir[0] * h * this.lean, oy = this.dir[1] * h * this.lean;
    const side = Math.hypot(ox, oy);
    if (side > REACH) { ox *= REACH / side; oy *= REACH / side; }
    const tx = s.x + ox, ty = s.y + oy - h;
    d.u.top = [tx, ty];
    d.u.strength = GAIN * this.strength * (0.75 + 0.25 * Math.sin(this.time * 0.4 + s.phase * 6.28));
    const m = s.w + 4;
    const x0 = Math.floor(Math.min(tx, s.x) - m), y0 = Math.floor(Math.min(ty, s.y) - m);
    const x1 = Math.ceil(Math.max(tx, s.x) + m), y1 = Math.ceil(Math.max(ty, s.y) + m);
    d.u.box = [x0, y0, x1 - x0, y1 - y0];
    if (d.quad.x !== x0 || d.quad.y !== y0 || d.quad.width !== x1 - x0 || d.quad.height !== y1 - y0) d.quad.setPosition(x0, y0).setSize(x1 - x0, y1 - y0);
  }
}

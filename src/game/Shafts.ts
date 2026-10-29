import Phaser from 'phaser';
import { SHAFTS, SHAFTS_BY_CELL, SHAFT_CELL, type Shaft } from '../world/shafts.ts';
import { TREES } from '../world/trees.ts';
import { SEASON } from '../world/season.ts';
import type { Light } from '../world/sky.ts';
import { COMMON } from './gpu.ts';

// Rays of light coming down through the trees (world/shafts.ts says where):
// each a thin beam from up in a crown, slanting down the screen away from the
// sun (a flat effect: down, leaning to the side the shadows fall), fading
// out (dithered) by the time it is level with the tree's foot (some
// sooner). They shimmer slowly, and dust motes drift and dance about in them.
// Strongest when the sun is low, at the golden hours; fainter at noon, gone
// under rain clouds, thin when the trees are bare; and at night, by
// moonlight, faint and blue. Each is a quad drawn by a shader (a Phaser
// Shader), just behind the tree it comes through, so its crown hides where
// it starts.

/** Rays starting this far (px) beyond the view are drawn... */
const AHEAD = 200;
/** ...at most this many, the nearest the middle of the view. */
const MOST = 64;
/** The sun is taken to be at least this high (degrees), and a ray to slant at most this many px across per px down. */
const LOW_SUN = 14, SLANT = 1;
/** The moon is taken to stand this high (degrees). */
const MOON_EL = 45;
/** The brightest a ray gets (its alpha), in this many dithered steps. */
const MAX_ALPHA = 0.5, STEPS = 4;
/** How bright a ray is for the light's strength (the scene's tint dims it further: it stands in the world). */
const GAIN = 2.2;

const SUN_HIGH: number[] = [1, 0.96, 0.8], SUN_LOW: number[] = [1, 0.74, 0.4], MOON: number[] = [0.66, 0.78, 1];

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
  // along the ray (0 up in the crown, 1 where it ends) and across it (px)
  float t = dot(p - uTop, u) / L, s = dot(p - uTop, n), d = t * L;
  float I = 0.0;
  if (t > 0.0 && t < 1.0) {
    float hw = uWidth * 0.5 * mix(0.8, 1.3, t), e = abs(s) / hw;
    // fading in out of the leaves, and out (dithered) towards its end
    float along = smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.7, 1.0, t));
    if (e < 1.0) {
      // shimmering: brighter streaks drifting slowly across and down it, and the whole of it breathing
      float streak = 0.5 + 0.5 * vnoise(vec2(s * 0.4 + uTime * 0.12, d * 0.03 - uTime * 0.05 + uSeed), 3.0);
      float breath = 0.82 + 0.18 * sin(uTime * 0.6 + d * 0.05 + uSeed * 6.0);
      I = (1.0 - e * e) * streak * breath * along;
    }
    // dust motes: one now and then in a little cell, drifting down, wandering round in it, twinkling
    if (e < 1.15) {
      vec2 cell = vec2(4.0, 7.0), q = vec2(s, d - uTime * 1.2) / cell, c = floor(q);
      float m = hash(c, uSeed + 5.0);
      if (m > 0.8) {
        vec2 at = (c + 0.5 + 0.32 * vec2(sin(uTime * (0.5 + m) + m * 40.0), cos(uTime * (0.4 + m * 0.6) + m * 23.0))) * cell;
        vec2 off = vec2(s, d - uTime * 1.2) - at;
        if (abs(off.x) < 0.6 && abs(off.y) < 0.6) I += (0.6 + 0.4 * sin(uTime * 2.0 + m * 50.0)) * along * 2.2;
      }
    }
  }
  float a = floor(min(1.0, I * uStrength) * ${STEPS.toFixed(1)} + bayer(w)) / ${STEPS.toFixed(1)} * ${MAX_ALPHA.toFixed(3)};
  gl_FragColor = vec4(uColour * a, a);
}
`;

interface Drawn {
  quad: Phaser.GameObjects.Shader;
  /** Its numbers, read by its shader each time it is drawn. */
  u: { box: number[]; top: number[]; foot: number[]; strength: number };
}

export class Shafts {
  private readonly scene: Phaser.Scene;
  private readonly drawn = new Map<number, Drawn>();
  /** How far across the screen a ray goes per px down it (away from the light), its colour and strength. */
  private slant = 0;
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
    // the sun: strongest low in the sky (but up), weaker as it climbs; through bare trees, little
    const golden = Math.max(0, Math.min(1, el / 4)) * (1 - 0.55 * Math.max(0, Math.min(1, (el - 12) / 35)));
    const leafy = 0.3 + 0.7 * SEASON.leaves;
    const sun = light.day * golden * clear * leafy;
    // the moon: by its phase (full at 0.5), faint
    const moon = light.night * (0.2 + 0.8 * (1 - Math.abs(light.moonPhase - 0.5) * 2)) * 0.6 * clear * leafy;
    const byMoon = moon > sun;
    // the light's side (left or right of the screen, as the shadows have it; the moon opposite the sun), and how low it is
    const A = (light.azimuth * Math.PI) / 180;
    const side = byMoon ? -Math.sin(A) : Math.sin(A);
    const rise = Math.tan(((byMoon ? MOON_EL : Math.max(LOW_SUN, el)) * Math.PI) / 180);
    this.slant = -side / rise;
    const low = Math.max(0, Math.min(1, 1 - (el - 4) / 26));
    this.colour = byMoon ? MOON : SUN_HIGH.map((c, k) => c + (SUN_LOW[k] - c) * low);
    this.strength = Math.max(sun, moon);

    // the rays near the view, nearest its middle first
    const want: number[] = [];
    if (this.strength > 0.02) {
      const x0 = view.x - AHEAD, x1 = view.right + AHEAD, y0 = view.y - AHEAD, y1 = view.bottom + AHEAD + 120;
      for (let cy = Math.floor(y0 / SHAFT_CELL); cy <= Math.floor(y1 / SHAFT_CELL); cy++)
        for (let cx = Math.floor(x0 / SHAFT_CELL); cx <= Math.floor(x1 / SHAFT_CELL); cx++)
          for (const i of SHAFTS_BY_CELL.get(cy * 4096 + cx) ?? []) {
            const s = SHAFTS[i];
            if (s.x >= x0 && s.x <= x1 && s.y >= y0 && s.y <= y1) want.push(i);
          }
      const mx = view.centerX, my = view.centerY, far = (i: number) => (SHAFTS[i].x - mx) ** 2 + (SHAFTS[i].y - my) ** 2;
      if (want.length > MOST) want.sort((a, b) => far(a) - far(b)).length = MOST;
    }
    const keep = new Set(want);
    for (const [i, d] of this.drawn)
      if (!keep.has(i)) {
        d.quad.destroy();
        this.drawn.delete(i);
      }
    for (const i of want) this.place(this.drawn.get(i) ?? this.make(i, SHAFTS[i]), SHAFTS[i]);
  }

  private make(i: number, s: Shaft): Drawn {
    const u = { box: [0, 0, 1, 1], top: [0, 0], foot: [0, 0], strength: 0 };
    const quad = this.scene.add.shader({
      name: 'shaft',
      fragmentSource: SOURCE,
      setupUniforms: (set: (name: string, value: unknown) => void) => {
        set('uBox', u.box);
        set('uTop', u.top);
        set('uFoot', u.foot);
        set('uWidth', s.w);
        set('uTime', this.time);
        set('uStrength', u.strength);
        set('uColour', this.colour);
        set('uSeed', i % 97);
      },
    }, 0, 0, 1, 1).setOrigin(0).setDepth(TREES[s.tree].y - 0.05).setBlendMode(Phaser.BlendModes.ADD);
    const d = { quad, u };
    this.drawn.set(i, d);
    return d;
  }

  /** Slant ray s down from its crown away from the light, ending by its tree's foot (or before), and put its quad round it. */
  private place(d: Drawn, s: Shaft): void {
    // (flat on the screen: per px down, this far across, away from the light; it ends `reach` of the way down to the tree's foot)
    const dx = Math.max(-SLANT, Math.min(SLANT, this.slant));
    // (from the side of the crown it slants to, so it soon comes out of the leaves)
    const tx = s.x + (dx < 0 ? -1 : 1) * s.rx * s.side, ty = s.y - s.h, root = s.y - TREES[s.tree].elev;
    const k = (root - ty) * s.reach, fx = tx + dx * k, fy = ty + k;
    d.u.top = [tx, ty];
    d.u.foot = [fx, fy];
    d.u.strength = GAIN * this.strength * (0.75 + 0.25 * Math.sin(this.time * 0.35 + s.phase * 6.28));
    const m = s.w + 4;
    const x0 = Math.floor(Math.min(tx, fx) - m), y0 = Math.floor(ty - m);
    const x1 = Math.ceil(Math.max(tx, fx) + m), y1 = Math.ceil(fy + 2);
    d.u.box = [x0, y0, x1 - x0, y1 - y0];
    if (d.quad.x !== x0 || d.quad.y !== y0 || d.quad.width !== x1 - x0 || d.quad.height !== y1 - y0) d.quad.setPosition(x0, y0).setSize(x1 - x0, y1 - y0);
  }
}

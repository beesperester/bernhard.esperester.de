import Phaser from 'phaser';
import { SHAFTS, SHAFTS_BY_CELL, SHAFT_CELL, type Shaft } from '../world/shafts.ts';
import { SEASON } from '../world/season.ts';
import type { Light } from '../world/sky.ts';
import { COMMON } from './gpu.ts';

// Rays of light coming down through the trees (world/shafts.ts says where):
// each a beam standing on a spot on the ground and going up from it towards
// the sun till it leaves the screen (a flat effect: up, leaning to the side
// the light comes from), in the world at that spot's depth, so it comes down
// between the trees. Some touch the ground, most fade out (dithered) a little
// above it; all of them fade towards the middle of the view, round the cat.
// They shimmer slowly, and dust motes drift and dance about in them.
// Strongest when the sun is low, at the golden hours; fainter at noon, gone
// under rain clouds, thin when the trees are bare; and at night, by
// moonlight, faint and blue. Each is a quad drawn by a shader (a Phaser
// Shader; or, drawn as cards, game/Cards.ts draws it with this shader, as a
// card standing at its spot: see rays()).

/** Rays standing this far (px) below the view are drawn (they reach up into it), fading out from FADE_BELOW on (so
 * none pops in or out as the view moves)... */
const BELOW = 160, FADE_BELOW = 60;
/** ...at most this many, the nearest the middle of the view. */
const MOST = 40;
/** A ray newly drawn comes in over this long (s). */
const COME_IN = 0.8;
/** The sun is taken to be at least this high (degrees), and a ray to slant at most this many px across per px up. */
const LOW_SUN = 14, SLANT = 1;
/** The moon is taken to stand this high (degrees). */
const MOON_EL = 45;
/** The brightest a ray gets (its alpha), in this many dithered steps. */
const MAX_ALPHA = 0.4, STEPS = 4;
/** How bright a ray is for the light's strength (the scene's tint dims it further: it stands in the world). */
const GAIN = 2.2;

const SUN_HIGH: number[] = [1, 0.96, 0.8], SUN_LOW: number[] = [1, 0.74, 0.4], MOON: number[] = [0.66, 0.78, 1];

/** A ray's shader: its quad covers uBox (world px), outTexCoord across it (y up). */
export const SHAFT_SOURCE = `
precision highp float;
uniform vec4 uBox;
uniform vec2 uTop;
uniform vec2 uFoot;
uniform float uWidth;
uniform float uLift;
uniform float uTime;
uniform float uStrength;
uniform vec3 uColour;
uniform float uSeed;
uniform vec3 uView;
varying vec2 outTexCoord;
${COMMON.replace(/vec2 worldPx\(\)[^\n]*\n/, '')}
void main() {
  vec2 w = uBox.xy + floor(vec2(outTexCoord.x, 1.0 - outTexCoord.y) * uBox.zw), p = w + 0.5;
  vec2 ax = uTop - uFoot;
  float L = length(ax);
  vec2 u = ax / L, n = vec2(-u.y, u.x);
  // up the ray from its spot on the ground (px), and across it (px)
  float d = dot(p - uFoot, u), s = dot(p - uFoot, n);
  float I = 0.0;
  if (d > 0.0 && d < L) {
    float hw = uWidth * 0.5 * (1.0 + d * 0.0012), e = abs(s) / hw;
    // fading in from where it ends low down (on the ground, soon; above it, slowly), and out
    // towards the middle of the view, so it doesn't stand over the cat
    float low = uLift > 0.0 ? smoothstep(uLift, uLift + 28.0, d) : smoothstep(0.0, 5.0, d);
    float mid = mix(0.2, 1.0, smoothstep(0.12, 0.75, length(p - uView.xy) / uView.z));
    float along = low * mid;
    if (e < 1.0) {
      // shimmering: brighter streaks drifting slowly across and down it, and the whole of it breathing
      float streak = 0.5 + 0.5 * vnoise(vec2(s * 0.4 + uTime * 0.12, d * 0.03 + uTime * 0.05 + uSeed), 3.0);
      float breath = 0.82 + 0.18 * sin(uTime * 0.6 - d * 0.05 + uSeed * 6.0);
      I = (1.0 - e * e) * streak * breath * along;
    }
    // dust motes: one now and then in a little cell, drifting down, wandering round in it, twinkling
    if (e < 1.15) {
      vec2 cell = vec2(4.0, 7.0), q = vec2(s, d + uTime * 1.2) / cell, c = floor(q);
      float m = hash(c, uSeed + 5.0);
      if (m > 0.8) {
        vec2 at = (c + 0.5 + 0.32 * vec2(sin(uTime * (0.5 + m) + m * 40.0), cos(uTime * (0.4 + m * 0.6) + m * 23.0))) * cell;
        vec2 off = vec2(s, d + uTime * 1.2) - at;
        if (abs(off.x) < 0.6 && abs(off.y) < 0.6) I += (0.6 + 0.4 * sin(uTime * 2.0 + m * 50.0)) * along * 2.2;
      }
    }
  }
  float a = floor(min(1.0, I * uStrength) * ${STEPS.toFixed(1)} + bayer(w)) / ${STEPS.toFixed(1)} * ${MAX_ALPHA.toFixed(3)};
  if (a <= 0.0) discard;
  gl_FragColor = vec4(uColour * a, a);
}
`;

interface Drawn {
  quad: Phaser.GameObjects.Shader;
  /** Its numbers, read by its shader each time it is drawn. */
  u: { box: number[]; top: number[]; foot: number[]; strength: number };
  /** When it was first drawn (s). */
  born: number;
  i: number;
}

/** A ray as drawn: its quad, its spot's depth, and its shader's numbers. */
export interface Ray { quad: Phaser.GameObjects.Shader; foot: number; uniforms: Record<string, number | number[]> }

export class Shafts {
  private readonly scene: Phaser.Scene;
  private readonly drawn = new Map<number, Drawn>();
  /** How far across the screen a ray would go per px down (away from the light), its colour and strength. */
  private slant = 0;
  private colour = SUN_HIGH;
  private strength = 0;
  private time = 0;
  /** The view: its middle and the radius rays fade out towards it (read by the shaders), and its box. */
  private view = [0, 0, 1];
  private box = new Phaser.Geom.Rectangle();

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
    // (handing over from the sun to the moon, the rays fade out and come back leaning the other way)
    this.strength = Math.max(sun, moon) - Math.min(sun, moon);

    // the rays reaching into the view, nearest its middle first
    const want: number[] = [];
    this.view = [view.centerX, view.centerY, Math.min(view.width, view.height) / 2];
    this.box = view;
    if (this.strength > 0.02) {
      const dx = this.lean(), y0 = view.y, y1 = view.bottom + BELOW;
      // (a ray's foot is this far across from where it crosses the view's top: look that much further that way)
      const far = -dx * (y1 - y0), x0 = view.x - 16 + Math.min(0, far), x1 = view.right + 16 + Math.max(0, far);
      for (let cy = Math.floor(y0 / SHAFT_CELL); cy <= Math.floor(y1 / SHAFT_CELL); cy++)
        for (let cx = Math.floor(x0 / SHAFT_CELL); cx <= Math.floor(x1 / SHAFT_CELL); cx++)
          for (const i of SHAFTS_BY_CELL.get(cy * 4096 + cx) ?? []) {
            const s = SHAFTS[i];
            if (s.y < y0 || s.y > y1) continue;
            // (its foot, and where it leaves the view's top: on the view at all?)
            const top = s.x + dx * (s.y - y0);
            if (Math.max(s.x, top) < view.x - 16 || Math.min(s.x, top) > view.right + 16) continue;
            want.push(i);
          }
      const mx = view.centerX, my = view.centerY, dist = (i: number) => (SHAFTS[i].x - mx) ** 2 + (SHAFTS[i].y - my) ** 2;
      if (want.length > MOST) want.sort((a, b) => dist(a) - dist(b)).length = MOST;
    }
    const keep = new Set(want);
    for (const [i, d] of this.drawn)
      if (!keep.has(i)) {
        d.quad.destroy();
        this.drawn.delete(i);
      }
    for (const i of want) this.place(this.drawn.get(i) ?? this.make(i, SHAFTS[i]), SHAFTS[i]);
  }

  /** How far across a ray goes per px up it (towards the light). */
  private lean(): number {
    return -Math.max(-SLANT, Math.min(SLANT, this.slant));
  }

  private make(i: number, s: Shaft): Drawn {
    const u = { box: [0, 0, 1, 1], top: [0, 0], foot: [0, 0], strength: 0 };
    const quad = this.scene.add.shader({
      name: 'shaft',
      fragmentSource: SHAFT_SOURCE,
      setupUniforms: (set: (name: string, value: unknown) => void) => {
        set('uBox', u.box);
        set('uTop', u.top);
        set('uFoot', u.foot);
        set('uWidth', s.w);
        set('uLift', s.lift);
        set('uTime', this.time);
        set('uStrength', u.strength);
        set('uColour', this.colour);
        set('uSeed', i % 97);
        set('uView', this.view);
      },
    }, 0, 0, 1, 1).setOrigin(0).setDepth(s.y - 0.05).setBlendMode(Phaser.BlendModes.ADD);
    const d = { quad, u, born: this.time, i };
    this.drawn.set(i, d);
    return d;
  }

  /** The rays drawn now, for game/Cards.ts. */
  rays(): Ray[] {
    const out: Ray[] = [];
    for (const d of this.drawn.values()) {
      const s = SHAFTS[d.i];
      out.push({
        quad: d.quad, foot: s.y,
        uniforms: { uBox: d.u.box, uTop: d.u.top, uFoot: d.u.foot, uWidth: s.w, uLift: s.lift, uTime: this.time, uStrength: d.u.strength, uColour: this.colour, uSeed: d.i % 97, uView: this.view },
      });
    }
    return out;
  }

  /** Lean ray s up from its spot towards the light till it is off the top of the view, and put its quad round it (on the view). */
  private place(d: Drawn, s: Shaft): void {
    const v = this.box, dx = this.lean();
    const ty = v.y - 8, tx = s.x + dx * (s.y - ty);
    d.u.foot = [s.x, s.y];
    d.u.top = [tx, ty];
    // (coming in when first drawn, and fading as its foot goes down out of the view)
    const fade = Math.min(1, (this.time - d.born) / COME_IN) * (1 - smooth(FADE_BELOW, BELOW, s.y - v.bottom));
    d.u.strength = GAIN * this.strength * fade * (0.75 + 0.25 * Math.sin(this.time * 0.35 + s.phase * 6.28));
    const m = s.w + 4;
    const x0 = Math.floor(Math.max(v.x - 8, Math.min(s.x, tx) - m)), x1 = Math.ceil(Math.min(v.right + 8, Math.max(s.x, tx) + m));
    const y0 = Math.floor(ty), y1 = Math.ceil(Math.min(v.bottom + 8, s.y + 2));
    d.u.box = [x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0)];
    const [, , w, h] = d.u.box;
    if (d.quad.x !== x0 || d.quad.y !== y0 || d.quad.width !== w || d.quad.height !== h) d.quad.setPosition(x0, y0).setSize(w, h);
  }
}

function smooth(a: number, b: number, v: number): number {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

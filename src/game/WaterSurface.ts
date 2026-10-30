import Phaser from 'phaser';
import { hex, mix, type Mask, type RGB } from '../art/raster.ts';
import { buildBed, clarity, shoreDistance, EYE, F0, FRESNEL_POW, SLOPE, WAVES, type Sky } from '../art/water.ts';
import type { Light } from '../world/sky.ts';
import { cullerFor } from './Culler.ts';
import { TILE, tileAt } from '../world/map.ts';
import { isBridge } from '../world/legend.ts';
import { defineShader, shade, type Uniforms } from './gpu.ts';

// The open water, drawn in two layers. Underneath, the bed: sand, pebbles,
// weed and mud (still, drawn once). The fish swim over it. On top, the
// surface: a sky box of blue, sun and drifting clouds mirrored by small
// moving waves, more where a wave tilts away from the eye (Fresnel), with
// the bed showing through in the shallows and lost in murk further out.
//
// The surface is drawn on the GPU, every frame: each patch's picture only
// says where there is water and how clear it is (red), and a shader works
// out the rest (as art/water.ts' surfacePixel() did on the CPU).

type Box = { x: number; y: number; w: number; h: number };

/** Under the fish and their shadows (-99995)... */
const BED_DEPTH = -99998;
/** Depth is counted this far out from the bank (px). */
const MAX_DEPTH = 60;
/** ...and over them, under the cast shadows (-99993) and the mirrored trees and cats (-99990). */
const SURFACE_DEPTH = -99994.5;

/** Caustics start where the water's this clear (art/water.ts' clarity: 0.72 at the bank), and are at full strength from here. */
const CAUSTIC_FROM = 0.2, CAUSTIC_FULL = 0.45;
/** How much light the caustics add to the bed at most. */
const CAUSTIC_BRIGHT = 0.65;

const v3 = (v: readonly number[]) => `vec3(${v.map((n) => n.toFixed(4)).join(', ')})`;

const SURFACE = defineShader('WaterSurface', `
uniform float uTime;
/** The sky: blue overhead and at the horizon, the clouds (0..1 rgb), the murk of the water itself. */
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uCloud;
uniform vec3 uMurk;
/** Cloud cover (0..1), drift (px), roughness, the sun's glint (0: none) and the way to the sun. */
uniform float uCover;
uniform vec2 uDrift;
uniform float uRough;
uniform float uGlint;
uniform vec3 uSun;
/** How bright the sunlight dancing on the bed in the shallows is (0: none, at night or under rain clouds). */
uniform float uCaustic;

const vec3 EYE = ${v3(EYE)};

/** The web of light the waves focus onto the bed: near the edges between drifting cells (1 on an edge, 0 away from them). */
float caustic(vec2 p, float t) {
  vec2 i = floor(p), f = p - i;
  float f1 = 8.0, f2 = 8.0;
  for (int dy = -1; dy <= 1; dy++)
    for (int dx = -1; dx <= 1; dx++) {
      vec2 g = vec2(float(dx), float(dy));
      float a = hash(i + g, 2130.0) * 6.2832, b = hash(i + g, 2131.0) * 6.2832;
      vec2 o = g + 0.5 + 0.38 * vec2(sin(t * 0.9 + a), cos(t * 0.7 + b)) - f;
      float d = dot(o, o);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
    }
  return clamp(1.0 - (sqrt(f2) - sqrt(f1)) / 0.3, 0.0, 1.0);
}

void main() {
  vec4 data = texture2D(uMainSampler, outTexCoord);
  if (data.a < 0.5) { gl_FragColor = vec4(0.0); return; }
  float clear = data.r / data.a;
  vec2 w = worldPx();
  float x = w.x, y = w.y, t = uTime;
  // the slope of the water here: a lazy, irregular swell (the slope of a drifting noise)...
  vec2 sw = vec2(x / 11.0 + t * 0.25, y / 7.0 - t * 0.18);
  float h0 = vnoise(sw, 2120.0);
  float gx = (vnoise(sw + vec2(0.12, 0.0), 2120.0) - h0) * 2.4, gy = (vnoise(sw + vec2(0.0, 0.12), 2120.0) - h0) * 3.4;
  // ...and fine ripples on it
${WAVES.map(([dx, dy, k, a, sp]) => `  { float c = cos((x * ${dx.toFixed(4)} + y * ${dy.toFixed(4)}) * ${k.toFixed(4)} - t * ${sp.toFixed(4)}) * ${(a * k).toFixed(5)} * uRough;
    gx += c * ${dx.toFixed(4)}; gy += c * ${dy.toFixed(4)}; }`).join('\n')}
  vec3 n = normalize(vec3(-gx * ${SLOPE.toFixed(4)}, -gy * ${SLOPE.toFixed(4)}, 1.0));
  float R = ${F0.toFixed(4)} + (1.0 - ${F0.toFixed(4)}) * pow(1.0 - max(0.0, dot(n, EYE)), ${FRESNEL_POW.toFixed(1)});
  // the eye's ray, bounced off the surface, into the sky
  vec3 r = reflect(-EYE, n);
  r.z = max(0.05, r.z);
  vec3 sky = mix(uHorizon, uZenith, pow(min(1.0, r.z), 0.8));
  // clouds, where the bounced ray meets them (they sit high: a little sideways shift goes a long way)
  vec2 cuv = vec2(x - (r.x / r.z) * 26.0, y + (r.y / r.z) * 26.0) + uDrift;
  float cn = vnoise(cuv / vec2(70.0, 42.0), 2110.0) * 0.7 + vnoise(cuv / vec2(23.0, 15.0), 2111.0) * 0.3;
  float cloud = clamp((cn - (1.0 - uCover) * 0.9 - 0.05) / 0.18, 0.0, 1.0);
  sky = mix(sky, uCloud, cloud * 0.85);
  // what shows over the bed: the sky as much as it mirrors, and the murk as much as the depth hides the bed
  float A = 1.0 - (1.0 - R) * clear, m = (1.0 - R) * (1.0 - clear);
  vec3 col = (R * sky + m * uMurk) / A;
  float alpha = A;
  // the sun glinting off a wave
  if (uGlint > 0.0) {
    float spec = pow(max(0.0, dot(n, normalize(uSun + EYE))), 900.0) * uGlint;
    if (spec > 0.25) {
      float s = min(1.0, spec);
      col = mix(col, vec3(1.0, 0.98, 0.91), s);
      alpha = max(alpha, s);
    }
  }
  // pixel art: the opacity in a few dithered steps
  alpha = min(1.0, floor(alpha * 6.0 + bayer(w)) / 6.0);
  // caustics: in the very shallow water, sunlight the waves bend into a wobbling web on the bed
  // (added on top, through the clear surface; seen through the slope of the water, so it shifts with the waves)
  vec3 light = vec3(0.0);
  float shallow = clamp((clear - ${CAUSTIC_FROM.toFixed(3)}) / ${(CAUSTIC_FULL - CAUSTIC_FROM).toFixed(3)}, 0.0, 1.0) * uCaustic;
  if (shallow > 0.0) {
    vec2 cp = (w + vec2(gx, gy) * 1.5) / vec2(6.0, 4.0);
    float c = max(caustic(cp, t), caustic(cp * 1.4 + vec2(3.7, 1.3), t * 1.3) * 0.75);
    // crisp lines a pixel or two wide, thinning out (dithered) as the water deepens; as bright as the bed shows through
    c = step(0.55, c) * step(bayer(w + 2.0), shallow);
    light = vec3(1.0, 0.96, 0.78) * c * (1.0 - alpha) * ${CAUSTIC_BRIGHT.toFixed(3)};
  }
  gl_FragColor = vec4(col * alpha + light, alpha);
}
`);

const DAY_SKY = { zenith: hex('#4f8ede'), horizon: hex('#bfe0f7'), cloud: hex('#f6f9fd') };
const DUSK_SKY = { zenith: hex('#5f6fb4'), horizon: hex('#f4b384'), cloud: hex('#f8d2b4') };
const NIGHT_SKY = { zenith: hex('#0c1430'), horizon: hex('#26365e'), cloud: hex('#3a4468') };
const RAIN_SKY = { zenith: hex('#86929f'), horizon: hex('#b4bcc4'), cloud: hex('#d4d8dc') };
/** The colour of the water itself, deep down: a green-brown murk, darker at night. */
const MURK = hex("#24474a"), MURK_NIGHT = hex('#0e1c22');


export class WaterSurface {
  /** The numbers the surface's shader is given, shared by every patch and set anew each frame. */
  private readonly uniforms: Uniforms = {
    uTime: 0, uZenith: [0, 0, 0], uHorizon: [0, 0, 0], uCloud: [0, 0, 0], uMurk: [0, 0, 0],
    uCover: 0, uDrift: [0, 0], uRough: 1, uGlint: 0, uSun: [0, 0, 1], uCaustic: 0,
  };

  constructor(scene: Phaser.Scene, boxes: Box[], mask: Mask) {
    boxes.forEach((box, n) => {
      // how deep it is, worked out over the patch and as far round it as depth is counted
      const wx = Math.max(0, box.x - MAX_DEPTH), wy = Math.max(0, box.y - MAX_DEPTH);
      const ww = Math.min(mask.w, box.x + box.w + MAX_DEPTH) - wx, wh = Math.min(mask.h, box.y + box.h + MAX_DEPTH) - wy;
      const around = mask.window(wx, wy, ww, wh);
      // bridges stand over the water: it's as deep under them as round them
      const dist = shoreDistance(around, MAX_DEPTH, (x, y) => {
        const ch = tileAt(Math.floor((x + wx) / TILE), Math.floor((y + wy) / TILE));
        return isBridge(ch);
      });
      const bed = buildBed(around, dist, wx, wy);
      const bedKey = `water-bed-${n}`;
      const bedTex = scene.textures.createCanvas(bedKey, box.w, box.h)!;
      bedTex.getContext().putImageData(new ImageData(bed.data, bed.w, bed.h), wx - box.x, wy - box.y);
      bedTex.refresh();
      cullerFor(scene).add(scene.add.image(box.x, box.y, bedKey).setOrigin(0).setDepth(BED_DEPTH));
      // the surface's picture: where there is water, and how clear it is (red)
      const key = `water-surface-${n}`;
      const tex = scene.textures.createCanvas(key, box.w, box.h)!;
      const data = new ImageData(box.w, box.h);
      for (let y = 0; y < box.h; y++)
        for (let x = 0; x < box.w; x++) {
          const d = dist[(box.y - wy + y) * ww + box.x - wx + x], i = (y * box.w + x) * 4;
          if (!d || !mask.isSet(box.x + x, box.y + y)) continue;
          data.data[i] = Math.round(clarity(d) * 255);
          data.data[i + 3] = 255;
        }
      tex.getContext().putImageData(data, 0, 0);
      tex.refresh();
      shade(cullerFor(scene).add(scene.add.image(box.x, box.y, key).setOrigin(0).setDepth(SURFACE_DEPTH)), SURFACE, this.uniforms);
    });
  }

  /** `overcast` (0..1) greys the sky and roughens the water. */
  update(light: Light, gt: number, _time: number, overcast: number): void {
    const sky = this.skyFor(light, gt, overcast), u = this.uniforms, c = (v: RGB) => v.map((n) => n / 255);
    u.uTime = gt / 1000;
    u.uZenith = c(sky.zenith);
    u.uHorizon = c(sky.horizon);
    u.uCloud = c(sky.cloud);
    u.uMurk = c(mix(MURK_NIGHT, MURK, light.day));
    u.uCover = sky.cover;
    u.uDrift = [sky.driftX, sky.driftY];
    u.uRough = sky.rough;
    u.uGlint = sky.glint;
    u.uSun = sky.sun;
    // (the sun must be up and out: none at night, faint low in the sky, gone under rain clouds)
    u.uCaustic = light.day * Math.min(1, Math.max(0, light.elevation) / 15) * (1 - overcast);
  }

  private skyFor(light: Light, gt: number, overcast: number): Sky {
    // blue by day, warm low in the sky at dawn and dusk, dark at night; grey in the rain
    const low = light.day * Math.max(0, 1 - light.elevation / 14);
    let { zenith, horizon, cloud } = DAY_SKY;
    zenith = mix(mix(NIGHT_SKY.zenith, zenith, light.day), DUSK_SKY.zenith, low);
    horizon = mix(mix(NIGHT_SKY.horizon, horizon, light.day), DUSK_SKY.horizon, low);
    cloud = mix(mix(NIGHT_SKY.cloud, cloud, light.day), DUSK_SKY.cloud, low);
    zenith = mix(zenith, RAIN_SKY.zenith, overcast * light.day);
    horizon = mix(horizon, RAIN_SKY.horizon, overcast * light.day);
    cloud = mix(cloud, RAIN_SKY.cloud, overcast * light.day);
    const e = (Math.max(0, light.elevation) * Math.PI) / 180, a = (light.azimuth * Math.PI) / 180;
    return {
      zenith, horizon, cloud,
      cover: 0.35 + overcast * 0.6,
      driftX: (gt / 1000) * 3.2, driftY: (gt / 1000) * -1.1,
      sun: [Math.sin(a) * Math.cos(e), -Math.cos(a) * Math.cos(e), Math.sin(e)],
      glint: light.elevation > 0 ? light.day * (1 - overcast) : 0,
      rough: 1 + overcast * 1.2,
    };
  }
}

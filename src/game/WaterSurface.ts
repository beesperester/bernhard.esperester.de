import Phaser from 'phaser';
import { Raster, hex, type RGB } from '../art/raster.ts';
import { buildBed, clarity, shoreDistance, surfacePixel, type Sky } from '../art/water.ts';
import type { Light } from '../world/sky.ts';
import { toCanvas } from './textures.ts';
import { cullerFor } from './Culler.ts';
import { TILE, tileAt } from '../world/map.ts';
import { isBridge, isLilyPad } from '../world/legend.ts';

// The open water, drawn in two layers. Underneath, the bed: sand, pebbles,
// weed and mud (still, drawn once). The fish swim over it. On top, the
// surface: a sky box of blue, sun and drifting clouds mirrored by small
// moving waves, more where a wave tilts away from the eye (Fresnel), with
// the bed showing through in the shallows and lost in murk further out.

type Box = { x: number; y: number; w: number; h: number };

/** Under the fish and their shadows (-99995)... */
const BED_DEPTH = -99998;
/** ...and over them, under the cast shadows (-99993) and the mirrored trees and cats (-99990). */
const SURFACE_DEPTH = -99994.5;
/** Redraw the visible surface this often (ms): waves are slow, and it's pixel art. */
const FRAME_MS = 90;
/** At most this long (ms) a frame spends redrawing water. */
const BUDGET_MS = 4;

const DAY_SKY = { zenith: hex('#4f8ede'), horizon: hex('#bfe0f7'), cloud: hex('#f6f9fd') };
const DUSK_SKY = { zenith: hex('#5f6fb4'), horizon: hex('#f4b384'), cloud: hex('#f8d2b4') };
const NIGHT_SKY = { zenith: hex('#0c1430'), horizon: hex('#26365e'), cloud: hex('#3a4468') };
const RAIN_SKY = { zenith: hex('#86929f'), horizon: hex('#b4bcc4'), cloud: hex('#d4d8dc') };
/** The colour of the water itself, deep down: a green-brown murk, darker at night. */
const MURK = hex("#24474a"), MURK_NIGHT = hex('#0e1c22');

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export class WaterSurface {
  /** The water cut into patches, each with its picture, how clear it is where, and when it was last redrawn. */
  private readonly patches: { box: Box; tex: Phaser.Textures.CanvasTexture; img: ImageData; clear: Float32Array; wet: Uint8Array; drawn: number }[] = [];
  private readonly px = [0, 0, 0, 0];

  constructor(scene: Phaser.Scene, boxes: Box[], mask: Raster) {
    // lily pads and bridges float on the water: it's as deep under them as round them
    const dist = shoreDistance(mask, 60, (x, y) => {
      const ch = tileAt(Math.floor(x / TILE), Math.floor(y / TILE));
      return isLilyPad(ch) || isBridge(ch);
    });
    scene.textures.addCanvas('water-bed', toCanvas(buildBed(mask, dist)));
    scene.add.image(0, 0, 'water-bed').setOrigin(0).setDepth(BED_DEPTH);
    boxes.forEach((box, n) => {
      const key = `water-surface-${n}`;
      const tex = scene.textures.createCanvas(key, box.w, box.h)!;
      const clear = new Float32Array(box.w * box.h), wet = new Uint8Array(box.w * box.h);
      for (let y = 0; y < box.h; y++)
        for (let x = 0; x < box.w; x++) {
          const d = dist[(box.y + y) * mask.w + box.x + x];
          wet[y * box.w + x] = d && mask.isSet(box.x + x, box.y + y) ? 1 : 0;
          clear[y * box.w + x] = clarity(d);
        }
      cullerFor(scene).add(scene.add.image(box.x, box.y, key).setOrigin(0).setDepth(SURFACE_DEPTH));
      this.patches.push({ box, tex, img: tex.getContext().createImageData(box.w, box.h), clear, wet, drawn: -Infinity });
    });
  }

  /** `overcast` (0..1) greys the sky and roughens the water; `driftX/Y` move the mirrored clouds with the wind. */
  update(light: Light, gt: number, time: number, overcast: number, view: Phaser.Geom.Rectangle): void {
    // the patches on screen that are due, the longest-waiting first
    const due = this.patches
      .filter(({ box, drawn }) => time - drawn >= FRAME_MS && box.x <= view.right && box.x + box.w >= view.x && box.y <= view.bottom && box.y + box.h >= view.y)
      .sort((a, b) => a.drawn - b.drawn);
    if (!due.length) return;
    const sky = this.skyFor(light, gt, overcast);
    const murk = mix(MURK_NIGHT, MURK, light.day);
    const t = gt / 1000, px = this.px;
    // a few each frame, so a big lake doesn't stall one frame in every few
    const start = performance.now();
    for (const p of due) {
      if (performance.now() - start > BUDGET_MS) break;
      p.drawn = time;
      const { box, img, clear, wet } = p;
      const d = img.data;
      // only the part on screen
      const x0 = Math.max(0, Math.floor(view.x - box.x)), x1 = Math.min(box.w, Math.ceil(view.right - box.x));
      const y0 = Math.max(0, Math.floor(view.y - box.y)), y1 = Math.min(box.h, Math.ceil(view.bottom - box.y));
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          const i = y * box.w + x;
          if (!wet[i]) continue;
          surfacePixel(box.x + x, box.y + y, t, clear[i], murk, sky, px);
          d[i * 4] = px[0]; d[i * 4 + 1] = px[1]; d[i * 4 + 2] = px[2]; d[i * 4 + 3] = px[3] * 255;
        }
      p.tex.getContext().putImageData(img, 0, 0);
      p.tex.refresh();
    }
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

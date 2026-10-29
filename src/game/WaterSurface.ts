import Phaser from 'phaser';
import { hex, type Mask, type RGB } from '../art/raster.ts';
import { buildBed, clarity, shoreDistance, surfacePixel, type Sky } from '../art/water.ts';
import type { Light } from '../world/sky.ts';
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
/** Depth is counted this far out from the bank (px). */
const MAX_DEPTH = 60;
/** ...and over them, under the cast shadows (-99993) and the mirrored trees and cats (-99990). */
const SURFACE_DEPTH = -99994.5;
/** Redraw the visible surface this often (ms): waves are slow, and it's pixel art. */
const FRAME_MS = 90;
/** At most this long (ms) a frame spends redrawing water. */
const BUDGET_MS = 4;
/** Water this far (px) outside the view is drawn too, so it's ready when the camera gets there. */
const MARGIN = 48;

const DAY_SKY = { zenith: hex('#4f8ede'), horizon: hex('#bfe0f7'), cloud: hex('#f6f9fd') };
const DUSK_SKY = { zenith: hex('#5f6fb4'), horizon: hex('#f4b384'), cloud: hex('#f8d2b4') };
const NIGHT_SKY = { zenith: hex('#0c1430'), horizon: hex('#26365e'), cloud: hex('#3a4468') };
const RAIN_SKY = { zenith: hex('#86929f'), horizon: hex('#b4bcc4'), cloud: hex('#d4d8dc') };
/** The colour of the water itself, deep down: a green-brown murk, darker at night. */
const MURK = hex("#24474a"), MURK_NIGHT = hex('#0e1c22');

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export class WaterSurface {
  /** The water cut into patches, each with its picture, how clear it is where, and when it was last redrawn. */
  private readonly patches: {
    box: Box; tex: Phaser.Textures.CanvasTexture; img: ImageData; clear: Float32Array; wet: Uint8Array; drawn: number;
    /** The part of the patch last drawn, in its own px: [x0, y0, x1, y1]. */
    done: [number, number, number, number];
  }[] = [];
  private readonly px = [0, 0, 0, 0];

  constructor(scene: Phaser.Scene, boxes: Box[], mask: Mask) {
    boxes.forEach((box, n) => {
      // how deep it is, worked out over the patch and as far round it as depth is counted
      const wx = Math.max(0, box.x - MAX_DEPTH), wy = Math.max(0, box.y - MAX_DEPTH);
      const ww = Math.min(mask.w, box.x + box.w + MAX_DEPTH) - wx, wh = Math.min(mask.h, box.y + box.h + MAX_DEPTH) - wy;
      const around = mask.window(wx, wy, ww, wh);
      // lily pads and bridges float on the water: it's as deep under them as round them
      const dist = shoreDistance(around, MAX_DEPTH, (x, y) => {
        const ch = tileAt(Math.floor((x + wx) / TILE), Math.floor((y + wy) / TILE));
        return isLilyPad(ch) || isBridge(ch);
      });
      const bed = buildBed(around, dist, wx, wy);
      const bedKey = `water-bed-${n}`;
      const bedTex = scene.textures.createCanvas(bedKey, box.w, box.h)!;
      bedTex.getContext().putImageData(new ImageData(bed.data, bed.w, bed.h), wx - box.x, wy - box.y);
      bedTex.refresh();
      cullerFor(scene).add(scene.add.image(box.x, box.y, bedKey).setOrigin(0).setDepth(BED_DEPTH));
      const key = `water-surface-${n}`;
      const tex = scene.textures.createCanvas(key, box.w, box.h)!;
      const clear = new Float32Array(box.w * box.h), wet = new Uint8Array(box.w * box.h);
      for (let y = 0; y < box.h; y++)
        for (let x = 0; x < box.w; x++) {
          const d = dist[(box.y - wy + y) * ww + box.x - wx + x];
          wet[y * box.w + x] = d && mask.isSet(box.x + x, box.y + y) ? 1 : 0;
          clear[y * box.w + x] = clarity(d);
        }
      cullerFor(scene).add(scene.add.image(box.x, box.y, key).setOrigin(0).setDepth(SURFACE_DEPTH));
      this.patches.push({ box, tex, img: tex.getContext().createImageData(box.w, box.h), clear, wet, drawn: -Infinity, done: [0, 0, 0, 0] });
    });
  }

  /** `overcast` (0..1) greys the sky and roughens the water; `driftX/Y` move the mirrored clouds with the wind. */
  update(light: Light, gt: number, time: number, overcast: number, view: Phaser.Geom.Rectangle): void {
    // what to draw: the view and a margin round it
    const ax = view.x - MARGIN, ay = view.y - MARGIN, bx = view.right + MARGIN, by = view.bottom + MARGIN;
    const area = (box: Box): [number, number, number, number] => [
      Math.max(0, Math.floor(ax - box.x)), Math.max(0, Math.floor(ay - box.y)),
      Math.min(box.w, Math.ceil(bx - box.x)), Math.min(box.h, Math.ceil(by - box.y)),
    ];
    // a patch the camera has moved onto past what it last drew can't wait: it would show a hole
    const behind = ({ box, done }: (typeof this.patches)[number]) =>
      view.x - box.x < done[0] || view.y - box.y < done[1] || view.right - box.x > done[2] || view.bottom - box.y > done[3];
    const near = this.patches.filter(({ box }) => box.x <= bx && box.x + box.w >= ax && box.y <= by && box.y + box.h >= ay);
    const urgent = near.filter((p) => behind(p) && p.box.x <= view.right && p.box.x + p.box.w >= view.x && p.box.y <= view.bottom && p.box.y + p.box.h >= view.y);
    const due = near.filter((p) => !urgent.includes(p) && time - p.drawn >= FRAME_MS).sort((a, b) => a.drawn - b.drawn);
    if (!urgent.length && !due.length) return;
    const sky = this.skyFor(light, gt, overcast);
    const murk = mix(MURK_NIGHT, MURK, light.day);
    const t = gt / 1000, px = this.px;
    // the urgent ones now, then the rest a few each frame, so a big lake doesn't stall one frame in every few
    const start = performance.now();
    for (const p of [...urgent, ...due]) {
      if (!urgent.includes(p) && performance.now() - start > BUDGET_MS) break;
      p.drawn = time;
      const { box, img, clear, wet } = p;
      const d = img.data;
      const [x0, y0, x1, y1] = (p.done = area(box));
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

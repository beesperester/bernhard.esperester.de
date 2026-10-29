import Phaser from 'phaser';
import { bayer } from '../art/tiles.ts';
import { TREES } from '../world/trees.ts';
import { DEPTH } from './Daylight.ts';
import type { TreeWatcher, Trees } from './Trees.ts';
import type { Glow } from './Glows.ts';

// The light over the garden: a layer the whole scene is multiplied by. By
// day it is white (nothing changes); at dusk and at night it is the sky's
// colour (deep blue), and round every lamp it is lifted towards warm white
// in a soft round falloff, so the grass, paths, trees and cats near a lamp
// show in their own colours, lit, rather than having a bright picture laid
// over them. The light lies on the ground: the leaves of the trees in front
// of a lamp, and the crowns of those behind it, are left out of it (as they
// are now: again whenever one of them changes or fades round your cat).
//
// Drawn each frame into a texture the size of the view (the darkness, the
// lights added onto it), which is then multiplied in. Like the rest of the
// art, a light falls off in a few steps, ordered-dithered from one to the
// next in world pixels (the same pattern everywhere, so lights that overlap
// agree).

/** The warm light of a candle or an oil lamp. */
export const LAMPLIGHT = 0xffc88c;

/** A light falls off in this many steps. */
const STEPS = 5;
/** Light lies on the ground, seen at a slant: a pool is this much as deep as it is wide. */
const FLAT = 0.62;
/** Leaves this far up a tree (px), even behind a lamp, aren't lit by it. */
const CROWN = 24;
/** The map reaches this far past the view's edges (px). */
const MARGIN = 8;

interface Lamp {
  x: number;
  y: number;
  r: number;
  alpha: number;
  colour: number;
  /** Its picture's top-left corner and size (world px)... */
  left: number;
  top: number;
  w: number;
  h: number;
  /** ...the picture, made when it first comes into view: its light before the trees are taken out, and with them. */
  still: ImageData | null;
  tex: Phaser.Textures.CanvasTexture | null;
  /** The trees in front of it have changed since it was last cut. */
  dirty: boolean;
}

export class LightMap implements TreeWatcher {
  private readonly map: Phaser.GameObjects.RenderTexture;
  private readonly lamps: Lamp[] = [];
  private readonly scene: Phaser.Scene;
  private readonly trees: Trees;

  constructor(scene: Phaser.Scene, trees: Trees) {
    this.scene = scene;
    this.trees = trees;
    trees.watch(this);
    this.map = scene.add.renderTexture(0, 0, 64, 64).setOrigin(0).setDepth(DEPTH.tint).setBlendMode(Phaser.BlendModes.MULTIPLY).setVisible(false);
  }

  /** A lamp's light, round (x, y) on the ground out to `r` px, in `colour`; set its strength (0..1) as it comes on. */
  add(x: number, y: number, r: number, colour: number): Glow {
    // (on whole world pixels, so its dither lines up with everything else's)
    r = Math.round(r);
    const ry = Math.round(r * FLAT);
    const lamp: Lamp = { x, y, r, alpha: 0, colour, left: Math.round(x) - r, top: Math.round(y) - ry, w: 2 * r + 1, h: 2 * ry + 1, still: null, tex: null, dirty: true };
    this.lamps.push(lamp);
    return { set: (a) => { lamp.alpha = a; } };
  }

  added(i: number): void {
    this.touched(i);
  }

  removed(i: number): void {
    this.touched(i);
  }

  holed(i: number): void {
    this.touched(i);
  }

  /** Tree i has changed: the lamps it stands over want cutting again. */
  private touched(i: number): void {
    const t = TREES[i], x0 = t.x - t.w / 2, y0 = t.y - (t.h - 1) - t.elev, x1 = x0 + t.w, y1 = y0 + t.h;
    for (const l of this.lamps) if (x0 < l.left + l.w && x1 > l.left && y0 < l.top + l.h && y1 > l.top) l.dirty = true;
  }

  /** Take the trees in front of lamp l out of its light, as they are now. */
  private cut(l: Lamp): void {
    if (!l.tex) {
      l.tex = this.scene.textures.createCanvas(`light-${this.lamps.indexOf(l)}`, l.w, l.h)!;
      l.still = falloff(l.r, (l.h - 1) / 2, l.left, l.top);
    }
    const src = l.still!, img = new ImageData(new Uint8ClampedArray(src.data), l.w, l.h);
    for (let v = 0; v < l.h; v++)
      for (let u = 0; u < l.w; u++) {
        const k = (v * l.w + u) * 4;
        if (img.data[k + 3]) img.data[k + 3] *= 1 - this.trees.coverage(l.left + u + 0.5, l.top + v + 0.5, l.y, CROWN);
      }
    l.tex.getContext().putImageData(img, 0, 0);
    l.tex.refresh();
    l.dirty = false;
  }

  /** Lay the sky's colour `tint` over the view, and the lamps in it. */
  update(view: Phaser.Geom.Rectangle, tint: number): void {
    const lit = this.lamps.filter((l) => l.alpha > 0 && l.x + l.r > view.x && l.x - l.r < view.right && l.y + l.r > view.y && l.y - l.r < view.bottom);
    const on = tint !== 0xffffff || lit.length > 0;
    this.map.setVisible(on);
    if (!on) return;
    // (a little past the view's edges, on whole pixels)
    const x0 = Math.floor(view.x) - MARGIN, y0 = Math.floor(view.y) - MARGIN;
    const w = Math.ceil(view.width) + 2 * MARGIN, h = Math.ceil(view.height) + 2 * MARGIN;
    if (Math.abs(this.map.width - w) > 1 || Math.abs(this.map.height - h) > 1) this.map.resize(w, h);
    this.map.setPosition(x0, y0).clear().fill(tint);
    for (const l of lit) {
      if (l.dirty) this.cut(l);
      this.map.stamp(l.tex!.key, undefined, l.left - x0, l.top - y0, { originX: 0, originY: 0, tint: l.colour, alpha: l.alpha, blendMode: Phaser.BlendModes.ADD });
    }
    this.map.render();
  }
}

/**
 * A round light `r` across and `ry` deep either side of its middle, its
 * top-left corner at world (left, top): white, brightest in the middle,
 * falling off in STEPS steps to nothing at the rim, dithered between them.
 */
function falloff(r: number, ry: number, left: number, top: number): ImageData {
  const w = 2 * r + 1, h = 2 * ry + 1, img = new ImageData(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const d = Math.min(1, Math.hypot((x - r) / r, (y - ry) / ry));
      const v = (1 - d * d) ** 2 * STEPS;
      const step = Math.min(STEPS, Math.floor(v) + (bayer(left + x, top + y) < v - Math.floor(v) ? 1 : 0));
      const k = (y * w + x) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = 255;
      img.data[k + 3] = Math.round((255 * step) / STEPS);
    }
  return img;
}

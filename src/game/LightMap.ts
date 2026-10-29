import Phaser from 'phaser';
import { bayer } from '../art/tiles.ts';
import { DEPTH } from './Daylight.ts';
import type { Glow } from './Glows.ts';

// The light over the garden: a layer the whole scene is multiplied by. By
// day it is white (nothing changes); at dusk and at night it is the sky's
// colour (deep blue), and round every lamp it is lifted towards warm white
// in a soft round falloff, so the grass, paths, trees and cats near a lamp
// show in their own colours, lit, rather than having a bright picture laid
// over them. The light spreads freely (leaves in front of a lamp are lit too).
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
/** The map reaches this far past the view's edges (px). */
const MARGIN = 8;

interface Lamp { x: number; y: number; r: number; alpha: number; colour: number; key: string; left: number; top: number }

export class LightMap {
  private readonly map: Phaser.GameObjects.RenderTexture;
  private readonly lamps: Lamp[] = [];
  private readonly scene: Phaser.Scene;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.map = scene.add.renderTexture(0, 0, 64, 64).setOrigin(0).setDepth(DEPTH.tint).setBlendMode(Phaser.BlendModes.MULTIPLY).setVisible(false);
  }

  /** A lamp's light, round (x, y) on the ground out to `r` px, in `colour`; set its strength (0..1) as it comes on. */
  add(x: number, y: number, r: number, colour: number): Glow {
    // (its picture, on whole world pixels, made for where it falls on the dither pattern)
    r = Math.round(r);
    const ry = Math.round(r * FLAT), left = Math.round(x) - r, top = Math.round(y) - ry;
    const key = `light-${r}-${left & 3}-${top & 3}`;
    if (!this.scene.textures.exists(key)) this.scene.textures.addCanvas(key, falloff(r, ry, left, top));
    const lamp: Lamp = { x, y, r, alpha: 0, colour, key, left, top };
    this.lamps.push(lamp);
    return { set: (a) => { lamp.alpha = a; } };
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
    for (const l of lit)
      this.map.stamp(l.key, undefined, l.left - x0, l.top - y0, { originX: 0, originY: 0, tint: l.colour, alpha: l.alpha, blendMode: Phaser.BlendModes.ADD });
    this.map.render();
  }
}

/**
 * A round light `r` across and `ry` deep either side of its middle, its
 * top-left corner at world (left, top): white, brightest in the middle,
 * falling off in STEPS steps to nothing at the rim, dithered between them.
 */
function falloff(r: number, ry: number, left: number, top: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  const w = (c.width = 2 * r + 1), h = (c.height = 2 * ry + 1);
  const g = c.getContext('2d')!, img = g.createImageData(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const d = Math.min(1, Math.hypot((x - r) / r, (y - ry) / ry));
      const v = (1 - d * d) ** 2 * STEPS;
      const step = Math.min(STEPS, Math.floor(v) + (bayer(left + x, top + y) < v - Math.floor(v) ? 1 : 0));
      const k = (y * w + x) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = 255;
      img.data[k + 3] = Math.round((255 * step) / STEPS);
    }
  g.putImageData(img, 0, 0);
  return c;
}

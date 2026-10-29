import Phaser from 'phaser';
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
// lights added onto it), which is then multiplied in.

/** The warm light of a candle or an oil lamp. */
export const LAMPLIGHT = 0xffc88c;

/** The falloff picture's size (px): a lamp is drawn by scaling it. */
const FALLOFF = 64;
/** Light lies on the ground, seen at a slant: a pool is this much as deep as it is wide. */
const FLAT = 0.62;
/** The map reaches this far past the view's edges (px). */
const MARGIN = 8;

interface Lamp { x: number; y: number; r: number; alpha: number; colour: number }

export class LightMap {
  private readonly map: Phaser.GameObjects.RenderTexture;
  private readonly lamps: Lamp[] = [];

  constructor(scene: Phaser.Scene) {
    if (!scene.textures.exists('light-falloff')) scene.textures.addCanvas('light-falloff', falloff());
    this.map = scene.add.renderTexture(0, 0, 64, 64).setOrigin(0).setDepth(DEPTH.tint).setBlendMode(Phaser.BlendModes.MULTIPLY).setVisible(false);
  }

  /** A lamp's light, round (x, y) on the ground out to `r` px, in `colour`; set its strength (0..1) as it comes on. */
  add(x: number, y: number, r: number, colour: number): Glow {
    const lamp: Lamp = { x, y, r, alpha: 0, colour };
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
      this.map.stamp('light-falloff', undefined, l.x - x0, l.y - y0, {
        scaleX: (2 * l.r) / FALLOFF, scaleY: (2 * l.r * FLAT) / FALLOFF, tint: l.colour, alpha: l.alpha, blendMode: Phaser.BlendModes.ADD,
      });
    this.map.render();
  }
}

/** A soft round light: white, brightest in the middle, falling off smoothly to nothing at the rim. */
function falloff(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = FALLOFF;
  const g = c.getContext('2d')!, img = g.createImageData(FALLOFF, FALLOFF);
  for (let y = 0; y < FALLOFF; y++)
    for (let x = 0; x < FALLOFF; x++) {
      const dx = (x + 0.5) / (FALLOFF / 2) - 1, dy = (y + 0.5) / (FALLOFF / 2) - 1, d = Math.min(1, Math.hypot(dx, dy));
      const k = (y * FALLOFF + x) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = 255;
      img.data[k + 3] = Math.round(255 * (1 - d * d) ** 2);
    }
  g.putImageData(img, 0, 0);
  return c;
}

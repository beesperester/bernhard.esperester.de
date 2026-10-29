import { lightAt, type Light } from '../world/sky.ts';

/** Draw order of the lighting layers, above the whole garden and below the god rays. */
export const DEPTH = {
  /** The scene is multiplied by the light colour here... */
  tint: 99996,
  /** ...and lamps, fireflies, glowing eyes and stars shine through it on top. */
  glow: 99997,
};

/**
 * The time of day: the colour the whole scene is multiplied by (warm at
 * sunrise and sunset, deep blue at night), following the real sun over
 * Berlin. LightMap.ts lays it over the garden, lamps lifting it round them.
 */
export class Daylight {
  light: Light;
  /** The colour (0xrrggbb; white by day). */
  tint = 0xffffff;

  constructor(gt: number) {
    this.light = lightAt(gt);
    this.update(gt);
  }

  update(gt: number): void {
    const l = (this.light = lightAt(gt));
    const [r, g, b] = l.tint.map(Math.round);
    this.tint = (r << 16) | (g << 8) | b;
  }
}

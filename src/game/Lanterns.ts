import Phaser from 'phaser';
import { LANTERNS, elevAt } from '../world/map.ts';
import type { Light } from '../world/sky.ts';
import { cullerFor } from './Culler.ts';
import type { Glow, Glows } from './Glows.ts';

/** Something drawn in front of whatever is behind its depth: its picture and where it is. */
export interface Occluder { canvas: CanvasImageSource; x: number; y: number; w: number; h: number; depth: number; /** A tree (they change: Glows.ts follows them as they are). */ tree?: boolean }

/**
 * Lanterns along the paths. They light up at dusk: the glass glows and a warm
 * pool of light spreads on the ground, shining through the night tint (and
 * what stands in front of it cut out of it: Glows.ts).
 */
export class Lanterns {
  private readonly lamps: { post: Phaser.GameObjects.Image; glass: Glow; pool: Glow; seed: number }[];
  private lit = -1;

  constructor(scene: Phaser.Scene, glows: Glows) {
    this.lamps = LANTERNS.map(([x, y], i) => {
      const top = y - elevAt(x, y);
      return {
        post: cullerFor(scene).add(scene.add.image(x, top, 'lantern', 0).setOrigin(0.5, 1).setDepth(y)),
        glass: glows.point('glow-core', x, top - 13, 1, y),
        pool: glows.area('glow-lantern', x, top - 2, 1, y),
        seed: i * 1.7,
      };
    });
  }

  update(light: Light, time: number): void {
    // only after dark: they come on once the sun is well below the horizon, and go off before sunrise
    const on = Math.max(0, Math.min(1, (-2 - light.elevation) / 4));
    const t = time / 1000;
    if (on === 0 && this.lit === 0) return;
    this.lit = on;
    for (const l of this.lamps) {
      // a candle-like flicker, different for every lantern
      const flicker = 0.9 + 0.06 * Math.sin(t * 7.3 + l.seed) + 0.04 * Math.sin(t * 13.1 + l.seed * 2);
      l.post.setFrame(on > 0.3 ? 1 : 0);
      l.glass.set(on * flicker);
      l.pool.set(on * 0.55 * flicker);
    }
  }
}

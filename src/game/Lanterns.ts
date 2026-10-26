import Phaser from 'phaser';
import { LANTERNS, elevAt } from '../world/map.ts';
import type { Light } from '../world/sky.ts';
import { DEPTH } from './Daylight.ts';

/**
 * Lanterns along the paths. They light up at dusk: the glass glows and a warm
 * pool of light spreads on the ground, shining through the night tint.
 */
export class Lanterns {
  private readonly lamps: { post: Phaser.GameObjects.Image; glass: Phaser.GameObjects.Image; pool: Phaser.GameObjects.Image; seed: number }[];
  private lit = -1;

  constructor(scene: Phaser.Scene) {
    this.lamps = LANTERNS.map(([x, y], i) => {
      const top = y - elevAt(x, y);
      const add = (key: string, px: number, py: number) =>
        scene.add.image(px, py, key).setDepth(DEPTH.glow).setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
      return {
        post: scene.add.image(x, top, 'lantern', 0).setOrigin(0.5, 1).setDepth(y),
        glass: add('glow-lamp', x, top - 13),
        pool: add('glow-lantern', x, top - 2),
        seed: i * 1.7,
      };
    });
  }

  update(light: Light, time: number): void {
    // on from a little before sunset until a little after sunrise
    const on = Math.max(0, Math.min(1, (2 - light.elevation) / 5));
    const t = time / 1000;
    if (on === 0 && this.lit === 0) return;
    this.lit = on;
    for (const l of this.lamps) {
      // a candle-like flicker, different for every lantern
      const flicker = 0.9 + 0.06 * Math.sin(t * 7.3 + l.seed) + 0.04 * Math.sin(t * 13.1 + l.seed * 2);
      l.post.setFrame(on > 0.3 ? 1 : 0);
      l.glass.setVisible(on > 0).setAlpha(on * flicker);
      l.pool.setVisible(on > 0).setAlpha(on * 0.55 * flicker);
    }
  }
}

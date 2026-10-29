import Phaser from 'phaser';
import { LANDMARK_SPOTS, LANTERNS, LEVEL, TILE, elevAt, levelAt } from '../world/map.ts';
import { LANDMARK_LAMPS, LANDMARK_SIZE } from '../world/landmarks.ts';
import type { Light } from '../world/sky.ts';
import { cullerFor } from './Culler.ts';
import type { Glow, Glows } from './Glows.ts';
import { LAMPLIGHT, type LightMap } from './LightMap.ts';

/** Something drawn in front of whatever is behind its depth: its picture and where it is. */
export interface Occluder { canvas: CanvasImageSource; x: number; y: number; w: number; h: number; depth: number; /** A tree (they change: Glows.ts follows them as they are). */ tree?: boolean }

/** How far round them the lanterns along the paths light (px), and the follies' lamps. */
const LANTERN_LIGHT = 72, FOLLY_LIGHT = 52;

/**
 * Lanterns along the paths, and the lamps of the follies (stone lanterns,
 * paper lanterns in the pavilions). They light up at dusk: the flame glows
 * and the garden round it is lit (LightMap.ts).
 */
export class Lanterns {
  private readonly lamps: { post: Phaser.GameObjects.Image | null; flame: Glow; light: Glow; seed: number }[];
  private lit = -1;

  constructor(scene: Phaser.Scene, glows: Glows, lights: LightMap) {
    this.lamps = LANTERNS.map(([x, y], i) => {
      const top = y - elevAt(x, y);
      return {
        post: cullerFor(scene).add(scene.add.image(x, top, 'lantern', 0).setOrigin(0.5, 1).setDepth(y)),
        flame: glows.point('glow-core', x, top - 13, 1, y),
        light: lights.add(x, top - 2, LANTERN_LIGHT, LAMPLIGHT),
        seed: i * 1.7,
      };
    });
    for (const l of LANDMARK_SPOTS) {
      const [, h] = LANDMARK_SIZE[l.kind], lift = levelAt(l.tx, l.ty + h - 1) * LEVEL;
      // (sorted with the folly: its front)
      const front = (l.ty + h) * TILE - 2;
      for (const [x, y, z] of LANDMARK_LAMPS[l.kind] ?? []) {
        const wx = l.tx * TILE + x, wy = l.ty * TILE + y - lift;
        this.lamps.push({
          post: null,
          flame: glows.point('glow-core', wx, wy - z, 1, front),
          light: lights.add(wx, wy, FOLLY_LIGHT, LAMPLIGHT),
          seed: this.lamps.length * 1.7,
        });
      }
    }
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
      l.post?.setFrame(on > 0.3 ? 1 : 0);
      l.flame.set(on * flicker);
      l.light.set(on * 0.85 * flicker);
    }
  }
}

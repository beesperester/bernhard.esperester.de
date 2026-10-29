import Phaser from 'phaser';
import type { Raster } from '../art/raster.ts';
import { buildFlower, buildPad } from '../art/lilies.ts';
import { FLOWERS, LILIES, PADS, liliesOut } from '../world/lilies.ts';
import { lampsOn, type Light } from '../world/sky.ts';
import { cullerFor } from './Culler.ts';
import type { Glow, Glows } from './Glows.ts';

/** Pads lie on the water over its surface and reflections (frogs sit on them, just above)... */
const PAD_DEPTH = -99981;
/** ...and the flowers on the pads. */
const FLOWER_DEPTH = -99980.5;
/** How bright the flowers glow at night, breathing slowly. */
const GLOW = 0.6;

/**
 * Water lilies on the still water (world/lilies.ts): their pads, and their
 * flowers, which glow softly after dark (the flower's own picture, bloomed
 * like the lamps: Glows.ts). None while the pond is frozen or in winter.
 */
export class Lilies {
  private readonly flowers: { glow: Glow; phase: number }[] = [];
  private lit = -1;

  constructor(scene: Phaser.Scene, toCanvas: (r: Raster) => HTMLCanvasElement, glows: Glows) {
    if (!liliesOut()) return;
    for (let i = 0; i < PADS; i++) scene.textures.addCanvas(`lily-pad-${i}`, toCanvas(buildPad(i)));
    for (let i = 0; i < FLOWERS; i++) scene.textures.addCanvas(`lily-flower-${i}`, toCanvas(buildFlower(i)));
    const culler = cullerFor(scene);
    for (const [k, l] of LILIES.entries()) {
      culler.add(scene.add.image(l.x, l.y, `lily-pad-${l.pad}`).setFlipX(l.flip).setDepth(PAD_DEPTH));
      if (l.flower < 0) continue;
      // (standing up out of the middle of its pad)
      const fy = l.y - 3;
      culler.add(scene.add.image(l.x, fy, `lily-flower-${l.flower}`).setDepth(FLOWER_DEPTH));
      this.flowers.push({ glow: glows.point(`lily-flower-${l.flower}`, l.x, fy, 1, l.y), phase: (k * 0.618) % 1 });
    }
  }

  update(light: Light, time: number): void {
    // (they open their glow as the lanterns come on)
    const on = lampsOn(light);
    if (on === 0 && this.lit === 0) return;
    this.lit = on;
    const t = time / 1000;
    for (const f of this.flowers) f.glow.set(on * GLOW * (0.8 + 0.2 * Math.sin(t * 0.7 + f.phase * Math.PI * 2)));
  }
}

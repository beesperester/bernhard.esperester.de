import type Phaser from 'phaser';
import type { Raster } from '../art/raster.ts';
import { RAIL_CHUNK, buildRailway, railChunks } from '../art/railway.ts';
import { cullerFor } from './Culler.ts';

/** On the ground, under the sun's shadows; and in the water, above its reflections and ripples. */
const ON_GROUND = -99994.2, IN_WATER = -99978;

/** The Ring's railway, drawn in pieces where the line passes (art/railway.ts). */
export class Railway {
  constructor(scene: Phaser.Scene, toCanvas: (r: Raster) => HTMLCanvasElement) {
    for (const [cx, cy] of railChunks())
      for (const part of ['ground', 'water'] as const) {
        const r = buildRailway(cx, cy, part);
        if (!r.data.some((v, i) => i % 4 === 3 && v > 0)) continue;
        const key = `rail-${part}-${cx}-${cy}`;
        scene.textures.addCanvas(key, toCanvas(r));
        cullerFor(scene).add(scene.add.image(cx * RAIL_CHUNK, cy * RAIL_CHUNK, key).setOrigin(0).setDepth(part === 'ground' ? ON_GROUND : IN_WATER));
      }
  }
}

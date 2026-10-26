import Phaser from 'phaser';
import { buildCloud, type CloudShape } from '../art/clouds.ts';
import type { Raster } from '../art/raster.ts';
import { TILE, WORLD_H, WORLD_W } from '../world/map.ts';

/** About one cloud per 200 tiles of park. */
const COUNT = Math.round((WORLD_W * WORLD_H) / (TILE * TILE * 200));
/** Drift in world px per second, roughly with the wind (towards the lower right). */
const VX = 5;
const VY = 1.6;
/** Clouds wrap around a field larger than the garden so they enter and leave off-screen. */
const MARGIN = 220;
const FIELD_W = WORLD_W + MARGIN * 2;
const FIELD_H = WORLD_H + MARGIN * 2;

/**
 * Soft cloud shadows drifting over the garden. Positions are a pure function of the
 * shared garden clock, so every cat sees the same sky without any messages.
 */
export class Clouds {
  private readonly clouds: { img: Phaser.GameObjects.Image; shape: CloudShape; ox: number; oy: number }[] = [];

  constructor(scene: Phaser.Scene, toCanvas: (r: Raster) => HTMLCanvasElement) {
    for (let i = 0; i < COUNT; i++) {
      const w = 150 + ((i * 53) % 70), h = 80 + ((i * 31) % 34);
      const shape = buildCloud(i + 1, w, h);
      scene.textures.addCanvas(`cloud-${i}`, toCanvas(shape.raster));
      this.clouds.push({
        img: scene.add.image(0, 0, `cloud-${i}`).setOrigin(0).setDepth(90000),
        shape,
        // spread evenly along the drift so the gaps between clouds stay generous
        ox: (i / COUNT) * FIELD_W + (i % 2) * 90,
        oy: ((i * 0.37) % 1) * FIELD_H,
      });
    }
  }

  /** Place the clouds for garden time `gt` (ms). */
  update(gt: number): void {
    const t = gt / 1000;
    for (const c of this.clouds) {
      const x = mod(c.ox + t * VX, FIELD_W) - MARGIN;
      const y = mod(c.oy + t * VY, FIELD_H) - MARGIN;
      c.img.setPosition(Math.round(x), Math.round(y));
    }
  }

  /** How shaded a world point is, 0 (full sun) to 1 (deep in a cloud's shadow). */
  coverAt(px: number, py: number): number {
    let cover = 0;
    for (const { img, shape } of this.clouds) {
      const x = Math.floor(px - img.x), y = Math.floor(py - img.y);
      const { w, h } = shape.raster;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      cover = Math.max(cover, shape.cover[y * w + x]);
    }
    return cover;
  }
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

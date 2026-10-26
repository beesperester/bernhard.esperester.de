import Phaser from 'phaser';
import { FLORA, LEANS, placeFlora, type Plant } from '../art/flora.ts';
import type { CatView } from './CatView.ts';

export interface LivePlant extends Plant {
  img: Phaser.GameObjects.Image;
  lean: number;
}

/** Grass, wildflowers and reeds that sway in a rolling wind and bend away from cats. */
export class Meadow {
  readonly plants: LivePlant[];

  constructor(scene: Phaser.Scene) {
    this.plants = placeFlora().map((p) => ({
      ...p,
      lean: 0,
      img: scene.add.image(p.x, p.y, `flora-${p.kind}`, 2).setOrigin(0.5, 1).setDepth(p.y),
    }));
  }

  update(time: number, cats: CatView[]): void {
    const t = time / 1000;
    const gust = 0.55 + 0.45 * Math.sin(t * 0.31) * Math.sin(t * 0.17 + 1);
    for (const p of this.plants) {
      // a wave of wind rolling in from the top-left, mostly bending plants to the right
      const wave = Math.sin(t * 2.1 - p.x * 0.05 - p.y * 0.03) + 0.35 * Math.sin(t * 5.3 + p.x * 0.3);
      let lean = Math.round(0.3 + wave * gust * 1.4);
      for (const c of cats) {
        const dx = p.x - c.x, dy = p.y - c.y;
        if (dx > -8 && dx < 8 && dy > -4 && dy < 7) lean = dx >= 0 ? 2 : -2;
      }
      lean = Math.max(-2, Math.min(2, lean));
      if (lean !== p.lean) {
        p.lean = lean;
        p.img.setFrame(lean + 2);
      }
    }
  }
}

export function addFloraTextures(scene: Phaser.Scene, toCanvas: (k: number) => HTMLCanvasElement): HTMLCanvasElement[] {
  return FLORA.map((k, i) => {
    const canvas = toCanvas(i);
    const tex = scene.textures.addCanvas(`flora-${i}`, canvas)!;
    for (let f = 0; f < LEANS; f++) tex.add(f, 0, f * k.w, 0, k.w, k.h);
    return canvas;
  });
}

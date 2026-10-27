import Phaser from 'phaser';
import { FLORA, LEANS, placeFlora, type Plant } from '../art/flora.ts';
import type { CatView } from './CatView.ts';
import { elevAt } from '../world/map.ts';
import { cullerFor } from './Culler.ts';

export interface LivePlant extends Plant {
  img: Phaser.GameObjects.Image;
  lean: number;
}

/** Plants are bucketed into square cells this big, so only those near the view are looked at. */
const CELL = 128;

/** Grass, wildflowers and reeds that sway in a rolling wind and bend away from cats. */
export class Meadow {
  readonly plants: LivePlant[];
  private readonly cells = new Map<string, LivePlant[]>();

  constructor(scene: Phaser.Scene) {
    const culler = cullerFor(scene);
    this.plants = placeFlora().map((p) => ({
      ...p,
      lean: 0,
      // plants on raised ground are drawn lifted with it
      img: culler.add(scene.add.image(p.x, p.y - elevAt(p.x, p.y), `flora-${p.kind}`, 2).setOrigin(0.5, 1).setDepth(p.y)),
    }));
    for (const p of this.plants) {
      const key = `${Math.floor(p.x / CELL)},${Math.floor(p.y / CELL)}`;
      let cell = this.cells.get(key);
      if (!cell) this.cells.set(key, (cell = []));
      cell.push(p);
    }
  }

  update(time: number, cats: CatView[], view: Phaser.Geom.Rectangle): void {
    const t = time / 1000;
    const gust = 0.55 + 0.45 * Math.sin(t * 0.31) * Math.sin(t * 0.17 + 1);
    // the park is big: only animate what can be seen (plants hang down from their base, raised ones further)
    const left = view.x - 8, right = view.right + 8, top = view.y - 8, bottom = view.bottom + 48;
    for (let cy = Math.floor(top / CELL); cy <= Math.floor(bottom / CELL); cy++)
      for (let cx = Math.floor(left / CELL); cx <= Math.floor(right / CELL); cx++)
        for (const plant of this.cells.get(`${cx},${cy}`) ?? []) {
          if (plant.x < left || plant.x > right || plant.y < top || plant.y > bottom) continue;
          this.sway(plant, t, gust, cats);
        }
  }

  private sway(plant: LivePlant, t: number, gust: number, cats: CatView[]): void {
    // a slow wave of wind rolling in from the top-left, nodding plants a pixel at most
    // (a whole meadow flicking between frames gets restless to look at)
    const wave = Math.sin(t * 1.3 - plant.x * 0.05 - plant.y * 0.03) + 0.2 * Math.sin(t * 3.1 + plant.x * 0.3);
    let lean = Math.round(0.25 + wave * gust * 0.75);
    // a cat brushing past pushes it aside
    for (const cat of cats) {
      const dx = plant.x - cat.x, dy = plant.y - cat.y;
      if (dx > -8 && dx < 8 && dy > -4 && dy < 7) lean = dx >= 0 ? 2 : -2;
    }
    lean = Math.max(-2, Math.min(2, lean));
    if (lean !== plant.lean) {
      plant.lean = lean;
      plant.img.setFrame(lean + 2);
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

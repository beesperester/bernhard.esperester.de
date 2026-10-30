// The things lying about the park that a cat can carry (world/things.ts):
// flat on the ground under the shadows, afloat on the water with the drift,
// or in the air on their way down, sorted among everything standing. Every
// screen draws the same from the store and the garden clock.

import Phaser from 'phaser';
import type { Bits } from '../art/raster.ts';
import type { ThingNow, ThingStore } from '../world/things.ts';
import { LEVEL, TILE, levelAt } from '../world/map.ts';
import { paint } from './Painted.ts';
import { sight } from './fauna/kit.ts';

/** Lying on the ground: over the furniture laid flat, under the shadows cast on it. */
const ON_GROUND = -99993.6;
/** Afloat: just above the water, with the leaves drifting down the streams (game/Streams.ts). */
const ON_WATER = -99979;

export class Things {
  private readonly imgs: Phaser.GameObjects.Image[] = [];
  private readonly scene: Phaser.Scene;
  private readonly water: Bits;

  constructor(scene: Phaser.Scene, water: Bits) {
    this.scene = scene;
    this.water = water;
  }

  update(store: ThingStore, gt: number, view: Phaser.Geom.Rectangle): void {
    const all = store.within(view.x - 12, view.y - 12, view.right + 12, view.bottom + 40, gt);
    let used = 0;
    for (const t of all) {
      // (out of sight under a bridge)
      const x = Math.round(t.x), y = Math.round(t.y);
      if (t.how === 'afloat' && !this.water.isSet(x, y)) continue;
      let img = this.imgs[used];
      if (!img) this.imgs.push((img = paint(this.scene.add.image(0, 0, 'thing-0-0'))));
      used++;
      this.draw(img, t, x, y);
    }
    for (let i = used; i < this.imgs.length; i++) this.imgs[i].setVisible(false);
  }

  private draw(img: Phaser.GameObjects.Image, t: ThingNow, x: number, y: number): void {
    // turned over in flight and as it floats: flipped, and end over end
    const flip = t.turn % 2 === 1, over = t.turn >= 2;
    img.setVisible(true).setTexture(`thing-${t.kind}-${t.v}`).setOrigin(0.5).setFlipX(flip !== over).setFlipY(t.how === 'flying' && over).setAlpha(t.alpha);
    if (t.how === 'flying') {
      const elev = levelAt(Math.floor(t.x / TILE), Math.floor(t.y / TILE)) * LEVEL;
      img.setPosition(x, Math.round(y - elev - t.z)).setDepth(t.y);
      const k = sight.through(img.x, img.y, img.depth);
      if (k < 1) img.setAlpha(t.alpha * k);
    } else {
      const elev = t.how === 'ground' ? levelAt(Math.floor(t.x / TILE), Math.floor(t.y / TILE)) * LEVEL : 0;
      img.setPosition(x, y - elev).setDepth(t.how === 'ground' ? ON_GROUND : ON_WATER);
      // (one that was in the air last time was the cards' to draw, and hidden from the camera: it's the camera's again)
      img.cameraFilter = 0;
    }
  }
}

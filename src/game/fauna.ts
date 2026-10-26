import Phaser from 'phaser';
import { mulberry32 } from '../art/raster.ts';

// Helpers shared by the deterministic fauna (Ambient, Birds).

type Img = Phaser.GameObjects.Image;

export const seedRng = (...k: number[]) => mulberry32(k.reduce((a, v) => Math.imul(a ^ (v | 0), 2654435761) >>> 0, 0x9e3779b9));
/** One deterministic random number in [0,1) for a tuple of integers. */
export const hash2 = (...k: number[]) => seedRng(...k)();
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smooth = (t: number) => t * t * (3 - 2 * t);
export const clamp01 = (t: number) => Math.max(0, Math.min(1, t));

/** Reuses images instead of creating and destroying them every frame. */
export class Pool {
  private imgs: Img[] = [];
  private used = 0;
  private readonly scene: Phaser.Scene;
  private readonly key: string;
  constructor(scene: Phaser.Scene, key: string) { this.scene = scene; this.key = key; }
  begin(): void { this.used = 0; }
  get(texture = this.key, frame: string | number = 0): Img {
    let img = this.imgs[this.used];
    if (!img) this.imgs.push((img = this.scene.add.image(0, 0, texture, frame)));
    this.used++;
    return img.setVisible(true).setTexture(texture, frame).setAlpha(1).setRotation(0).setFlipX(false).setOrigin(0.5).setScale(1);
  }
  end(): void { for (let i = this.used; i < this.imgs.length; i++) this.imgs[i].setVisible(false); }
}

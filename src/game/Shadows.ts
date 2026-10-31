import type Phaser from 'phaser';
import { cullerFor } from './Culler.ts';
import type { Light } from '../world/sky.ts';

// Soft round shadows under everything, which take over from the sun's as it
// sets (the sun's are game/Cards.ts', from its shadow map): faint by day,
// stronger at night.

const COLOUR = [22, 34, 78];

export class Shadows {
  private readonly blobs: Phaser.GameObjects.Image[] = [];
  /** 0 at night, 1 in full sun: how strong the sun's shadows are (the soft ones take over as it fades). */
  strength = 0;

  constructor(scene: Phaser.Scene, blobs: { x: number; y: number; w: number; h: number; depth: number }[]) {
    const blob = document.createElement('canvas');
    blob.width = 64;
    blob.height = 64;
    const g = blob.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, `rgba(${COLOUR},1)`);
    grad.addColorStop(0.55, `rgba(${COLOUR},0.7)`);
    grad.addColorStop(1, `rgba(${COLOUR},0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    scene.textures.addCanvas('blob', blob);
    for (const b of blobs)
      this.blobs.push(cullerFor(scene).add(scene.add.image(b.x, b.y, 'blob').setDisplaySize(b.w, b.h).setDepth(b.depth).setAlpha(0)));
  }

  /** `overcast` (0..1): rain clouds soften the sun's shadows away. */
  update(light: Light, overcast: number): void {
    this.strength = Math.max(0, Math.min(1, light.elevation / 10)) * (1 - overcast * 0.85);
    const soft = 0.08 + 0.42 * (1 - this.strength);
    for (const b of this.blobs) b.setAlpha(soft);
  }
}

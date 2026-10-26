import Phaser from 'phaser';
import { lightAt, type Light } from '../world/sky.ts';

/** Draw order of the lighting layers, above the whole garden and below the god rays. */
export const DEPTH = {
  /** The scene is multiplied by the light colour here... */
  tint: 99996,
  /** ...and lamps, fireflies, glowing eyes and stars shine through it on top. */
  glow: 99997,
};

/**
 * The time of day: a full-screen colour the whole scene is multiplied by
 * (warm at sunrise and sunset, deep blue at night), following the real sun
 * over Berlin.
 */
export class Daylight {
  light: Light;
  private readonly scene: Phaser.Scene;
  private readonly tint: Phaser.GameObjects.Rectangle;
  private last = '';

  constructor(scene: Phaser.Scene, gt: number) {
    this.scene = scene;
    this.light = lightAt(gt);
    this.tint = scene.add.rectangle(0, 0, 1, 1, 0xffffff)
      .setScrollFactor(0).setDepth(DEPTH.tint).setBlendMode(Phaser.BlendModes.MULTIPLY);
    this.resize();
  }

  resize(): void {
    const cam = this.scene.cameras.main;
    // scroll-factor-0 objects are still zoomed around the camera centre
    this.tint.setPosition(cam.width / 2, cam.height / 2).setSize(cam.width / cam.zoom + 4, cam.height / cam.zoom + 4);
  }

  update(gt: number): void {
    const l = (this.light = lightAt(gt));
    const [r, g, b] = l.tint.map(Math.round);
    const key = `${r},${g},${b}`;
    if (key === this.last) return;
    this.last = key;
    this.tint.setFillStyle((r << 16) | (g << 8) | b).setVisible(key !== '255,255,255');
  }
}

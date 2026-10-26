import Phaser from 'phaser';
import { buildRays } from '../art/rays.ts';
import type { Raster } from '../art/raster.ts';

const MOTES = 28;

/**
 * Screen-space god rays from the top-left plus dust motes drifting through them.
 * Textures are built at world-pixel resolution so they match the game's pixels.
 */
export class Sunlight {
  private readonly scene: Phaser.Scene;
  private readonly toCanvas: (r: Raster) => HTMLCanvasElement;
  private layers: Phaser.GameObjects.Image[] = [];
  private motes: { img: Phaser.GameObjects.Image; x: number; y: number; ph: number; sp: number }[] = [];
  private intensity: Float32Array = new Float32Array(0);
  private w = 0;
  private h = 0;
  private gen = 0;
  /** Smoothed sunshine, dimmed while a cloud passes over the view. */
  private sun = 1;

  constructor(scene: Phaser.Scene, toCanvas: (r: Raster) => HTMLCanvasElement) {
    this.scene = scene;
    this.toCanvas = toCanvas;
    for (let i = 0; i < MOTES; i++)
      this.motes.push({
        img: scene.add.image(0, 0, 'mote').setScrollFactor(0).setDepth(99999).setBlendMode(Phaser.BlendModes.ADD),
        x: Math.random(), y: Math.random(), ph: Math.random() * 6.28, sp: 0.6 + Math.random() * 0.8,
      });
  }

  /** Rebuild the ray textures for the current camera size and zoom. */
  resize(): void {
    const cam = this.scene.cameras.main;
    const w = Math.ceil(cam.width / cam.zoom), h = Math.ceil(cam.height / cam.zoom);
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    const old = this.layers;
    const gen = ++this.gen;
    this.layers = [0, 1].map((v) => {
      const { raster, intensity } = buildRays(w, h, v);
      if (v === 0) this.intensity = intensity;
      const key = `rays-${v}-${gen}`;
      this.scene.textures.addCanvas(key, this.toCanvas(raster));
      return this.scene.add
        .image(cam.width / 2, cam.height / 2, key)
        .setScrollFactor(0)
        .setDepth(99998)
        .setBlendMode(Phaser.BlendModes.ADD);
    });
    for (const img of old) {
      const key = img.texture.key;
      img.destroy();
      this.scene.textures.remove(key);
    }
  }

  /** `shade` is the cloud cover over the view, 0 (clear) to 1 (overcast). */
  update(time: number, dt: number, shade = 0): void {
    const cam = this.scene.cameras.main;
    const t = time / 1000;
    this.sun += (1 - 0.85 * shade - this.sun) * Math.min(1, dt * 1.2);
    // the rays breathe in and out on two slow, unrelated waves...
    const breathe = 0.6 + 0.25 * Math.sin(t * 0.31) + 0.15 * Math.sin(t * 0.83 + 1.7);
    // ...while cross-fading between two layouts. (They must not move: shifting a
    // dithered layer by a pixel visibly pops the whole screen.)
    const f = 0.5 + 0.5 * Math.sin(t * 0.45);
    const glow = this.sun * breathe;
    this.layers[0]?.setAlpha(glow * (0.35 + 0.65 * f));
    this.layers[1]?.setAlpha(glow * (0.35 + 0.65 * (1 - f)));

    const { w, h } = this;
    for (const m of this.motes) {
      m.x += (dt * 3 * m.sp + Math.sin(t * 0.8 + m.ph) * dt * 2) / w;
      m.y += (dt * 4 * m.sp + Math.cos(t * 0.6 + m.ph) * dt * 1.5) / h;
      if (m.x > 1) m.x -= 1;
      if (m.y > 1) m.y -= 1;
      const px = Math.floor(m.x * w), py = Math.floor(m.y * h);
      const light = this.intensity[py * w + px] ?? 0;
      const twinkle = 0.5 + 0.5 * Math.sin(t * 2.3 + m.ph * 3);
      m.img
        // scroll-factor-0 objects are still zoomed around the camera centre
        .setPosition(cam.width / 2 + px - w / 2, cam.height / 2 + py - h / 2)
        .setAlpha(Math.min(1, light * 1.4) * twinkle * this.sun);
    }
  }
}

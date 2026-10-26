import Phaser from 'phaser';

/** A soft, full-resolution darkening towards the screen edges. */
export class Vignette {
  private readonly scene: Phaser.Scene;
  private img: Phaser.GameObjects.Image | null = null;
  private gen = 0;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  resize(): void {
    const cam = this.scene.cameras.main;
    const w = Math.max(1, Math.round(cam.width)), h = Math.max(1, Math.round(cam.height));
    const key = `vignette-${++this.gen}`;
    const tex = this.scene.textures.createCanvas(key, w, h)!;
    const ctx = tex.getContext();
    // stretch a circular gradient into an ellipse that fits the screen
    ctx.setTransform(w / 2, 0, 0, h / 2, w / 2, h / 2);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.SQRT2);
    g.addColorStop(0, 'rgba(8, 20, 10, 0)');
    g.addColorStop(0.35, 'rgba(8, 20, 10, 0)');
    g.addColorStop(0.62, 'rgba(8, 20, 10, 0.2)');
    g.addColorStop(0.85, 'rgba(8, 20, 10, 0.5)');
    g.addColorStop(1, 'rgba(8, 20, 10, 0.78)');
    ctx.fillStyle = g;
    ctx.fillRect(-1, -1, 2, 2);
    tex.refresh();

    const old = this.img;
    // drawn at screen resolution: undo the camera zoom
    this.img = this.scene.add
      .image(cam.width / 2, cam.height / 2, key)
      .setScrollFactor(0)
      .setScale(1 / cam.zoom)
      .setDepth(99999.5);
    if (old) {
      const k = old.texture.key;
      old.destroy();
      this.scene.textures.remove(k);
    }
  }
}

// A curtain over the garden, under the HUD: it stays shut while we find out
// where our cat belongs (a cat that stayed may remember where it was before a
// reload), then dissolves in a dither of game-sized pixels, so the first
// picture doesn't flash in, nor the cat jump from one spot to another.
import { bayer } from '../art/tiles.ts';

/** The page's own green (style.css), so a shut curtain looks like nothing has loaded yet. */
const COLOUR = [0x2e, 0x6e, 0x24] as const;

export class Fader {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  /** How much of the curtain is open (0 shut, 1 gone), and where it is heading. */
  private open = 0;
  private anim: { from: number; to: number; t0: number; ms: number; done: () => void } | null = null;
  private zoom: () => number;

  constructor(zoom: () => number) {
    this.zoom = zoom;
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'fader';
    this.ctx = this.canvas.getContext('2d')!;
    document.getElementById('game')!.after(this.canvas);
    this.draw();
  }

  get shut(): boolean {
    return this.open < 1;
  }

  /** Dissolve the curtain away. */
  reveal(ms = 700): Promise<void> {
    return this.to(1, ms);
  }

  /** Dither the curtain back over the garden. */
  close(ms = 300): Promise<void> {
    return this.to(0, ms);
  }

  private to(target: number, ms: number): Promise<void> {
    this.anim?.done();
    return new Promise((done) => {
      this.anim = { from: this.open, to: target, t0: performance.now(), ms, done };
      const tick = () => {
        const a = this.anim;
        if (!a || a.done !== done) return;
        const u = Math.min(1, (performance.now() - a.t0) / a.ms);
        this.open = a.from + (a.to - a.from) * u;
        this.draw();
        if (u < 1) requestAnimationFrame(tick);
        else {
          this.anim = null;
          done();
        }
      };
      requestAnimationFrame(tick);
    });
  }

  private draw(): void {
    const c = this.canvas;
    c.hidden = this.open >= 1;
    if (c.hidden) return;
    const z = this.zoom();
    const w = Math.ceil(innerWidth / z), h = Math.ceil(innerHeight / z);
    if (c.width !== w || c.height !== h) Object.assign(c, { width: w, height: h });
    const img = this.ctx.createImageData(w, h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (bayer(x, y) < this.open) continue;
        const i = (y * w + x) * 4;
        img.data[i] = COLOUR[0];
        img.data[i + 1] = COLOUR[1];
        img.data[i + 2] = COLOUR[2];
        img.data[i + 3] = 255;
      }
    this.ctx.putImageData(img, 0, 0);
  }
}

import Phaser from 'phaser';
import { CAT } from '../art/cat.ts';
import { FLORA } from '../art/flora.ts';
import type { Prop } from '../art/tiles.ts';
import type { CatView } from './CatView.ts';
import type { LivePlant } from './Meadow.ts';

const MARGIN = 48; // how far above the pond objects may stand and still reflect

type Box = { x: number; y: number; w: number; h: number };
let count = 0;

/**
 * Fakes reflections on one patch of water: anything standing near it is drawn
 * upside down below its base line, rippled, tinted and clipped to open water.
 */
export class PondReflection {
  readonly box: Box;
  private readonly raw: CanvasRenderingContext2D;
  private readonly tex: Phaser.Textures.CanvasTexture;
  private readonly out: CanvasRenderingContext2D;
  private readonly mask: HTMLCanvasElement;
  private readonly trees: { canvas: HTMLCanvasElement; p: Prop }[];
  private readonly plants: LivePlant[];
  private readonly catSheets: HTMLCanvasElement[];
  private readonly floraSheets: HTMLCanvasElement[];

  constructor(
    scene: Phaser.Scene,
    box: Box,
    opts: {
      waterMask: HTMLCanvasElement;
      catSheets: HTMLCanvasElement[];
      floraSheets: HTMLCanvasElement[];
      props: { canvas: HTMLCanvasElement; p: Prop }[];
      plants: LivePlant[];
    },
  ) {
    this.box = box;
    const { x, y, w, h } = box;
    const key = `reflection-${count++}`;
    const raw = document.createElement('canvas');
    raw.width = w;
    raw.height = h;
    this.raw = raw.getContext('2d')!;
    this.tex = scene.textures.createCanvas(key, w, h)!;
    this.out = this.tex.getContext();
    this.mask = document.createElement('canvas');
    this.mask.width = w;
    this.mask.height = h;
    this.mask.getContext('2d')!.drawImage(opts.waterMask, x, y, w, h, 0, 0, w, h);
    scene.add.image(x, y, key).setOrigin(0).setDepth(-99990).setAlpha(0.65);

    this.catSheets = opts.catSheets;
    this.floraSheets = opts.floraSheets;
    const near = (bx: number, base: number, half: number) =>
      bx + half > x && bx - half < x + w && base > y - MARGIN && base < y + h;
    this.trees = opts.props.filter(({ p, canvas }) => near(p.x + canvas.width / 2, p.depthY + 1, canvas.width / 2));
    this.plants = opts.plants.filter((p) => near(p.x, p.y, 8));
  }

  /** Draw `src` region flipped vertically around world line `base`. */
  private flipped(src: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, wx: number, wy: number, base: number): void {
    const { x, y } = this.box;
    this.raw.setTransform(1, 0, 0, -1, -x, 2 * base - y);
    this.raw.drawImage(src, sx, sy, sw, sh, wx, wy, sw, sh);
  }

  update(time: number, cats: CatView[]): void {
    const { x, y, w, h } = this.box;
    const raw = this.raw;
    raw.setTransform(1, 0, 0, 1, 0, 0);
    raw.clearRect(0, 0, w, h);

    // big crowns would swamp the water, so trees reflect more faintly than cats
    raw.globalAlpha = 0.45;
    for (const { canvas, p } of this.trees) this.flipped(canvas, 0, 0, canvas.width, canvas.height, p.x, p.y, p.depthY + 1);
    raw.globalAlpha = 1;
    for (const p of this.plants) {
      const k = FLORA[p.kind];
      this.flipped(this.floraSheets[p.kind], (p.lean + 2) * k.w, 0, k.w, k.h, p.x - Math.floor(k.w / 2), p.y - k.h, p.y);
    }
    for (const c of cats) {
      const cx = Math.round(c.x), cy = Math.round(c.y);
      if (cx + 8 < x || cx - 8 > x + w || cy + CAT + 12 < y || cy > y + h) continue;
      this.flipped(this.catSheets[c.coat], c.frame * CAT, 0, CAT, CAT, cx - CAT / 2, cy - CAT - Math.round(c.z), cy);
    }
    raw.setTransform(1, 0, 0, 1, 0, 0);

    // ripple: shift rows left/right
    const out = this.out;
    out.globalCompositeOperation = 'source-over';
    out.clearRect(0, 0, w, h);
    const t = time / 1000;
    for (let j = 0; j < h; j++) {
      const off = Math.round(Math.sin((y + j) * 0.8 + t * 3) * 0.9);
      out.drawImage(raw.canvas, 0, j, w, 1, off, j, w, 1);
    }
    // tint towards the water colour, then clip to open water
    out.globalCompositeOperation = 'source-atop';
    out.fillStyle = 'rgba(40, 90, 190, 0.45)';
    out.fillRect(0, 0, w, h);
    out.globalCompositeOperation = 'destination-in';
    out.drawImage(this.mask, 0, 0);
    out.globalCompositeOperation = 'source-over';
    this.tex.refresh();
  }
}

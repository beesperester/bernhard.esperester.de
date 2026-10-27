import Phaser from 'phaser';
import { CAT } from '../art/cat.ts';
import { FLORA } from '../art/flora.ts';
import type { Prop } from '../art/tiles.ts';
import type { CatView } from './CatView.ts';
import type { LivePlant } from './Meadow.ts';
import { cullerFor } from './Culler.ts';

type Box = { x: number; y: number; w: number; h: number };
let count = 0;

/**
 * Fakes reflections on one patch of water: anything standing near it is drawn
 * upside down below its base line, rippled, tinted and clipped to open water.
 * Trees and plants are redrawn now and then (they hardly move); cats on a
 * layer of their own every frame, so their reflection keeps up with them.
 */
export class PondReflection {
  readonly box: Box;
  private readonly raw: CanvasRenderingContext2D;
  private readonly tex: Phaser.Textures.CanvasTexture;
  private readonly out: CanvasRenderingContext2D;
  private readonly catTex: Phaser.Textures.CanvasTexture;
  /** Whether the cat layer has anything on it (to clear it once they've gone). */
  private catsShown = false;
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
    cullerFor(scene).add(scene.add.image(x, y, key).setOrigin(0).setDepth(-99990).setAlpha(0.65));
    this.catTex = scene.textures.createCanvas(`${key}-cats`, w, h)!;
    cullerFor(scene).add(scene.add.image(x, y, `${key}-cats`).setOrigin(0).setDepth(-99989.9).setAlpha(0.65));

    this.catSheets = opts.catSheets;
    this.floraSheets = opts.floraSheets;
    // an object's reflection hangs from its base line as far down as the object is tall;
    // keep everything whose reflection reaches this patch (tall trees span several)
    const near = (bx: number, base: number, half: number, tall: number) =>
      bx + half > x && bx - half < x + w && base + tall > y && base < y + h;
    this.trees = opts.props.filter(({ p, canvas }) => near(p.x + canvas.width / 2, p.depthY + 1, canvas.width / 2, p.depthY + 1 - p.y));
    this.plants = opts.plants.filter((p) => near(p.x, p.y, 8, FLORA[p.kind].h));
  }

  /** Draw `src` region flipped vertically around world line `base`. */
  private flipped(src: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, wx: number, wy: number, base: number): void {
    const { x, y } = this.box;
    this.raw.setTransform(1, 0, 0, -1, -x, 2 * base - y);
    this.raw.drawImage(src, sx, sy, sw, sh, wx, wy, sw, sh);
  }

  /** Redraw the trees' and plants' reflections. */
  update(time: number): void {
    const raw = this.begin();
    // big crowns would swamp the water, so trees reflect more faintly than cats
    raw.globalAlpha = 0.45;
    for (const { canvas, p } of this.trees) this.flipped(canvas, 0, 0, canvas.width, canvas.height, p.x, p.y, p.depthY + 1);
    raw.globalAlpha = 1;
    for (const p of this.plants) {
      const k = FLORA[p.kind];
      this.flipped(this.floraSheets[p.kind], (p.lean + 2) * k.w, 0, k.w, k.h, p.x - Math.floor(k.w / 2), p.y - k.h, p.y);
    }
    this.finish(this.out, time);
    this.tex.refresh();
  }

  /** Redraw the cats' reflections (every frame, but only while a cat is near). */
  updateCats(time: number, cats: CatView[]): void {
    const { x, y, w, h } = this.box;
    const near = cats.filter((c) => {
      const cx = Math.round(c.x), cy = Math.round(c.y);
      return !(cx + 8 < x || cx - 8 > x + w || cy + CAT + 12 < y || cy > y + h);
    });
    if (!near.length && !this.catsShown) return;
    this.catsShown = near.length > 0;
    const raw = this.begin();
    for (const c of near) {
      const cx = Math.round(c.x), cy = Math.round(c.y);
      this.flipped(this.catSheets[c.coat], c.frame * CAT, 0, CAT, CAT, cx - CAT / 2, cy - CAT - Math.round(c.z), cy);
    }
    raw.setTransform(1, 0, 0, 1, 0, 0);
    this.finish(this.catTex.getContext(), time);
    this.catTex.refresh();
  }

  private begin(): CanvasRenderingContext2D {
    this.raw.setTransform(1, 0, 0, 1, 0, 0);
    this.raw.clearRect(0, 0, this.box.w, this.box.h);
    return this.raw;
  }

  /** Copy what was drawn into `out`: rippled, tinted towards the water, clipped to open water. */
  private finish(out: CanvasRenderingContext2D, time: number): void {
    const { y, w, h } = this.box;
    this.raw.setTransform(1, 0, 0, 1, 0, 0);
    // ripple: shift rows left/right
    out.globalCompositeOperation = 'source-over';
    out.clearRect(0, 0, w, h);
    const t = time / 1000;
    for (let j = 0; j < h; j++) {
      const off = Math.round(Math.sin((y + j) * 0.8 + t * 3) * 0.9);
      out.drawImage(this.raw.canvas, 0, j, w, 1, off, j, w, 1);
    }
    out.globalCompositeOperation = 'source-atop';
    out.fillStyle = 'rgba(30, 64, 70, 0.4)';
    out.fillRect(0, 0, w, h);
    out.globalCompositeOperation = 'destination-in';
    out.drawImage(this.mask, 0, 0);
    out.globalCompositeOperation = 'source-over';
  }
}

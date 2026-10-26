import Phaser from 'phaser';
import { bayer, type Prop } from '../art/tiles.ts';
import type { CatView } from './CatView.ts';

const HOLE_R = 16;
/** Fraction of pixels removed at the centre of the hole; the tree never fully disappears. */
const HOLE_MAX = 0.8;

interface Tree {
  p: Prop;
  tex: Phaser.Textures.CanvasTexture;
  orig: ImageData;
  work: ImageData;
  holed: boolean;
}

/**
 * Trees are drawn from canvases so that a cat walking behind one can be seen
 * through a round, dithered window in the foliage.
 */
export class Trees {
  private readonly trees: Tree[];

  constructor(scene: Phaser.Scene, props: Prop[], canvases: HTMLCanvasElement[]) {
    this.trees = props.map((p, i) => {
      const { width: w, height: h } = canvases[i];
      const tex = scene.textures.createCanvas(`tree-${i}`, w, h)!;
      const orig = canvases[i].getContext('2d')!.getImageData(0, 0, w, h);
      tex.getContext().putImageData(orig, 0, 0);
      tex.refresh();
      scene.add.image(p.x, p.y, `tree-${i}`).setOrigin(0).setDepth(p.depthY);
      return { p, tex, orig, work: new ImageData(w, h), holed: false };
    });
  }

  /** True if a tree's crown is drawn over world point (x, y) for something whose feet are at feetY. */
  covers(x: number, y: number, feetY: number): boolean {
    for (const { p, orig } of this.trees) {
      if (feetY >= p.depthY) continue;
      const lx = Math.round(x) - p.x, ly = Math.round(y) - p.y;
      if (lx < 0 || ly < 0 || lx >= orig.width || ly >= orig.height) continue;
      if (orig.data[(ly * orig.width + lx) * 4 + 3] > 0) return true;
    }
    return false;
  }

  /** Open a see-through hole wherever one of these cats is behind a tree. */
  update(cats: CatView[]): void {
    for (const t of this.trees) {
      const { p, orig } = t;
      const w = orig.width, h = orig.height;
      // cats behind this tree (feet above its base) whose body overlaps it
      const holes: [number, number][] = [];
      for (const c of cats) {
        if (c.y >= p.depthY) continue;
        const hx = Math.round(c.x) - p.x, hy = Math.round(c.y - 8 - c.z) - p.y;
        if (hx < -HOLE_R || hy < -HOLE_R || hx > w + HOLE_R || hy > h + HOLE_R) continue;
        holes.push([hx, hy]);
      }
      if (!holes.length) {
        if (t.holed) {
          t.tex.getContext().putImageData(orig, 0, 0);
          t.tex.refresh();
          t.holed = false;
        }
        continue;
      }
      const src = orig.data, dst = t.work.data;
      dst.set(src);
      for (const [hx, hy] of holes)
        for (let y = Math.max(0, hy - HOLE_R); y < Math.min(h, hy + HOLE_R); y++)
          for (let x = Math.max(0, hx - HOLE_R); x < Math.min(w, hx + HOLE_R); x++) {
            const d2 = ((x - hx) ** 2 + (y - hy) ** 2) / (HOLE_R * HOLE_R);
            if (d2 >= 1) continue;
            // world-space dither so the pattern stays put while the cat moves
            const strength = HOLE_MAX * (1 - d2) ** 0.7;
            if (bayer(p.x + x, p.y + y) < strength) dst[(y * w + x) * 4 + 3] = 0;
          }
      t.tex.getContext().putImageData(t.work, 0, 0);
      t.tex.refresh();
      t.holed = true;
    }
  }
}

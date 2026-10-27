import Phaser from 'phaser';
import { bayer } from '../art/tiles.ts';
import type { Prop } from '../art/trees.ts';
import type { CatView } from './CatView.ts';
import { cullerFor } from './Culler.ts';

const HOLE_R = 12;
/** Fraction of pixels removed at the centre of the hole; the tree never fully disappears. */
const HOLE_MAX = 0.55;

interface Tree {
  p: Prop;
  tex: Phaser.Textures.CanvasTexture;
  /** The tree as shaded (the hole is cut from a copy of it). */
  orig: ImageData;
  work: ImageData;
  holed: boolean;
  /** Shaded again for another sun: redraw it. */
  dirty: boolean;
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
      cullerFor(scene).add(scene.add.image(p.x, p.y, `tree-${i}`).setOrigin(0).setDepth(p.depthY));
      return { p, tex, orig, work: new ImageData(w, h), holed: false, dirty: true };
    });
  }

  /** Tree i has been shaded for another sun: show it from the next update. */
  relight(i: number, img: ImageData): void {
    const t = this.trees[i];
    t.orig.data.set(img.data);
    t.dirty = true;
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

  /** Open a see-through hole wherever one of these cats is behind a tree in view. */
  update(cats: CatView[], view: Phaser.Geom.Rectangle): void {
    for (const t of this.trees) {
      const { p, orig } = t;
      const w = orig.width, h = orig.height;
      if (p.x + w < view.x || p.x > view.right || p.y > view.bottom || p.y + h < view.y) continue;
      // cats behind this tree (drawn before it: feet above its base, and not up in it) whose body overlaps it
      const holes: [number, number][] = [];
      for (const c of cats) {
        if (c.depth >= p.depthY) continue;
        const hx = Math.round(c.x) - p.x, hy = Math.round(c.y - 8 - c.z) - p.y;
        if (hx < -HOLE_R || hy < -HOLE_R || hx > w + HOLE_R || hy > h + HOLE_R) continue;
        holes.push([hx, hy]);
      }
      if (!t.dirty && !holes.length && !t.holed) continue;
      t.dirty = false;
      t.holed = holes.length > 0;
      const src = orig.data, dst = t.work.data;
      dst.set(src);
      for (const [hx, hy] of holes)
        for (let y = Math.max(0, hy - HOLE_R); y < Math.min(h, hy + HOLE_R); y++)
          for (let x = Math.max(0, hx - HOLE_R); x < Math.min(w, hx + HOLE_R); x++) {
            const d2 = ((x - hx) ** 2 + (y - hy) ** 2) / (HOLE_R * HOLE_R);
            if (d2 >= 1) continue;
            // world-space dither so the pattern stays put while the cat moves
            const strength = HOLE_MAX * (1 - d2) ** 1.2;
            if (bayer(p.x + x, p.y + y) < strength) dst[(y * w + x) * 4 + 3] = 0;
          }
      t.tex.getContext().putImageData(t.work, 0, 0);
      t.tex.refresh();
    }
  }
}

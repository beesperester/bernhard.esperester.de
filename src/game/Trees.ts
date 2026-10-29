import Phaser from 'phaser';
import { bayer } from '../art/tiles.ts';
import { buildProp, relightProp, treeOutline, type Prop } from '../art/trees.ts';
import { Raster } from '../art/raster.ts';
import { sunLight } from '../art/lighting.ts';
import { TREES, treeHolding } from '../world/trees.ts';
import type { CatView } from './CatView.ts';
import { toCanvas } from './textures.ts';

// The park's trees. They are big and there are many, so a tree is only drawn
// while the camera is near it: those in view straight away, those just
// beyond it a few at a time, and the far ones are let go again.
//
// A tree standing in front of your cat (its foot lower down the screen, its
// picture over the cat) fades away as a whole, dithered, together with any
// cat sitting up in it; only the tree your cat is up in stays.

/** Trees this far (px) beyond the view are drawn ahead of the camera... */
const AHEAD = 200;
/** ...and those further off than this are let go. */
const KEEP = 600;
/** At most this long (ms) a frame spends drawing trees that aren't in view yet. */
const BUDGET_MS = 6;
/** The trees are looked up in square cells this big. */
const CELL = 256;
/** A fade takes this long (ms), in this many dithered steps. */
const FADE_MS = 280, STEPS = 8;
/** Room round the cat that a tree in front of it must leave clear (px). */
const CLEAR = 10;

interface Live {
  p: Prop;
  canvas: HTMLCanvasElement;
  tex: Phaser.Textures.CanvasTexture;
  img: Phaser.GameObjects.Image;
  /** The tree as shaded (the fade is cut from a copy of it). */
  orig: ImageData;
  work: ImageData;
  /** How faded it is (0 there .. 1 gone), and the dithered step drawn. */
  fade: number;
  step: number;
  /** Shaded again for another sun: redraw it. */
  dirty: boolean;
}

/** Hears when a tree's picture comes and goes (sunlit rims are drawn round it, for one). */
export interface TreeWatcher {
  added(i: number, p: Prop, canvas: HTMLCanvasElement): void;
  removed(i: number): void;
  /** It is fading out in front of your cat (0 there .. 1 gone). */
  faded(i: number, fade: number): void;
}

export class Trees {
  private readonly scene: Phaser.Scene;
  private readonly live = new Map<number, Live>();
  private readonly cells = new Map<number, number[]>();
  private readonly watchers: TreeWatcher[] = [];

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    TREES.forEach((_, i) => {
      const [x0, y0, x1, y1] = box(i);
      for (let cy = Math.floor(y0 / CELL); cy <= Math.floor(y1 / CELL); cy++)
        for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) {
          const k = cellKey(cx, cy);
          const list = this.cells.get(k);
          if (list) list.push(i);
          else this.cells.set(k, [i]);
        }
    });
  }

  watch(w: TreeWatcher): void {
    this.watchers.push(w);
    for (const [i, t] of this.live) w.added(i, t.p, t.canvas);
  }

  /** Tree i's picture, if it is drawn now. */
  get(i: number): { p: Prop; canvas: HTMLCanvasElement } | undefined {
    return this.live.get(i);
  }

  /** Every tree drawn now. */
  each(f: (i: number, p: Prop, canvas: HTMLCanvasElement) => void): void {
    for (const [i, t] of this.live) f(i, t.p, t.canvas);
  }

  /** Tree i has been shaded for another sun: show it from the next update. */
  relight(i: number, img: ImageData): void {
    const t = this.live.get(i);
    if (!t) return;
    t.orig.data.set(img.data);
    t.dirty = true;
  }

  /** True if a tree's leaves are drawn over world point (x, y) for something whose feet are at feetY. */
  covers(x: number, y: number, feetY: number): boolean {
    for (const i of this.cells.get(cellKey(Math.floor(x / CELL), Math.floor(y / CELL))) ?? []) {
      const t = this.live.get(i);
      if (!t || feetY >= t.p.depthY || t.fade > 0.5) continue;
      const lx = Math.round(x) - t.p.x, ly = Math.round(y) - t.p.y, { orig } = t;
      if (lx < 0 || ly < 0 || lx >= orig.width || ly >= orig.height) continue;
      if (orig.data[(ly * orig.width + lx) * 4 + 3] > 0) return true;
    }
    return false;
  }

  /** How faded tree i is now (0 there .. 1 gone): a cat up in it fades with it. */
  fadeOf(i: number): number {
    return this.live.get(i)?.fade ?? 0;
  }

  /** Draw the trees round the view, let go of the far ones, and fade those in front of `me`. */
  update(me: CatView, view: Phaser.Geom.Rectangle, dt: number): void {
    this.show(view);
    const mine = treeHolding(me.x, me.y, me.z);
    // the cat's body on screen
    const cx = Math.round(me.x), cy = Math.round(me.y - me.z - 7);
    for (const [i, t] of this.live) {
      const { p, orig } = t, w = orig.width, h = orig.height;
      if (p.x + w < view.x || p.x > view.right || p.y > view.bottom || p.y + h < view.y) continue;
      const want = i !== mine && p.depthY > me.y && this.over(t, cx - p.x, cy - p.y) ? 1 : 0;
      t.fade = want > t.fade ? Math.min(want, t.fade + dt / FADE_MS) : Math.max(want, t.fade - dt / FADE_MS);
      const step = Math.round(t.fade * STEPS);
      if (step === t.step && !t.dirty) continue;
      t.step = step;
      t.dirty = false;
      const src = orig.data, dst = t.work.data;
      dst.set(src);
      // world-space dither, so the pattern stays put while the camera moves
      if (step > 0)
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++) if (bayer(p.x + x, p.y + y) < step / STEPS) dst[(y * w + x) * 4 + 3] = 0;
      t.tex.getContext().putImageData(t.work, 0, 0);
      t.tex.refresh();
      t.img.setVisible(step < STEPS);
      for (const w of this.watchers) w.faded(i, step / STEPS);
    }
  }

  /** Whether tree t's leaves (or trunk) are drawn round picture point (x, y). */
  private over(t: Live, x: number, y: number): boolean {
    const { orig } = t, w = orig.width, h = orig.height;
    for (let dy = -CLEAR; dy <= CLEAR; dy += 4)
      for (let dx = -CLEAR; dx <= CLEAR; dx += 4) {
        const px = x + dx, py = y + dy;
        if (px >= 0 && py >= 0 && px < w && py < h && orig.data[(py * w + px) * 4 + 3] > 0) return true;
      }
    return false;
  }

  /** Draw the trees near the view (those in it at once), and let go of the far ones. */
  private show(view: Phaser.Geom.Rectangle): void {
    const near = this.around(view, AHEAD);
    const start = performance.now();
    for (const i of near) {
      if (this.live.has(i)) continue;
      const [x0, y0, x1, y1] = box(i);
      const inView = x1 > view.x && x0 < view.right && y1 > view.y && y0 < view.bottom;
      if (!inView && performance.now() - start > BUDGET_MS) continue;
      this.make(i);
    }
    for (const i of this.live.keys()) {
      const [x0, y0, x1, y1] = box(i);
      if (x1 < view.x - KEEP || x0 > view.right + KEEP || y1 < view.y - KEEP || y0 > view.bottom + KEEP) this.drop(i);
    }
  }

  /** The trees whose pictures reach into `view` grown by `margin` px, nearest the middle first. */
  private around(view: Phaser.Geom.Rectangle, margin: number): number[] {
    const out = new Set<number>();
    for (let cy = Math.floor((view.y - margin) / CELL); cy <= Math.floor((view.bottom + margin) / CELL); cy++)
      for (let cx = Math.floor((view.x - margin) / CELL); cx <= Math.floor((view.right + margin) / CELL); cx++)
        for (const i of this.cells.get(cellKey(cx, cy)) ?? []) {
          const [x0, y0, x1, y1] = box(i);
          if (x1 > view.x - margin && x0 < view.right + margin && y1 > view.y - margin && y0 < view.bottom + margin) out.add(i);
        }
    const mx = view.centerX, my = view.centerY;
    return [...out].sort((a, b) => Math.hypot(TREES[a].x - mx, TREES[a].y - my) - Math.hypot(TREES[b].x - mx, TREES[b].y - my));
  }

  private make(i: number): void {
    const p = buildProp(i);
    // (in the light as it is now)
    relightProp(p, sunLight);
    const canvas = toCanvas(p.raster);
    const { width: w, height: h } = canvas;
    const key = `tree-${i}`;
    const tex = this.scene.textures.createCanvas(key, w, h)!;
    const orig = canvas.getContext('2d')!.getImageData(0, 0, w, h);
    tex.getContext().putImageData(orig, 0, 0);
    tex.refresh();
    const img = this.scene.add.image(p.x, p.y, key).setOrigin(0).setDepth(p.depthY);
    this.live.set(i, { p, canvas, tex, img, orig, work: new ImageData(w, h), fade: 0, step: 0, dirty: false });
    for (const w of this.watchers) w.added(i, p, canvas);
  }

  private drop(i: number): void {
    const t = this.live.get(i)!;
    t.img.destroy();
    this.scene.textures.remove(`tree-${i}`);
    this.live.delete(i);
    for (const w of this.watchers) w.removed(i);
  }
}

/** Tree i's outline (from its plan, not drawn) as a picture: what it hides of a light. */
export function outlineCanvas(i: number): HTMLCanvasElement {
  const { w, h, data } = treeOutline(i);
  const r = new Raster(w, h);
  for (let k = 0; k < data.length; k++) if (data[k]) r.set(k % w, Math.floor(k / w), [255, 255, 255]);
  return toCanvas(r);
}

/** Where tree i's picture is in the world: [x0, y0, x1, y1]. */
function box(i: number): [number, number, number, number] {
  const t = TREES[i], x = t.x - t.w / 2, y = t.y - (t.h - 1) - t.elev;
  return [x, y, x + t.w, y + t.h];
}

const cellKey = (cx: number, cy: number) => (cy + 1) * 4096 + cx + 1;

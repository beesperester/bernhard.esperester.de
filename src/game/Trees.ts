import Phaser from 'phaser';
import { bayer } from '../art/tiles.ts';
import { relightProp, treeOutline, type Prop } from '../art/trees.ts';
import { Raster } from '../art/raster.ts';
import { sunLight, type ScreenLight } from '../art/lighting.ts';
import { TREES, treeHolding } from '../world/trees.ts';
import type { CatView } from './CatView.ts';
import { toCanvas } from './textures.ts';
import type { Painter } from './Painter.ts';
import { holeIn } from './HoleFilter.ts';

// The park's trees. They are big and there are many, so a tree is only drawn
// while the camera is near it, nearest first, by the painter off the main
// thread (Painter.ts); the far ones are let go again.
//
// Each tree is two pictures: the tree from the back (the leaves at the back,
// trunk, branches and the small leaves along them) and the leaves hanging in
// front of the branches, drawn in front of a cat sitting in the tree. Where a
// tree stands in front of your cat, a dithered hole opens in it round your
// cat (and in anything sitting in that tree). Up a tree, it opens round your
// cat as if a ball were round it: wide through the leaves in front, narrower
// through the leaves behind, so you see a little past it too; its trunk and
// branches stay solid (a third picture, of just them, over the tree).

/** Trees this far (px) beyond the view are drawn ahead of the camera... */
const AHEAD = 200;
/** ...and those further off than this are let go. */
const KEEP = 600;
/** The trees are looked up in square cells this big. */
const CELL = 256;
/** A hole opens over this long (ms). */
const FADE_MS = 280;
/** The hole round your cat: this wide (px), clear out to this much of it and dithered beyond. */
const HOLE_R = 80;
export const CLEAR = 0.6;
/** Up a tree, the hole through the tree behind your cat is this much as wide: the far side of the ball round it. */
const BEHIND = 0.45;
/** Above its feet, the middle of a cat. */
const CAT_MID = 8;
/** A front picture is drawn this far in front of its tree (a cat up in it is at +0.6, the birds at +0.5)... */
const FRONT = 0.8;
/** ...and its trunk and branches this far, while your cat is up it. */
const MIDDLE = 0.2;

interface Pic {
  canvas: HTMLCanvasElement;
  tex: Phaser.Textures.CanvasTexture;
  img: Phaser.GameObjects.Image;
  /** The picture as shaded (the hole is cut from what's shown on the GPU: HoleFilter.ts). */
  orig: ImageData;
}

interface Live {
  p: Prop;
  base: Pic;
  front: Pic | null;
  /** Its trunk and branches, while your cat is up it. */
  mid: Pic | null;
  /** How far the hole round your cat is open in it (0..1, it's in front of your cat)... */
  hole: number;
  /** ...or round your cat up it (0..1); and where each picture was cut last. */
  open: number;
  cut: string;
  cutFront: string;
  /** Shaded again for another sun: redraw it. */
  dirty: boolean;
}

/** The hole round your cat: its middle and how wide it is now. */
export interface Hole { x: number; y: number; r: number }

/** How much of a pixel at world (x, y) shows through a hole (0 cut away .. 1 all there). */
export function holeKeeps(h: Hole, x: number, y: number): boolean {
  const d = Math.hypot(x - h.x, y - h.y);
  if (d >= h.r) return true;
  if (d < h.r * CLEAR) return false;
  return bayer(x, y) >= (h.r - d) / (h.r * (1 - CLEAR));
}

/** Hears when a tree's picture comes and goes (sunlit rims are drawn round it, for one). */
export interface TreeWatcher {
  added(i: number, p: Prop, canvas: HTMLCanvasElement): void;
  removed(i: number): void;
  /** The hole round your cat is cut in it (null: no longer). */
  holed(i: number, hole: Hole | null): void;
}

export class Trees {
  private readonly scene: Phaser.Scene;
  private readonly live = new Map<number, Live>();
  private readonly cells = new Map<number, number[]>();
  private readonly watchers: TreeWatcher[] = [];
  private readonly painter: Painter;
  /** Trees asked of the painter and not back yet. */
  private readonly asked = new Set<number>();
  /** The trees with a hole in them this frame, and the hole. */
  private holed: Live[] = [];
  private hole: { x: number; y: number } = { x: 0, y: 0 };
  private view = new Phaser.Geom.Rectangle();

  constructor(scene: Phaser.Scene, painter: Painter) {
    this.scene = scene;
    this.painter = painter;
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
    for (const [i, t] of this.live) w.added(i, t.p, t.base.canvas);
  }

  /** Tree i's pictures, if it is drawn now. */
  get(i: number): { p: Prop; canvas: HTMLCanvasElement; front: HTMLCanvasElement | null } | undefined {
    const t = this.live.get(i);
    return t && { p: t.p, canvas: t.base.canvas, front: t.front?.canvas ?? null };
  }

  /** Every tree drawn now. */
  each(f: (i: number, p: Prop) => void): void {
    for (const [i, t] of this.live) f(i, t.p);
  }

  /** Tree i has been shaded for another sun (relightProp): show it from the next update. */
  relight(i: number): void {
    const t = this.live.get(i);
    if (!t) return;
    for (const [pic, r] of [[t.base, t.p.raster], [t.front, t.p.front?.raster], [t.mid, t.p.mid?.raster]] as const) {
      if (!pic || !r) continue;
      pic.orig.data.set(r.data);
      pic.canvas.getContext('2d')!.putImageData(pic.orig, 0, 0);
    }
    t.dirty = true;
  }

  /** True if a tree's leaves are drawn over world point (x, y) for something whose feet are at feetY. */
  covers(x: number, y: number, feetY: number): boolean {
    for (const i of this.cells.get(cellKey(Math.floor(x / CELL), Math.floor(y / CELL))) ?? []) {
      const t = this.live.get(i);
      if (!t || feetY >= t.p.depthY) continue;
      if (t.hole > 0 && !holeKeeps({ ...this.hole, r: HOLE_R * t.hole }, Math.round(x), Math.round(y))) continue;
      const lx = Math.round(x) - t.p.x, ly = Math.round(y) - t.p.y, { orig } = t.base;
      if (lx < 0 || ly < 0 || lx >= orig.width || ly >= orig.height) continue;
      if (orig.data[(ly * orig.width + lx) * 4 + 3] > 0) return true;
    }
    return false;
  }

  /**
   * How much shows (0..1) of something at world (x, y) drawn at `depth`: up
   * a tree with a hole in it round your cat (drawn just in front of that
   * tree), it is cut away with it.
   */
  seeThrough(x: number, y: number, depth: number): number {
    for (const t of this.holed) {
      if (depth < t.p.depthY || depth >= t.p.depthY + 1) continue;
      const r = HOLE_R * t.hole, d = Math.hypot(x - this.hole.x, y - this.hole.y);
      return Math.max(0, Math.min(1, (d - r * CLEAR) / (r * (1 - CLEAR))));
    }
    return 1;
  }

  /** Draw the trees round the view, let go of the far ones, and open the hole round `me`. */
  update(me: CatView, view: Phaser.Geom.Rectangle, dt: number): void {
    this.view = view;
    this.show(view);
    const mine = treeHolding(me.x, me.y, me.z);
    const hx = Math.round(me.x), hy = Math.round(me.y - me.z - CAT_MID);
    this.hole = { x: hx, y: hy };
    this.holed = [];
    const ease = (v: number, want: number) => (want > v ? Math.min(want, v + dt / FADE_MS) : Math.max(want, v - dt / FADE_MS));
    for (const [i, t] of this.live) {
      const { p } = t, { width: w, height: h } = t.base.orig;
      if (p.x + w < view.x || p.x > view.right || p.y > view.bottom || p.y + h < view.y) continue;
      // in front of our cat (as drawn), and drawn round it
      const ahead = i !== mine && p.depthY > me.depth && this.near(t, hx, hy);
      t.hole = ease(t.hole, ahead ? 1 : 0);
      t.open = ease(t.open, i === mine ? 1 : 0);
      if (t.hole > 0) this.holed.push(t);
      // (in front: the same hole through all of it; up it: wide in front of the cat, narrow behind)
      const r = HOLE_R * Math.max(t.hole, t.open), rb = HOLE_R * Math.max(t.hole, t.open * BEHIND);
      const hole: Hole | null = rb > 0 ? { x: hx, y: hy, r: rb } : null, front: Hole | null = r > 0 ? { x: hx, y: hy, r } : null;
      const cut = hole ? `${hx},${hy},${hole.r.toFixed(1)}` : '', cutFront = front ? `${hx},${hy},${front.r.toFixed(1)}` : '';
      if (t.dirty) for (const pic of [t.base, t.front, t.mid]) if (pic) this.draw(pic);
      if (cut !== t.cut) {
        holeIn(t.base.img, hole, CLEAR);
        for (const wt of this.watchers) wt.holed(i, hole);
      }
      if (t.front && cutFront !== t.cutFront) holeIn(t.front.img, front, CLEAR);
      // (up it, its trunk and branches over the hole in it)
      if (t.open > 0 && !t.mid && p.mid) t.mid = this.pic(`tree-mid-${i}`, p.mid.raster, p.x, p.y, p.depthY + MIDDLE);
      else if (t.open === 0 && t.mid) this.unpic(t, 'mid', `tree-mid-${i}`);
      t.cut = cut;
      t.cutFront = cutFront;
      t.dirty = false;
    }
  }

  /** Show picture `pic` as shaded now. */
  private draw(pic: Pic): void {
    pic.tex.getContext().putImageData(pic.orig, 0, 0);
    pic.tex.refresh();
  }

  /** Whether tree t is drawn round world point (x, y) (within the hole's reach). */
  private near(t: Live, x: number, y: number): boolean {
    for (const pic of [t.base, t.front]) {
      if (!pic) continue;
      const { orig } = pic, w = orig.width, h = orig.height, lx = x - t.p.x, ly = y - t.p.y;
      for (let dy = -HOLE_R * 0.6; dy <= HOLE_R * 0.6; dy += 4)
        for (let dx = -HOLE_R * 0.6; dx <= HOLE_R * 0.6; dx += 4) {
          const px = Math.round(lx + dx), py = Math.round(ly + dy);
          if (px >= 0 && py >= 0 && px < w && py < h && orig.data[(py * w + px) * 4 + 3] > 0) return true;
        }
    }
    return false;
  }

  /** Draw the trees near the view (those in it at once), and let go of the far ones. */
  private show(view: Phaser.Geom.Rectangle): void {
    for (const i of this.around(view, AHEAD)) {
      if (!this.painter.free) break;
      if (this.live.has(i) || this.asked.has(i)) continue;
      this.asked.add(i);
      const lit = { ...sunLight };
      void this.painter.tree(i).then((p) => {
        this.asked.delete(i);
        // (unless the camera has gone on, far enough that it would be let go)
        const [x0, y0, x1, y1] = box(i), v = this.view;
        if (x1 < v.x - KEEP || x0 > v.right + KEEP || y1 < v.y - KEEP || y0 > v.bottom + KEEP) return;
        this.make(i, p, lit);
      });
    }
    for (const i of this.live.keys()) {
      const [x0, y0, x1, y1] = box(i);
      if (x1 < view.x - KEEP || x0 > view.right + KEEP || y1 < view.y - KEEP || y0 > view.bottom + KEEP) this.drop(i);
    }
  }

  /** Whether every tree in `view` is drawn. */
  ready(view: Phaser.Geom.Rectangle): boolean {
    return this.around(view, 0).every((i) => this.live.has(i));
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

  private pic(key: string, r: Raster, x: number, y: number, depth: number): Pic {
    const { w, h } = r;
    const tex = this.scene.textures.createCanvas(key, w, h)!;
    const orig = new ImageData(new Uint8ClampedArray(r.data), w, h);
    tex.getContext().putImageData(orig, 0, 0);
    tex.refresh();
    const canvas = tex.getSourceImage() as HTMLCanvasElement;
    const img = this.scene.add.image(x, y, key).setOrigin(0).setDepth(depth);
    return { canvas, tex, img, orig };
  }

  private unpic(t: Live, which: 'front' | 'mid', key: string): void {
    const pic = t[which];
    if (!pic) return;
    pic.img.destroy();
    this.scene.textures.remove(key);
    t[which] = null;
  }

  /** Show tree i, drawn in light `lit`. */
  private make(i: number, p: Prop, lit: ScreenLight): void {
    // (in the light as it is now: it may have moved on while the tree was being drawn)
    if (lit.x !== sunLight.x || lit.y !== sunLight.y || lit.k !== sunLight.k) relightProp(p, sunLight);
    const base = this.pic(`tree-${i}`, p.raster, p.x, p.y, p.depthY);
    const front = p.front ? this.pic(`tree-front-${i}`, p.front.raster, p.x, p.y, p.depthY + FRONT) : null;
    this.live.set(i, { p, base, front, mid: null, hole: 0, open: 0, cut: '', cutFront: '', dirty: false });
    for (const w of this.watchers) w.added(i, p, base.canvas);
  }

  private drop(i: number): void {
    const t = this.live.get(i)!;
    t.base.img.destroy();
    this.scene.textures.remove(`tree-${i}`);
    this.unpic(t, 'front', `tree-front-${i}`);
    this.unpic(t, 'mid', `tree-mid-${i}`);
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

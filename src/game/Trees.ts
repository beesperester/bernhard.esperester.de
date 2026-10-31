import Phaser from 'phaser';
import { paintedMaps, treeOutline, type LitPixels, type Prop, type Puffs } from '../art/trees.ts';
import { Raster } from '../art/raster.ts';
import { TREES, treeHolding } from '../world/trees.ts';
import type { CatView } from './CatView.ts';
import { toCanvas } from './textures.ts';
import type { Painter } from './Painter.ts';
import { addPainted, paint } from './Painted.ts';
import { CLEAR, kept, reachUp, shows, type Opening } from '../art/fade.ts';

// The park's trees. They are big and there are many, so a tree is only drawn
// while the camera is near it, nearest first, by the painter off the main
// thread (Painter.ts); the far ones are let go again.
//
// Each tree is two pictures: the tree from the back (the leaves at the back,
// trunk, branches and the small leaves along them) and the leaves hanging in
// front of the branches, drawn in front of a cat sitting in the tree. Where a
// tree really hides your cat (its picture is over your cat's, and it stands in
// front), a hole opens in it round your cat, a puff of leaves at a time, and
// the rest of it is dithered thin, so none of it stands solid in front of your
// cat (art/fade.ts; the same goes for anything sitting in it). Up a tree, it opens round your
// cat as if a ball were round it: wide through the leaves in front, narrower
// through the leaves behind, so you see a little past it too; its trunk and
// branches stay solid (a third picture, of just them, over the tree).
//
// The pictures are shaded on the GPU (Painted.ts), in the light as it is each
// frame, their sunlit rims too.

/** Trees this far (px) beyond the view are drawn ahead of the camera... */
const AHEAD = 200;
/** ...and those further off than this are let go. */
const KEEP = 600;
/** The trees are looked up in square cells this big. */
const CELL = 256;
/** A hole opens over this long (ms). */
const FADE_MS = 280;
/** The hole round your cat: this wide (px). */
const HOLE_R = 180;
/** The rest of a tree hiding your cat is dithered this thin (0..1: the part of it left out). */
const REST = 0.5;
/** Your cat's picture, round its feet, for whether a tree hides it: this far either side, and this tall (px)... */
const CAT_HALF = 6, CAT_TALL = 14;
/** ...this much further round, once a tree has opened (so it doesn't flicker at the edge)... */
const CAT_SLACK = 6;
/** ...and it hides it once this many of the points looked at (every 2 px) are under it. */
const HIDES = 3;
/** Above its feet, the middle of a cat. */
const CAT_MID = 8;
/** A front picture is drawn this far in front of its tree (a cat up in it is at +0.6, the birds at +0.5). */
const FRONT = 0.8;

interface Pic {
  /** The picture as shaded when it was drawn... */
  canvas: HTMLCanvasElement;
  img: Phaser.GameObjects.Image;
  /** ...and its pixels (the hole is cut from what's shown on the GPU: game/Cards.ts). */
  orig: ImageData;
}

interface Live {
  p: Prop;
  base: Pic;
  front: Pic | null;
  /** How far the hole round your cat is open in it (0..1, it's in front of your cat)... */
  hole: number;
  /** ...or round your cat up it (0..1); how each picture is cut now, and as what it was cut last. */
  open: number;
  cutBase: Cut | null;
  cutFrontAs: Cut | null;
  cut: string;
  cutFront: string;
  /** The textures of its pictures' puff maps. */
  puffs: string | null;
  frontPuffs: string | null;
}

/** A cut through a tree (game/Cards.ts cuts it so): the hole (null: none), how thin the rest of it is (0..1), and the texture of its puff map, if any. */
export interface Cut { hole: Opening | null; rest: number; puffs: string | null }

const NO_HOLE: Opening = { x: 0, y: 0, r: 0, up: 1 };

/** Hears when a tree's picture comes and goes (sunlit rims are drawn round it, for one). */
export interface TreeWatcher {
  added(i: number, p: Prop, canvas: HTMLCanvasElement): void;
  removed(i: number): void;
  /** It is cut round your cat (null: no longer). */
  holed(i: number, cut: Cut | null): void;
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

  /**
   * True if a tree's leaves are drawn over world point (x, y) for something whose feet are at feetY: a tree in front
   * of it, or (`above` px given) any tree that far or more up from its own foot there (its crown, off the ground).
   */
  covers(x: number, y: number, feetY: number, above = Infinity): boolean {
    for (const i of this.cells.get(cellKey(Math.floor(x / CELL), Math.floor(y / CELL))) ?? []) {
      const t = this.live.get(i);
      if (!t || (feetY >= t.p.depthY && t.p.depthY - y < above)) continue;
      // (its leaves behind its trunk, and those in front of it)
      if (leafAt(t.base, t.cutBase, t.p.puffs ?? null, t.p.x, t.p.y, x, y)) return true;
      if (t.front && leafAt(t.front, t.cutFrontAs, t.p.front?.puffs ?? null, t.p.x, t.p.y, x, y)) return true;
    }
    return false;
  }

  /**
   * How much of world point (x, y) leaves cover (0..1), as covers() asks, but evenly: where a tree is thinned or
   * its hole fades out, part covered rather than dithered.
   */
  coverage(x: number, y: number, feetY: number, above = Infinity): number {
    let open = 1;
    for (const i of this.cells.get(cellKey(Math.floor(x / CELL), Math.floor(y / CELL))) ?? []) {
      const t = this.live.get(i);
      if (!t || (feetY >= t.p.depthY && t.p.depthY - y < above)) continue;
      open *= 1 - leafAmount(t.base, t.cutBase, t.p.puffs ?? null, t.p.x, t.p.y, x, y);
      if (t.front) open *= 1 - leafAmount(t.front, t.cutFrontAs, t.p.front?.puffs ?? null, t.p.x, t.p.y, x, y);
      if (open === 0) break;
    }
    return 1 - open;
  }

  /**
   * How much shows (0..1) of something at world (x, y) drawn at `depth`: up
   * a tree with a hole in it round your cat (drawn just in front of that
   * tree), it is cut away with it.
   */
  seeThrough(x: number, y: number, depth: number): number {
    for (const t of this.holed) {
      if (depth < t.p.depthY || depth >= t.p.depthY + 1 || !t.cutBase) continue;
      const { hole, rest } = t.cutBase, h = hole ?? NO_HOLE, dy = y - h.y;
      const d = Math.hypot(x - h.x, dy < 0 ? (dy * h.r) / h.up : dy);
      return (h.r > 0 ? Math.max(0, Math.min(1, (d - h.r * CLEAR) / (h.r * (1 - CLEAR)))) : 1) * (1 - rest);
    }
    return 1;
  }

  /** Draw the trees round the view, let go of the far ones, and open the hole round `me`. */
  update(me: CatView, view: Phaser.Geom.Rectangle, dt: number): void {
    this.view = view;
    this.show(view);
    const mine = treeHolding(me.x, me.y, me.z);
    const hx = Math.round(me.x), hy = Math.round(me.y - me.z - CAT_MID);
    this.holed = [];
    const ease = (v: number, want: number) => (want > v ? Math.min(want, v + dt / FADE_MS) : Math.max(want, v - dt / FADE_MS));
    for (const [i, t] of this.live) {
      const { p } = t, { width: w, height: h } = t.base.orig;
      if (p.x + w < view.x || p.x > view.right || p.y > view.bottom || p.y + h < view.y) continue;
      // in front of our cat (as drawn), and over it
      const ahead = i !== mine && p.depthY > me.depth && this.hides(t, me.x, me.y - me.z, t.hole > 0);
      t.hole = ease(t.hole, ahead ? 1 : 0);
      t.open = ease(t.open, i === mine ? 1 : 0);
      if (t.hole > 0) this.holed.push(t);
      // (in front: the same hole through all of it, reaching up over what's left of it, and the rest of it thin;
      // up it: wide in front of the cat, and nothing behind it: the leaves behind stay, darker, for the branches to stand out on)
      const r = HOLE_R * Math.max(t.hole, t.open), rb = HOLE_R * t.hole, rest = REST * t.hole;
      const opening = (rr: number): Opening | null => (rr > 0 ? { x: hx, y: hy, r: rr, up: t.hole > 0 ? reachUp(hy, rr, p.y) : rr } : null);
      const base: Cut | null = rb > 0 || rest > 0 ? { hole: opening(rb), rest, puffs: t.puffs } : null;
      const front: Cut | null = r > 0 || rest > 0 ? { hole: opening(r), rest, puffs: t.frontPuffs } : null;
      const key = (c: Cut | null) => (c ? `${c.hole ? `${c.hole.x},${c.hole.y},${c.hole.r.toFixed(1)},${c.hole.up.toFixed(1)}` : ''}/${c.rest.toFixed(2)}` : '');
      const cut = key(base), cutFront = key(front);
      t.cutBase = base;
      t.cutFrontAs = front;
      if (cut !== t.cut) for (const wt of this.watchers) wt.holed(i, base);
      t.cut = cut;
      t.cutFront = cutFront;
    }
  }

  /** Whether tree t's pictures are over your cat's, its feet at world (x, y) (with some slack, once it has opened). */
  private hides(t: Live, x: number, y: number, open: boolean): boolean {
    const pad = open ? CAT_SLACK : 0;
    let n = 0;
    for (const pic of [t.base, t.front]) {
      if (!pic) continue;
      const { orig } = pic, w = orig.width, h = orig.height;
      for (let dy = -CAT_TALL - pad; dy <= pad; dy += 2)
        for (let dx = -CAT_HALF - pad; dx <= CAT_HALF + pad; dx += 2) {
          const px = Math.round(x + dx) - t.p.x, py = Math.round(y + dy) - t.p.y;
          if (px >= 0 && py >= 0 && px < w && py < h && orig.data[(py * w + px) * 4 + 3] > 0 && ++n >= HIDES) return true;
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
      void this.painter.tree(i).then((p) => {
        this.asked.delete(i);
        // (unless the camera has gone on, far enough that it would be let go)
        const [x0, y0, x1, y1] = box(i), v = this.view;
        if (x1 < v.x - KEEP || x0 > v.right + KEEP || y1 < v.y - KEEP || y0 > v.bottom + KEEP) return;
        this.make(i, p);
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

  private pic(key: string, r: Raster, lit: LitPixels | undefined, x: number, y: number, depth: number): Pic {
    const { w, h } = r;
    const orig = new ImageData(new Uint8ClampedArray(r.data), w, h);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d')!.putImageData(orig, 0, 0);
    const { main, normal } = paintedMaps(r, lit);
    addPainted(this.scene, key, main, normal, w, h);
    const img = paint(this.scene.add.image(x, y, key).setOrigin(0).setDepth(depth));
    return { canvas, img, orig };
  }

  /** A puff map as a texture for the GPU (its key; null if there's none, or no leaves in puffs at all). */
  private puffMap(key: string, puffs: Uint8ClampedArray | undefined, r: Raster): string | null {
    if (!puffs || !puffs.some((v, k) => (k & 3) === 3 && v > 0)) return null;
    const tex = this.scene.textures.createCanvas(key, r.w, r.h)!;
    tex.getContext().putImageData(new ImageData(new Uint8ClampedArray(puffs), r.w, r.h), 0, 0);
    tex.refresh();
    return key;
  }

  private unpic(t: Live, which: 'front', key: string): void {
    const pic = t[which];
    if (!pic) return;
    pic.img.destroy();
    this.scene.textures.remove(key);
    t[which] = null;
  }

  /** Show tree i. */
  private make(i: number, p: Prop): void {
    const base = this.pic(`tree-${i}`, p.raster, p.lit, p.x, p.y, p.depthY);
    const front = p.front ? this.pic(`tree-front-${i}`, p.front.raster, p.front.lit, p.x, p.y, p.depthY + FRONT) : null;
    const puffs = this.puffMap(`tree-puffs-${i}`, p.puffs, p.raster), frontPuffs = p.front ? this.puffMap(`tree-front-puffs-${i}`, p.front.puffs, p.front.raster) : null;
    this.live.set(i, { p, base, front, hole: 0, open: 0, cutBase: null, cutFrontAs: null, cut: '', cutFront: '', puffs, frontPuffs });
    for (const w of this.watchers) w.added(i, p, base.canvas);
  }

  private drop(i: number): void {
    const t = this.live.get(i)!;
    t.base.img.destroy();
    this.scene.textures.remove(`tree-${i}`);
    this.unpic(t, 'front', `tree-front-${i}`);
    for (const key of [t.puffs, t.frontPuffs]) if (key) this.scene.textures.remove(key);
    this.live.delete(i);
    for (const w of this.watchers) w.removed(i);
  }
}

/** Whether picture `pic` (placed at px, py; cut as `cut`) shows at world point (x, y). */
function leafAt(pic: Pic, cut: Cut | null, puffs: Puffs | null, px: number, py: number, x: number, y: number): boolean {
  const lx = Math.round(x) - px, ly = Math.round(y) - py, { orig } = pic, k = ly * orig.width + lx;
  if (lx < 0 || ly < 0 || lx >= orig.width || ly >= orig.height || orig.data[k * 4 + 3] === 0) return false;
  return !cut || shows(cut.hole ?? NO_HOLE, cut.rest, Math.round(x), Math.round(y), puffs, k);
}

/** How much of picture `pic` (placed at px, py; cut as `cut`) shows at world point (x, y) (0..1, undithered). */
function leafAmount(pic: Pic, cut: Cut | null, puffs: Puffs | null, px: number, py: number, x: number, y: number): number {
  const lx = Math.round(x) - px, ly = Math.round(y) - py, { orig } = pic, k = ly * orig.width + lx;
  if (lx < 0 || ly < 0 || lx >= orig.width || ly >= orig.height || orig.data[k * 4 + 3] === 0) return 0;
  return cut ? kept(cut.hole ?? NO_HOLE, Math.round(x), Math.round(y), puffs, k) * (1 - cut.rest) : 1;
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

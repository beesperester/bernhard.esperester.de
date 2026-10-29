import Phaser from 'phaser';
import { CAT, framePos } from '../art/cat.ts';
import type { TerrainPiece } from '../art/terrain.ts';
import type { CatView } from './CatView.ts';
import { LEVEL, TILE, WORLD_H, WORLD_W, casterHeight, elevAt, levelAt } from '../world/map.ts';
import type { Light } from '../world/sky.ts';
import type { TreePlan } from '../world/trees.ts';
import { cullerFor } from './Culler.ts';

// Shadows that follow the sun. By day they are cast for real:
//  - terrain, hedges, bushes, rocks, and fences form a height map of the
//    garden, and every ground pixel looks towards the sun to see whether
//    anything rises above the ray (one sweep across the map, sun side first);
//  - trees, lanterns, furniture and cats are flat sprites, so their outlines
//    are projected onto the ground along the sun's direction, each pixel as far
//    as it is high.
// After sunset these fade into soft round shadows under everything.
// The park is big, so all this is only worked out in a window round the
// camera, cast anew when the camera has wandered too near its edge.

const RAD = Math.PI / 180;
/** Long evening shadows are capped at this sun height, so they stay on screen. */
const MIN_EL = 15;
/** The sun's direction is rounded to these steps, so shadows are only recast now and then. */
const AZ_STEP = 3, EL_STEP = 1.5;
const COLOUR = [22, 34, 78];
const ALPHA = 0.32;
/** Cats are this many px tall for their shadows; their feet are on the bottom row. */
const CAT_TOP = CAT - 1;
/** How far a cat reaches in front of and behind its feet, for its shadow. */
const CAT_DEPTH = 2;
/** Room around a cat's shadow for the longest one. */
const CAT_REACH = Math.ceil(CAT * Math.tan((90 - MIN_EL) * RAD)) + 2;
const CELL = CAT + 2 * CAT_REACH;
/** The window shadows are cast in reaches this far (px) beyond the view... */
const WINDOW_MARGIN = 256;
/** The shadows of this many trees are kept, to be laid down again as the window moves. */
const TREE_MARKS = 160;

/** Where a shadow falls on the ground at one level: a box of the world, 1 where it is. */
interface Footprint { x: number; y: number; w: number; h: number; bits: Uint8Array }

/** Runs of shade put down by a caster: each its level, row and first and past-last px (world px). */
class Spans {
  a = new Int32Array(1 << 14);
  n = 0;

  put(l: number, y: number, x0: number, x1: number): void {
    if (x1 <= x0) return;
    if (this.n + 4 > this.a.length) {
      const b = new Int32Array(this.a.length * 2);
      b.set(this.a);
      this.a = b;
    }
    const a = this.a, n = this.n;
    a[n] = l; a[n + 1] = y; a[n + 2] = x0; a[n + 3] = x1;
    this.n = n + 4;
  }
}
const spans = new Spans();

/** Collect what `cast` puts down, for each of `n` levels, into footprints. */
function footprints(n: number, cast: (out: Spans) => void): Footprint[] {
  spans.n = 0;
  cast(spans);
  const { a } = spans, box = Array.from({ length: n }, () => [Infinity, Infinity, -Infinity, -Infinity]);
  for (let i = 0; i < spans.n; i += 4) {
    const b = box[a[i]];
    b[0] = Math.min(b[0], a[i + 2]); b[1] = Math.min(b[1], a[i + 1]); b[2] = Math.max(b[2], a[i + 3]); b[3] = Math.max(b[3], a[i + 1] + 1);
  }
  const out = box.map(([x0, y0, x1, y1]) =>
    x1 < x0 ? { x: 0, y: 0, w: 0, h: 0, bits: new Uint8Array(0) } : { x: x0, y: y0, w: x1 - x0, h: y1 - y0, bits: new Uint8Array((x1 - x0) * (y1 - y0)) });
  for (let i = 0; i < spans.n; i += 4) {
    const f = out[a[i]], row = (a[i + 1] - f.y) * f.w - f.x;
    f.bits.fill(1, row + a[i + 2], row + a[i + 3]);
  }
  return out;
}
/** ...and is moved once the view has come within this of its edge. */
const WINDOW_SLACK = 112;
/** At most this long (ms) a frame spends casting the next window. */
const BUDGET_MS = 3;

/** Something whose outline casts a shadow: a sprite (or part of a sheet) and where its foot is. */
export interface Caster {
  /** Its picture, or (for a tree, which is only drawn near the camera) its plan: its shadow is worked out from its leaf masses and trunk. */
  src: (CanvasImageSource & { width: number; height: number }) | { tree: TreePlan };
  /** Region of `src` to use. */
  sx: number; sy: number; w: number; h: number;
  /** Screen position of the region's top-left corner. */
  x: number; y: number;
  /** Ground-plane y of its foot (the bottom row), and the terrain height it stands on. */
  ground: number; lift: number;
  /** Pixels higher than this count as its top (a table's top is deep, not tall). */
  cap: number;
  /**
   * How deep it is, front to back, as it stands on the ground: px either side
   * of its foot line; or 'round', like a tree, as deep as it is wide at every
   * height. (A flat cut-out would cast a mere line with the sun off to the side.)
   */
  depth: number | 'round';
}

/** A plateau top's shadows, and where they were last drawn (1 a px; null: none). */
interface Overlay { img: Phaser.GameObjects.Image; tex: Phaser.Textures.CanvasTexture; t: TerrainPiece; drawn: Uint8Array | null }

/** A stretch of the ground shadows are worked out over (world px), and all that is worked out for it. */
interface Win {
  ox: number; oy: number; W: number; H: number;
  /** Height of the surface at every ground pixel (terrain plus whatever stands there). */
  height: Float32Array;
  /** Where a shadow falls: the ground, or the top of something drawn standing there (not the bare edges of its tile). */
  floor: Float32Array;
  level: Uint8Array;
  /** Swept: the highest a sunward obstacle reaches above each pixel, minus the ray's rise. */
  sky: Float32Array;
  /** Projected outlines: level + 1 of the ground they fall on, 0 where none. */
  outlines: Uint8Array;
  /** Final: 1 where the ground is in shade. */
  shade: Uint8Array;
  /** Unit ground vector away from the sun, scaled per px of height; and which sun it was cast for. */
  s: [number, number];
  key: string;
}

const emptyWin = (): Win => ({
  ox: 0, oy: 0, W: 0, H: 0, height: new Float32Array(0), floor: new Float32Array(0), level: new Uint8Array(0),
  sky: new Float32Array(0), outlines: new Uint8Array(0), shade: new Uint8Array(0), s: [0, 0], key: '',
});

export class Shadows {
  private readonly scene: Phaser.Scene;
  /** The window shown, and the one the next is cast in (they take turns, so the arrays are reused). */
  private win = emptyWin();
  private spare = emptyWin();
  /** A cast under way, a little each frame (the old shadows stay up meanwhile). */
  private job: Generator<void, void> | null = null;
  private readonly upright: (x: number, y: number) => boolean;
  private readonly ground: Phaser.Textures.CanvasTexture;
  private readonly groundImg: Phaser.GameObjects.Image;
  private readonly overlays: Overlay[] = [];
  /** Each caster with its outline read out once. */
  private readonly casters: (Caster & { alpha: Uint8Array | null; tree: TreePlan | null })[];
  private readonly catAlpha: Uint8Array;
  private readonly catSheetW: number;
  private readonly catFrames = new Map<number, ImageData>();
  /** Where each tree's shadow falls for the sun as it was last cast (most recently used last). */
  private readonly treeMarks = new Map<TreePlan, { key: string; levels: Footprint[] }>();
  private readonly cats = new Map<CatView, { tex: Phaser.Textures.CanvasTexture; img: Phaser.GameObjects.Image; frame: number; key: string }>();
  private readonly blobs: Phaser.GameObjects.Image[] = [];
  private catCount = 0;
  /** 0 at night, 1 in full sun: how strong cast shadows are (soft ones take over as it fades). */
  strength = 0;

  constructor(scene: Phaser.Scene, opts: { terrain: TerrainPiece[]; casters: Caster[]; blobs: { x: number; y: number; w: number; h: number; depth: number }[]; catSheet: HTMLCanvasElement; upright: (x: number, y: number) => boolean }) {
    this.scene = scene;
    this.upright = opts.upright;
    this.casters = opts.casters.map((c) => {
      if ('tree' in c.src) return { ...c, alpha: null, tree: c.src.tree };
      const ctx = scratch(c.w, c.h);
      ctx.clearRect(0, 0, c.w, c.h);
      ctx.drawImage(c.src, c.sx, c.sy, c.w, c.h, 0, 0, c.w, c.h);
      const a = ctx.getImageData(0, 0, c.w, c.h).data;
      const alpha = new Uint8Array(c.w * c.h);
      for (let k = 0; k < alpha.length; k++) alpha[k] = a[k * 4 + 3] > 0 ? 1 : 0;
      return { ...c, alpha, tree: null };
    });

    this.ground = scene.textures.createCanvas('sun-shadows', 1, 1)!;
    this.groundImg = scene.add.image(0, 0, 'sun-shadows').setOrigin(0).setDepth(-99993).setVisible(false);
    for (const [i, t] of opts.terrain.entries()) {
      if (t.stairs) continue;
      const tex = scene.textures.createCanvas(`sun-shadows-${i}`, t.raster.w, TILE)!;
      this.overlays.push({ t, tex, drawn: null, img: cullerFor(scene).add(scene.add.image(t.x, t.y, `sun-shadows-${i}`).setOrigin(0).setDepth(t.depth + 0.001).setVisible(false)) });
    }

    // the cats' outlines (all coats share them)
    const cw = opts.catSheet.width, chh = opts.catSheet.height;
    const a = opts.catSheet.getContext('2d')!.getImageData(0, 0, cw, chh).data;
    this.catSheetW = cw;
    this.catAlpha = new Uint8Array(cw * chh);
    for (let k = 0; k < this.catAlpha.length; k++) this.catAlpha[k] = a[k * 4 + 3] > 0 ? 1 : 0;

    // soft round shadows for the night
    const blob = document.createElement('canvas');
    blob.width = 64;
    blob.height = 64;
    const g = blob.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, `rgba(${COLOUR},1)`);
    grad.addColorStop(0.55, `rgba(${COLOUR},0.7)`);
    grad.addColorStop(1, `rgba(${COLOUR},0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    scene.textures.addCanvas('blob', blob);
    for (const b of opts.blobs)
      this.blobs.push(cullerFor(scene).add(scene.add.image(b.x, b.y, 'blob').setDisplaySize(b.w, b.h).setDepth(b.depth).setAlpha(0)));
  }

  /** How shaded the ground under (x, y) is right now, 0..1, for darkening cats standing there. */
  shadeAt(x: number, y: number): number {
    const w = this.win, px = Math.round(x) - w.ox, py = Math.round(y) - w.oy;
    if (px < 0 || py < 0 || px >= w.W || py >= w.H) return 0;
    return w.shade[py * w.W + px] * this.strength;
  }

  /** `overcast` (0..1): rain clouds soften the shadows away. `view`: the part of the world on screen. */
  update(light: Light, cats: CatView[], overcast: number, view: Phaser.Geom.Rectangle): void {
    const el = light.elevation;
    this.strength = Math.max(0, Math.min(1, el / 10)) * (1 - overcast * 0.85);
    const sun = this.strength > 0.01;
    if (sun) {
      const key = `${Math.round(light.azimuth / AZ_STEP)}:${Math.round(Math.min(el, 70) / EL_STEP)}`;
      const w = this.win, s = WINDOW_SLACK;
      const inside = view.x - s >= w.ox && view.y - s >= w.oy && view.right + s <= w.ox + w.W && view.bottom + s <= w.oy + w.H;
      if (!this.job && (key !== w.key || !inside)) {
        this.job = this.recast(view, light.azimuth, Math.max(MIN_EL, Math.min(el, 70)), key);
        // (the first time, there's nothing to show meanwhile)
        if (!w.key) while (!this.job.next().done);
      }
      const start = performance.now();
      while (this.job && performance.now() - start < BUDGET_MS) if (this.job.next().done) this.job = null;
    }
    const a = ALPHA * this.strength;
    this.groundImg.setVisible(sun).setAlpha(a);
    for (const o of this.overlays) o.img.setVisible(sun).setAlpha(a);
    const soft = 0.08 + 0.42 * (1 - this.strength);
    for (const b of this.blobs) b.setAlpha(soft);
    this.updateCats(cats, sun, a);
  }

  // ---------------------------------------------------------------- casting

  /** Cast the shadows anew in a window round `view`, a slice at a time, then show them. */
  private *recast(view: Phaser.Geom.Rectangle, azimuth: number, elevation: number, key: string): Generator<void, void> {
    const w = this.spare;
    yield* this.place(w, view);
    const A = azimuth * RAD, rise = Math.tan(elevation * RAD);
    // towards the sun on the ground (x right, y down the screen), and the shadow per px of height
    const gx = Math.sin(A), gy = -Math.cos(A);
    w.s = [-gx / rise, -gy / rise];
    w.key = key;
    yield* this.sweep(w, gx, gy, rise);
    yield* this.project(w);
    const { W, H, ox, oy, floor, sky, outlines, level, shade } = w;
    for (let i = 0; i < shade.length; i++) shade[i] = sky[i] > floor[i] + 0.5 || outlines[i] === level[i] + 1 ? 1 : 0;
    yield;

    // the lawn...
    const img = new ImageData(W, H);
    const d = img.data;
    for (let i = 0; i < shade.length; i++)
      if (shade[i] && level[i] === 0) { d[i * 4] = COLOUR[0]; d[i * 4 + 1] = COLOUR[1]; d[i * 4 + 2] = COLOUR[2]; d[i * 4 + 3] = 255; }
    yield;
    // ...and the tops of the plateaus, which are drawn lifted (those in the window, and those to be wiped),
    // where they've changed (as the window moves on, most haven't)
    const tops: [Overlay, Uint8Array | null][] = [];
    let looked = 0;
    for (const o of this.overlays) {
      const { t } = o, lift = t.level * LEVEL;
      if (t.x + t.raster.w <= ox || t.x >= ox + W || t.y + lift + TILE <= oy || t.y + lift >= oy + H) {
        if (o.drawn) tops.push([o, null]);
        continue;
      }
      const top = new Uint8Array(t.raster.w * TILE);
      let any = false;
      for (let y = 0; y < TILE; y++)
        for (let x = 0; x < t.raster.w; x++) {
          if (!t.raster.isSet(x, y)) continue;
          const wx = t.x + x - ox, wy = t.y + y + lift - oy;
          if (wx < 0 || wy < 0 || wx >= W || wy >= H) continue;
          const i = wy * W + wx;
          if (!shade[i] || level[i] !== t.level) continue;
          top[y * t.raster.w + x] = 1;
          any = true;
        }
      if (any ? !o.drawn || !same(top, o.drawn) : o.drawn) tops.push([o, any ? top : null]);
      if (++looked % 16 === 0) yield;
    }

    // show them all at once
    if (this.ground.width !== W || this.ground.height !== H) {
      this.ground.setSize(W, H);
      this.groundImg.setTexture('sun-shadows');
    }
    this.ground.getContext().putImageData(img, 0, 0);
    this.ground.refresh();
    this.groundImg.setPosition(ox, oy);
    this.spare = this.win;
    this.win = w;
    this.catFrames.clear();
    // (the tops a few at a time: each is a picture of its own, and sending many at once stalls a frame)
    for (const [n, [o, top]] of tops.entries()) {
      const { w: tw } = o.t.raster, img = new ImageData(tw, TILE);
      if (top)
        for (let i = 0; i < top.length; i++)
          if (top[i]) { img.data[i * 4] = COLOUR[0]; img.data[i * 4 + 1] = COLOUR[1]; img.data[i * 4 + 2] = COLOUR[2]; img.data[i * 4 + 3] = 255; }
      o.tex.getContext().putImageData(img, 0, 0);
      o.tex.refresh();
      o.drawn = top;
      if (n % 8 === 7) yield;
    }
  }

  /** Put window `w` round `view`, and read the height of everything in it. */
  private *place(w: Win, view: Phaser.Geom.Rectangle): Generator<void, void> {
    const M = WINDOW_MARGIN;
    const x0 = Math.max(0, Math.floor((view.x - M) / TILE) * TILE), y0 = Math.max(0, Math.floor((view.y - M) / TILE) * TILE);
    const x1 = Math.min(WORLD_W, Math.ceil((view.right + M) / TILE) * TILE), y1 = Math.min(WORLD_H, Math.ceil((view.bottom + M) / TILE) * TILE);
    const W = x1 - x0, H = y1 - y0, n = W * H;
    w.ox = x0;
    w.oy = y0;
    if (W !== w.W || H !== w.H) {
      w.W = W;
      w.H = H;
      w.height = new Float32Array(n);
      w.floor = new Float32Array(n);
      w.level = new Uint8Array(n);
      w.sky = new Float32Array(n);
      w.outlines = new Uint8Array(n);
      w.shade = new Uint8Array(n);
    }
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const wx = x0 + x, wy = y0 + y;
        const l = levelAt(Math.floor(wx / TILE), Math.floor(wy / TILE));
        w.level[y * W + x] = l;
        const h = l * LEVEL + casterHeight(wx, wy);
        w.height[y * W + x] = h;
        // a rock is round but blocks the sun over its whole tile: the lawn round it still takes its shadow
        w.floor[y * W + x] = this.upright(wx, wy) ? h : l * LEVEL;
      }
      if (y % 64 === 63) yield;
    }
  }

  /**
   * For every pixel, how high the tallest obstacle between it and the sun
   * reaches above the ray: a pixel is in shade where that is above its own
   * height. Each pixel only needs its neighbour one step towards the sun, so
   * one pass from the sunny edge of the window does it.
   */
  private *sweep(w: Win, gx: number, gy: number, rise: number): Generator<void, void> {
    const { W, H, height, sky } = w;
    const alongX = Math.abs(gx) >= Math.abs(gy);
    // one step: a whole pixel along the main axis, a fraction along the other
    const main = alongX ? Math.sign(gx) : Math.sign(gy);
    const side = alongX ? gy / Math.abs(gx) : gx / Math.abs(gy);
    const drop = rise * Math.hypot(1, side);
    const lines = alongX ? W : H, across = alongX ? H : W;
    const at = (line: number, k: number) => (alongX ? k * W + line : line * W + k);
    const top = (i: number) => Math.max(height[i], sky[i]);
    for (let n = 0; n < lines; n++) {
      // start on the sun's side
      const line = main > 0 ? lines - 1 - n : n;
      const prev = line + main;
      for (let k = 0; k < across; k++) {
        const i = at(line, k);
        if (prev < 0 || prev >= lines) { sky[i] = -1e9; continue; }
        const f = k + side, k0 = Math.floor(f), u = f - k0;
        const a = k0 >= 0 && k0 < across ? top(at(prev, k0)) : -1e9;
        const b = k0 + 1 >= 0 && k0 + 1 < across ? top(at(prev, k0 + 1)) : -1e9;
        // off the window counts as nothing in the way
        const v = u < 1e-6 || b === -1e9 ? a : a === -1e9 ? b : a + (b - a) * u;
        sky[i] = v - drop;
      }
      if (n % 96 === 95) yield;
    }
  }

  /**
   * Lay each sprite's outline on the ground, away from the sun. The ground
   * isn't flat: a ray from a pixel h above the caster's foot reaches higher
   * terrain sooner, so for every terrain level it lands at a different spot,
   * and it counts where the ground there really is at that level. (So a
   * tree's shadow runs on up a slope, or down off a plateau, instead of
   * stopping at the edge.)
   */
  private *project(w: Win): Generator<void, void> {
    const { W, H, ox, oy } = w, out = w.outlines, level = w.level;
    out.fill(0);
    const [sx, sy] = w.s;
    const steps = Math.ceil(Math.hypot(sx, sy)) + 1;
    let levels = 0;
    for (let i = 0; i < level.length; i++) if (level[i] > levels) levels = level[i];
    /** Shade the ground at level l at (px, py), if that's where the ground there is. */
    const mark = (px: number, py: number, l: number) => {
      px -= ox;
      py -= oy;
      if (px < 0 || py < 0 || px >= W || py >= H) return;
      const i = py * W + px;
      if (level[i] === l) out[i] = l + 1;
    };
    const per = Math.hypot(sx, sy);
    let done = 0;
    for (const c of this.casters) {
      // (only those whose shadow can reach the window)
      const reach = (c.h + c.lift) * per + 4 + (c.depth === 'round' ? c.w : c.depth);
      if (c.x + c.w + reach < ox || c.x - reach > ox + W || Math.max(c.y + c.h, c.ground) + reach < oy || c.y - reach > oy + H) continue;
      // (a tree's shadow takes a few ms: one at a time)
      if (c.tree) {
        const k = `${w.key}:${levels}`;
        let marks = this.treeMarks.get(c.tree);
        if (marks?.key !== k) {
          yield;
          marks = { key: k, levels: footprints(levels + 1, (out) => this.projectTree(c.tree!, c.lift, w.s, levels, out)) };
          this.treeMarks.delete(c.tree);
          this.treeMarks.set(c.tree, marks);
          if (this.treeMarks.size > TREE_MARKS) this.treeMarks.delete(this.treeMarks.keys().next().value!);
        }
        marks.levels.forEach((f, l) => {
          for (let y = 0; y < f.h; y++)
            for (let x = 0; x < f.w; x++) if (f.bits[y * f.w + x]) mark(f.x + x, f.y + y, l);
        });
        continue;
      }
      if (++done % 24 === 0) yield;
      const alpha = c.alpha!;
      const foot = c.y + c.h - 1; // screen y of the bottom row
      if (c.depth === 'round') { this.projectRound(c, alpha, w.s, steps, levels, mark); continue; }
      const deep = c.depth;
      for (let y = 0; y < c.h; y++)
        for (let x = 0; x < c.w; x++) {
          if (!alpha[y * c.w + x]) continue;
          const h0 = Math.min(c.cap, foot - (c.y + y));
          // smear each pixel over its one-pixel slice of height, so long shadows have no gaps
          for (let k = 0; k < steps; k++)
            for (let l = 0; l <= levels; l++) {
              // how high the pixel is above ground at level l
              const h = h0 + k / steps + c.lift - l * LEVEL;
              if (h < 0) break;
              const px = Math.round(c.x + x + sx * h), py = Math.round(c.ground + sy * h);
              // (and over its depth, front to back)
              for (let d = -deep; d <= deep; d++) mark(px, py + d, l);
            }
        }
    }
  }

  /**
   * A tree's shadow, from its plan: each mass of leaves is a ball (as deep as
   * it is wide), whose shadow along the sun's rays is an ellipse on the
   * ground; the trunk a column of discs, each bough a bar. Put down a row at
   * a time.
   */
  private projectTree(t: TreePlan, lift: number, [sx, sy]: [number, number], levels: number, out: Spans): void {
    let top = 0;
    for (const p of t.perches) top = Math.max(top, p.z0, p.z1);
    for (let l = 0; l <= levels; l++) {
      // (the tree's foot this high above the ground at level l)
      const base = lift - l * LEVEL;
      for (const b of t.crown) {
        const zc = b.z + base, { rx, rz } = b;
        if (zc + rz < 0) continue;
        // a ground point (u, v) from under the ball is shaded if some point of the ball is on the ray
        // through it: the ray at height Z is (u - sx Z, v - sy Z, Z), and in the ball's own measure
        // it's AZ² - 2BZ + C from the middle, nearest at Z = B / A (or the ground, if that's below it)
        const ia = 1 / (rx * rx), ib = 1 / (rz * rz), A = (sx * sx + sy * sy) * ia + ib;
        const z0 = Math.max(0, zc - rz), z1 = zc + rz;
        const v0 = Math.floor(Math.min(sy * z0, sy * z1) - rx), v1 = Math.ceil(Math.max(sy * z0, sy * z1) + rx);
        const cx = Math.round(t.x + b.x), cy = t.y;
        // (where the ball meets the ground, if it does: a disc this wide)
        const foot = (1 - zc * zc * ib) / ia;
        for (let v = v0; v <= v1; v++) {
          // the ray comes within the ball where A·C - B² <= A: a quadratic in u, so a run from root to root
          const k = sy * v * ia + zc * ib;
          const qa = ia * (sy * sy * ia + ib), qb = -2 * sx * ia * k, qc = A * (v * v * ia + zc * zc * ib - 1) - k * k;
          const disc = qb * qb - 4 * qa * qc;
          if (disc < 0) continue;
          const root = Math.sqrt(disc);
          let u0 = Math.ceil((-qb - root) / (2 * qa)), u1 = Math.floor((-qb + root) / (2 * qa));
          if (u1 < u0) continue;
          // ...but where B < 0 the nearest point is the ground itself, shaded only under the ball's foot
          const r2 = foot - v * v, half = r2 >= 0 ? Math.floor(Math.sqrt(r2)) : -1;
          if (sx === 0) {
            if (k < 0) { u0 = Math.max(u0, -half); u1 = Math.min(u1, half); }
            out.put(l, cy + v, cx + u0, cx + u1 + 1);
            continue;
          }
          // (B = sx·u·ia + k, so it's >= 0 on one side of this u)
          const ut = -k / (sx * ia);
          const [s0, s1] = sx > 0 ? [Math.max(u0, Math.ceil(ut)), u1] : [u0, Math.min(u1, Math.floor(ut))];
          out.put(l, cy + v, cx + s0, cx + s1 + 1);
          const [o0, o1] = sx > 0 ? [u0, Math.min(u1, s0 - 1)] : [Math.max(u0, s1 + 1), u1];
          out.put(l, cy + v, cx + Math.max(o0, -half), cx + Math.min(o1, half) + 1);
        }
      }
      // the trunk, thinning as it goes up (a disc every px of height, which is plenty)
      for (let z = Math.max(0, -base); z < top; z++) {
        const h = z + base, r = Math.max(2, t.trunk - (z / top) * (t.trunk - 2));
        const ox = t.x + sx * h, oy = t.y + sy * h;
        for (let dy = -Math.floor(r); dy <= r; dy++) {
          const half = Math.sqrt(Math.max(0, r * r - dy * dy));
          out.put(l, Math.round(oy + dy), Math.round(ox - half), Math.round(ox + half));
        }
      }
      for (const p of t.perches) {
        const h = (p.z0 + p.z1) / 2 + base;
        if (h < 0 || p.kind === 'stump') continue;
        const x0 = Math.round(t.x + p.x0 + sx * h), y = Math.round(t.y + sy * h);
        for (let d = -1; d <= 1; d++) out.put(l, y + d, x0, x0 + Math.round(p.x1 - p.x0));
      }
    }
  }

  /**
   * A round thing's shadow: every run of pixels across a row of its outline is
   * taken as a disc lying level at that height (a slice through the crown),
   * and its shadow is that disc, moved along the sun's rays down to the ground.
   */
  private projectRound(c: Caster, alpha: Uint8Array, [sx, sy]: [number, number], steps: number, levels: number, mark: (px: number, py: number, l: number) => void): void {
    const foot = c.y + c.h - 1;
    for (let y = 0; y < c.h; y++) {
      const h0 = Math.min(c.cap, foot - (c.y + y));
      for (let x = 0; x < c.w; ) {
        while (x < c.w && !alpha[y * c.w + x]) x++;
        const a = x;
        while (x < c.w && alpha[y * c.w + x]) x++;
        if (x === a) break;
        const r = (x - a) / 2, mid = c.x + a + r;
        // small discs get smeared over the row's slice of height, so they leave no gaps
        const sub = r * 2 < steps ? steps : 1;
        for (let k = 0; k < sub; k++)
          for (let l = 0; l <= levels; l++) {
            const h = h0 + k / sub + c.lift - l * LEVEL;
            if (h < 0) break;
            const ox = mid + sx * h, oy = c.ground + sy * h;
            for (let dy = -Math.floor(r); dy <= r; dy++) {
              const half = Math.sqrt(Math.max(0, r * r - dy * dy));
              const py = Math.round(oy + dy);
              for (let px = Math.round(ox - half); px < Math.round(ox + half); px++) mark(px, py, l);
            }
          }
      }
    }
  }

  // ---------------------------------------------------------------- cats

  /** A cat frame's shadow for the current sun, centred on its feet. */
  private catFrame(frame: number): ImageData {
    let img = this.catFrames.get(frame);
    if (img) return img;
    img = new ImageData(CELL, CELL);
    const [sx, sy] = this.win.s;
    const steps = Math.ceil(Math.hypot(sx, sy)) + 1;
    const c = CELL / 2, [x0, y0] = framePos(frame), w = this.catSheetW;
    for (let y = 0; y < CAT; y++)
      for (let x = 0; x < CAT; x++) {
        if (!this.catAlpha[(y0 + y) * w + x0 + x]) continue;
        for (let k = 0; k < steps; k++) {
          const h = CAT_TOP - y + k / steps;
          const px = Math.round(c + x - CAT / 2 + sx * h), py0 = Math.round(c + sy * h);
          // a cat is a few px deep, front to back
          for (let py = py0 - CAT_DEPTH; py <= py0 + CAT_DEPTH; py++) {
            if (px < 0 || py < 0 || px >= CELL || py >= CELL) continue;
            const i = (py * CELL + px) * 4;
            img.data[i] = COLOUR[0]; img.data[i + 1] = COLOUR[1]; img.data[i + 2] = COLOUR[2]; img.data[i + 3] = 255;
          }
        }
      }
    this.catFrames.set(frame, img);
    return img;
  }

  private updateCats(cats: CatView[], sun: boolean, alpha: number): void {
    for (const cat of cats) {
      let s = this.cats.get(cat);
      if (!s) {
        const key = `cat-shadow-${this.catCount++}`;
        const tex = this.scene.textures.createCanvas(key, CELL, CELL)!;
        s = { tex, img: this.scene.add.image(0, 0, key).setOrigin(0.5), frame: -1, key: '' };
        this.cats.set(cat, s);
      }
      s.img.setVisible(sun);
      if (!sun) continue;
      if (s.frame !== cat.frame || s.key !== this.win.key) {
        s.frame = cat.frame;
        s.key = this.win.key;
        s.tex.getContext().putImageData(this.catFrame(cat.frame), 0, 0);
        s.tex.refresh();
      }
      // a jumping cat's shadow slides away from it; on a ledge it lies on the ledge
      const elev = elevAt(cat.x, cat.y), up = cat.z - elev;
      const [sx, sy] = this.win.s;
      s.img.setPosition(Math.round(cat.x + sx * up), Math.round(cat.y + sy * up - elev)).setAlpha(alpha)
        .setDepth(elev > 0 ? Math.floor(cat.y / TILE) * TILE + 0.0015 : -99992);
    }
    for (const [cat, s] of this.cats)
      if (!cats.includes(cat)) {
        s.img.destroy();
        s.tex.destroy();
        this.cats.delete(cat);
      }
  }
}

const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

let scratchCanvas: HTMLCanvasElement | null = null;
function scratch(w: number, h: number): CanvasRenderingContext2D {
  scratchCanvas ??= document.createElement('canvas');
  if (scratchCanvas.width < w) scratchCanvas.width = w;
  if (scratchCanvas.height < h) scratchCanvas.height = h;
  return scratchCanvas.getContext('2d', { willReadFrequently: true })!;
}

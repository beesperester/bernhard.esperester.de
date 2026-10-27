import Phaser from 'phaser';
import { CAT } from '../art/cat.ts';
import type { TerrainPiece } from '../art/terrain.ts';
import type { CatView } from './CatView.ts';
import { LEVEL, TILE, WORLD_H, WORLD_W, casterHeight, elevAt, levelAt } from '../world/map.ts';
import type { Light } from '../world/sky.ts';
import { cullerFor } from './Culler.ts';

// Shadows that follow the sun. By day they are cast for real:
//  - terrain, hedges, bushes, rocks, fences and the shed form a height map of the
//    garden, and every ground pixel looks towards the sun to see whether
//    anything rises above the ray (one sweep across the map, sun side first);
//  - trees, lanterns, furniture and cats are flat sprites, so their outlines
//    are projected onto the ground along the sun's direction, each pixel as far
//    as it is high.
// After sunset these fade into soft round shadows under everything.

const RAD = Math.PI / 180;
/** Long evening shadows are capped at this sun height, so they stay on screen. */
const MIN_EL = 15;
/** The sun's direction is rounded to these steps, so shadows are only recast now and then. */
const AZ_STEP = 3, EL_STEP = 1.5;
const COLOUR = [22, 34, 78];
const ALPHA = 0.32;
/** Cats are this many px tall for their shadows; their feet are on the bottom row. */
const CAT_TOP = CAT - 1;
/** Room around a cat's shadow for the longest one. */
const CAT_REACH = Math.ceil(CAT * Math.tan((90 - MIN_EL) * RAD)) + 2;
const CELL = CAT + 2 * CAT_REACH;

/** Something whose outline casts a shadow: a sprite (or part of a sheet) and where its foot is. */
export interface Caster {
  src: CanvasImageSource & { width: number; height: number };
  /** Region of `src` to use. */
  sx: number; sy: number; w: number; h: number;
  /** Screen position of the region's top-left corner. */
  x: number; y: number;
  /** Ground-plane y of its foot (the bottom row), and the terrain height it stands on. */
  ground: number; lift: number;
  /** Pixels higher than this count as its top (a table's top is deep, not tall). */
  cap: number;
}

interface Overlay { img: Phaser.GameObjects.Image; tex: Phaser.Textures.CanvasTexture; t: TerrainPiece }

export class Shadows {
  private readonly scene: Phaser.Scene;
  /** Height of the surface at every ground pixel (terrain plus whatever stands there). */
  private readonly height: Float32Array;
  private readonly level: Uint8Array;
  /** Swept: the highest a sunward obstacle reaches above each pixel, minus the ray's rise. */
  private readonly sky: Float32Array;
  /** Projected outlines: level + 1 of the ground they fall on, 0 where none. */
  private readonly outlines: Uint8Array;
  /** Final: 1 where the ground is in shade. */
  private readonly shade: Uint8Array;
  private readonly ground: Phaser.Textures.CanvasTexture;
  private readonly groundImg: Phaser.GameObjects.Image;
  private readonly overlays: Overlay[] = [];
  /** Each caster with its outline read out once. */
  private readonly casters: (Caster & { alpha: Uint8Array })[];
  private readonly catAlpha: Uint8Array;
  private readonly catSheetW: number;
  private readonly catFrames = new Map<number, ImageData>();
  private readonly cats = new Map<CatView, { tex: Phaser.Textures.CanvasTexture; img: Phaser.GameObjects.Image; frame: number; key: string }>();
  private readonly blobs: Phaser.GameObjects.Image[] = [];
  private key = '';
  private catCount = 0;
  /** Unit ground vector away from the sun, scaled per px of height. */
  private s: [number, number] = [0, 0];
  /** 0 at night, 1 in full sun: how strong cast shadows are (soft ones take over as it fades). */
  strength = 0;

  constructor(scene: Phaser.Scene, opts: { terrain: TerrainPiece[]; casters: Caster[]; blobs: { x: number; y: number; w: number; h: number; depth: number }[]; catSheet: HTMLCanvasElement }) {
    this.scene = scene;
    const W = WORLD_W, H = WORLD_H, n = W * H;
    this.height = new Float32Array(n);
    this.level = new Uint8Array(n);
    this.sky = new Float32Array(n);
    this.outlines = new Uint8Array(n);
    this.shade = new Uint8Array(n);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const l = levelAt(Math.floor(x / TILE), Math.floor(y / TILE));
        this.level[y * W + x] = l;
        this.height[y * W + x] = l * LEVEL + casterHeight(x, y);
      }
    this.casters = opts.casters.map((c) => {
      const ctx = scratch(c.w, c.h);
      ctx.clearRect(0, 0, c.w, c.h);
      ctx.drawImage(c.src, c.sx, c.sy, c.w, c.h, 0, 0, c.w, c.h);
      const a = ctx.getImageData(0, 0, c.w, c.h).data;
      const alpha = new Uint8Array(c.w * c.h);
      for (let k = 0; k < alpha.length; k++) alpha[k] = a[k * 4 + 3] > 0 ? 1 : 0;
      return { ...c, alpha };
    });

    this.ground = scene.textures.createCanvas('sun-shadows', W, H)!;
    this.groundImg = scene.add.image(0, 0, 'sun-shadows').setOrigin(0).setDepth(-99993).setVisible(false);
    for (const [i, t] of opts.terrain.entries()) {
      if (t.stairs) continue;
      const tex = scene.textures.createCanvas(`sun-shadows-${i}`, t.raster.w, TILE)!;
      this.overlays.push({ t, tex, img: cullerFor(scene).add(scene.add.image(t.x, t.y, `sun-shadows-${i}`).setOrigin(0).setDepth(t.depth + 0.001).setVisible(false)) });
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
    const px = Math.round(x), py = Math.round(y);
    if (px < 0 || py < 0 || px >= WORLD_W || py >= WORLD_H) return 0;
    return this.shade[py * WORLD_W + px] * this.strength;
  }

  /** `overcast` (0..1): rain clouds soften the shadows away. */
  update(light: Light, cats: CatView[], overcast = 0): void {
    const el = light.elevation;
    this.strength = Math.max(0, Math.min(1, el / 10)) * (1 - overcast * 0.85);
    const sun = this.strength > 0.01;
    if (sun) {
      const key = `${Math.round(light.azimuth / AZ_STEP)}:${Math.round(Math.min(el, 70) / EL_STEP)}`;
      if (key !== this.key) {
        this.key = key;
        this.cast(light.azimuth, Math.max(MIN_EL, Math.min(el, 70)));
      }
    }
    const a = ALPHA * this.strength;
    this.groundImg.setVisible(sun).setAlpha(a);
    for (const o of this.overlays) o.img.setVisible(sun).setAlpha(a);
    const soft = 0.08 + 0.42 * (1 - this.strength);
    for (const b of this.blobs) b.setAlpha(soft);
    this.updateCats(cats, sun, a);
  }

  // ---------------------------------------------------------------- casting

  private cast(azimuth: number, elevation: number): void {
    const W = WORLD_W, H = WORLD_H;
    const A = azimuth * RAD, rise = Math.tan(elevation * RAD);
    // towards the sun on the ground (x right, y down the screen), and the shadow per px of height
    const gx = Math.sin(A), gy = -Math.cos(A);
    this.s = [-gx / rise, -gy / rise];
    this.sweep(gx, gy, rise);
    this.project();
    const { height, sky, outlines, level, shade } = this;
    for (let i = 0; i < shade.length; i++) shade[i] = sky[i] > height[i] + 0.5 || outlines[i] === level[i] + 1 ? 1 : 0;

    // the lawn...
    const img = new ImageData(W, H);
    const d = img.data;
    for (let i = 0; i < shade.length; i++)
      if (shade[i] && level[i] === 0) { d[i * 4] = COLOUR[0]; d[i * 4 + 1] = COLOUR[1]; d[i * 4 + 2] = COLOUR[2]; d[i * 4 + 3] = 255; }
    this.ground.getContext().putImageData(img, 0, 0);
    this.ground.refresh();
    // ...and the tops of the plateaus, which are drawn lifted
    for (const { t, tex } of this.overlays) {
      const o = new ImageData(t.raster.w, TILE);
      const lift = t.level * LEVEL;
      for (let y = 0; y < TILE; y++)
        for (let x = 0; x < t.raster.w; x++) {
          if (!t.raster.isSet(x, y)) continue;
          const wx = t.x + x, wy = t.y + y + lift;
          if (wx < 0 || wy < 0 || wx >= W || wy >= H) continue;
          const i = wy * W + wx;
          if (!shade[i] || level[i] !== t.level) continue;
          const k = (y * t.raster.w + x) * 4;
          o.data[k] = COLOUR[0]; o.data[k + 1] = COLOUR[1]; o.data[k + 2] = COLOUR[2]; o.data[k + 3] = 255;
        }
      tex.getContext().putImageData(o, 0, 0);
      tex.refresh();
    }
    this.catFrames.clear();
  }

  /**
   * For every pixel, how high the tallest obstacle between it and the sun
   * reaches above the ray: a pixel is in shade where that is above its own
   * height. Each pixel only needs its neighbour one step towards the sun, so
   * one pass from the sunny edge of the map does it.
   */
  private sweep(gx: number, gy: number, rise: number): void {
    const W = WORLD_W, H = WORLD_H, { height, sky } = this;
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
        // off the map counts as nothing in the way
        const v = u < 1e-6 || b === -1e9 ? a : a === -1e9 ? b : a + (b - a) * u;
        sky[i] = v - drop;
      }
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
  private project(): void {
    const W = WORLD_W, H = WORLD_H, out = this.outlines, level = this.level;
    out.fill(0);
    const [sx, sy] = this.s;
    const steps = Math.ceil(Math.hypot(sx, sy)) + 1;
    let levels = 0;
    for (let i = 0; i < level.length; i++) if (level[i] > levels) levels = level[i];
    for (const c of this.casters) {
      const foot = c.y + c.h - 1; // screen y of the bottom row
      for (let y = 0; y < c.h; y++)
        for (let x = 0; x < c.w; x++) {
          if (!c.alpha[y * c.w + x]) continue;
          const h0 = Math.min(c.cap, foot - (c.y + y));
          // smear each pixel over its one-pixel slice of height, so long shadows have no gaps
          for (let k = 0; k < steps; k++)
            for (let l = 0; l <= levels; l++) {
              // how high the pixel is above ground at level l
              const h = h0 + k / steps + c.lift - l * LEVEL;
              if (h < 0) break;
              const px = Math.round(c.x + x + sx * h), py = Math.round(c.ground + sy * h);
              if (px < 0 || py < 0 || px >= W || py >= H) continue;
              const i = py * W + px;
              if (level[i] === l) out[i] = l + 1;
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
    const [sx, sy] = this.s;
    const steps = Math.ceil(Math.hypot(sx, sy)) + 1;
    const c = CELL / 2, x0 = frame * CAT, w = this.catSheetW;
    for (let y = 0; y < CAT; y++)
      for (let x = 0; x < CAT; x++) {
        if (!this.catAlpha[y * w + x0 + x]) continue;
        for (let k = 0; k < steps; k++) {
          const h = CAT_TOP - y + k / steps;
          const px = Math.round(c + x - CAT / 2 + sx * h), py = Math.round(c + sy * h);
          if (px < 0 || py < 0 || px >= CELL || py >= CELL) continue;
          const i = (py * CELL + px) * 4;
          img.data[i] = COLOUR[0]; img.data[i + 1] = COLOUR[1]; img.data[i + 2] = COLOUR[2]; img.data[i + 3] = 255;
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
      if (s.frame !== cat.frame || s.key !== this.key) {
        s.frame = cat.frame;
        s.key = this.key;
        s.tex.getContext().putImageData(this.catFrame(cat.frame), 0, 0);
        s.tex.refresh();
      }
      // a jumping cat's shadow slides away from it; on a ledge it lies on the ledge
      const elev = elevAt(cat.x, cat.y), up = cat.z - elev;
      const [sx, sy] = this.s;
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

let scratchCanvas: HTMLCanvasElement | null = null;
function scratch(w: number, h: number): CanvasRenderingContext2D {
  scratchCanvas ??= document.createElement('canvas');
  if (scratchCanvas.width < w) scratchCanvas.width = w;
  if (scratchCanvas.height < h) scratchCanvas.height = h;
  return scratchCanvas.getContext('2d', { willReadFrequently: true })!;
}

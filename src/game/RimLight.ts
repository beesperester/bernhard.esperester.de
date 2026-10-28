import Phaser from 'phaser';
import { catFrames } from './textures.ts';
import type { Raster } from '../art/raster.ts';
import type { Prop } from '../art/trees.ts';
import type { TerrainPiece } from '../art/terrain.ts';
import { LEVEL, TILE, levelAt } from '../world/map.ts';
import type { Light } from '../world/sky.ts';
import { cullerFor } from './Culler.ts';

/** The sun's direction is rounded to one of this many, so rims are only redrawn now and then. */
const DIRECTIONS = 16;
/** Brightness of the outer rim pixel and of the one inside it. */
const OUTER = 255, INNER = 110;

type Solid = (x: number, y: number) => boolean;
interface Overlay { img: Phaser.GameObjects.Image; tex: Phaser.Textures.CanvasTexture; w: number; h: number; rim: (out: Uint8ClampedArray) => void }

/**
 * Sunlit rims on everything standing up (cats, trees, bushes, rocks, hedges,
 * fences, cliffs, stairs): the edge pixels on the side facing the sun light up,
 * so you can tell where the sun is. Each object gets an additive overlay whose
 * texture is redrawn whenever the sun moves to another of the 16 directions.
 */
export class RimLight {
  private readonly overlays: Overlay[] = [];
  private readonly catTex: Phaser.Textures.CanvasTexture;
  private readonly catAlpha: Uint8Array;
  private readonly catW: number;
  private dir = -1;
  private d1: [number, number] = [0, 0];
  private d2: [number, number] = [0, 0];
  private shown = '';
  /** Current strength and colour, for the cats' rim sprites. */
  strength = 0;
  colour = 0xffffff;

  constructor(
    scene: Phaser.Scene,
    parts: { trees: { p: Pick<Prop, 'x' | 'y' | 'depthY'>; canvas: HTMLCanvasElement }[]; upright: Raster; terrain: TerrainPiece[]; catSheet: HTMLCanvasElement; catSize: number },
  ) {
    const add = (key: string, w: number, h: number, x: number, y: number, depth: number, rim: Overlay['rim']) => {
      const tex = scene.textures.createCanvas(key, w, h)!;
      const img = cullerFor(scene).add(scene.add.image(x, y, key).setOrigin(0).setDepth(depth).setBlendMode(Phaser.BlendModes.ADD).setVisible(false));
      this.overlays.push({ img, tex, w, h, rim });
    };

    // things in the ground art (on the lawn; those on raised ground go with the terrain below)
    const up = parts.upright, W = up.w, H = up.h;
    const isUp = (x: number, y: number) => up.isSet(x, y);
    const groundRim = new Uint8ClampedArray(W * H);
    const solidGround: Solid = (x, y) => isUp(x, y);
    add('rim-ground', W, H, 0, 0, -99989, (out) => {
      this.rimInto(groundRim, W, H, solidGround, solidGround);
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const v = groundRim[y * W + x];
          if (v && levelAt(Math.floor(x / TILE), Math.floor(y / TILE)) === 0) out[(y * W + x) * 4 + 3] = v;
        }
    });

    // terrain: which level shows at each screen pixel, to find the edges of plateaus as drawn
    const OFF = 3 * LEVEL; // pieces can be lifted above the top of the map
    const comp = new Int8Array(W * (H + OFF));
    for (const t of [...parts.terrain].sort((a, b) => a.depth - b.depth))
      for (let y = 0; y < t.raster.h; y++)
        for (let x = 0; x < t.raster.w; x++)
          if (t.raster.isSet(x, y)) {
            const sx = t.x + x, sy = t.y + y + OFF;
            if (sx >= 0 && sx < W && sy >= 0 && sy < H + OFF) comp[sy * W + sx] = t.level;
          }
    const levelOnScreen = (sx: number, sy: number) => {
      sy += OFF;
      return sx < 0 || sx >= W || sy < 0 || sy >= H + OFF ? 0 : comp[sy * W + sx];
    };
    parts.terrain.forEach((t, i) => {
      const { raster: r } = t;
      add(`rim-terrain-${i}`, r.w, r.h, t.x, t.y, t.depth + 0.002, (out) => {
        const [a, b] = this.d1, [c, d] = this.d2;
        for (let y = 0; y < r.h; y++)
          for (let x = 0; x < r.w; x++) {
            if (!r.isSet(x, y)) continue;
            const sx = t.x + x, sy = t.y + y;
            let v = levelOnScreen(sx + a, sy + b) < t.level ? OUTER : levelOnScreen(sx + c, sy + d) < t.level ? INNER : 0;
            // bushes, rocks and hedges up on the plateau
            if (!t.stairs && y < TILE) v = Math.max(v, groundRim[(sy + t.level * LEVEL) * W + sx] ?? 0);
            out[(y * r.w + x) * 4 + 3] = v;
          }
      });
    });

    // trees and furniture
    parts.trees.forEach(({ p, canvas }, i) => {
      const { width: w, height: h } = canvas;
      const a = canvas.getContext('2d')!.getImageData(0, 0, w, h).data;
      const solid: Solid = (x, y) => x >= 0 && y >= 0 && x < w && y < h && a[(y * w + x) * 4 + 3] > 0;
      const rim = new Uint8ClampedArray(w * h);
      add(`rim-tree-${i}`, w, h, p.x, p.y, p.depthY + 0.002, (out) => {
        this.rimInto(rim, w, h, solid, solid);
        for (let k = 0; k < rim.length; k++) out[k * 4 + 3] = rim[k];
      });
    });

    // cats: one rim sheet for all coats (they share their outlines), used by every cat's rim sprite
    const cw = parts.catSheet.width, ch = parts.catSheet.height;
    const ca = parts.catSheet.getContext('2d')!.getImageData(0, 0, cw, ch).data;
    this.catW = cw;
    this.catAlpha = new Uint8Array(cw * ch);
    for (let k = 0; k < this.catAlpha.length; k++) this.catAlpha[k] = ca[k * 4 + 3] > 0 ? 1 : 0;
    this.catTex = scene.textures.createCanvas('cat-rim', cw, ch)!;
    catFrames(this.catTex, parts.catSheet);
    this.catSize = parts.catSize;
  }

  private readonly catSize: number;

  /** Rim brightness for every pixel of a shape: lit where the next pixel towards the sun is empty. */
  private rimInto(out: Uint8ClampedArray, w: number, h: number, mine: Solid, solid: Solid): void {
    const [a, b] = this.d1, [c, d] = this.d2;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        out[y * w + x] = !mine(x, y) ? 0 : !solid(x + a, y + b) ? OUTER : !solid(x + c, y + d) ? INNER : 0;
  }

  update(light: Light): void {
    const s = light.rim;
    if (s > 0.01) {
      const [sx, sy] = light.sunDir;
      const q = ((Math.round(Math.atan2(sy, sx) / ((Math.PI * 2) / DIRECTIONS)) % DIRECTIONS) + DIRECTIONS) % DIRECTIONS;
      if (q !== this.dir) this.redraw(q);
    }
    const [r, g, b] = light.rimColour.map(Math.round);
    const colour = (r << 16) | (g << 8) | b;
    const key = `${s.toFixed(2)}:${colour}`;
    this.strength = s > 0.01 ? s : 0;
    this.colour = colour;
    if (key === this.shown) return;
    this.shown = key;
    for (const o of this.overlays) o.img.setVisible(this.strength > 0).setAlpha(s).setTint(colour);
  }

  private redraw(q: number): void {
    this.dir = q;
    const ang = (q / DIRECTIONS) * Math.PI * 2;
    this.d1 = [Math.round(Math.cos(ang)), Math.round(Math.sin(ang))];
    this.d2 = [Math.round(Math.cos(ang) * 2), Math.round(Math.sin(ang) * 2)];
    for (const o of this.overlays) {
      const img = new ImageData(o.w, o.h);
      img.data.fill(255);
      for (let k = 3; k < img.data.length; k += 4) img.data[k] = 0;
      o.rim(img.data);
      o.tex.getContext().putImageData(img, 0, 0);
      o.tex.refresh();
    }
    // cats, frame by frame so rims stop at the frame edges
    const w = this.catW, h = this.catTex.height, S = this.catSize, A = this.catAlpha;
    const img = new ImageData(w, h);
    const [a, b] = this.d1, [c, d] = this.d2;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (!A[y * w + x]) continue;
        const f0 = Math.floor(x / S) * S, g0 = Math.floor(y / S) * S;
        const solid = (px: number, py: number) => px >= f0 && px < f0 + S && py >= g0 && py < g0 + S && A[py * w + px] === 1;
        const v = !solid(x + a, y + b) ? OUTER : !solid(x + c, y + d) ? INNER : 0;
        if (!v) continue;
        const k = (y * w + x) * 4;
        img.data[k] = img.data[k + 1] = img.data[k + 2] = 255;
        img.data[k + 3] = v;
      }
    this.catTex.getContext().putImageData(img, 0, 0);
    this.catTex.refresh();
  }
}

import Phaser from 'phaser';
import { catFrames } from './textures.ts';
import type { Prop } from '../art/trees.ts';
import type { TerrainPiece } from '../art/terrain.ts';
import { LEVEL, MAP_H, MAP_W, TILE, WORLD_H, WORLD_W, levelAt } from '../world/map.ts';
import { hasUpright } from '../art/tiles.ts';
import type { Light } from '../world/sky.ts';
import { cullerFor } from './Culler.ts';
import type { TreeWatcher } from './Trees.ts';

/** The sun's direction is rounded to one of this many, so rims are only redrawn now and then. */
const DIRECTIONS = 16;
/** The rims of what stands up in the ground are drawn in pieces this many tiles square. */
const CHUNK = 8;
/** Brightness of the outer rim pixel and of the one inside it. */
const OUTER = 255, INNER = 110;

type Solid = (x: number, y: number) => boolean;
interface Overlay {
  img: Phaser.GameObjects.Image; tex: Phaser.Textures.CanvasTexture; w: number; h: number; rim: (out: Uint8ClampedArray) => void;
  /** How much of the rim shows (a tree fading out takes its rim with it). */
  k: number;
}

/**
 * Sunlit rims on everything standing up (cats, trees, bushes, rocks, hedges,
 * fences, cliffs, stairs): the edge pixels on the side facing the sun light up,
 * so you can tell where the sun is. Each object gets an additive overlay whose
 * texture is redrawn whenever the sun moves to another of the 16 directions.
 */
export class RimLight implements TreeWatcher {
  private readonly scene: Phaser.Scene;
  private readonly overlays: Overlay[] = [];
  /** The trees' rims, while their pictures are drawn. */
  private readonly trees = new Map<number, Overlay>();
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
    parts: { things: { p: Pick<Prop, 'x' | 'y' | 'depthY'>; canvas: HTMLCanvasElement }[]; upright: (x: number, y: number) => boolean; terrain: TerrainPiece[]; catSheet: HTMLCanvasElement; catSize: number },
  ) {
    this.scene = scene;
    const add = (key: string, w: number, h: number, x: number, y: number, depth: number, rim: Overlay['rim']) => {
      this.overlays.push(this.overlay(key, w, h, x, y, depth, rim));
    };

    // things in the ground art (on the lawn; those on raised ground go with the terrain below)
    // (in pieces of CHUNK tiles square, each only as big as what stands up in it)
    const W = WORLD_W, H = WORLD_H, isUp = parts.upright;
    const groundRim = (x: number, y: number) => {
      const [a, b] = this.d1, [c, d] = this.d2;
      return !isUp(x, y) ? 0 : !isUp(x + a, y + b) ? OUTER : !isUp(x + c, y + d) ? INNER : 0;
    };
    for (let cy = 0; cy < MAP_H; cy += CHUNK)
      for (let cx = 0; cx < MAP_W; cx += CHUNK) {
        let x0 = MAP_W, y0 = MAP_H, x1 = -1, y1 = -1;
        for (let ty = cy; ty < Math.min(MAP_H, cy + CHUNK); ty++)
          for (let tx = cx; tx < Math.min(MAP_W, cx + CHUNK); tx++)
            if (levelAt(tx, ty) === 0 && hasUpright(tx, ty)) { x0 = Math.min(x0, tx); y0 = Math.min(y0, ty); x1 = Math.max(x1, tx); y1 = Math.max(y1, ty); }
        if (x1 < 0) continue;
        const ox = x0 * TILE, oy = y0 * TILE, w = (x1 - x0 + 1) * TILE, h = (y1 - y0 + 1) * TILE;
        add(`rim-ground-${cx}-${cy}`, w, h, ox, oy, -99989, (out) => {
          for (let y = 0; y < h; y++)
            for (let x = 0; x < w; x++) {
              const v = groundRim(ox + x, oy + y);
              if (v && levelAt(Math.floor((ox + x) / TILE), Math.floor((oy + y) / TILE)) === 0) out[(y * w + x) * 4 + 3] = v;
            }
        });
      }

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
            if (!t.stairs && y < TILE) v = Math.max(v, groundRim(sx, sy + t.level * LEVEL));
            out[(y * r.w + x) * 4 + 3] = v;
          }
      });
    });

    // furniture and follies
    parts.things.forEach(({ p, canvas }, i) => this.overlays.push(this.outline(`rim-thing-${i}`, canvas, p.x, p.y, p.depthY + 0.002)));

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

  private overlay(key: string, w: number, h: number, x: number, y: number, depth: number, rim: Overlay['rim']): Overlay {
    const tex = this.scene.textures.createCanvas(key, w, h)!;
    const img = cullerFor(this.scene).add(this.scene.add.image(x, y, key).setOrigin(0).setDepth(depth).setBlendMode(Phaser.BlendModes.ADD).setVisible(false));
    return { img, tex, w, h, rim, k: 1 };
  }

  /** A rim round the outline of a picture standing at (x, y). */
  private outline(key: string, canvas: HTMLCanvasElement, x: number, y: number, depth: number): Overlay {
    const { width: w, height: h } = canvas;
    const a = canvas.getContext('2d')!.getImageData(0, 0, w, h).data;
    const solid: Solid = (px, py) => px >= 0 && py >= 0 && px < w && py < h && a[(py * w + px) * 4 + 3] > 0;
    const rim = new Uint8ClampedArray(w * h);
    return this.overlay(key, w, h, x, y, depth, (out) => {
      this.rimInto(rim, w, h, solid, solid);
      for (let k = 0; k < rim.length; k++) out[k * 4 + 3] = rim[k];
    });
  }

  /** A tree has been drawn: its rim, in the light as it is now. */
  added(i: number, p: Prop, canvas: HTMLCanvasElement): void {
    const o = this.outline(`rim-tree-${i}`, canvas, p.x, p.y, p.depthY + 0.002);
    this.trees.set(i, o);
    this.overlays.push(o);
    if (this.dir >= 0) this.paint(o);
    o.img.setVisible(this.strength > 0).setAlpha(this.strength).setTint(this.colour);
  }

  /** A tree has been let go: and its rim. */
  removed(i: number): void {
    const o = this.trees.get(i);
    if (!o) return;
    this.trees.delete(i);
    this.overlays.splice(this.overlays.indexOf(o), 1);
    o.img.destroy();
    this.scene.textures.remove(o.tex);
  }

  /** A tree is fading out (0 there .. 1 gone), its rim with it. */
  faded(i: number, fade: number): void {
    const o = this.trees.get(i);
    if (!o) return;
    o.k = 1 - fade;
    o.img.setVisible(this.strength > 0 && o.k > 0).setAlpha(this.strength * o.k);
  }

  private paint(o: Overlay): void {
    const img = new ImageData(o.w, o.h);
    img.data.fill(255);
    for (let k = 3; k < img.data.length; k += 4) img.data[k] = 0;
    o.rim(img.data);
    o.tex.getContext().putImageData(img, 0, 0);
    o.tex.refresh();
  }

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
    for (const o of this.overlays) o.img.setVisible(this.strength > 0 && o.k > 0).setAlpha(s * o.k).setTint(colour);
  }

  private redraw(q: number): void {
    this.dir = q;
    const ang = (q / DIRECTIONS) * Math.PI * 2;
    this.d1 = [Math.round(Math.cos(ang)), Math.round(Math.sin(ang))];
    this.d2 = [Math.round(Math.cos(ang) * 2), Math.round(Math.sin(ang) * 2)];
    for (const o of this.overlays) this.paint(o);
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

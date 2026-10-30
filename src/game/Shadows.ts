import Phaser from 'phaser';
import { CAT } from '../art/cat.ts';
import type { CatView } from './CatView.ts';
import { casterBox, casterHeight } from '../world/map.ts';
import { MAP_H, MAP_W, TILE } from '../world/size.ts';
import type { Light } from '../world/sky.ts';
import { TREES, type TreePlan } from '../world/trees.ts';
import { cullerFor } from './Culler.ts';
import { turnStretchTurn } from './shear.ts';

// Shadows that follow the sun, drawn anew every frame by the GPU as shapes
// laid on the ground away from the sun (so they move on with it smoothly):
//  - a tree's leaf masses are balls, and a ball's shadow is an ellipse,
//    drawn out along the sun's rays; its trunk and boughs are bars;
//  - hedges, bushes, rocks and fences are boxes, swept along the rays;
//  - furniture, follies, lanterns and cats are flat pictures standing up a
//    few px deep: their outlines are sheared onto the ground, each pixel as
//    far as it is high.
// They are all drawn into one picture over the view (so where they overlap
// they don't darken twice), which is laid over the ground.
// After sunset these fade into soft round shadows under everything.
// (The ground is all one level now the hills are gone: shadows don't climb.)

const RAD = Math.PI / 180;
/** Long evening shadows are capped at this sun height, so they stay on screen. */
const MIN_EL = 15;
const COLOUR = [22, 34, 78];
const ALPHA = 0.32;
/** How far a cat reaches in front of and behind its feet, for its shadow. */
const CAT_DEPTH = 2;
/** The shadows are drawn this far (px) past the view's edges. */
const MARGIN = 8;
/** At these sun heights the rays are this near flat (a shear can't be quite flat: their depth fills it). */
const MIN_DROP = 0.2;

/** Something whose outline casts a shadow: a sprite (or part of a sheet) and where its foot is. */
export interface Caster {
  /** Its picture. */
  src: CanvasImageSource & { width: number; height: number };
  /** Region of `src` to use. */
  sx: number; sy: number; w: number; h: number;
  /** World position of the region's top-left corner. */
  x: number; y: number;
  /** Ground-plane y of its foot (the bottom row). */
  ground: number;
  /** Pixels higher than this count as its top (a table's top is deep, not tall). */
  cap: number;
  /**
   * How deep it is, front to back, as it stands on the ground: px either side
   * of its foot line; or 'round', like an urn, as deep as it is wide at every
   * height. (A flat cut-out would cast a mere line with the sun off to the side.)
   */
  depth: number | 'round';
}

/** A caster as drawn: its picture's texture, and its frames (below its cap, and above). */
interface Cutout {
  c: Caster;
  key: string;
  /** Rows up to its cap ('lo'), and those above it, if any ('hi', laid flat at the cap's height). */
  lo: string;
  hi: string | null;
  loRows: number;
  hiRows: number;
  /** A round one's rows, as discs: height, middle (px from its left) and radius each. */
  discs: number[] | null;
}

/** A sheared picture: a turned, stretched container holding the turned picture (game/shear.ts). */
interface Shear { box: Phaser.GameObjects.Container; img: Phaser.GameObjects.Image }

export class Shadows {
  private readonly scene: Phaser.Scene;
  private readonly map: Phaser.GameObjects.RenderTexture;
  /** Swept boxes; the boxes themselves, taken out again (what stands there is lit on top); and all other shapes. */
  private readonly prisms: Phaser.GameObjects.Graphics;
  private readonly boxes: Phaser.GameObjects.Graphics;
  private readonly shapes: Phaser.GameObjects.Graphics;
  private readonly shears: Shear[] = [];
  private used = 0;
  private readonly cutouts: Cutout[] = [];
  private readonly blobs: Phaser.GameObjects.Image[] = [];
  /** The tallest box (px). */
  private readonly boxTop: number;
  /** The sun's shadows: per px of height, how far along the ground away from the sun; and the unit way towards it, and the rays' rise per px. */
  private s: [number, number] = [0, 0];
  private g: [number, number] = [0, -1];
  private rise = 1;
  /** The trees whose shadows are drawn now. */
  private near: TreePlan[] = [];
  /** 0 at night, 1 in full sun: how strong cast shadows are (soft ones take over as it fades). */
  strength = 0;
  /** Whether it casts the sun's shadows at all (not when game/Cards.ts does, from its shadow map): else only the night's soft ones. */
  cast = true;

  constructor(scene: Phaser.Scene, opts: { casters: Caster[]; blobs: { x: number; y: number; w: number; h: number; depth: number }[] }) {
    this.scene = scene;
    this.map = scene.add.renderTexture(0, 0, 64, 64).setOrigin(0).setDepth(-99993).setVisible(false)
      .setTint(Phaser.Display.Color.GetColor(COLOUR[0], COLOUR[1], COLOUR[2]));
    this.prisms = scene.make.graphics({}, false);
    this.boxes = scene.make.graphics({}, false);
    this.shapes = scene.make.graphics({}, false);

    let top = 0;
    for (let ty = 0; ty < MAP_H; ty++) for (let tx = 0; tx < MAP_W; tx++) top = Math.max(top, casterBox(tx, ty)?.[4] ?? 0);
    this.boxTop = top;

    // each caster's picture as a texture (shared by those with the same picture), cut at its cap
    const keys = new Map<CanvasImageSource, string>();
    for (const c of opts.casters) {
      let key = keys.get(c.src);
      if (!key) {
        key = `shadow-src-${keys.size}`;
        keys.set(c.src, key);
        scene.textures.addCanvas(key, c.src as HTMLCanvasElement);
      }
      const tex = scene.textures.get(key), name = `${c.sx},${c.sy},${c.w},${c.h}`;
      const loRows = Math.min(c.h, Math.floor(c.cap) + 1), hiRows = c.h - loRows;
      if (!tex.has(`${name}:lo`)) {
        tex.add(`${name}:lo`, 0, c.sx, c.sy + hiRows, c.w, loRows);
        if (hiRows) tex.add(`${name}:hi`, 0, c.sx, c.sy, c.w, hiRows);
      }
      this.cutouts.push({ c, key, lo: `${name}:lo`, hi: hiRows ? `${name}:hi` : null, loRows, hiRows, discs: c.depth === 'round' ? discsOf(c) : null });
    }

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

  /** How shaded the ground under (x, y) is right now, 0..1, for darkening cats standing there (by the trees and boxes). */
  shadeAt(x: number, y: number): number {
    if (this.strength <= 0.01) return 0;
    const [sx, sy] = this.s, s = Math.hypot(sx, sy), ux = s ? sx / s : 0, uy = s ? sy / s : 1;
    for (const t of this.near)
      for (const b of t.crown) {
        const dx = x - (t.x + b.x + sx * b.z), dy = y - (t.y + sy * b.z);
        const along = dx * ux + dy * uy, across = dx * uy - dy * ux, r = Math.hypot(b.rx, b.rz * s);
        if ((along / r) ** 2 + (across / b.rx) ** 2 <= 1) return this.strength;
      }
    const [gx, gy] = this.g;
    for (let t = 1; t * this.rise < this.boxTop; t++) if (casterHeight(x + gx * t, y + gy * t) > t * this.rise) return this.strength;
    return 0;
  }

  /** `overcast` (0..1): rain clouds soften the shadows away. `view`: the part of the world on screen. */
  update(light: Light, cats: CatView[], overcast: number, view: Phaser.Geom.Rectangle): void {
    const el = light.elevation;
    this.strength = Math.max(0, Math.min(1, el / 10)) * (1 - overcast * 0.85);
    const sun = this.strength > 0.01;
    this.map.setVisible(sun && this.cast).setAlpha(ALPHA * this.strength);
    const soft = 0.08 + 0.42 * (1 - this.strength);
    for (const b of this.blobs) b.setAlpha(soft);
    if (!sun || !this.cast) {
      this.near = [];
      return;
    }

    // towards the sun on the ground (x right, y down the screen), and the shadow per px of height
    const A = light.azimuth * RAD, rise = Math.tan(Math.max(MIN_EL, Math.min(el, 70)) * RAD);
    this.g = [Math.sin(A), -Math.cos(A)];
    this.rise = rise;
    const [sx, sy] = (this.s = [-this.g[0] / rise, -this.g[1] / rise]);

    // the picture: a little past the view's edges, on whole pixels
    const x0 = Math.floor(view.x) - MARGIN, y0 = Math.floor(view.y) - MARGIN;
    const w = Math.ceil(view.width) + 2 * MARGIN, h = Math.ceil(view.height) + 2 * MARGIN, x1 = x0 + w, y1 = y0 + h;
    if (Math.abs(this.map.width - w) > 1 || Math.abs(this.map.height - h) > 1) this.map.resize(w, h);
    this.map.setPosition(x0, y0).clear();
    for (const g of [this.prisms, this.boxes, this.shapes]) g.clear().fillStyle(0xffffff).setPosition(-x0, -y0);
    this.used = 0;
    /** Whether a shadow from (ax, ay) reaching out by (dx, dy), and `pad` px round that, is in the picture. */
    const seen = (ax: number, ay: number, dx: number, dy: number, pad: number) =>
      Math.min(ax, ax + dx) - pad < x1 && Math.max(ax, ax + dx) + pad > x0 && Math.min(ay, ay + dy) - pad < y1 && Math.max(ay, ay + dy) + pad > y0;

    // the boxes, swept along the rays
    const reachX = sx * this.boxTop, reachY = sy * this.boxTop;
    const tx0 = Math.max(0, Math.floor((x0 - Math.max(0, reachX)) / TILE)), tx1 = Math.min(MAP_W - 1, Math.floor((x1 - Math.min(0, reachX)) / TILE));
    const ty0 = Math.max(0, Math.floor((y0 - Math.max(0, reachY)) / TILE)), ty1 = Math.min(MAP_H - 1, Math.floor((y1 - Math.min(0, reachY)) / TILE));
    for (let ty = ty0; ty <= ty1; ty++)
      for (let tx = tx0; tx <= tx1; tx++) {
        const b = casterBox(tx, ty);
        if (!b) continue;
        const [l, t, r, bt, bh] = b, vx = sx * bh, vy = sy * bh;
        this.prisms.fillRect(l + vx, t + vy, r - l, bt - t);
        quad(this.prisms, l, t, r, bt, r + vx, bt + vy, l + vx, t + vy);
        quad(this.prisms, r, t, l, bt, l + vx, bt + vy, r + vx, t + vy);
        this.boxes.fillRect(l, t, r - l, bt - t);
      }

    // the trees
    this.near = [];
    for (const t of TREES) {
      if (!seen(t.x - t.w / 2, t.y, sx * t.h, sy * t.h, t.w)) continue;
      this.near.push(t);
      this.tree(t);
    }

    // the furniture, follies and lanterns, and the cats
    for (const k of this.cutouts) {
      const { c } = k, top = Math.min(c.cap, c.h - 1), deep = c.depth === 'round' ? c.w / 2 : c.depth;
      if (!seen(c.x, c.ground, sx * top, sy * top, c.w + deep)) continue;
      if (k.discs) this.discs(k);
      else this.cutout(k.key, k.lo, k.loRows, k.hi, k.hiRows, c.x, c.ground, 0, c.depth as number);
    }
    for (const cat of cats) {
      const up = Math.max(0, cat.z);
      if (!seen(cat.x - CAT / 2, cat.y, sx * (CAT + up), sy * (CAT + up), CAT)) continue;
      this.cutout(`cat-${cat.coat}`, cat.frame, CAT, null, 0, Math.round(cat.x - CAT / 2), cat.y, up, CAT_DEPTH);
    }

    this.map.draw(this.prisms).erase(this.boxes).draw(this.shapes);
    for (let i = 0; i < this.used; i++) this.map.draw(this.shears[i].box);
    this.map.render();
  }

  /**
   * A tree's shadow, from its plan: each mass of leaves is a ball (as deep as
   * it is wide), whose shadow along the sun's rays is an ellipse; the trunk
   * is a bar thinning as it goes up, each bough a thin bar.
   */
  private tree(t: TreePlan): void {
    const [sx, sy] = this.s, g = this.shapes, s = Math.hypot(sx, sy), turn = Math.atan2(sy, sx);
    for (const b of t.crown) {
      // a ball rx round and rz tall: its shadow is rx across the rays, and drawn out along them by its height
      const along = Math.hypot(b.rx, b.rz * s);
      g.save().translateCanvas(t.x + b.x + sx * b.z, t.y + sy * b.z).rotateCanvas(turn).fillEllipse(0, 0, 2 * along, 2 * b.rx, 20).restore();
    }
    let top = 0;
    for (const p of t.perches) top = Math.max(top, p.z0, p.z1);
    const ex = t.x + sx * top, ey = t.y + sy * top, nx = s ? -sy / s : 1, ny = s ? sx / s : 0, r0 = t.trunk, r1 = 2;
    g.fillCircle(t.x, t.y, r0).fillCircle(ex, ey, r1);
    quad(g, t.x + nx * r0, t.y + ny * r0, ex + nx * r1, ey + ny * r1, ex - nx * r1, ey - ny * r1, t.x - nx * r0, t.y - ny * r0);
    for (const p of t.perches) {
      const h = (p.z0 + p.z1) / 2;
      if (h < 0 || p.kind === 'stump') continue;
      const a = t.x + Math.min(p.x0, p.x1) + sx * h;
      g.fillRect(Math.round(a), Math.round(t.y + sy * h) - 1, Math.round(Math.abs(p.x1 - p.x0)), 3);
    }
  }

  /** A round caster's shadow: each row of its outline a disc lying level at that height, moved along the rays to the ground. */
  private discs(k: Cutout): void {
    const [sx, sy] = this.s, d = k.discs!, steps = Math.ceil(Math.hypot(sx, sy));
    for (let i = 0; i < d.length; i += 3) {
      const h = d[i], mid = k.c.x + d[i + 1], r = d[i + 2];
      // (small discs smeared over their row's slice of height, so they leave no gaps)
      const sub = r * 2 < steps ? steps : 1;
      for (let j = 0; j < sub; j++) this.shapes.fillCircle(mid + sx * (h + j / sub), k.c.ground + sy * (h + j / sub), r);
    }
  }

  /**
   * A flat caster's shadow: its picture (rows up to its cap; those above laid flat at the cap's
   * height) sheared onto the ground, its foot at (x, ground), `lift` px up, smeared `deep` px
   * either side of its foot line.
   */
  private cutout(key: string, lo: string | number, loRows: number, hi: string | null, hiRows: number, x: number, ground: number, lift: number, deep: number): void {
    const [sx, sy] = this.s, dy = Math.max(MIN_DROP, sy);
    // (a px of the picture at (u, v) from its foot, v up the picture negative, lands at (u - sx v, -dy v))
    const m = turnStretchTurn(1, -sx, 0, -dy);
    const step = deep <= 4 ? 1 : 2;
    for (let d = -deep; d <= deep; d = d < deep && d + step > deep ? deep : d + step) {
      const ox = x + sx * lift - this.map.x, oy = ground + d + sy * lift - this.map.y;
      this.shear(key, lo, ox, oy, m.phi, m.sx, m.sy, m.theta);
      // (the rows above the cap, flattened onto one row at its height)
      if (hi) this.shear(key, hi, ox + sx * loRows, oy + sy * loRows, 0, 1, 1 / hiRows, 0);
    }
  }

  private shear(key: string, frame: string | number, x: number, y: number, phi: number, sx: number, sy: number, theta: number): void {
    let s = this.shears[this.used++];
    if (!s) {
      const img = new Phaser.GameObjects.Image(this.scene, 0, 0, key, frame).setOrigin(0, 1).setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
      s = { img, box: this.scene.make.container({}, false).add(img) };
      this.shears.push(s);
    }
    s.img.setTexture(key, frame).setRotation(theta);
    s.box.setPosition(x, y).setRotation(phi).setScale(sx, sy);
  }
}

/** Fill the four-sided shape with corners a, b, c, d in turn. */
function quad(g: Phaser.GameObjects.Graphics, ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): void {
  g.fillTriangle(ax, ay, bx, by, cx, cy).fillTriangle(ax, ay, cx, cy, dx, dy);
}

/** A round caster's rows as discs: [height above its foot, middle (px from its left), radius] for each run of each row. */
function discsOf(c: Caster): number[] {
  const cv = document.createElement('canvas');
  cv.width = c.w;
  cv.height = c.h;
  const ctx = cv.getContext('2d')!;
  ctx.drawImage(c.src, c.sx, c.sy, c.w, c.h, 0, 0, c.w, c.h);
  const a = ctx.getImageData(0, 0, c.w, c.h).data, out: number[] = [];
  for (let y = 0; y < c.h; y++) {
    const h = Math.min(c.cap, c.h - 1 - y);
    for (let x = 0; x < c.w; ) {
      while (x < c.w && !a[(y * c.w + x) * 4 + 3]) x++;
      const start = x;
      while (x < c.w && a[(y * c.w + x) * 4 + 3]) x++;
      if (x > start) out.push(h, (start + x) / 2, (x - start) / 2);
    }
  }
  return out;
}

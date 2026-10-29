import Phaser from 'phaser';
import type { Prop } from '../art/trees.ts';
import { TREES } from '../world/trees.ts';
import { DEPTH } from './Daylight.ts';
import { cullerFor } from './Culler.ts';
import type { Occluder } from './Lanterns.ts';
import type { TreeWatcher, Trees } from './Trees.ts';

// Lights after dark: lamp flames, fairy lights, pools of light on the ground.
// They shine through the night tint, so they are drawn on top of everything,
// and what stands in front of one has to be cut out of it by hand: the
// follies and the lie of the land once, the trees as they are now (one in
// front of your cat fades away round it, and the light then shows where it
// had hidden it).
//
// A small light (a flame, a bulb) is a bright core: it dims away behind
// leaves, as far as they cover it. The glow round it is made on the GPU: the cores
// are drawn together, blurred, and the blur added back over them (a bloom of
// the lights alone). A wide light (a pool of light on the ground) has the
// trees in front taken out of it pixel by pixel (and the crowns of those
// behind it: it lies on the ground), again whenever one of them changes;
// where they are thinned or fading, it dims evenly (not dithered like them:
// a dithered light is a checkerboard).

/** A pool of light lies on the ground: leaves this far up a tree (px), even behind it, aren't lit by it. */
const CROWN = 24;
/** A small light comes and goes behind leaves over this long (ms). */
const DIM_MS = 150;
/** The glow round the small lights: how far it spreads (world px), in this many passes, and how much brighter it is
 * made (a blur spreads a small light thin). */
const HALO = 2.5, HALO_STEPS = 4, HALO_GAIN = 4;

export interface Glow {
  /** Show it this bright (0: off); what stands in front of it dims it further. */
  set(alpha: number): void;
}

interface Small {
  img: Phaser.GameObjects.Image;
  x: number;
  y: number;
  feet: number;
  /** Hidden by something that never moves. */
  hidden: boolean;
  /** How much of it shows past the trees (eased), and how bright it is to be. */
  seen: number;
  alpha: number;
}

interface Wide {
  img: Phaser.GameObjects.Image;
  tex: Phaser.Textures.CanvasTexture;
  /** Its picture with what never moves cut out. */
  still: ImageData;
  left: number;
  up: number;
  scale: number;
  feet: number;
  /** The trees have changed in front of it since it was last cut. */
  dirty: boolean;
}

export class Glows implements TreeWatcher {
  private readonly scene: Phaser.Scene;
  private readonly trees: Trees;
  private readonly occluders: Occluder[];
  private readonly small: Small[] = [];
  private readonly wide: Wide[] = [];
  /** The small lights, drawn together and glowing. */
  private readonly halo: Phaser.GameObjects.Container;
  private readonly blur: Phaser.Filters.Blur;
  private view = new Phaser.Geom.Rectangle();

  constructor(scene: Phaser.Scene, trees: Trees, occluders: Occluder[]) {
    this.scene = scene;
    this.trees = trees;
    this.occluders = occluders;
    trees.watch(this);
    this.halo = scene.add.container(0, 0).setDepth(DEPTH.glow).setBlendMode(Phaser.BlendModes.ADD);
    this.halo.enableFilters();
    // (over the whole view, not just round the lights)
    this.halo.filtersFocusContext = true;
    const bloom = this.halo.filters!.external.addParallelFilters();
    this.blur = bloom.top.addBlur(1, HALO, HALO, 1, 0xffffff, HALO_STEPS);
    bloom.top.addColorMatrix().colorMatrix.brightness(HALO_GAIN);
    bloom.blend.blendMode = Phaser.BlendModes.ADD;
    bloom.blend.amount = 1;
  }

  /** A small light: picture `key` centred on (x, y), `scale` times its size, for a thing whose feet are at `feet`. */
  point(key: string, x: number, y: number, scale: number, feet: number): Glow {
    const img = this.scene.make.image({ x, y, key } as Phaser.Types.GameObjects.Sprite.SpriteConfig, false).setScale(scale).setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
    this.halo.add(img);
    const hidden = this.occluders.some((o) => o.depth > feet && opaqueAt(o, Math.round(x), Math.round(y)));
    const s: Small = { img, x, y, feet, hidden, seen: 1, alpha: 0 };
    this.small.push(s);
    return { set: (a) => { s.alpha = a; show(s.img, a * s.seen * (s.hidden ? 0 : 1)); } };
  }

  /** A wide light: picture `key` centred on (x, y), `scale` times its size, for a thing whose feet are at `feet`. */
  area(key: string, x: number, y: number, scale: number, feet: number): Glow {
    const src = this.scene.textures.get(key).getSourceImage() as HTMLCanvasElement;
    const w = src.width, h = src.height, left = Math.round(x - (w * scale) / 2), up = Math.round(y - (h * scale) / 2);
    const name = `glow-${this.wide.length}`;
    const tex = this.scene.textures.createCanvas(name, w, h)!;
    const g = tex.getContext();
    g.drawImage(src, 0, 0);
    g.globalCompositeOperation = 'destination-out';
    // (at its own scale)
    g.setTransform(1 / scale, 0, 0, 1 / scale, 0, 0);
    const W = w * scale, H = h * scale;
    for (const o of this.occluders)
      if (o.depth > feet && !o.tree && o.x < left + W && o.x + o.w > left && o.y < up + H && o.y + o.h > up) g.drawImage(o.canvas, o.x - left, o.y - up);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    const still = g.getImageData(0, 0, w, h);
    tex.refresh();
    const img = cullerFor(this.scene).add(this.scene.add.image(left, up, name).setOrigin(0).setScale(scale).setDepth(DEPTH.glow).setBlendMode(Phaser.BlendModes.ADD).setVisible(false));
    const d: Wide = { img, tex, still, left, up, scale, feet, dirty: true };
    this.wide.push(d);
    return { set: (a) => show(d.img, a) };
  }

  added(i: number, _p: Prop, _canvas: HTMLCanvasElement): void {
    this.touched(i);
  }

  removed(i: number): void {
    this.touched(i);
  }

  holed(i: number): void {
    this.touched(i);
  }

  /** Follow the trees in front of the lights in view. */
  update(view: Phaser.Geom.Rectangle, dt: number, zoom: number): void {
    this.view = view;
    // (the blur works in screen px)
    this.blur.x = this.blur.y = HALO * zoom;
    const step = dt / DIM_MS;
    for (const s of this.small) {
      if (!s.img.visible && s.alpha <= 0) continue;
      if (!inView(view, s.x, s.y, 8)) continue;
      const want = 1 - this.trees.coverage(s.x, s.y, s.feet);
      if (want === s.seen) continue;
      s.seen = want > s.seen ? Math.min(want, s.seen + step) : Math.max(want, s.seen - step);
      show(s.img, s.alpha * s.seen * (s.hidden ? 0 : 1));
    }
    for (const d of this.wide) if (d.dirty && d.img.visible && this.near(d)) this.cut(d);
  }

  /** Tree i has changed: the wide lights it stands over want cutting again. */
  private touched(i: number): void {
    const t = TREES[i], x0 = t.x - t.w / 2, y0 = t.y - (t.h - 1) - t.elev, x1 = x0 + t.w, y1 = y0 + t.h;
    for (const d of this.wide) {
      const w = d.tex.width * d.scale, h = d.tex.height * d.scale;
      if (x0 < d.left + w && x1 > d.left && y0 < d.up + h && y1 > d.up) d.dirty = true;
    }
  }

  private near(d: Wide): boolean {
    const v = this.view;
    return d.left < v.right + 24 && d.left + d.tex.width * d.scale > v.x - 24 && d.up < v.bottom + 24 && d.up + d.tex.height * d.scale > v.y - 24;
  }

  /** Cut the trees in front of wide light d out of it, as they are now. */
  private cut(d: Wide): void {
    const { width: w, height: h } = d.still, img = new ImageData(new Uint8ClampedArray(d.still.data), w, h);
    for (let v = 0; v < h; v++)
      for (let u = 0; u < w; u++) {
        const k = (v * w + u) * 4;
        if (img.data[k + 3]) img.data[k + 3] *= 1 - this.trees.coverage(d.left + (u + 0.5) * d.scale, d.up + (v + 0.5) * d.scale, d.feet, CROWN);
      }
    d.tex.getContext().putImageData(img, 0, 0);
    d.tex.refresh();
    d.dirty = false;
  }
}

function show(img: Phaser.GameObjects.Image, a: number): void {
  img.setVisible(a > 0).setAlpha(a);
}

function inView(v: Phaser.Geom.Rectangle, x: number, y: number, m: number): boolean {
  return x > v.x - m && x < v.right + m && y > v.y - m && y < v.bottom + m;
}

/** Whether occluder o is drawn at world pixel (x, y). */
function opaqueAt(o: Occluder, x: number, y: number): boolean {
  if (o.tree || x < o.x || y < o.y || x >= o.x + o.w || y >= o.y + o.h) return false;
  const c = o.canvas as HTMLCanvasElement;
  return c.getContext('2d')!.getImageData(x - o.x, y - o.y, 1, 1).data[3] > 0;
}

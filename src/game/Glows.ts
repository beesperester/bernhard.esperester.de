import Phaser from 'phaser';
import { DEPTH } from './Daylight.ts';
import type { Occluder } from './Lanterns.ts';
import type { Trees } from './Trees.ts';

// Lights after dark: lamp flames, fairy lights, glowing flowers. They shine
// through the night tint, so they are drawn on top of everything, and what
// stands in front of one has to be taken out of it by hand: the follies and
// the lie of the land once, the trees as they are now (one in front of your
// cat fades away round it, and the light then shows where it had hidden it).
//
// A light is a bright core: it dims away behind leaves, as far as they cover
// it (evenly, not dithered like them: a dithered light is a checkerboard).
// The glow round it is made on the GPU: the cores are drawn together,
// blurred, and the blur added back over them (a bloom of the lights alone).
// The light they cast on the garden round them is LightMap.ts's.

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

export class Glows {
  private readonly scene: Phaser.Scene;
  private readonly trees: Trees;
  private readonly occluders: Occluder[];
  private readonly small: Small[] = [];
  /** The small lights, drawn together and glowing. */
  private readonly halo: Phaser.GameObjects.Container;
  private readonly blur: Phaser.Filters.Blur;

  constructor(scene: Phaser.Scene, trees: Trees, occluders: Occluder[]) {
    this.scene = scene;
    this.trees = trees;
    this.occluders = occluders;
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

  /** Follow the trees in front of the lights in view. */
  update(view: Phaser.Geom.Rectangle, dt: number, zoom: number): void {
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

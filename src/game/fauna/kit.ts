import Phaser from 'phaser';
import { mulberry32, type Bits } from '../../art/raster.ts';
import type { TreePlan } from '../../world/trees.ts';
import type { Prey } from '../state.ts';
import type { CatView } from '../CatView.ts';
import type { Effects } from './Effects.ts';

// What every kind of animal in the garden is built from: the context it gets
// when the scene starts, the frame it gets every update, and the helpers for
// deterministic randomness and reusing images.

type Img = Phaser.GameObjects.Image;
type Pt = [number, number];

/** Something catchable this frame. `y` is the ground point under it, `h` its height. */
export interface PreyRef {
  kind: Prey; id: number; x: number; y: number; h: number; colour: number;
  /** On the wing: only a cat in mid-jump can get it. */
  air?: boolean;
}

/** What a fauna module gets once, when the garden is built. */
export interface FaunaContext {
  scene: Phaser.Scene;
  /** Tree crowns, with their pictures (for perches and roosts). */
  trees: readonly TreePlan[];
  /** Flower heads bees and butterflies visit. */
  flowers: Pt[];
  /** Pixel mask of open water. */
  water: Bits;
  /** The box around all the ponds. */
  pond: { x: number; y: number; w: number; h: number };
  /** Has a cat already caught this one? (Caught prey never comes back.) */
  isCaught(kind: Prey, id: number): boolean;
  /** Splashes, ripples, feathers and other short-lived effects. */
  fx: Effects;
}

/** What a fauna module gets every frame. */
export interface FaunaFrame {
  /** Garden clock (ms), the same for every visitor: everything deterministic hangs off it. */
  gt: number;
  /** The garden clock at the previous frame (equal to gt after a clock jump). */
  prevGt: number;
  /** Local time (ms), for reactions to cats that only this browser sees the timing of. */
  now: number;
  cats: CatView[];
  /** Add whatever can be caught this frame. */
  prey: PreyRef[];
  /** The part of the world on screen. */
  view: Phaser.Geom.Rectangle;
}

/**
 * One kind (or family) of animal. To add one: write a class with a
 * `constructor(ctx: FaunaContext)` and `update(frame)`, push its catchable
 * individuals onto `frame.prey`, and list it in FAUNA (index.ts); give any
 * new prey kind an entry in PREY (prey.ts).
 */
export interface Fauna {
  update(frame: FaunaFrame): void;
  /** One of this module's prey was caught by `cat` (only called for the kinds in `catches`). */
  onCatch?(prey: PreyRef, cat: CatView, gt: number): void;
  /** Prey kinds this module looks after, for onCatch. */
  readonly catches?: readonly Prey[];
}

export const seedRng = (...k: number[]) => mulberry32(k.reduce((a, v) => Math.imul(a ^ (v | 0), 2654435761) >>> 0, 0x9e3779b9));
/** One deterministic random number in [0,1) for a tuple of integers. */
export const hash2 = (...k: number[]) => seedRng(...k)();
/** A 32-bit FNV-1a hash of a string, to seed things off peer ids. */
export const strHash = (s: string) => [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smooth = (t: number) => t * t * (3 - 2 * t);
export const clamp01 = (t: number) => Math.max(0, Math.min(1, t));

/** A Map that forgets its oldest entries beyond `max` (for per-slot caches). */
export function remember<K, V>(map: Map<K, V>, key: K, value: V, max: number, onForget?: (key: K) => void): V {
  map.set(key, value);
  while (map.size > max) {
    const old = map.keys().next().value!;
    map.delete(old);
    onForget?.(old);
  }
  return value;
}

/** Reuses images instead of creating and destroying them every frame. */
/** How much shows (0..1) of a critter at world (x, y) drawn at `depth` (up a tree with a hole cut round our cat, less). */
export const sight = { through: (_x: number, _y: number, _depth: number): number => 1 };

export class Pool {
  private imgs: Img[] = [];
  private used = 0;
  private readonly scene: Phaser.Scene;
  private readonly key: string;
  constructor(scene: Phaser.Scene, key: string) { this.scene = scene; this.key = key; }
  begin(): void { this.used = 0; }
  get(texture = this.key, frame: string | number = 0): Img {
    let img = this.imgs[this.used];
    if (!img) this.imgs.push((img = this.scene.add.image(0, 0, texture, frame)));
    this.used++;
    return img.setVisible(true).setTexture(texture, frame).setAlpha(1).setRotation(0).setFlipX(false).setOrigin(0.5).setScale(1);
  }
  end(): void {
    for (let i = 0; i < this.used; i++) {
      const img = this.imgs[i], k = sight.through(img.x, img.y, img.depth);
      if (k < 1) img.setAlpha(img.alpha * k);
    }
    for (let i = this.used; i < this.imgs.length; i++) this.imgs[i].setVisible(false);
  }
}

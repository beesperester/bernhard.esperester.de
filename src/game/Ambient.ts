import Phaser from 'phaser';
import type { Raster } from '../art/raster.ts';
import type { Prop } from '../art/tiles.ts';
import { Act, Prey } from './state.ts';
import type { CatView } from './CatView.ts';
import { TILE } from '../world/map.ts';
import { FAUNA, Birds, type Fauna, type FaunaContext, type PreyRef } from './fauna/index.ts';
import { Effects } from './fauna/Effects.ts';
import { PREY } from './fauna/prey.ts';

// The garden's wildlife as a whole: builds every fauna module (fauna/index.ts),
// updates them each frame, collects what can be caught, and settles catches.

type Pt = [number, number];

/** Prey this far above or below a cat's paws is out of reach (a ledge between them). */
const REACH_BELOW = 4, REACH_ABOVE = 16;
/** A catch is remembered (so the prey stays gone) for this many catches. */
const REMEMBER_CATCHES = 256;
/** A garden clock jump bigger than this (ms) isn't treated as time passing. */
const CLOCK_JUMP = 5000;

const preyKey = (kind: Prey, id: number) => kind * 1e10 + id;

export class Ambient {
  private readonly scene: Phaser.Scene;
  private readonly fauna: Fauna[];
  private readonly birds: Birds;
  /** Which module looks after each kind of prey's catches. */
  private readonly keepers = new Map<Prey, Fauna>();
  private readonly fx: Effects;
  private readonly caught = new Set<number>();
  private prey: PreyRef[] = [];
  private lastGt = -1;

  constructor(
    scene: Phaser.Scene,
    opts: { flowers: Pt[]; water: Raster; pond: { x: number; y: number; w: number; h: number }; trees: { p: Prop; canvas: HTMLCanvasElement }[] },
  ) {
    this.scene = scene;
    this.fx = new Effects(scene);
    const ctx: FaunaContext = { scene, ...opts, fx: this.fx, isCaught: (kind, id) => this.caught.has(preyKey(kind, id)) };
    this.fauna = FAUNA.map((make) => make(ctx));
    this.birds = this.fauna.find((f): f is Birds => f instanceof Birds)!;
    for (const f of this.fauna) for (const kind of f.catches ?? []) this.keepers.set(kind, f);
  }

  update(gt: number, dt: number, cats: CatView[], view: Phaser.Geom.Rectangle): void {
    if (this.lastGt < 0 || Math.abs(gt - this.lastGt) > CLOCK_JUMP) this.lastGt = gt;
    this.prey = [];
    const frame = { gt, prevGt: this.lastGt, now: this.scene.time.now, cats, prey: this.prey, view };
    for (const f of this.fauna) f.update(frame);
    this.fx.followCats(cats, frame.now);
    this.fx.update(dt);
    this.lastGt = gt;
  }

  /** A bird sitting in a tree near (x, y), for birdsong. */
  perchedBird(x: number, y: number, range: number): { x: number; y: number } | null {
    return this.birds.perchedNear(x, y, range);
  }

  /** The nearest catchable thing within a tile of this cat, if any (things on the wing only in mid-jump). */
  preyNear(cat: CatView): PreyRef | null {
    let best: PreyRef | null = null, bestDist = Infinity;
    for (const p of this.prey) {
      if (p.air && cat.act !== Act.Jump) continue;
      // fish are reached for a little in front of the paws
      const dx = p.x - cat.x, dy = p.y - (cat.y - (p.kind === Prey.Fish ? 3 : 0));
      if (Math.abs(dx) > TILE + 6 || Math.abs(dy) > TILE + 4) continue;
      // out of reach from the top of a ledge, or from below it
      if (p.h - cat.z < -REACH_BELOW || p.h - cat.z > REACH_ABOVE) continue;
      const d = dx * dx + dy * dy;
      if (d < bestDist) { bestDist = d; best = p; }
    }
    return best;
  }

  /**
   * A cat got it (this one, or another visitor's: catches come over the
   * network). It is gone for good; most prey fly into the cat's mouth, and
   * the module it belongs to adds its own touch (feathers, a splash, a bee
   * zooming off).
   */
  catchPrey(kind: Prey, id: number, cat: CatView): void {
    const key = preyKey(kind, id);
    if (this.caught.has(key)) return;
    this.caught.add(key);
    if (this.caught.size > REMEMBER_CATCHES) this.caught.delete(this.caught.values().next().value!);
    const p = this.prey.find((v) => v.kind === kind && v.id === id);
    if (!p) return;
    this.keepers.get(kind)?.onCatch?.(p, cat, this.lastGt);
    const info = PREY[kind];
    if (info.held) cat.heldKey = info.held(p.colour);
    if (!info.leap) return;
    const { texture, frame, seconds, centred } = info.leap;
    const img = this.fx.image(texture(p.colour), frame).setPosition(p.x, p.y - p.h);
    if (!centred) img.setOrigin(0.5, 1);
    this.fx.leap(img, cat, seconds);
  }
}

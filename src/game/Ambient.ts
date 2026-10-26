import Phaser from 'phaser';
import type { Raster } from '../art/raster.ts';
import { Pool, seedRng, hash2, lerp, smooth, clamp01 } from './fauna.ts';
import { BUTTERFLY_COLOURS, RIPPLE_FRAMES, Z_SIZES } from '../art/critters.ts';
import type { Prop } from '../art/tiles.ts';
import { Birds } from './Birds.ts';
import { NightLife } from './NightLife.ts';
import { DEPTH } from './Daylight.ts';
import { lightAt } from '../world/sky.ts';
import { Act, Facing, Prey, SWIPE_AT_MS } from './state.ts';
import { Wary, type Senses } from './Wary.ts';
import type { CatView } from './CatView.ts';
import { tileAt, wetAt, elevAt, TILE } from '../world/map.ts';
import { sound } from '../audio/sound.ts';

// All fauna is a deterministic function of a shared garden clock and fixed
// seeds, so every visitor sees the same fish, bees and butterflies without
// sending anything. Only interactions travel over the network (a catch),
// or are derived from cat states that are synced anyway (startled butterflies).

type Img = Phaser.GameObjects.Image;
type Pt = [number, number];

const strHash = (s: string) => [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);

// fish leaping out of the pond
const JUMP_SLOT = 1000, JUMP_P = 0.12, LEAP_DELAY = 350, LEAP_MS = 750;
// fish lingering just below the surface (catchable)
const SHALLOW_SLOT = 3000, SHALLOW_P = 0.4, SHALLOW_MAX_LIFE = 14000;
// bees
const BEES = 5, BEE_EPOCH = 45000, BEE_HOP = 4000;
// resting butterflies
const FLY_SLOT = 5000, FLY_P = 0.55, FLY_WINDOW = 50000, FLIGHT_MS = 6000, BURST_MS = 3000;
const DUST_SPEED = 110;
/** A stung-and-swatted bee zooms off for this long. */
const BEE_FLEE_MS = 1600;
/** Butterflies and bees below this height are within paw reach. */
const REACH_H = 14;
/** Resting butterflies and buzzing bees: sneak up, then pounce. */
const FLY_SENSES: Senses = { walking: 36, jumping: 40, hissing: 48, dashing: 64, notice: 30, react: 650, swipe: 28 };
const BEE_SENSES: Senses = { walking: 30, jumping: 36, hissing: 48, dashing: 56, notice: 26, react: 750, swipe: 26 };
/**
 * Fish lured by a paw splashing the water: one may come over from deeper water
 * (decided by the splash, so everyone sees the same fish), stays a while, and
 * swims off again.
 */
const LURE_P = 0.75, LURE_COME_MS = 1600, LURE_STAY_MS = 6500, LURE_GO_MS = 1800, LURE_EVERY_MS = 2500;
const LURE_FROM: [number, number] = [36, 90];

interface Jump { t0: number; x: number; y: number; dir: number }
interface Shallow { id: number; t0: number; life: number; a: Pt; b: Pt; period: number }
interface Butterfly { id: number; flower: Pt; colour: number; land: number; restMax: number }
interface Takeoff { t: number; dir: number }
interface Burst { t0: number; x: number; y: number; seed: number; n: number }
interface Lure { id: number; t0: number; at: Pt; from: Pt }

interface Particle {
  img: Img; kind: 'ripple' | 'drop' | 'z' | 'dust' | 'leap' | 'feather' | 'puff';
  x: number; y: number; z: number; vx: number; vy: number; vz: number;
  t: number; life: number; delay: number; cat?: CatView;
  /** Draw order, if not by its own ground position. */
  depth?: number;
}

/** Something catchable this frame. `y` is the ground point under it, `h` its height. */
export interface PreyRef { kind: Prey; id: number; x: number; y: number; h: number; colour: number }

const preyKey = (kind: Prey, id: number) => kind * 1e10 + id;

export class Ambient {
  private readonly scene: Phaser.Scene;
  private readonly flowers: Pt[];
  private readonly water: Raster;
  private readonly open: Pt[] = [];
  private readonly shore: Pt[] = [];
  /** For each flower, the other flowers within a short bee hop. */
  private readonly neighbours: number[][];

  private readonly jumps = new Map<number, Jump | null>();
  private readonly shallows = new Map<number, Shallow | null>();
  private readonly beeRoutes = new Map<string, number[]>();
  private readonly butterflies = new Map<number, Butterfly | null>();
  private readonly takeoffs = new Map<number, Takeoff>();
  private readonly caught = new Set<number>();
  private readonly fleeing = new Map<number, { t: number; x: number; y: number; h: number; dir: number }>();
  private bursts: Burst[] = [];
  private readonly burstKeys = new Set<string>();
  private particles: Particle[] = [];
  private readonly perCat = new WeakMap<CatView, { nextZ: number; nextDust: number; wet: boolean; swipe: number; nextLure: number }>();
  private lures: Lure[] = [];
  /** Bees that took fright (not caught, just gone). */
  private readonly shooed = new Set<number>();
  private readonly wary: Wary;
  private lastGt = -1;
  private prey: PreyRef[] = [];
  private readonly birds: Birds;
  private readonly night: NightLife;

  private readonly pools: Record<'fish' | 'shadow' | 'bee' | 'fly' | 'flyShadow', Pool>;

  constructor(
    scene: Phaser.Scene,
    opts: { flowers: Pt[]; water: Raster; pond: { x: number; y: number; w: number; h: number }; trees: { p: Prop; canvas: HTMLCanvasElement }[] },
  ) {
    this.scene = scene;
    this.birds = new Birds(scene, opts.trees, (id) => this.caught.has(preyKey(Prey.Bird, id)), (x, y, depth, loud) => {
      // a bird splashing in the bath: a few drops, now and then a little splish
      for (let i = 0; i < 3; i++)
        this.particles.push({
          img: this.scene.add.image(x, y, 'drop'), kind: 'drop',
          x: x + Math.random() * 4 - 2, y, z: 1, vx: Math.random() * 30 - 15, vy: 0, vz: 20 + Math.random() * 20,
          t: 0, life: 1, delay: 0, depth,
        });
      if (loud) this.splashSound(x, y, 0.12, 1.9);
    });
    this.night = new NightLife(scene, (kind, id) => this.caught.has(preyKey(kind, id)), {
      ripple: (x, y, d) => this.ripple(x, y, d),
      splash: (x, y, dir) => this.splash(x, y, dir),
      splashSound: (x, y, v, r) => this.splashSound(x, y, v, r),
    });
    this.wary = new Wary(scene);
    this.flowers = opts.flowers;
    this.water = opts.water;
    this.neighbours = this.flowers.map(([x, y], i) =>
      this.flowers.flatMap(([x2, y2], j) => (j !== i && Math.hypot(x2 - x, y2 - y) < 72 ? [j] : [])),
    );
    this.pools = {
      fish: new Pool(scene, 'fish'),
      shadow: new Pool(scene, 'fish-shadow'),
      bee: new Pool(scene, 'bee'),
      fly: new Pool(scene, 'butterfly-0'),
      flyShadow: new Pool(scene, 'shadow'),
    };
    // candidate spots for fish, identical for every visitor
    const { x, y, w, h } = opts.pond;
    const wet = (px: number, py: number) => this.water.isSet(Math.round(px), Math.round(py));
    for (let py = y + 4; py < y + h - 4; py += 3)
      for (let px = x + 4; px < x + w - 4; px += 3) {
        if (![[0, 0], [-6, 0], [6, 0], [0, -3], [0, 3]].every(([dx, dy]) => wet(px + dx, py + dy))) continue;
        const roomy = [[-14, 0], [14, 0], [0, -7], [0, 7], [-24, 0], [24, 0]].every(([dx, dy]) => wet(px + dx, py + dy));
        const nearLand = [[-12, 0], [12, 0], [0, -9], [0, 9]].some(([dx, dy]) => !wet(px + dx, py + dy));
        if (roomy) this.open.push([px, py]);
        else if (nearLand) this.shore.push([px, py]);
      }
  }

  // ---------------------------------------------------------------- public

  update(gt: number, dt: number, cats: CatView[], view: Phaser.Geom.Rectangle): void {
    if (this.lastGt < 0 || Math.abs(gt - this.lastGt) > 5000) this.lastGt = gt; // first frame or clock jump
    for (const p of Object.values(this.pools)) p.begin();
    this.prey = [];
    this.wary.begin();
    this.updateJumps(gt);
    this.updateShallows(gt);
    this.updateLures(gt);
    this.updateBees(gt, cats);
    this.updateButterflies(gt, cats);
    this.birds.update(gt, this.scene.time.now, cats, this.prey);
    this.night.update(gt, this.scene.time.now, cats, this.prey, view);
    this.updateCats(gt, cats);
    this.updateParticles(dt);
    for (const p of Object.values(this.pools)) p.end();
    this.wary.end();
    this.lastGt = gt;
  }

  /** A bird sitting in a tree near (x, y), for birdsong. */
  perchedBird(x: number, y: number, range: number): { x: number; y: number } | null {
    return this.birds.perchedNear(x, y, range);
  }

  /** The nearest catchable fish, butterfly, bee, bird, firefly or frog within a tile of this cat, if any. */
  preyNear(cat: CatView): PreyRef | null {
    let best: PreyRef | null = null, bd = Infinity;
    for (const p of this.prey) {
      const dx = p.x - cat.x, dy = p.y - (cat.y - (p.kind === Prey.Fish ? 3 : 0));
      if (Math.abs(dx) > TILE + 6 || Math.abs(dy) > TILE + 4) continue;
      // out of reach from the top of a ledge, or from below it
      if (p.h - cat.z < -4 || p.h - cat.z > REACH_H + 2) continue;
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  /**
   * A cat got it: a fish leaps into its mouth, a butterfly flutters into it,
   * a bird is snatched in a puff of feathers, a firefly goes out in a puff of
   * light, a frog is grabbed off the shore, and a bee stings and zooms off.
   */
  catchPrey(kind: Prey, id: number, cat: CatView): void {
    const key = preyKey(kind, id);
    if (this.caught.has(key)) return;
    this.caught.add(key);
    if (this.caught.size > 256) this.caught.delete(this.caught.values().next().value!);
    const p = this.prey.find((v) => v.kind === kind && v.id === id);
    if (!p) return;
    if (kind === Prey.Bee) {
      this.fleeing.set(id, { t: this.lastGt, x: p.x, y: p.y, h: p.h, dir: Math.sign(p.x - cat.x) || 1 });
      return;
    }
    if (kind === Prey.Fish) {
      this.splashSound(p.x, p.y, 0.45, 1.2);
      this.splash(p.x, p.y, 0);
      this.ripple(p.x, p.y, 0);
      this.ripple(p.x, p.y, 0.25);
    }
    if (kind === Prey.Bird) {
      cat.heldKey = `held-bird-${p.colour}`;
      for (let i = 0; i < 6; i++)
        this.particles.push({
          img: this.scene.add.image(p.x, p.y, `feather-${p.colour}`).setDepth(100000), kind: 'feather',
          x: p.x + Math.random() * 6 - 3, y: p.y - p.h - 3, z: 0, vx: Math.random() * 30 - 15, vy: -10 - Math.random() * 14, vz: 0,
          t: 0, life: 1.4 + Math.random() * 0.8, delay: 0,
        });
    }
    if (kind === Prey.Firefly) {
      const img = this.scene.add.image(p.x, p.y - p.h, 'glow-puff').setDepth(DEPTH.glow).setBlendMode(Phaser.BlendModes.ADD);
      this.particles.push({ img, kind: 'puff', x: p.x, y: p.y - p.h, z: 0, vx: 0, vy: 0, vz: 0, t: 0, life: 0.7, delay: 0 });
      return;
    }
    if (kind === Prey.Frog) cat.heldKey = 'held-frog';
    const img = kind === Prey.Fish ? this.scene.add.image(p.x, p.y, 'fish')
      : kind === Prey.Frog ? this.scene.add.image(p.x, p.y - p.h, 'frog', 0).setOrigin(0.5, 1)
      : kind === Prey.Bird ? this.scene.add.image(p.x, p.y - p.h, `bird-${p.colour}`, 2).setOrigin(0.5, 1)
      : this.scene.add.image(p.x, p.y - p.h, `butterfly-${p.colour}`, 1).setOrigin(0.5, 1);
    this.particles.push({ img: img.setDepth(100000), kind: 'leap', x: p.x, y: p.y - p.h, z: 0, vx: 0, vy: 0, vz: 0, t: 0, life: kind === Prey.Fish ? 0.3 : 0.18, delay: 0, cat });
  }

  // ---------------------------------------------------------------- fish

  private jumpAt(k: number): Jump | null {
    if (!this.jumps.has(k)) {
      let j: Jump | null = null;
      if (hash2(k, 1, 901) < JUMP_P && this.open.length) {
        const r = seedRng(k, 1);
        const [x, y] = this.open[Math.floor(r() * this.open.length)];
        j = { t0: k * JUMP_SLOT + r() * 500, x, y, dir: r() < 0.5 ? -1 : 1 };
      }
      this.jumps.set(k, j);
      if (this.jumps.size > 16) this.jumps.delete(this.jumps.keys().next().value!);
    }
    return this.jumps.get(k)!;
  }

  private updateJumps(gt: number): void {
    const crossed = (t: number) => this.lastGt < t && t <= gt;
    for (let k = Math.floor(gt / JUMP_SLOT) - 2; k <= Math.floor(gt / JUMP_SLOT); k++) {
      const j = this.jumpAt(k);
      if (!j) continue;
      const leap = j.t0 + LEAP_DELAY, land = leap + LEAP_MS;
      const lx = j.x + j.dir * 20;
      if (crossed(j.t0)) this.ripple(j.x, j.y, 0);
      if (crossed(leap)) { this.splash(j.x, j.y, j.dir); this.splashSound(j.x, j.y, 0.2, 1.3); }
      if (crossed(land)) { this.ripple(lx, j.y, 0); this.ripple(lx, j.y, 0.3); this.splash(lx, j.y, j.dir); this.splashSound(lx, j.y, 0.3, 1.15); }
      if (gt < leap || gt >= land) continue;
      const u = (gt - leap) / LEAP_MS;
      const h = 14 * 4 * u * (1 - u);
      // nose up, level, nose down, in 45° steps to stay pixel-crisp
      const tilt = Math.round((1 - 2 * u) * 1.4) * (Math.PI / 4);
      this.pools.fish.get().setFlipX(j.dir < 0)
        .setPosition(Math.round(lerp(j.x, lx, u)), Math.round(j.y - h))
        .setRotation(-tilt * j.dir).setDepth(j.y);
    }
  }

  private shallowAt(k: number): Shallow | null {
    if (!this.shallows.has(k)) {
      let s: Shallow | null = null;
      if (hash2(k, 2, 902) < SHALLOW_P) {
        const r = seedRng(k, 2);
        // out in the open water: to get one near the shore, lure it with a splash
        r();
        const spots = this.open;
        if (spots.length) {
          const a = spots[Math.floor(r() * spots.length)];
          let b: Pt = a;
          for (let i = 0; i < 6; i++) {
            const ang = r() * Math.PI * 2, len = 6 + r() * 14;
            const c: Pt = [a[0] + Math.cos(ang) * len, a[1] + Math.sin(ang) * len * 0.5];
            const mid: Pt = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
            if ([c, mid].every(([x, y]) => this.water.isSet(Math.round(x), Math.round(y)))) { b = c; break; }
          }
          s = { id: k, t0: k * SHALLOW_SLOT + r() * 1500, life: 6000 + r() * 8000, a, b, period: 5000 + r() * 4000 };
        }
      }
      this.shallows.set(k, s);
      if (this.shallows.size > 24) this.shallows.delete(this.shallows.keys().next().value!);
    }
    return this.shallows.get(k)!;
  }

  private updateShallows(gt: number): void {
    const k1 = Math.floor(gt / SHALLOW_SLOT);
    for (let k = Math.floor((gt - SHALLOW_MAX_LIFE) / SHALLOW_SLOT) - 1; k <= k1; k++) {
      const s = this.shallowAt(k);
      if (!s || this.caught.has(preyKey(Prey.Fish, s.id)) || gt < s.t0 || gt > s.t0 + s.life) continue;
      const ph = ((gt - s.t0) / s.period) * Math.PI * 2;
      const u = 0.5 - 0.5 * Math.cos(ph);
      const x = lerp(s.a[0], s.b[0], u), y = lerp(s.a[1], s.b[1], u);
      const heading = (s.b[0] - s.a[0]) * Math.sin(ph);
      const fade = Math.min(1, (gt - s.t0) / 1200, (s.t0 + s.life - gt) / 1500);
      const alpha = 0.42 * fade * (0.85 + 0.15 * Math.sin(gt / 300 + s.id));
      this.pools.shadow.get().setFlipX(heading < 0).setPosition(Math.round(x), Math.round(y)).setAlpha(alpha).setDepth(-99995);
      if (alpha > 0.15) this.prey.push({ kind: Prey.Fish, id: s.id, x, y, h: 0, colour: 0 });
    }
  }

  // ---------------------------------------------------------------- bees

  /** Flower indices a bee visits during one epoch, hopping between nearby flowers. */
  private beeRoute(b: number, e: number, hops: number): number[] {
    const key = `${b}:${e}`;
    let route = this.beeRoutes.get(key);
    if (!route) {
      route = [Math.floor(hash2(b, e, 903) * this.flowers.length)];
      this.beeRoutes.set(key, route);
      if (this.beeRoutes.size > 20) this.beeRoutes.delete(this.beeRoutes.keys().next().value!);
    }
    while (route.length <= hops) {
      const near = this.neighbours[route[route.length - 1]];
      const pickN = hash2(b, e, route.length, 3);
      route.push(near.length ? near[Math.floor(pickN * near.length)] : Math.floor(pickN * this.flowers.length));
    }
    return route;
  }

  private updateBees(gt: number, cats: CatView[]): void {
    if (!this.flowers.length) return;
    for (let b = 0; b < BEES; b++)
      for (let e = Math.floor(gt / BEE_EPOCH) - 1; e <= Math.floor(gt / BEE_EPOCH); e++) {
        const start = e * BEE_EPOCH + hash2(b, e, 904) * 15000;
        const dur = 22000 + hash2(b, e, 905) * 10000;
        const tau = gt - start;
        const id = e * BEES + b;
        if (tau < 0 || tau > dur || this.caught.has(preyKey(Prey.Bee, id)) || this.shooed.has(id) || lightAt(start).day < 0.5) continue;
        const i = Math.floor(tau / BEE_HOP), frac = (tau - i * BEE_HOP) / 1000;
        const route = this.beeRoute(b, e, i + 1);
        const [ax, ay] = this.flowers[route[i]], [bx, by] = this.flowers[route[i + 1]];
        const m = smooth(clamp01(frac));
        const spin = (hash2(b, e, 906) < 0.5 ? -1 : 1) * (2.5 + hash2(b, e, 907) * 2);
        const ang = (gt / 1000) * spin + b;
        const x = lerp(ax, bx, m) + Math.cos(ang) * 6;
        const y = lerp(ay, by, m) + Math.sin(ang) * 3;
        const h = 7 + Math.sin(gt / 250 + b) * 2 + lerp(elevAt(ax, ay), elevAt(bx, by), m);
        const alpha = Math.min(1, tau / 1000, (dur - tau) / 1000);
        if (alpha > 0.5) {
          const v = this.wary.watch(preyKey(Prey.Bee, id), x, y, h, cats, gt, this.scene.time.now, BEE_SENSES);
          if (!v.calm && !v.alert) {
            // buzzes off in a huff
            this.shooed.add(id);
            if (this.shooed.size > 64) this.shooed.delete(this.shooed.values().next().value!);
            this.fleeing.set(id, { t: gt, x, y, h, dir: Math.sign(x - v.cat.x) || 1 });
            continue;
          }
          if (!v.calm) this.wary.mark(x, y - h - 5);
        }
        this.pools.bee.get('bee', Math.floor(gt / 40) % 2)
          .setPosition(Math.round(x), Math.round(y - h)).setDepth(y)
          .setAlpha(alpha);
        if (alpha > 0.5) this.prey.push({ kind: Prey.Bee, id, x, y, h, colour: 0 });
      }

    // swatted bees zoom off in an angry zigzag
    for (const [id, f] of this.fleeing) {
      const tau = gt - f.t;
      if (tau > BEE_FLEE_MS || tau < 0) { this.fleeing.delete(id); continue; }
      const s = tau / 1000;
      const x = f.x + f.dir * (40 * s + 50 * s * s) + Math.sin(s * 30) * 3;
      const y = f.y - 12 * s;
      const h = f.h + 30 * s;
      this.pools.bee.get('bee', Math.floor(gt / 25) % 2)
        .setPosition(Math.round(x), Math.round(y - h)).setDepth(99000 + y)
        .setAlpha(clamp01((BEE_FLEE_MS - tau) / 500));
    }
  }

  // ---------------------------------------------------------------- butterflies

  private butterflyAt(k: number): Butterfly | null {
    if (!this.butterflies.has(k)) {
      let b: Butterfly | null = null;
      // butterflies only come out in daylight
      if (hash2(k, 4, 908) < FLY_P && this.flowers.length && lightAt(k * FLY_SLOT).day > 0.5) {
        const r = seedRng(k, 4);
        b = {
          id: k, flower: this.flowers[Math.floor(r() * this.flowers.length)],
          colour: Math.floor(r() * BUTTERFLY_COLOURS.length),
          land: k * FLY_SLOT + r() * 2000, restMax: 10000 + r() * 30000,
        };
      }
      this.butterflies.set(k, b);
      if (this.butterflies.size > 24) {
        const old = this.butterflies.keys().next().value!;
        this.butterflies.delete(old);
        this.takeoffs.delete(old);
      }
    }
    return this.butterflies.get(k)!;
  }

  /** Position of a butterfly flying away: closed form so it needs no state. */
  private flight(seed: number, tau: number, x0: number, y0: number, dir: number, fast: boolean): [number, number, number] {
    const r = seedRng(seed, 5);
    const speed = (fast ? 40 : 14) + r() * (fast ? 25 : 12);
    const vy = (r() - 0.6) * (fast ? 30 : 16);
    const vh = (fast ? 45 : 20) + r() * 12;
    const s = tau / 1000;
    // climb rate eases off towards 15% after ~2.5s
    const climb = s < 2.55 ? s - (s * s) / 6 : 2.55 - 2.55 ** 2 / 6 + (s - 2.55) * 0.15;
    return [x0 + dir * speed * s + Math.sin(s * 6) * 1.7, y0 + vy * s, 3 + vh * climb + Math.sin(s * 9) * 0.5];
  }

  private drawButterfly(id: number, colour: number, x: number, y: number, h: number, frame: number, alpha: number, lift = 0): void {
    if (h < REACH_H && alpha > 0.5) this.prey.push({ kind: Prey.Fly, id, x, y, h: h + lift, colour });
    h += lift;
    this.pools.fly.get(`butterfly-${colour}`, frame)
      .setOrigin(0.5, 1).setPosition(Math.round(x), Math.round(y - h))
      .setDepth(h - lift > 14 ? 99000 + y : y).setAlpha(alpha);
    this.pools.flyShadow.get().setScale(0.4, 0.5).setPosition(Math.round(x), Math.round(y - lift)).setDepth(y - 1)
      .setAlpha(Math.max(0, 0.18 - (h - lift) * 0.004) * alpha);
  }

  private updateButterflies(gt: number, cats: CatView[]): void {
    for (let k = Math.floor((gt - FLY_WINDOW) / FLY_SLOT); k <= Math.floor(gt / FLY_SLOT); k++) {
      const b = this.butterflyAt(k);
      if (!b || this.caught.has(preyKey(Prey.Fly, b.id))) continue;
      const [fx, fy] = b.flower;
      const lift = elevAt(fx, fy);
      let off = this.takeoffs.get(b.id);
      if (!off && gt >= b.land) {
        // it keeps an eye on the cats: sneak up, then pounce
        const v = this.wary.watch(preyKey(Prey.Fly, b.id), fx, fy, lift, cats, gt, this.scene.time.now, FLY_SENSES);
        if (!v.calm && !v.alert) off = { t: gt, dir: Math.sign(fx - v.cat.x) || 1 };
        else if (!v.calm) this.wary.mark(fx, fy - lift - 10);
        else if (gt >= b.land + b.restMax) off = { t: b.land + b.restMax, dir: hash2(b.id, 6, 909) < 0.5 ? -1 : 1 };
        if (off) this.takeoffs.set(b.id, off);
      }
      if (gt < b.land - 1200) continue;
      if (gt < b.land) {
        // fluttering down onto the flower
        const u = (gt - (b.land - 1200)) / 1200;
        this.drawButterfly(b.id, b.colour, fx + Math.sin(u * 8) * 3 * (1 - u), fy, lerp(40, 3, smooth(u)), Math.floor(gt / 90) % 2, Math.min(1, u * 2), lift);
      } else if (!off || gt < off.t) {
        // resting, wings slowly opening and closing
        this.drawButterfly(b.id, b.colour, fx, fy, 3, hash2(b.id, Math.floor(gt / 1300), 910) < 0.5 ? 0 : 1, 1, lift);
      } else if (gt < off.t + FLIGHT_MS) {
        const tau = gt - off.t;
        const [x, y, h] = this.flight(b.id, tau, fx, fy, off.dir, false);
        this.drawButterfly(b.id, b.colour, x, y, h, Math.floor(gt / 70) % 2, clamp01((FLIGHT_MS - tau) / 1500), lift);
      }
    }

    // bursts flushed out of the grass by dashing cats
    this.bursts = this.bursts.filter((u) => gt - u.t0 < BURST_MS);
    for (const u of this.bursts)
      for (let i = 0; i < u.n; i++) {
        const seed = (u.seed + i * 7919) >>> 0;
        if (this.caught.has(preyKey(Prey.Fly, seed))) continue;
        const r = seedRng(seed, 8);
        const tau = gt - u.t0 - r() * 150;
        if (tau < 0) continue;
        const [x, y, h] = this.flight(seed, tau, u.x + (r() - 0.5) * 14, u.y + (r() - 0.5) * 6, r() < 0.5 ? -1 : 1, true);
        this.drawButterfly(seed, Math.floor(r() * BUTTERFLY_COLOURS.length), x, y, h, Math.floor(gt / 45 + i) % 2, clamp01((BURST_MS - tau) / 1000), elevAt(u.x, u.y));
      }
  }

  // ---------------------------------------------------------------- cats

  private updateCats(gt: number, cats: CatView[]): void {
    const now = this.scene.time.now;
    for (const c of cats) {
      let s = this.perCat.get(c);
      if (!s) this.perCat.set(c, (s = { nextZ: 0, nextDust: 0, wet: false, swipe: -1, nextLure: 0 }));

      // a paw slapping the water splashes, and may lure a fish over
      if (c.act === Act.Catch && now - c.actStart >= SWIPE_AT_MS && s.swipe !== c.actStart) {
        s.swipe = c.actStart;
        const px = c.x + (c.facing === Facing.Right ? 11 : -11), py = c.y - 3;
        if (c.z < 4 && this.water.isSet(Math.round(px), Math.round(py))) {
          this.splash(px, py, Math.sign(px - c.x));
          this.ripple(px, py, 0);
          this.splashSound(px, py, 0.3, 1.4);
          if (now >= s.nextLure) {
            s.nextLure = now + LURE_EVERY_MS;
            this.lure(strHash(`${c.id}:${c.seq}`), gt, [px, py]);
          }
        }
      }

      // splash whenever a cat touches down in the pond
      const wet = c.z < 4 && wetAt(c.x, c.y);
      if (wet && !s.wet) { this.splashSound(c.x, c.y, 0.75, 1); this.splash(c.x, c.y, 0); this.splash(c.x, c.y, 0); this.ripple(c.x, c.y, 0); this.ripple(c.x, c.y, 0.25); }
      s.wet = wet;

      if (c.act === Act.Sleep && now >= s.nextZ) {
        s.nextZ = now + 850;
        const head = c.facing === Facing.Right ? 4 : -4;
        this.particles.push({
          img: this.scene.add.image(0, 0, 'z-0').setDepth(100000), kind: 'z',
          x: c.x + head, y: c.y - 8 - c.z, z: 0, vx: 4 + Math.random() * 4, vy: -9, vz: 0, t: 0, life: 2.4, delay: 0,
        });
      }

      const dashing = c.speed > DUST_SPEED && c.act !== Act.Jump;
      if (dashing && now >= s.nextDust) {
        s.nextDust = now + 70;
        const back = c.facing === Facing.Left ? 5 : c.facing === Facing.Right ? -5 : 0;
        this.particles.push({
          img: this.scene.add.image(0, 0, 'dust', 0).setDepth(c.y - 1), kind: 'dust',
          x: c.x + back + Math.random() * 2 - 1, y: c.y - 1 - c.z, z: 0, vx: back * 2, vy: -4, vz: 0, t: 0, life: 0.36, delay: 0,
        });
      }
      // dashing through grass flushes out butterflies (at most once per cat per 3s slot)
      if (dashing && ',f.'.includes(tileAt(Math.floor(c.x / TILE), Math.floor((c.y - 2) / TILE)))) {
        const slot = Math.floor(gt / 3000);
        const key = `${c.id}:${slot}`;
        if (!this.burstKeys.has(key)) {
          this.burstKeys.add(key);
          if (this.burstKeys.size > 64) this.burstKeys.delete(this.burstKeys.values().next().value!);
          const seed = strHash(key);
          if (lightAt(gt).day > 0.5) this.bursts.push({ t0: gt, x: c.x, y: c.y, seed, n: 4 + (seed % 4) });
        }
      }
    }
  }

  // ---------------------------------------------------------------- lured fish

  /** Maybe bring a fish over from deeper water to a splash at `at`. */
  private lure(seed: number, gt: number, at: Pt): void {
    const r = seedRng(seed, 40);
    if (r() >= LURE_P || this.lures.length >= 4) return;
    const wet = ([x, y]: Pt) => this.water.isSet(Math.round(x), Math.round(y));
    // where it comes from: open water within reach, with water all the way
    const from = [...this.open, ...this.shore].filter(([x, y]) => {
      const d = Math.hypot(x - at[0], y - at[1]);
      if (d < LURE_FROM[0] || d > LURE_FROM[1]) return false;
      for (let i = 1; i < 8; i++) if (!wet([lerp(x, at[0], i / 8), lerp(y, at[1], i / 8)])) return false;
      return true;
    });
    if (!from.length) return;
    const id = 1e9 + (seed % 1e8);
    if (this.lures.some((l) => l.id === id)) return;
    this.lures.push({ id, t0: gt, at, from: from[Math.floor(r() * from.length)] });
  }

  private updateLures(gt: number): void {
    this.lures = this.lures.filter((l) => gt - l.t0 < LURE_COME_MS + LURE_STAY_MS + LURE_GO_MS && !this.caught.has(preyKey(Prey.Fish, l.id)));
    for (const l of this.lures) {
      const tau = gt - l.t0;
      const [fx, fy] = l.from, [ax, ay] = l.at;
      // nosing about a little in front of the paw
      const wig = Math.sin(gt / 420 + l.id) * 3;
      const sx = ax + wig, sy = ay + Math.sin(gt / 610 + l.id) * 1.2 + 1;
      const k = tau < LURE_COME_MS ? smooth(tau / LURE_COME_MS)
        : tau < LURE_COME_MS + LURE_STAY_MS ? 1
        : 1 - smooth((tau - LURE_COME_MS - LURE_STAY_MS) / LURE_GO_MS);
      const x = lerp(fx, sx, k), y = lerp(fy, sy, k);
      const leaving = tau >= LURE_COME_MS + LURE_STAY_MS;
      const heading = tau < LURE_COME_MS ? ax - fx : leaving ? fx - ax : Math.cos(gt / 420 + l.id);
      const alpha = 0.45 * Math.min(1, tau / 600, leaving ? 1 - (tau - LURE_COME_MS - LURE_STAY_MS) / LURE_GO_MS : 1);
      this.pools.shadow.get().setFlipX(heading < 0).setPosition(Math.round(x), Math.round(y)).setAlpha(alpha).setDepth(-99995);
      if (alpha > 0.15) this.prey.push({ kind: Prey.Fish, id: l.id, x, y, h: 0, colour: 0 });
    }
  }

  // ---------------------------------------------------------------- effects

  private ripple(x: number, y: number, delay: number): void {
    const img = this.scene.add.image(Math.round(x), Math.round(y), 'ripple', 0).setDepth(-99980).setVisible(false);
    this.particles.push({ img, kind: 'ripple', x, y, z: 0, vx: 0, vy: 0, vz: 0, t: 0, life: 1.2, delay });
  }

  private splashSound(x: number, y: number, volume: number, rate: number): void {
    void sound.play('splash', { at: { x, y }, volume, rate: rate * (0.92 + Math.random() * 0.16) });
  }

  private splash(x: number, y: number, dir: number): void {
    for (let i = 0; i < 7; i++)
      this.particles.push({
        img: this.scene.add.image(x, y, 'drop'), kind: 'drop',
        x: x + Math.random() * 6 - 3, y: y + Math.random() * 2 - 1, z: 1,
        vx: Math.random() * 36 - 18 + dir * 8, vy: Math.random() * 8 - 4, vz: 25 + Math.random() * 30,
        t: 0, life: 2, delay: 0,
      });
  }

  private updateParticles(dt: number): void {
    const keep: Particle[] = [];
    for (const p of this.particles) {
      if (p.delay > 0) { p.delay -= dt; keep.push(p); continue; }
      p.t += dt;
      const u = p.t / p.life;
      let dead = u >= 1;
      switch (p.kind) {
        case 'ripple':
          p.img.setVisible(true).setFrame(Math.min(RIPPLE_FRAMES - 1, Math.floor(u * RIPPLE_FRAMES))).setAlpha(1 - u);
          break;
        case 'drop':
          p.vz -= 220 * dt;
          p.z += p.vz * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          if (p.z <= 0) dead = true;
          p.img.setPosition(Math.round(p.x), Math.round(p.y - p.z)).setDepth(p.depth ?? p.y + 1);
          break;
        case 'z': {
          // drifts up from the cat, growing as it goes, then fades
          p.x += (p.vx + Math.sin(p.t * 3) * 6) * dt;
          p.y += p.vy * dt;
          const size = Math.min(Z_SIZES.length - 1, Math.floor(u * Z_SIZES.length));
          p.img.setTexture(`z-${size}`).setPosition(Math.round(p.x), Math.round(p.y)).setAlpha(u > 0.75 ? (1 - u) / 0.25 : 1);
          break;
        }
        case 'dust':
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.img.setFrame(Math.min(2, Math.floor(u * 3))).setPosition(Math.round(p.x), Math.round(p.y)).setAlpha(1 - u * 0.5);
          break;
        case 'puff':
          // a caught firefly's light swells and fades
          p.img.setScale(1 + u * 1.5).setAlpha(1 - u);
          break;
        case 'feather':
          // burst up, then sway down slowly
          p.vy = Math.min(p.vy + 40 * dt, 9);
          p.vx *= 1 - 2 * dt;
          p.x += (p.vx + Math.sin(p.t * 7 + p.life * 10) * 8) * dt;
          p.y += p.vy * dt;
          p.img.setPosition(Math.round(p.x), Math.round(p.y)).setAlpha(u > 0.6 ? (1 - u) / 0.4 : 1);
          break;
        case 'leap': {
          // caught fish arcs from the water into the cat's mouth
          const c = p.cat!;
          const mx = c.x + (c.facing === Facing.Right ? 6 : -6), my = c.y - 7 - c.z;
          const e = clamp01(u);
          p.img.setFlipX(mx > p.x).setPosition(Math.round(lerp(p.x, mx, e)), Math.round(lerp(p.y, my, e) - 12 * 4 * e * (1 - e)));
          break;
        }
      }
      if (dead) p.img.destroy();
      else keep.push(p);
    }
    this.particles = keep;
  }
}

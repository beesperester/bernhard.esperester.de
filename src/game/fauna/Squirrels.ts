import { Act, Prey } from '../state.ts';
import { Wary, type Senses } from './Wary.ts';
import type { CatView } from '../CatView.ts';
import { FORK_Z, LEVEL, TILE, furnished, groundAt, levelAt, tileAt } from '../../world/map.ts';
import { isOpenGround } from '../../world/legend.ts';
import { TREES, RISE, type TreePlan } from '../../world/trees.ts';
import { Fruit, fruitOf } from '../../world/fruit.ts';
import { lightAt } from '../../world/sky.ts';
import { seasonAt, type Season } from '../../world/season.ts';
import { sound } from '../../audio/sound.ts';
import { Pool, seedRng, hash2, clamp01, remember, type Fauna, type FaunaContext, type FaunaFrame, type PreyRef } from './kit.ts';

// Fruit and squirrels. The trees drop what they bear (acorns and hazelnuts in
// autumn, cherries in early summer, apples in late summer, pine cones all
// year), now and then by themselves and more often when a cat paws at the
// trunk. Red squirrels live in some of the trees: by day they come down to
// hop about under their tree, and anything that falls near it brings one
// straight down to fetch it and sit nibbling. A cat that comes too close
// sends it back up the trunk. On the ground a squirrel can be caught.
//
// Fruit that falls by itself, and the squirrels' outings, follow from the
// garden clock like the rest of the fauna. A pawed-at tree is news that
// travels over the network (GardenScene sends it); what falls then follows
// from the tree and the moment, so everyone sees the same fruit.

type Pt = [number, number];


/** A tree may drop something by itself every FALL_SLOT ms (when it bears anything). */
const FALL_SLOT = 25000, FALL_P = 0.12;
/** A squirrel notices something that fell by itself only now and then (a shaken tree, always: the rustle). */
const NOTICE_P = 0.35;
/** Fruit lies about this long before it's gone (ms). */
const FRUIT_LIFE = 150000;
/** A paw at a laden tree shakes something down this often. */
const SHAKE_P = 0.55;
/** How far from its tree a squirrel will come for fruit, and wander about on its own (px). */
const ATTRACT = 110, WANDER = 48;
/** A resident squirrel may come down every OUT_SLOT ms. */
const OUT_SLOT = 40000, OUT_P = 0.45;
const RUN_SPEED = 62, HOP_SPEED = 34, CLIMB_SPEED = 30, FLEE_SPEED = 95;
/** How long it sits nibbling what it fetched, and how long a fled squirrel sits up the tree. */
const NIBBLE_MS = 3200, SULK_MS = 7000;
/** Hops in little legs, then a stop to look about. */
const LEG_MS = 1500, HOP_MS = 600;
const SENSES: Senses = { walking: 34, jumping: 44, hissing: 52, dashing: 60, notice: 26, react: 450, swipe: 22 };
/** Where on the trunk a squirrel climbs, from its foot (px across). */
const TRUNK_SIDE = 4;

export interface FruitDrop {
  id: number; tree: number; kind: Fruit;
  /** Where it lands, and when (garden clock). */
  x: number; y: number; t: number;
  /** Shaken down by a cat at this garden time (to tell cats arriving later). */
  shook?: number;
  /** How high it fell from (px). */
  z0: number;
}


/** A squirrel's trip down from its tree: to wander about, or to fetch a fruit. */
interface Trip {
  id: number; tree: number;
  /** When it starts down the trunk, and from how high. */
  t0: number; z: number;
  /** Where it goes on the ground, and for how long it wanders there (0 for a fetch). */
  to: Pt; wander: number;
  fruit: FruitDrop | null;
}
interface Pose { x: number; y: number; z: number; frame: number; right: boolean; alpha: number; climbing: boolean }
/**
 * A squirrel that took fright: back to its tree and up it. One up the tree
 * that a cat comes up to bolts off into the crown (`gone`: when, from where).
 */
interface Flight { t: number; from: Pt; ms: number; gone?: { t: number; x: number; z: number } }

export class Squirrels implements Fauna {
  readonly catches = [Prey.Squirrel] as const;
  private readonly squirrels: Pool;
  private readonly fruit: Pool;
  private readonly wary: Wary;
  private readonly isCaught: (id: number) => boolean;
  /** Trees a squirrel lives in. */
  private readonly homes: number[];
  private readonly falls = new Map<number, FruitDrop | null>();
  private readonly outings = new Map<number, Trip | null>();
  /** Fruit shaken down by cats. */
  private readonly shaken: FruitDrop[] = [];
  /** Fruit fetched by a squirrel: gone from then on. */
  private readonly eaten = new Map<number, number>();
  private readonly fled = new Map<number, Flight>();
  private season: { at: number; s: Season } = { at: -Infinity, s: seasonAt(0) };

  constructor({ scene, isCaught }: FaunaContext) {
    this.isCaught = (id) => isCaught(Prey.Squirrel, id);
    this.squirrels = new Pool(scene, 'squirrel');
    this.fruit = new Pool(scene, 'fruit');
    this.wary = new Wary(scene);
    this.homes = TREES.map((t, i) => (t.shape !== 'treehouse' && hash2(t.tx, t.ty, 1201) < 0.4 ? i : -1)).filter((i) => i >= 0);
  }

  private seasonNow(gt: number): Season {
    if (Math.abs(gt - this.season.at) > 60000) this.season = { at: gt, s: seasonAt(gt) };
    return this.season.s;
  }

  /**
   * A cat pawed at tree `tree` at garden time `gt` (this one, or another's,
   * over the network): maybe something falls. True if it did.
   */
  shake(tree: number, gt: number, quiet = false): boolean {
    const t = TREES[tree];
    if (!t || this.shaken.some((f) => f.tree === tree && Math.abs(f.shook! - gt) < 400)) return false;
    if (!quiet) void sound.play('rustle', { at: { x: t.x, y: t.y }, volume: 0.5, rate: 0.9 + hash2(tree, gt, 1202) * 0.2 });
    const { kind, amount } = fruitOf(t, this.seasonNow(gt));
    if (hash2(tree, gt, 1203) >= SHAKE_P * amount) return false;
    const f = this.drop(tree, kind, gt, 2e9 + ((tree * 7919 + Math.floor(gt / 10)) % 1e9), seedRng(tree, gt, 1204));
    if (f) this.shaken.push({ ...f, shook: gt });
    while (this.shaken.length > 40) this.shaken.shift();
    return !!f;
  }

  /** The shakes that brought down fruit still lying about (or being fetched) at garden time gt: [tree, gt]. */
  shakes(gt: number): [number, number][] {
    return this.shaken.filter((f) => gt - f.t < FRUIT_LIFE).map((f) => [f.tree, f.shook!]);
  }

  /** Something falls from tree `tree` from garden time t: where it lands, if anywhere it can lie. */
  private drop(tree: number, kind: Fruit, t: number, id: number, r: () => number): FruitDrop | null {
    const p = TREES[tree];
    const x = p.x + (r() - 0.5) * p.w * 0.7, y = p.y - 4 + r() * 16;
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    if (!isOpenGround(tileAt(tx, ty)) || furnished(tx, ty) || groundAt(x, y) !== levelAt(tx, ty) * LEVEL) return null;
    // from somewhere in the crown, falling with gravity
    const z0 = 26 + r() * 30;
    return { id, tree, kind, x, y, t: t + Math.sqrt((2 * z0) / 600) * 1000, z0 };
  }

  private fallAt(tree: number, k: number): FruitDrop | null {
    const key = tree * 1e5 + (k % 1e5);
    if (!this.falls.has(key)) {
      let f: FruitDrop | null = null;
      const t0 = k * FALL_SLOT;
      const { kind, amount } = fruitOf(TREES[tree], this.seasonNow(t0));
      if (amount > 0 && hash2(tree, k, 1205) < FALL_P * amount) {
        const r = seedRng(tree, k, 1206);
        f = this.drop(tree, kind, t0 + r() * FALL_SLOT, key, r);
      }
      remember(this.falls, key, f, 600);
    }
    return this.falls.get(key)!;
  }

  update({ gt, now, cats, prey, view }: FaunaFrame): void {
    this.squirrels.begin();
    this.fruit.begin();
    this.wary.begin();
    const near = (x: number, y: number, m: number) => x > view.x - m && x < view.right + m && y > view.y - m && y < view.bottom + m;
    // the fruit lying about near here
    const lying: FruitDrop[] = [];
    TREES.forEach((t, i) => {
      if (!near(t.x, t.y, ATTRACT + 60)) return;
      for (let k = Math.floor((gt - FRUIT_LIFE) / FALL_SLOT); k <= Math.floor(gt / FALL_SLOT); k++) {
        const f = this.fallAt(i, k);
        if (f) lying.push(f);
      }
    });
    for (const f of this.shaken) if (near(f.x, f.y, ATTRACT + 60)) lying.push(f);
    const day = lightAt(gt).night < 0.4;
    for (const f of lying) this.drawFruit(f, gt);
    // squirrels: out wandering under their tree now and then, and down for any fruit near it
    const winter = this.seasonNow(gt).snow > 0.5 ? 0.4 : 1;
    for (const tree of this.homes) {
      const t = TREES[tree];
      if (!near(t.x, t.y, ATTRACT + 40)) continue;
      if (day) for (let k = Math.floor((gt - 40000) / OUT_SLOT); k <= Math.floor(gt / OUT_SLOT); k++) {
        const trip = this.outingAt(tree, k, winter);
        if (trip) this.updateTrip(trip, gt, now, cats, prey);
      }
      for (const f of lying) {
        if (Math.hypot(f.x - t.x, f.y - t.y) > ATTRACT || levelAt(Math.floor(f.x / TILE), Math.floor(f.y / TILE)) * LEVEL !== t.elev) continue;
        // the nearest home tree goes for it
        if (f.id < 2e9 && hash2(f.id, 1214) >= NOTICE_P) continue;
        if (this.homes.some((h) => h !== tree && Math.hypot(f.x - TREES[h].x, f.y - TREES[h].y) < Math.hypot(f.x - t.x, f.y - t.y))) continue;
        const r = seedRng(f.id, 1207);
        const trip: Trip = { id: 3e9 + (f.id % 1e9), tree, t0: f.t + 1200 + r() * 2500, z: this.perchZ(t, r()), to: [f.x, f.y], wander: 0, fruit: f };
        if (day || hash2(f.id, 1208) < 0.2) this.updateTrip(trip, gt, now, cats, prey);
      }
    }
    this.squirrels.end();
    this.fruit.end();
    this.wary.end();
  }

  private drawFruit(f: FruitDrop, gt: number): void {
    const eaten = this.eaten.get(f.id);
    const fallStart = f.t - Math.sqrt((2 * f.z0) / 600) * 1000;
    if (gt < fallStart || gt > f.t + FRUIT_LIFE || (eaten !== undefined && gt >= eaten)) return;
    const elev = levelAt(Math.floor(f.x / TILE), Math.floor(f.y / TILE)) * LEVEL;
    let z = 0;
    if (gt < f.t) {
      const s = (gt - fallStart) / 1000;
      z = Math.max(0, f.z0 - 300 * s * s);
    } else if (gt < f.t + 260) {
      // one little bounce
      const u = (gt - f.t) / 260;
      z = 4 * u * (1 - u) * 4;
    }
    if (gt >= f.t && gt - 16 < f.t) void sound.play('steps', { at: { x: f.x, y: f.y }, volume: 0.25, rate: 2.4 });
    // fades away at the end of its life; falling fruit is drawn in front of its tree
    const fade = clamp01((f.t + FRUIT_LIFE - gt) / 3000);
    const depth = gt < f.t ? TREES[f.tree].y + 0.3 : f.y;
    this.fruit.get('fruit', f.kind).setOrigin(0.5, 1).setPosition(Math.round(f.x), Math.round(f.y - elev - z)).setDepth(depth).setAlpha(fade);
  }

  /** A perch for a squirrel to come down from: a low branch, picked by u (0..1). */
  private perchZ(t: TreePlan, u: number): number {
    const low = t.perches.filter((p) => p.kind !== 'stump' && p.z0 <= FORK_Z + RISE * 2);
    return (low[Math.floor(u * low.length)] ?? t.perches[0]).z0;
  }

  private outingAt(tree: number, k: number, winter: number): Trip | null {
    const key = tree * 1e5 + (k % 1e5);
    if (!this.outings.has(key)) {
      let trip: Trip | null = null;
      if (hash2(tree, k, 1209) < OUT_P * winter) {
        const r = seedRng(tree, k, 1210);
        const t = TREES[tree];
        const a = r() * Math.PI * 2, d = 16 + r() * (WANDER - 16);
        const to: Pt = [t.x + Math.cos(a) * d, t.y + 4 + Math.sin(a) * d * 0.6];
        if (this.walkable(to, t.elev)) trip = { id: key, tree, t0: k * OUT_SLOT + r() * (OUT_SLOT - 30000), z: this.perchZ(t, r()), to, wander: 8000 + r() * 12000, fruit: null };
      }
      remember(this.outings, key, trip, 400, (old) => this.fled.delete(old));
    }
    return this.outings.get(key)!;
  }

  private walkable([x, y]: Pt, elev: number): boolean {
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    return isOpenGround(tileAt(tx, ty)) && !furnished(tx, ty) && groundAt(x, y) === elev;
  }

  /** Where a squirrel on its trip is at garden time gt, or null if it isn't out. */
  private pose(trip: Trip, gt: number): Pose | null {
    const t = TREES[trip.tree];
    const foot: Pt = [t.x + t.trunk - TRUNK_SIDE, t.y + 1];
    const climb = (trip.z / CLIMB_SPEED) * 1000;
    const [tx, ty] = trip.to;
    const run = (Math.hypot(tx - foot[0], ty - foot[1]) / RUN_SPEED) * 1000;
    const stay = trip.fruit ? NIBBLE_MS : trip.wander;
    const phases = [climb, run, stay, run, climb];
    let tau = gt - trip.t0;
    if (tau < 0) return null;
    const at = (p: Pt, q: Pt, u: number): [number, number] => [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u];
    const hop = (ms: number) => 1 + (Math.floor(ms / 110) % 2);
    for (let i = 0; i < phases.length; i++) {
      if (tau >= phases[i]) { tau -= phases[i]; continue; }
      const u = tau / phases[i];
      switch (i) {
        case 0: return { x: foot[0], y: foot[1], z: trip.z * (1 - u), frame: 4, right: false, alpha: clamp01(tau / 300), climbing: true };
        case 1: { const [x, y] = at(foot, trip.to, u); return { x, y, z: 0, frame: hop(tau), right: tx > foot[0], alpha: 1, climbing: false }; }
        case 2: {
          if (trip.fruit) return { x: tx, y: ty, z: 0, frame: 3, right: tx < foot[0], alpha: 1, climbing: false };
          return this.wanderPose(trip, tau);
        }
        case 3: {
          // (a wanderer heads home from wherever its wandering ended)
          const from = trip.fruit ? trip.to : (() => { const w = this.wanderPose(trip, trip.wander); return [w.x, w.y] as Pt; })();
          const [x, y] = at(from, foot, u);
          return { x, y, z: 0, frame: hop(tau), right: foot[0] > from[0], alpha: 1, climbing: false };
        }
        default: return { x: foot[0], y: foot[1], z: trip.z * u, frame: 4, right: false, alpha: clamp01((phases[4] - tau) / 300), climbing: true };
      }
    }
    return null;
  }

  /** A wandering squirrel `tau` ms into its wander: hop, stop and sit up, hop on, never far from its tree. */
  private wanderPose(trip: Trip, tau: number): Pose {
    const t = TREES[trip.tree];
    let [x, y] = trip.to, dir = hash2(trip.id, 1211) * Math.PI * 2;
    for (let leg = 0; ; leg++) {
      const m = Math.min(tau - leg * LEG_MS, HOP_MS);
      if (leg) dir += (hash2(trip.id, leg, 1212) - 0.5) * 2.6;
      // drawn back towards the tree when it strays
      if (Math.hypot(x - t.x, y - t.y) > WANDER) dir = Math.atan2(t.y - y, t.x - x);
      const step = (HOP_SPEED * Math.max(0, m)) / 1000;
      let nx = x + Math.cos(dir) * step, ny = y + Math.sin(dir) * step * 0.6;
      if (!this.walkable([nx, ny], t.elev)) { dir += Math.PI; nx = x; ny = y; }
      if (tau < (leg + 1) * LEG_MS) {
        const moving = m > 0 && m < HOP_MS;
        return { x: nx, y: ny, z: 0, frame: moving ? 1 + (Math.floor(m / 110) % 2) : 0, right: Math.cos(dir) > 0, alpha: 1, climbing: false };
      }
      x = nx;
      y = ny;
    }
  }

  private updateTrip(trip: Trip, gt: number, now: number, cats: CatView[], prey: PreyRef[]): void {
    if (this.isCaught(trip.id)) return;
    const t = TREES[trip.tree];
    const f = this.fled.get(trip.id);
    let p: Pose | null;
    if (f) {
      p = this.flightPose(trip, f, gt);
      if (!p) return;
    } else {
      p = this.pose(trip, gt);
      if (!p) return;
      // got to its fruit: it's gone from the grass now
      if (trip.fruit && p.frame === 3 && !this.eaten.has(trip.fruit.id)) remember(this.eaten, trip.fruit.id, gt, 200);
      if (!p.climbing) {
        const v = this.wary.watch(trip.id, p.x, p.y, t.elev, cats, gt, now, SENSES);
        if (!v.calm && !v.alert) {
          this.fled.set(trip.id, { t: gt, from: [p.x, p.y], ms: (Math.hypot(t.x + t.trunk - TRUNK_SIDE - p.x, t.y + 1 - p.y) / FLEE_SPEED) * 1000 });
          this.wary.forget(trip.id);
          void sound.play('rustle', { at: { x: p.x, y: p.y }, volume: 0.3, rate: 2.4 });
          p = this.flightPose(trip, this.fled.get(trip.id)!, gt)!;
        } else if (!v.calm) {
          this.wary.mark(p.x, p.y - t.elev - 9);
          p.frame = 0;
        }
      }
    }
    if (!p) return;
    // up the tree: a cat climbing up to it (and not creeping) sends it off into the crown
    if (p.climbing && !this.fled.get(trip.id)?.gone) {
      const sz = t.elev + p.z;
      const c = cats.find((c) => c.z > t.elev + 4 && Math.abs(c.z - sz) < 16 && Math.abs(c.x - p.x) < 30 && Math.abs(c.y - t.y) < 14
        && c.act !== Act.Crouch && c.act !== Act.Sneak && c.act !== Act.Catch && (c.speed > 5 || c.act === Act.Jump));
      if (c) {
        this.fled.set(trip.id, { t: gt, from: [p.x, p.y], ms: 0, gone: { t: gt, x: p.x, z: p.z } });
        void sound.play('rustle', { at: { x: p.x, y: p.y }, volume: 0.4, rate: 1.6 });
      }
    }
    // on the trunk it is drawn in front of its tree
    const depth = p.climbing ? t.y + 0.7 : p.y;
    this.squirrels.get('squirrel', p.frame).setOrigin(0.5, 1).setFlipX(p.right)
      .setPosition(Math.round(p.x), Math.round(p.y - t.elev - p.z)).setDepth(depth).setAlpha(p.alpha);
    // on the ground, on the trunk or sitting on a branch, a cat in reach can get it
    if (p.alpha > 0.5) prey.push({ kind: Prey.Squirrel, id: trip.id, x: p.x, y: p.y, h: t.elev + p.z, colour: 0 });
  }

  /** A fled squirrel: a dash to its trunk, up it, a sulk on a branch, and gone into the crown. */
  private flightPose(trip: Trip, f: Flight, gt: number): Pose | null {
    const t = TREES[trip.tree];
    const foot: Pt = [t.x + t.trunk - TRUNK_SIDE, t.y + 1];
    const up = FORK_Z + RISE;
    if (f.gone) {
      // scrambling up into the leaves and out of sight
      const u = (gt - f.gone.t) / 450;
      return u >= 1 ? null : { x: f.gone.x, y: foot[1], z: f.gone.z + u * 14, frame: 4, right: false, alpha: 1 - u, climbing: true };
    }
    let tau = gt - f.t;
    if (tau < f.ms) {
      const u = tau / f.ms;
      return { x: f.from[0] + (foot[0] - f.from[0]) * u, y: f.from[1] + (foot[1] - f.from[1]) * u, z: 0, frame: 1 + (Math.floor(tau / 70) % 2), right: foot[0] > f.from[0], alpha: 1, climbing: false };
    }
    tau -= f.ms;
    const climb = (up / (CLIMB_SPEED * 2.5)) * 1000;
    if (tau < climb) return { x: foot[0], y: foot[1], z: (up * tau) / climb, frame: 4, right: false, alpha: 1, climbing: true };
    tau -= climb;
    if (tau > SULK_MS) return null;
    return { x: foot[0] + 3, y: foot[1], z: up, frame: 0, right: hash2(trip.id, 1213) < 0.5, alpha: clamp01((SULK_MS - tau) / 600), climbing: true };
  }

  onCatch(p: PreyRef): void {
    this.fled.delete(p.id);
  }
}


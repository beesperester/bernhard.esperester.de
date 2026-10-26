import { Act, Facing, Prey, SWIPE_AT_MS } from '../state.ts';
import type { CatView } from '../CatView.ts';
import type { Raster } from '../../art/raster.ts';
import { lightAt } from '../../world/sky.ts';
import type { Effects } from './Effects.ts';
import { Pool, clamp01, hash2, lerp, remember, seedRng, smooth, strHash, type Fauna, type FaunaContext, type FaunaFrame, type PreyRef } from './kit.ts';

// Koi in the ponds. Some leap out of the water now and then (just for show);
// others linger as shadows just under the surface, out in the open water. A
// cat on the bank can't reach those, but slapping the water with a paw may
// lure one over: see LURE_*.

type Pt = [number, number];

/** A leap may happen every LEAP_SLOT ms with probability LEAP_P: a ripple, then after LEAP_DELAY a LEAP_MS arc. */
const LEAP_SLOT = 1000, LEAP_P = 0.12, LEAP_DELAY = 350, LEAP_MS = 750;
/** A fish may come up under the surface every SHALLOW_SLOT ms; none stays longer than SHALLOW_MAX_LIFE. */
const SHALLOW_SLOT = 3000, SHALLOW_P = 0.4, SHALLOW_MAX_LIFE = 14000;
/** Shadows fainter than this are too deep to catch. */
const CATCHABLE_ALPHA = 0.15;
/**
 * Fish lured by a paw splashing the water: one may come over from deeper water
 * (decided by the splash, so everyone sees the same fish) and wait, curious,
 * a little way off. It only creeps up to the paw while the cat crouches
 * quite still; splashing again, getting up and walking, hissing or jumping
 * before then scares it off. At the paw it stays a while for the catch.
 *
 * LURE_P is the best chance a splash has; it takes calm water (LURE_CALM_MS
 * since the last splash), the right time of day and plenty of water around.
 */
const LURE_P = 0.5, LURE_CALM_MS = 8000, LURE_COME_MS = 1600, LURE_GO_MS = 1800, LURE_EVERY_MS = 2500;
/** How far off (px) a lured fish comes from. */
const LURE_FROM: [number, number] = [36, 90];
/** How far along it waits, how long it waits for a crouch, how long the creeping up takes, how long it stays at the paw. */
const LURE_WAIT_K = 0.35, LURE_WAIT_MS = 7000, LURE_CREEP_MS = 2400, LURE_STAY_MS = 5000;
/** At most this many lured fish at once. */
const MAX_LURES = 4;

interface Leap { t0: number; x: number; y: number; dir: number }
interface Shallow { id: number; t0: number; life: number; a: Pt; b: Pt; period: number }
interface Lure {
  id: number; t0: number; at: Pt; from: Pt; cat: CatView;
  /** Coming, waiting a way off, creeping up, at the paw, or going (from `k` along the way). */
  phase: 'come' | 'wait' | 'close' | 'go';
  /** When this phase began, and how far towards the paw it is (0 out in the water, 1 at the paw). */
  since: number; k: number;
}

export class Fish implements Fauna {
  readonly catches = [Prey.Fish] as const;
  private readonly water: Raster;
  private readonly fx: Effects;
  private readonly isCaught: (id: number) => boolean;
  /** Spots well out in the water, and spots near the bank. */
  private readonly open: Pt[] = [];
  private readonly shore: Pt[] = [];
  private readonly leaps = new Map<number, Leap | null>();
  private readonly shallows = new Map<number, Shallow | null>();
  private lures: Lure[] = [];
  private readonly perCat = new WeakMap<CatView, { swipe: number; nextLure: number; lastSplash: number }>();
  private readonly fish: Pool;
  private readonly shadows: Pool;

  constructor(ctx: FaunaContext) {
    this.water = ctx.water;
    this.fx = ctx.fx;
    this.isCaught = (id) => ctx.isCaught(Prey.Fish, id);
    this.fish = new Pool(ctx.scene, 'fish');
    this.shadows = new Pool(ctx.scene, 'fish-shadow');
    // candidate spots, identical for every visitor
    const { x, y, w, h } = ctx.pond;
    const wet = (px: number, py: number) => this.wet([px, py]);
    for (let py = y + 4; py < y + h - 4; py += 3)
      for (let px = x + 4; px < x + w - 4; px += 3) {
        if (![[0, 0], [-6, 0], [6, 0], [0, -3], [0, 3]].every(([dx, dy]) => wet(px + dx, py + dy))) continue;
        const roomy = [[-14, 0], [14, 0], [0, -7], [0, 7], [-24, 0], [24, 0]].every(([dx, dy]) => wet(px + dx, py + dy));
        const nearLand = [[-12, 0], [12, 0], [0, -9], [0, 9]].some(([dx, dy]) => !wet(px + dx, py + dy));
        if (roomy) this.open.push([px, py]);
        else if (nearLand) this.shore.push([px, py]);
      }
  }

  update(f: FaunaFrame): void {
    this.fish.begin();
    this.shadows.begin();
    this.updateLeaps(f.gt, f.prevGt);
    this.updateShallows(f.gt, f.prey);
    this.watchPaws(f.gt, f.now, f.cats);
    this.updateLures(f.gt, f.prevGt, f.now, f.prey);
    this.fish.end();
    this.shadows.end();
  }

  onCatch(p: PreyRef): void {
    this.fx.plunge(p.x, p.y, 0.45, 1.2);
  }

  private wet([x, y]: Pt): boolean {
    return this.water.isSet(Math.round(x), Math.round(y));
  }

  // ---------------------------------------------------------------- leaps

  private leapAt(k: number): Leap | null {
    if (!this.leaps.has(k)) {
      let j: Leap | null = null;
      if (hash2(k, 1, 901) < LEAP_P && this.open.length) {
        const r = seedRng(k, 1);
        const [x, y] = this.open[Math.floor(r() * this.open.length)];
        j = { t0: k * LEAP_SLOT + r() * 500, x, y, dir: r() < 0.5 ? -1 : 1 };
      }
      remember(this.leaps, k, j, 16);
    }
    return this.leaps.get(k)!;
  }

  private updateLeaps(gt: number, prevGt: number): void {
    const crossed = (t: number) => prevGt < t && t <= gt;
    for (let k = Math.floor(gt / LEAP_SLOT) - 2; k <= Math.floor(gt / LEAP_SLOT); k++) {
      const j = this.leapAt(k);
      if (!j) continue;
      const leap = j.t0 + LEAP_DELAY, land = leap + LEAP_MS;
      const lx = j.x + j.dir * 20;
      if (crossed(j.t0)) this.fx.ripple(j.x, j.y);
      if (crossed(leap)) { this.fx.splash(j.x, j.y, j.dir); this.fx.splashSound(j.x, j.y, 0.2, 1.3); }
      if (crossed(land)) { this.fx.ripple(lx, j.y); this.fx.ripple(lx, j.y, 0.3); this.fx.splash(lx, j.y, j.dir); this.fx.splashSound(lx, j.y, 0.3, 1.15); }
      if (gt < leap || gt >= land) continue;
      const u = (gt - leap) / LEAP_MS;
      const h = 14 * 4 * u * (1 - u);
      // nose up, level, nose down, in 45° steps to stay pixel-crisp
      const tilt = Math.round((1 - 2 * u) * 1.4) * (Math.PI / 4);
      this.fish.get().setFlipX(j.dir < 0)
        .setPosition(Math.round(lerp(j.x, lx, u)), Math.round(j.y - h))
        .setRotation(-tilt * j.dir).setDepth(j.y);
    }
  }

  // ---------------------------------------------------------------- shallows

  private shallowAt(k: number): Shallow | null {
    if (!this.shallows.has(k)) {
      let s: Shallow | null = null;
      if (hash2(k, 2, 902) < SHALLOW_P && this.open.length) {
        const r = seedRng(k, 2);
        r(); // (once chose between open water and the bank; kept so the fish stay where they were)
        // out in the open water: to get one near the bank, lure it with a splash
        const a = this.open[Math.floor(r() * this.open.length)];
        // it swims to and fro between a and b
        let b: Pt = a;
        for (let i = 0; i < 6; i++) {
          const ang = r() * Math.PI * 2, len = 6 + r() * 14;
          const c: Pt = [a[0] + Math.cos(ang) * len, a[1] + Math.sin(ang) * len * 0.5];
          const mid: Pt = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
          if (this.wet(c) && this.wet(mid)) { b = c; break; }
        }
        s = { id: k, t0: k * SHALLOW_SLOT + r() * 1500, life: 6000 + r() * 8000, a, b, period: 5000 + r() * 4000 };
      }
      remember(this.shallows, k, s, 24);
    }
    return this.shallows.get(k)!;
  }

  private updateShallows(gt: number, prey: PreyRef[]): void {
    for (let k = Math.floor((gt - SHALLOW_MAX_LIFE) / SHALLOW_SLOT) - 1; k <= Math.floor(gt / SHALLOW_SLOT); k++) {
      const s = this.shallowAt(k);
      if (!s || this.isCaught(s.id) || gt < s.t0 || gt > s.t0 + s.life) continue;
      const phase = ((gt - s.t0) / s.period) * Math.PI * 2;
      const u = 0.5 - 0.5 * Math.cos(phase);
      const x = lerp(s.a[0], s.b[0], u), y = lerp(s.a[1], s.b[1], u);
      const heading = (s.b[0] - s.a[0]) * Math.sin(phase);
      const fade = Math.min(1, (gt - s.t0) / 1200, (s.t0 + s.life - gt) / 1500);
      const alpha = 0.42 * fade * (0.85 + 0.15 * Math.sin(gt / 300 + s.id));
      this.shadows.get().setFlipX(heading < 0).setPosition(Math.round(x), Math.round(y)).setAlpha(alpha).setDepth(-99995);
      if (alpha > CATCHABLE_ALPHA) prey.push({ kind: Prey.Fish, id: s.id, x, y, h: 0, colour: 0 });
    }
  }

  // ---------------------------------------------------------------- lures

  /** A paw slapping the water splashes, and may lure a fish over. */
  private watchPaws(gt: number, now: number, cats: CatView[]): void {
    for (const c of cats) {
      let s = this.perCat.get(c);
      if (!s) this.perCat.set(c, (s = { swipe: -1, nextLure: 0, lastSplash: -1e9 }));
      if (c.act !== Act.Catch || now - c.actStart < SWIPE_AT_MS || s.swipe === c.actStart) continue;
      s.swipe = c.actStart;
      const paw: Pt = [c.x + (c.facing === Facing.Right ? 11 : -11), c.y - 3];
      if (c.z >= 4 || !this.wet(paw)) continue;
      const [px, py] = paw;
      this.fx.splash(px, py, Math.sign(px - c.x));
      this.fx.ripple(px, py);
      this.fx.splashSound(px, py, 0.3, 1.4);
      // splashing on and on just scares a lured fish off (one at the paw had its chance: the swipe)
      const mine = this.lures.find((l) => l.cat === c && l.phase !== 'go');
      if (mine) this.scare(mine, gt + (mine.phase === 'close' ? 150 : 0));
      // a fish only comes to the first splash on calm water: splashing again and again keeps them away
      const calm = clamp01((now - s.lastSplash - 1000) / LURE_CALM_MS);
      s.lastSplash = now;
      if (mine || this.lures.some((l) => l.cat === c)) s.nextLure = now + LURE_EVERY_MS;
      else if (now >= s.nextLure) {
        s.nextLure = now + LURE_EVERY_MS;
        this.lure(strHash(`${c.id}:${c.seq}`), gt, paw, c, calm);
      }
    }
  }

  /**
   * Maybe bring a fish over from deeper water to a splash at `at`: more likely
   * on calm water (`calm` 0..1), at dawn and dusk when they feed, and where
   * there is plenty of open water around for fish to be in.
   */
  private lure(seed: number, gt: number, at: Pt, cat: CatView, calm: number): void {
    const r = seedRng(seed, 40);
    const roll = r();
    if (this.lures.length >= MAX_LURES) return;
    // where it comes from: open water within reach, with water all the way
    const from = [...this.open, ...this.shore].filter(([x, y]) => {
      const d = Math.hypot(x - at[0], y - at[1]);
      if (d < LURE_FROM[0] || d > LURE_FROM[1]) return false;
      for (let i = 1; i < 8; i++) if (!this.wet([lerp(x, at[0], i / 8), lerp(y, at[1], i / 8)])) return false;
      return true;
    });
    if (!from.length) return;
    const light = lightAt(gt);
    const twilight = clamp01(1 - Math.abs(light.elevation - 2) / 10);
    const hour = twilight > 0 ? 0.6 + 0.8 * twilight : light.day > 0.5 ? 0.6 : 0.45;
    if (roll >= LURE_P * calm * hour * Math.min(1, from.length / 12)) return;
    const id = 1e9 + (seed % 1e8);
    if (this.lures.some((l) => l.id === id)) return;
    this.lures.push({ id, t0: gt, at, from: from[Math.floor(r() * from.length)], cat, phase: 'come', since: gt, k: 0 });
  }

  private scare(l: Lure, at: number): void {
    if (l.phase === 'go') return;
    l.phase = 'go';
    l.since = at;
  }

  private updateLures(gt: number, prevGt: number, now: number, prey: PreyRef[]): void {
    const step = Math.max(0, gt - prevGt);
    this.lures = this.lures.filter((l) => {
      if (!this.isCaught(l.id)) return !(l.phase === 'go' && gt - l.since >= LURE_GO_MS);
      // the catching swipe splashes too: that one doesn't lure the next fish
      const s = this.perCat.get(l.cat);
      if (s) s.nextLure = now + LURE_EVERY_MS;
      return false;
    });
    for (const l of this.lures) {
      const c = l.cat;
      const [fx, fy] = l.from, [ax, ay] = l.at;
      const still = (c.act === Act.Crouch || c.act === Act.Sneak) && c.speed < 5;
      // the cat walking off, or hissing or jumping about, scares it
      const away = Math.hypot(c.x - ax, c.y - ay) > 24 || c.act === Act.Hiss || c.act === Act.Jump || (c.speed > 20 && c.act !== Act.Sneak);
      switch (l.phase) {
        case 'come':
          l.k = LURE_WAIT_K * smooth(Math.min(1, (gt - l.since) / LURE_COME_MS));
          if (gt - l.since >= LURE_COME_MS) { l.phase = 'wait'; l.since = gt; }
          else if (away) this.scare(l, gt);
          break;
        case 'wait':
          // creeps closer only while the cat keeps low and still
          if (still) l.k = Math.min(1, l.k + ((1 - LURE_WAIT_K) * step) / LURE_CREEP_MS);
          if (l.k >= 1) { l.phase = 'close'; l.since = gt; }
          else if (away || gt - l.since > LURE_WAIT_MS) this.scare(l, gt);
          break;
        case 'close':
          if (gt - l.since > LURE_STAY_MS || Math.hypot(c.x - ax, c.y - ay) > 40) this.scare(l, gt);
          break;
      }
      // swimming off from wherever it got to
      const going = l.phase === 'go' && gt >= l.since;
      const u = going ? (gt - l.since) / LURE_GO_MS : 0;
      const k = going ? l.k * (1 - smooth(Math.min(1, u))) : l.k;
      // nosing about a little, more so in front of the paw
      const wiggle = Math.sin(gt / 420 + l.id) * (1 + 2 * l.k);
      const sx = ax + wiggle, sy = ay + Math.sin(gt / 610 + l.id) * 1.2 + 1;
      const x = lerp(fx, sx, k), y = lerp(fy, sy, k);
      const heading = l.phase === 'come' ? ax - fx : going ? fx - ax : Math.cos(gt / 420 + l.id);
      const alpha = 0.45 * Math.min(1, (gt - l.t0) / 600, going ? 1 - u : 1);
      this.shadows.get().setFlipX(heading < 0).setPosition(Math.round(x), Math.round(y)).setAlpha(alpha).setDepth(-99995);
      // out of reach until it's come right up
      if (alpha > CATCHABLE_ALPHA && k > 0.85) prey.push({ kind: Prey.Fish, id: l.id, x, y, h: 0, colour: 0 });
    }
  }
}

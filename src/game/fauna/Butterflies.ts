import { BUTTERFLY_COLOURS } from '../../art/critters.ts';
import { Act, Prey } from '../state.ts';
import type { CatView } from '../CatView.ts';
import { TILE, elevAt, tileAt } from '../../world/map.ts';
import { lightAt } from '../../world/sky.ts';
import { inSeason } from '../../world/season.ts';
import { isGrassy } from '../../world/legend.ts';
import { DASH_SPEED } from './Effects.ts';
import { Wary, type Senses } from './Wary.ts';
import { Pool, clamp01, hash2, lerp, remember, seedRng, smooth, strHash, type Fauna, type FaunaContext, type FaunaFrame, type PreyRef } from './kit.ts';

// Butterflies flutter down onto a flower by day, rest there with their wings
// slowly opening and closing, and fly off after a while, or when a cat comes
// too close. A cat dashing through the grass flushes out a whole burst of them.

type Pt = [number, number];

/** A butterfly may land every SLOT ms with probability P; none rests longer than WINDOW. */
const SLOT = 5000, P = 0.55, WINDOW = 50000;
/** How long a flight away lasts, and a burst from the grass. */
const FLIGHT_MS = 6000, BURST_MS = 3000;
/** A dashing cat flushes a burst out of the grass at most once per BURST_SLOT ms. */
const BURST_SLOT = 3000;
/** Butterflies below this height are within paw reach. */
const REACH_H = 14;
/** Resting butterflies: sneak up, then pounce. */
const SENSES: Senses = { walking: 36, jumping: 40, hissing: 48, dashing: 64, notice: 30, react: 650, swipe: 28 };

interface Butterfly { id: number; flower: Pt; colour: number; land: number; restMax: number }
interface Takeoff { t: number; dir: number }
interface Burst { t0: number; x: number; y: number; seed: number; n: number }

export class Butterflies implements Fauna {
  private readonly flowers: Pt[];
  private readonly butterflies = new Map<number, Butterfly | null>();
  private readonly takeoffs = new Map<number, Takeoff>();
  private bursts: Burst[] = [];
  private readonly burstKeys = new Set<string>();
  private readonly isCaught: (id: number) => boolean;
  private readonly wary: Wary;
  private readonly flies: Pool;
  private readonly shadows: Pool;
  private prey: PreyRef[] = [];

  constructor(ctx: FaunaContext) {
    this.flowers = ctx.flowers;
    this.isCaught = (id) => ctx.isCaught(Prey.Fly, id);
    this.wary = new Wary(ctx.scene);
    this.flies = new Pool(ctx.scene, 'butterfly-0');
    this.shadows = new Pool(ctx.scene, 'shadow');
  }

  update({ gt, now, cats, prey }: FaunaFrame): void {
    this.prey = prey;
    this.flies.begin();
    this.shadows.begin();
    this.wary.begin();
    this.updateResting(gt, now, cats);
    this.flushOut(gt, cats);
    this.updateBursts(gt);
    this.flies.end();
    this.shadows.end();
    this.wary.end();
  }

  private butterflyAt(k: number): Butterfly | null {
    if (!this.butterflies.has(k)) {
      let b: Butterfly | null = null;
      // butterflies only come out in daylight
      if (hash2(k, 4, 908) < P && this.flowers.length && lightAt(k * SLOT).day > 0.5 && inSeason('butterfly', k * SLOT, hash2(k, 4, 1601))) {
        const r = seedRng(k, 4);
        b = {
          id: k, flower: this.flowers[Math.floor(r() * this.flowers.length)],
          colour: Math.floor(r() * BUTTERFLY_COLOURS.length),
          land: k * SLOT + r() * 2000, restMax: 10000 + r() * 30000,
        };
      }
      remember(this.butterflies, k, b, 24, (old) => this.takeoffs.delete(old));
    }
    return this.butterflies.get(k)!;
  }

  /** Where a butterfly flying away is after `tau` ms: closed form, so it needs no state. */
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

  /** Draw one at ground point (x, y), h above the ground there (`lift` the ground's own height), and offer it as prey if low enough. */
  private draw(id: number, colour: number, x: number, y: number, h: number, frame: number, alpha: number, lift = 0): void {
    if (h < REACH_H && alpha > 0.5) this.prey.push({ kind: Prey.Fly, id, x, y, h: h + lift, colour });
    this.flies.get(`butterfly-${colour}`, frame)
      .setOrigin(0.5, 1).setPosition(Math.round(x), Math.round(y - h - lift))
      .setDepth(h > 14 ? 99000 + y : y).setAlpha(alpha);
    this.shadows.get().setScale(0.4, 0.5).setPosition(Math.round(x), Math.round(y - lift)).setDepth(y - 1)
      .setAlpha(Math.max(0, 0.18 - h * 0.004) * alpha);
  }

  private updateResting(gt: number, now: number, cats: CatView[]): void {
    for (let k = Math.floor((gt - WINDOW) / SLOT); k <= Math.floor(gt / SLOT); k++) {
      const b = this.butterflyAt(k);
      if (!b || this.isCaught(b.id)) continue;
      const [fx, fy] = b.flower;
      const lift = elevAt(fx, fy);
      let off = this.takeoffs.get(b.id);
      if (!off && gt >= b.land) {
        // it keeps an eye on the cats: sneak up, then pounce
        const v = this.wary.watch(Prey.Fly * 1e10 + b.id, fx, fy, lift, cats, gt, now, SENSES);
        if (!v.calm && !v.alert) off = { t: gt, dir: Math.sign(fx - v.cat.x) || 1 };
        else if (!v.calm) this.wary.mark(fx, fy - lift - 10);
        else if (gt >= b.land + b.restMax) off = { t: b.land + b.restMax, dir: hash2(b.id, 6, 909) < 0.5 ? -1 : 1 };
        if (off) this.takeoffs.set(b.id, off);
      }
      if (gt < b.land - 1200) continue;
      if (gt < b.land) {
        // fluttering down onto the flower
        const u = (gt - (b.land - 1200)) / 1200;
        this.draw(b.id, b.colour, fx + Math.sin(u * 8) * 3 * (1 - u), fy, lerp(40, 3, smooth(u)), Math.floor(gt / 90) % 2, Math.min(1, u * 2), lift);
      } else if (!off || gt < off.t) {
        // resting, wings slowly opening and closing
        this.draw(b.id, b.colour, fx, fy, 3, hash2(b.id, Math.floor(gt / 1300), 910) < 0.5 ? 0 : 1, 1, lift);
      } else if (gt < off.t + FLIGHT_MS) {
        const tau = gt - off.t;
        const [x, y, h] = this.flight(b.id, tau, fx, fy, off.dir, false);
        this.draw(b.id, b.colour, x, y, h, Math.floor(gt / 70) % 2, clamp01((FLIGHT_MS - tau) / 1500), lift);
      }
    }
  }

  /** Dashing through grass flushes out butterflies (at most once per cat per BURST_SLOT). */
  private flushOut(gt: number, cats: CatView[]): void {
    for (const c of cats) {
      if (c.speed <= DASH_SPEED || c.act === Act.Jump || !isGrassy(tileAt(Math.floor(c.x / TILE), Math.floor((c.y - 2) / TILE)))) continue;
      const key = `${c.id}:${Math.floor(gt / BURST_SLOT)}`;
      if (this.burstKeys.has(key)) continue;
      this.burstKeys.add(key);
      if (this.burstKeys.size > 64) this.burstKeys.delete(this.burstKeys.values().next().value!);
      // seeded off the cat and the slot, so everyone sees the same burst
      const seed = strHash(key);
      if (lightAt(gt).day > 0.5 && inSeason('butterfly', gt, 0.5)) this.bursts.push({ t0: gt, x: c.x, y: c.y, seed, n: 4 + (seed % 4) });
    }
  }

  private updateBursts(gt: number): void {
    this.bursts = this.bursts.filter((u) => gt - u.t0 < BURST_MS);
    for (const u of this.bursts)
      for (let i = 0; i < u.n; i++) {
        const seed = (u.seed + i * 7919) >>> 0;
        if (this.isCaught(seed)) continue;
        const r = seedRng(seed, 8);
        const tau = gt - u.t0 - r() * 150;
        if (tau < 0) continue;
        const [x, y, h] = this.flight(seed, tau, u.x + (r() - 0.5) * 14, u.y + (r() - 0.5) * 6, r() < 0.5 ? -1 : 1, true);
        this.draw(seed, Math.floor(r() * BUTTERFLY_COLOURS.length), x, y, h, Math.floor(gt / 45 + i) % 2, clamp01((BURST_MS - tau) / 1000), elevAt(u.x, u.y));
      }
  }
}

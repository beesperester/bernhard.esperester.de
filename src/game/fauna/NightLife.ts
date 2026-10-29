import Phaser from 'phaser';
import { Prey } from '../state.ts';
import { Wary, type Senses } from './Wary.ts';
import type { CatView } from '../CatView.ts';
import { DEPTH } from '../Daylight.ts';
import { MAP_H, MAP_W, TILE, elevAt, inClearing, levelAt, tileAt } from '../../world/map.ts';
import { lightAt } from '../../world/sky.ts';
import { inSeason, rainfall } from '../../world/season.ts';
import { Pool, seedRng, hash2, lerp, clamp01, type Fauna, type FaunaContext, type FaunaFrame, type PreyRef } from './kit.ts';
import type { Effects } from './Effects.ts';
import { groundOf, isLawnOrTall, isLilyPad, isMeadow, isOpenWater, isPond } from '../../world/legend.ts';

// Fireflies drifting over the grass and frogs sitting at the water's edge,
// after dark (and the frogs in the rain, too). Deterministic like the rest of the fauna: whether something
// turns up is decided by the garden clock (and how dark it is at that moment).

/** A swarm of fireflies may rise every FIRE_SLOT ms. */
const FIRE_SLOT = 2500, FIRE_MAX = 45000;
/** A frog may come out of the water every FROG_SLOT ms; this share of them climb onto a lily pad. */
const FROG_SLOT = 6000, FROG_P = 0.55, FROG_MAX = 90000, LILY_P = 0.35;
/** Dark enough for night creatures (0..1). */
const DARK = 0.5;
/** Raining hard enough to bring the frogs out by day (0..1). */
const RAINY = 0.3;
const HOP_MS = 420;
/** How close cats may get before a frog jumps back into the water: sneak up, then pounce. */
const FROG_SENSES: Senses = { walking: 34, jumping: 48, hissing: 48, dashing: 56, notice: 28, react: 700, swipe: 30 };

type Pt = [number, number];
interface Swarm { id: number; at: Pt; n: number; t0: number; life: number }
interface Frog { id: number; at: Pt; water: Pt; lily: boolean; t0: number; life: number }

const dark = (ms: number) => lightAt(ms).night >= DARK;
/** Frogs come out after dark, and in a good shower whatever the time of day. */
const frogWeather = (ms: number) => dark(ms) || rainfall(ms) >= RAINY;

export class NightLife implements Fauna {
  readonly catches = [Prey.Firefly] as const;
  private readonly bodies: Pool;
  private readonly glows: Pool;
  private readonly frogs: Pool;
  private readonly grass: Pt[] = [];
  private readonly shore: { at: Pt; water: Pt; lily: boolean }[] = [];
  private readonly pads: { at: Pt; water: Pt; lily: boolean }[] = [];
  private readonly swarms = new Map<number, Swarm | null>();
  private readonly frogVisits = new Map<number, Frog | null>();
  /** Frogs that jumped back in early: when, and from where. */
  private readonly dived = new Map<number, number>();
  private readonly isCaught: (kind: Prey, id: number) => boolean;
  private readonly fx: Effects;
  private readonly wary: Wary;

  constructor({ scene, isCaught, fx }: FaunaContext) {
    this.isCaught = isCaught;
    this.fx = fx;
    this.wary = new Wary(scene);
    this.bodies = new Pool(scene, 'firefly');
    this.glows = new Pool(scene, 'glow-firefly');
    this.frogs = new Pool(scene, 'frog');
    const water = (x: number, y: number) => isPond(tileAt(x, y));
    for (let ty = 1; ty < MAP_H - 1; ty++)
      for (let tx = 1; tx < MAP_W - 1; tx++) {
        const ch = tileAt(tx, ty);
        // fireflies like long grass and flowers, the clearings in the woods, and the edges of the ponds
        if (isMeadow(ch) || inClearing(tx, ty) || (groundOf(ch) === 'lawn' && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => water(tx + dx, ty + dy))))
          this.grass.push([tx * TILE + 8, ty * TILE + 8]);
        // frogs: out on a lily pad, climbing up from the open water beside it...
        if (isLilyPad(ch)) {
          const side = ([[0, 1], [1, 0], [-1, 0], [0, -1]] as const).find(([dx, dy]) => isOpenWater(tileAt(tx + dx, ty + dy)));
          const cx = tx * TILE + 7, cy = ty * TILE + 11;
          if (side) this.pads.push({ at: [cx, cy], water: [cx + side[0] * 11, cy + side[1] * 8], lily: true });
        }
        // ...or on the lawn right at the water, facing it
        if (!isLawnOrTall(ch) || levelAt(tx, ty) !== 0) continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const)
          if (isOpenWater(tileAt(tx + dx, ty + dy))) {
            const cx = tx * TILE + 8 + dx * 5, cy = ty * TILE + 10 + dy * 4;
            this.shore.push({ at: [cx, cy], water: [cx + dx * 10, cy + dy * 9], lily: false });
          }
      }
  }

  update({ gt, now, cats, prey, view }: FaunaFrame): void {
    this.bodies.begin();
    this.glows.begin();
    this.frogs.begin();
    this.wary.begin();
    const night = lightAt(gt).night;
    if (night > 0.02 || this.frogVisits.size || rainfall(gt) > 0) {
      this.updateFireflies(gt, night, prey, view);
      this.updateFrogs(gt, now, cats, prey);
    }
    this.bodies.end();
    this.glows.end();
    this.frogs.end();
    this.wary.end();
  }

  /** A caught firefly goes out in a puff of light. */
  onCatch(p: PreyRef): void {
    this.fx.glowPuff(p.x, p.y - p.h);
  }

  // ---------------------------------------------------------------- fireflies

  private swarmAt(k: number): Swarm | null {
    if (!this.swarms.has(k)) {
      let s: Swarm | null = null;
      const t0 = k * FIRE_SLOT;
      if (this.grass.length && dark(t0) && inSeason('firefly', t0, hash2(k, 31, 1603))) {
        const r = seedRng(k, 31);
        s = { id: k, at: this.grass[Math.floor(r() * this.grass.length)], n: 2 + Math.floor(r() * 3), t0: t0 + r() * FIRE_SLOT, life: 25000 + r() * 20000 };
      }
      this.swarms.set(k, s);
      if (this.swarms.size > 40) this.swarms.delete(this.swarms.keys().next().value!);
    }
    return this.swarms.get(k)!;
  }

  private updateFireflies(gt: number, night: number, prey: PreyRef[], view: Phaser.Geom.Rectangle): void {
    for (let k = Math.floor((gt - FIRE_MAX) / FIRE_SLOT); k <= Math.floor(gt / FIRE_SLOT); k++) {
      const s = this.swarmAt(k);
      if (!s || gt < s.t0 || gt > s.t0 + s.life) continue;
      const [ax, ay] = s.at;
      if (ax < view.x - 40 || ax > view.right + 40 || ay < view.y - 40 || ay > view.bottom + 60) continue;
      const tau = gt - s.t0;
      const fade = clamp01(Math.min(tau / 3000, (s.life - tau) / 3000));
      for (let i = 0; i < s.n; i++) {
        const id = s.id * 8 + i;
        if (this.isCaught(Prey.Firefly, id)) continue;
        const r = seedRng(id, 32);
        const [f1, f2, f3, p1, p2, p3] = [0.2 + r() * 0.25, 0.35 + r() * 0.3, 0.5 + r() * 0.4, r() * 6.3, r() * 6.3, r() * 6.3];
        const t = gt / 1000;
        // lazy loops around the swarm's spot
        const x = ax + Math.sin(t * f1 + p1) * 20 + Math.sin(t * f2 * 1.7 + p2) * 7;
        const y = ay + Math.sin(t * f2 + p2) * 10 + Math.cos(t * f3 + p3) * 4;
        const lift = elevAt(ax, ay);
        const h = 7 + Math.sin(t * f3 + p1) * 5;
        // slow pulses with dark pauses between them
        const blink = Math.max(0, Math.sin(t * (1.1 + f1) + p3)) ** 2;
        const alpha = fade * night;
        const sx = Math.round(x), sy = Math.round(y - h - lift);
        this.bodies.get().setOrigin(0.5, 1).setPosition(sx, sy).setDepth(y).setAlpha(alpha * (0.4 + 0.6 * blink));
        if (blink > 0.02) this.glows.get().setPosition(sx, sy - 1).setDepth(DEPTH.glow).setBlendMode(Phaser.BlendModes.ADD).setAlpha(alpha * blink);
        if (alpha > 0.5) prey.push({ kind: Prey.Firefly, id, x, y, h: h + lift, colour: 0 });
      }
    }
  }

  // ---------------------------------------------------------------- frogs

  private frogAt(k: number): Frog | null {
    if (!this.frogVisits.has(k)) {
      let f: Frog | null = null;
      const t0 = k * FROG_SLOT;
      if (this.shore.length && hash2(k, 33, 930) < FROG_P && frogWeather(t0) &&inSeason('frog', t0, hash2(k, 33, 1604))) {
        const r = seedRng(k, 33);
        const spots = this.pads.length && r() < LILY_P ? this.pads : this.shore;
        const s = spots[Math.floor(r() * spots.length)];
        f = { id: k, at: s.at, water: s.water, lily: s.lily, t0: t0 + r() * FROG_SLOT, life: 40000 + r() * 50000 };
      }
      this.frogVisits.set(k, f);
      if (this.frogVisits.size > 24) {
        const old = this.frogVisits.keys().next().value!;
        this.frogVisits.delete(old);
        this.dived.delete(old);
      }
    }
    return this.frogVisits.get(k)!;
  }

  private updateFrogs(gt: number, now: number, cats: CatView[], prey: PreyRef[]): void {
    // one frog to a pad (or patch of shore): one that would turn up while it's taken never comes
    const busy = new Map<Pt, number>();
    for (let k = Math.floor((gt - FROG_MAX) / FROG_SLOT); k <= Math.floor(gt / FROG_SLOT); k++) {
      const f = this.frogAt(k);
      if (!f || f.t0 < (busy.get(f.at) ?? -Infinity)) continue;
      busy.set(f.at, f.t0 + f.life + HOP_MS);
      if (gt < f.t0 || this.isCaught(Prey.Frog, f.id)) continue;
      const [x, y] = f.at, [wx, wy] = f.water;
      const right = wx < x; // faces away from the water, towards the lawn
      const end = this.dived.get(f.id) ?? f.t0 + f.life;
      const tau = gt - f.t0;
      // climbing out of the water...
      if (tau < HOP_MS) {
        if (tau < 20) this.fx.ripple(wx, wy, 0);
        this.hop(wx, wy, x, y, tau / HOP_MS, right);
        continue;
      }
      // ...and plopping back in
      if (gt >= end) {
        const u = (gt - end) / HOP_MS;
        if (u >= 1) continue;
        this.hop(x, y, wx, wy, u, !right);
        continue;
      }

      const v = this.wary.watch(f.id, x, y, elevAt(x, y), cats, gt, now, FROG_SENSES);
      if (!v.calm && !v.alert) {
        this.dived.set(f.id, gt);
        this.wary.forget(f.id);
        setTimeout(() => {
          this.fx.splash(wx, wy, 0);
          this.fx.ripple(wx, wy, 0);
          this.fx.splashSound(wx, wy, 0.35, 1.5);
        }, HOP_MS);
      }
      if (!v.calm && v.alert) this.wary.mark(x, y - elevAt(x, y) - 8);
      // sits, now and then puffing up its throat to croak (not while it eyes a cat)
      const croak = v.calm && hash2(f.id, Math.floor(gt / 700), 931) < 0.18;
      this.frogs.get('frog', croak ? 1 : 0).setOrigin(0.5, 1).setFlipX(right)
        .setPosition(Math.round(x), Math.round(y - elevAt(x, y))).setDepth(f.lily ? -99980 : y);
      prey.push({ kind: Prey.Frog, id: f.id, x, y, h: elevAt(x, y), colour: 0 });
    }
  }

  private hop(ax: number, ay: number, bx: number, by: number, u: number, right: boolean): void {
    const x = lerp(ax, bx, u), y = lerp(ay, by, u), h = 7 * 4 * u * (1 - u);
    this.frogs.get('frog', 0).setOrigin(0.5, 1).setFlipX(right).setPosition(Math.round(x), Math.round(y - h)).setDepth(y);
  }
}

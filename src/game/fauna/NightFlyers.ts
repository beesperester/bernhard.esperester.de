import { Act, Prey } from '../state.ts';
import type { CatView } from '../CatView.ts';
import { DEPTH } from '../Daylight.ts';
import { LANTERNS, elevAt, waterBoxes } from '../../world/map.ts';
import { LANTERN_H } from '../../art/critters.ts';
import { lightAt } from '../../world/sky.ts';
import { inSeason } from '../../world/season.ts';
import { Pool, seedRng, hash2, smooth, clamp01, distanceFelt, type Fauna, type FaunaContext, type FaunaFrame, type PreyRef } from './kit.ts';

// What flies about after dark: bats flitting round the lanterns and over the
// ponds from dusk on, now and then one hanging upside down under a tree for a
// rest, and every so often an owl that glides in, sits in a tree
// top or on a lantern for a while, looks about with glowing eyes and glides
// off again. Deterministic like the rest of the fauna; only a scared owl or
// roosting bat (somebody hissed or jumped at it, or came up the tree to it
// without creeping) leaves early, on each screen by itself. A roosting bat can
// be caught by a cat that sneaks up the tree to it.

/** A bat may come out every BAT_SLOT ms, from dusk... */
const BAT_SLOT = 5000, BAT_P = 0.55, BAT_MAX = 80000, BAT_DUSK = 0.3;
/** ...an owl every OWL_SLOT ms, once it's properly dark. */
const OWL_SLOT = 40000, OWL_P = 0.5, OWL_MAX = 120000, OWL_DARK = 0.6;
/** How long an owl takes to glide in or out, and how far off it comes from. */
const GLIDE_MS = 4000, GLIDE_FROM = 320;
const BAT_IN_MS = 2500;
/** A bat may come to hang in a tree every ROOST_SLOT ms. */
const ROOST_SLOT = 20000, ROOST_P = 0.5, ROOST_MAX = 160000;

type Pt = [number, number];
interface Bat { id: number; at: Pt; from: number; t0: number; life: number }
interface Perch { x: number; y: number; h: number; depth: number }
interface Roost { id: number; spot: Perch; from: number; to: number; t0: number; life: number }
interface Owl { id: number; perch: Perch; from: number; to: number; t0: number; life: number }

const darkness = (ms: number) => lightAt(ms).night;

export class NightFlyers implements Fauna {
  private readonly bats: Pool;
  private readonly owls: Pool;
  private readonly eyes: Pool;
  private readonly hanging: Pool;
  /** Under the crowns, on either side of the trunk. */
  private readonly roosts: Perch[] = [];
  private readonly roostVisits = new Map<number, Roost | null>();
  private readonly haunts: Pt[];
  private readonly perches: Perch[];
  private readonly batVisits = new Map<number, Bat | null>();
  private readonly owlVisits = new Map<number, Owl | null>();
  /** Owls and roosting bats that left early: when, and which way. */
  private readonly scared = new Map<number, { t: number; dir: number }>();

  private readonly isCaught: (id: number) => boolean;
  /** Bats on the wing this frame, for cats leaping at them. */
  private prey: PreyRef[] = [];

  constructor({ scene, trees, isCaught }: FaunaContext) {
    this.isCaught = (id) => isCaught(Prey.Bat, id);
    this.bats = new Pool(scene, 'bat');
    this.owls = new Pool(scene, 'owl');
    this.eyes = new Pool(scene, 'owl-eyes');
    this.hanging = new Pool(scene, 'bat-hang');
    // bats hunt moths round the lanterns and midges over the water
    this.haunts = [...LANTERNS.map(([x, y]): Pt => [x, y]), ...waterBoxes().map((b): Pt => [b.x + b.w / 2, b.y + b.h / 2])];
    // owls sit on the top of a crown or on a lantern
    this.perches = [
      ...trees.map((t) => {
        const top = t.crown.reduce((a, b) => (b.z + b.rz > a.z + a.rz ? b : a));
        // sunk a little into the leaves
        return { x: t.x + top.x, y: t.y, h: t.elev + top.z + top.rz - 2, depth: t.y + 0.5 };
      }),
      ...LANTERNS.map(([x, y]) => ({ x, y, h: elevAt(x, y) + LANTERN_H, depth: y + 0.5 })),
    ];
    // roosts: the lowest edge of the leaves either side of the trunk
    for (const t of trees)
      for (const side of [-1, 1]) {
        const low = t.crown.filter((c) => c.x * side > 4).sort((a, b) => a.z - a.rz - (b.z - b.rz))[0];
        if (low) this.roosts.push({ x: t.x + low.x, y: t.y, h: t.elev + low.z - Math.round(low.rz * 0.8), depth: t.y + 0.5 });
      }
  }

  update({ gt, cats, prey, view }: FaunaFrame): void {
    this.prey = prey;
    this.bats.begin();
    this.owls.begin();
    this.eyes.begin();
    this.hanging.begin();
    const night = lightAt(gt).night;
    this.updateBats(gt, view);
    this.updateRoosts(gt, cats, view);
    this.updateOwls(gt, night, cats, view);
    this.bats.end();
    this.owls.end();
    this.eyes.end();
    this.hanging.end();
  }

  /** Somebody hissing, jumping or dashing near spot `s`, or up level with it. */
  private disturbed(s: Perch, cats: CatView[], reach: number): CatView | null {
    for (const c of cats) {
      const d = distanceFelt(c, s.x, s.y);
      // a cat up at its height wakes it, unless it creeps along the branch
      const creeping = c.act === Act.Crouch || c.act === Act.Sneak || c.act === Act.Catch;
      const level = Math.abs(c.z - s.h) < 16 && d < 28 && !creeping;
      const loud = (c.act === Act.Hiss && d < reach) || (c.act === Act.Jump && d < 36) || (c.speed > 110 && d < 30);
      if (level || loud) return c;
    }
    return null;
  }

  // ---------------------------------------------------------------- bats

  private batAt(k: number): Bat | null {
    if (!this.batVisits.has(k)) {
      let b: Bat | null = null;
      const t0 = k * BAT_SLOT;
      if (this.haunts.length && hash2(k, 41, 940) < BAT_P && darkness(t0) >= BAT_DUSK && inSeason('bat', t0, hash2(k, 41, 1605))) {
        const r = seedRng(k, 41);
        b = { id: k, at: this.haunts[Math.floor(r() * this.haunts.length)], from: r() * Math.PI * 2, t0: t0 + r() * BAT_SLOT, life: 30000 + r() * 50000 };
      }
      this.batVisits.set(k, b);
      if (this.batVisits.size > 40) this.batVisits.delete(this.batVisits.keys().next().value!);
    }
    return this.batVisits.get(k)!;
  }

  private updateBats(gt: number, view: Phaser.Geom.Rectangle): void {
    for (let k = Math.floor((gt - BAT_MAX) / BAT_SLOT); k <= Math.floor(gt / BAT_SLOT); k++) {
      const b = this.batAt(k);
      if (!b || gt < b.t0 || gt > b.t0 + b.life || this.isCaught(b.id)) continue;
      const [ax, ay] = b.at;
      if (ax < view.x - 200 || ax > view.right + 200 || ay < view.y - 200 || ay > view.bottom + 200) continue;
      const r = seedRng(b.id, 42);
      const [f1, f2, f3, p1, p2, p3] = [0.5 + r() * 0.4, 1.1 + r() * 0.6, 2.3 + r() * 1.2, r() * 6.3, r() * 6.3, r() * 6.3];
      const R = 26 + r() * 30;
      const t = gt / 1000;
      // quick loops round the spot, with jinks after moths
      let x = ax + Math.sin(t * f1 + p1) * R + Math.sin(t * f3 + p2) ** 3 * 12;
      let y = ay + Math.cos(t * f1 * 0.9 + p1) * R * 0.5 + Math.sin(t * f2 + p3) * 6;
      // and every so often a swoop down low after something over the grass: that's when a cat can leap for it
      const swoop = Math.max(0, Math.sin(t * f1 * 0.37 + p3)) ** 12 * 22;
      let h = elevAt(ax, ay) + 34 + Math.sin(t * f2 * 0.7 + p2) * 8 + Math.sin(t * f3 * 1.3 + p1) ** 5 * 6;
      h = Math.max(elevAt(ax, ay) + 10, h - swoop);
      // fluttering in from somewhere and off again
      const tau = gt - b.t0;
      const away = 1 - smooth(clamp01(Math.min(tau, b.life - tau) / BAT_IN_MS));
      if (away > 0) {
        const dir = tau < b.life / 2 ? b.from : b.from + 2;
        x += Math.cos(dir) * GLIDE_FROM * away;
        y += Math.sin(dir) * GLIDE_FROM * 0.5 * away;
        h += 60 * away;
      }
      this.flyingBat(b.id, x, y, h, gt, clamp01((1 - away) * 4));
    }
  }

  /** A bat on the wing at ground point (x, y), height h. */
  private flyingBat(id: number, x: number, y: number, h: number, gt: number, alpha: number): void {
    const flap = [0, 1, 2, 1][Math.floor(gt / 55 + id) % 4];
    this.bats.get('bat', flap).setOrigin(0.5, 1).setPosition(Math.round(x), Math.round(y - h)).setDepth(99000 + y).setAlpha(alpha);
    if (alpha > 0.5) this.prey.push({ kind: Prey.Bat, id, x, y, h, colour: 0, air: true });
  }

  private roostAt(k: number): Roost | null {
    if (!this.roostVisits.has(k)) {
      let b: Roost | null = null;
      const t0 = k * ROOST_SLOT;
      if (this.roosts.length && hash2(k, 44, 960) < ROOST_P && darkness(t0) >= BAT_DUSK && inSeason('bat', t0, hash2(k, 44, 1606))) {
        const r = seedRng(k, 44);
        const from = r() * Math.PI * 2;
        b = { id: 1e6 + k, spot: this.roosts[Math.floor(r() * this.roosts.length)], from, to: from + 1 + r() * 4, t0: t0 + r() * ROOST_SLOT, life: 70000 + r() * 80000 };
      }
      this.roostVisits.set(k, b);
      if (this.roostVisits.size > 16) {
        const old = this.roostVisits.keys().next().value!;
        this.scared.delete(this.roostVisits.get(old)?.id ?? -1);
        this.roostVisits.delete(old);
      }
    }
    return this.roostVisits.get(k)!;
  }

  private updateRoosts(gt: number, cats: CatView[], view: Phaser.Geom.Rectangle): void {
    const taken = new Set<Perch>();
    for (let k = Math.floor((gt - ROOST_MAX) / ROOST_SLOT); k <= Math.floor(gt / ROOST_SLOT); k++) {
      const b = this.roostAt(k);
      if (!b || gt < b.t0 || taken.has(b.spot) || this.isCaught(b.id)) continue;
      const s = b.spot;
      const scared = this.scared.get(b.id);
      const leave = scared ? scared.t : b.t0 + b.life;
      if (gt > leave + BAT_IN_MS) continue;
      taken.add(s);
      if (s.x < view.x - GLIDE_FROM || s.x > view.right + GLIDE_FROM || s.y < view.y - GLIDE_FROM || s.y > view.bottom + GLIDE_FROM) continue;
      const tau = gt - b.t0;
      // flitting in and off again
      if (tau < BAT_IN_MS || gt >= leave) {
        const u = tau < BAT_IN_MS ? 1 - tau / BAT_IN_MS : (gt - leave) / BAT_IN_MS;
        const dir = tau < BAT_IN_MS ? b.from : scared ? (scared.dir > 0 ? 0 : Math.PI) - 0.6 : b.to;
        const e = u * u;
        this.flyingBat(b.id, s.x + Math.cos(dir) * GLIDE_FROM * e + Math.sin(u * 20) * 6 * u, s.y + Math.sin(dir) * GLIDE_FROM * 0.5 * e, s.h + 60 * e - 6, gt, clamp01((1 - u) * 4));
        continue;
      }
      const c = this.disturbed(s, cats, 50);
      if (c) this.scared.set(b.id, { t: gt, dir: Math.sign(s.x - c.x) || 1 });
      // hangs, swaying a little, and now and then stretches its wings
      const stretch = hash2(b.id, Math.floor(gt / 1200), 961) < 0.06;
      const sway = Math.sin(gt / 900 + b.id) * 0.12;
      this.hanging.get('bat-hang', stretch ? 1 : 0).setOrigin(0.5, 0).setRotation(sway)
        .setPosition(Math.round(s.x), Math.round(s.y - s.h)).setDepth(s.depth);
      // asleep under the leaves: a cat that has crept up the tree to it can take it
      if (!c) this.prey.push({ kind: Prey.Bat, id: b.id, x: s.x, y: s.y, h: s.h - 5, colour: 0 });
    }
  }

  // ---------------------------------------------------------------- owls

  private owlAt(k: number): Owl | null {
    if (!this.owlVisits.has(k)) {
      let o: Owl | null = null;
      const t0 = k * OWL_SLOT;
      if (this.perches.length && hash2(k, 43, 950) < OWL_P && darkness(t0) >= OWL_DARK) {
        const r = seedRng(k, 43);
        const from = r() * Math.PI * 2;
        o = { id: k, perch: this.perches[Math.floor(r() * this.perches.length)], from, to: from + Math.PI * (0.6 + r() * 0.8), t0: t0 + r() * OWL_SLOT, life: 50000 + r() * 60000 };
      }
      this.owlVisits.set(k, o);
      if (this.owlVisits.size > 16) {
        const old = this.owlVisits.keys().next().value!;
        this.owlVisits.delete(old);
        this.scared.delete(old);
      }
    }
    return this.owlVisits.get(k)!;
  }

  private updateOwls(gt: number, night: number, cats: CatView[], view: Phaser.Geom.Rectangle): void {
    const taken = new Set<Perch>();
    for (let k = Math.floor((gt - OWL_MAX) / OWL_SLOT); k <= Math.floor(gt / OWL_SLOT); k++) {
      const o = this.owlAt(k);
      if (!o || gt < o.t0) continue;
      const s = o.perch;
      // two owls don't share a perch: the later one doesn't come
      if (taken.has(s)) continue;
      const scared = this.scared.get(o.id);
      const leave = scared ? scared.t : o.t0 + o.life;
      if (gt > leave + GLIDE_MS) continue;
      taken.add(s);
      if (s.x < view.x - GLIDE_FROM || s.x > view.right + GLIDE_FROM || s.y < view.y - GLIDE_FROM || s.y > view.bottom + GLIDE_FROM + 80) continue;
      const tau = gt - o.t0;
      // gliding in: a long descending swoop, a few slow wingbeats, and the landing
      if (tau < GLIDE_MS) {
        this.flight(o, s, o.from, 1 - tau / GLIDE_MS, gt, night);
        continue;
      }
      if (gt >= leave) {
        const dir = scared ? (scared.dir > 0 ? 0 : Math.PI) - 0.5 : o.to;
        this.flight(o, s, dir, (gt - leave) / GLIDE_MS, gt, night);
        continue;
      }
      // somebody hissing, jumping or dashing right underneath, or up beside it: off it goes, silently
      const c = this.disturbed(s, cats, 70);
      if (c) this.scared.set(o.id, { t: gt, dir: Math.sign(s.x - c.x) || 1 });
      // sits, blinks now and then, and turns its head to look about
      const blink = hash2(o.id, Math.floor(gt / 300), 951) < 0.05;
      const look = hash2(o.id, Math.floor(gt / 2600), 952);
      const frame = blink ? 1 : look < 0.35 ? 2 : 0;
      this.draw(s.x, s.y, s.h, frame, look < 0.17, s.depth, 1, night);
    }
  }

  /** An owl on the wing, `u` from the perch (0) to far off in direction `dir` (1). */
  private flight(o: Owl, s: Perch, dir: number, u: number, gt: number, night: number): void {
    const e = u * u; // slow near the perch, faster far away
    const x = s.x + Math.cos(dir) * GLIDE_FROM * e;
    const y = s.y + Math.sin(dir) * GLIDE_FROM * 0.5 * e;
    const h = s.h + 90 * e + Math.sin(u * Math.PI) * 10;
    // long glides between a few deep wingbeats
    const beat = (gt + o.id * 137) % 1400;
    const frame = beat < 360 ? (Math.floor(beat / 180) % 2 ? 4 : 3) : 3;
    const high = h - elevAt(x, y) > 30;
    this.draw(x, y, h, frame, Math.cos(dir) > 0, high ? 99000 + y : s.depth, clamp01((1 - u) * 4), night);
  }

  private draw(x: number, y: number, h: number, frame: number, flip: boolean, depth: number, alpha: number, night: number): void {
    const px = Math.round(x), py = Math.round(y - h);
    this.owls.get('owl', frame).setOrigin(0.5, 1).setFlipX(flip).setPosition(px, py).setDepth(depth).setAlpha(alpha);
    // the eyes catch what light there is
    if (frame !== 1 && night > 0.2)
      this.eyes.get('owl-eyes', frame).setOrigin(0.5, 1).setFlipX(flip).setPosition(px, py)
        .setDepth(DEPTH.glow).setAlpha(alpha * night * 0.85);
  }
}

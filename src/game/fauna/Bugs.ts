import Phaser from 'phaser';
import { Prey } from '../state.ts';
import { Wary, type Senses } from './Wary.ts';
import type { CatView } from '../CatView.ts';
import { BEETLE_COLOURS } from '../../art/critters.ts';
import { MAP_H, MAP_W, TILE, elevAt, furnished, levelAt, tileAt } from '../../world/map.ts';
import { lightAt } from '../../world/sky.ts';
import { inSeason } from '../../world/season.ts';
import { Pool, seedRng, hash2, lerp, smooth, clamp01, type Fauna, type FaunaContext, type FaunaFrame, type PreyRef } from './kit.ts';
import { isOpenGround, isOpenWater, isPond } from '../../world/legend.ts';

// Beetles crawling about the lawns and paths (they can't fly: scare one and it
// skitters off into the grass), and dragonflies darting about over the ponds
// by day, hovering here and there. Both deterministic from the garden clock
// like the rest of the fauna; only a scare is worked out on each screen.

/** A beetle may come out every BEETLE_SLOT ms. */
const BEETLE_SLOT = 6000, BEETLE_P = 0.6, BEETLE_MAX = 70000;
/** It crawls for a while, stops, turns a little, crawls on. */
const LEG_MS = 2600, CRAWL_MS = 1700, CRAWL_SPEED = 7;
/** Scared, it runs for it and is gone into the grass. */
const SKITTER_MS = 900, SKITTER_SPEED = 75, HIDE_MS = 300;
const BEETLE_SENSES: Senses = { walking: 22, jumping: 34, hissing: 40, dashing: 44, notice: 20, react: 600, swipe: 22 };

/** A dragonfly may turn up every DRAGON_SLOT ms, by day. */
const DRAGON_SLOT = 7000, DRAGON_P = 0.5, DRAGON_MAX = 60000, DART_MS = 320, ARRIVE_MS = 1500;
const DRAGON_SENSES: Senses = { walking: 30, jumping: 40, hissing: 48, dashing: 56, notice: 26, react: 500, swipe: 28 };
/** Scared, it zips off and up. */
const ZIP_MS = 1100;

type Pt = [number, number];
interface Beetle { id: number; at: Pt; colour: number; dir: number; t0: number; life: number }
interface Dragonfly { id: number; home: number; t0: number; life: number; from: number }
interface Pose { x: number; y: number; h: number; dir: number; moving: boolean }

const walkable = (tx: number, ty: number, level: number) =>
  isOpenGround(tileAt(tx, ty)) && levelAt(tx, ty) === level && !furnished(tx, ty);

export class Bugs implements Fauna {
  private readonly beetles: Pool;
  private readonly dragonflies: Pool;
  private readonly shadows: Pool;
  private readonly wary: Wary;
  private readonly ground: Pt[] = [];
  /** Hover spots over the water near its edge, and for each the ones within a dart. */
  private readonly hovers: Pt[] = [];
  private readonly near: number[][];
  private readonly beetleVisits = new Map<number, Beetle | null>();
  private readonly dragonVisits = new Map<number, Dragonfly | null>();
  /** Bugs that took fright: when, from where, and which way. */
  private readonly fled = new Map<number, { t: number; x: number; y: number; h: number; dir: number }>();
  private readonly isCaught: (kind: Prey, id: number) => boolean;

  constructor({ scene, isCaught }: FaunaContext) {
    this.isCaught = isCaught;
    this.wary = new Wary(scene);
    this.beetles = new Pool(scene, 'beetle-0');
    this.dragonflies = new Pool(scene, 'dragonfly');
    this.shadows = new Pool(scene, 'shadow');
    const water = (tx: number, ty: number) => isPond(tileAt(tx, ty));
    for (let ty = 1; ty < MAP_H - 1; ty++)
      for (let tx = 1; tx < MAP_W - 1; tx++) {
        if (walkable(tx, ty, levelAt(tx, ty)) && hash2(tx, ty, 970) < 0.35) this.ground.push([tx * TILE + 8, ty * TILE + 10]);
        if (isOpenWater(tileAt(tx, ty)) && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !water(tx + dx, ty + dy)))
          this.hovers.push([tx * TILE + 8, ty * TILE + 8]);
      }
    this.near = this.hovers.map(([x, y], i) => this.hovers.flatMap(([x2, y2], j) => (j !== i && Math.hypot(x2 - x, y2 - y) < 64 ? [j] : [])));
  }

  update({ gt, now, cats, prey, view }: FaunaFrame): void {
    this.beetles.begin();
    this.dragonflies.begin();
    this.shadows.begin();
    this.wary.begin();
    this.updateBeetles(gt, now, cats, prey, view);
    this.updateDragonflies(gt, now, cats, prey, view);
    this.beetles.end();
    this.dragonflies.end();
    this.shadows.end();
    this.wary.end();
  }

  // ---------------------------------------------------------------- beetles

  private beetleAt(k: number): Beetle | null {
    if (!this.beetleVisits.has(k)) {
      let b: Beetle | null = null;
      if (this.ground.length && hash2(k, 51, 971) < BEETLE_P && inSeason('beetle', k * BEETLE_SLOT, hash2(k, 51, 1607))) {
        const r = seedRng(k, 51);
        const t0 = k * BEETLE_SLOT;
        // ladybirds and rose chafers by day, the black ground beetles at night
        const colour = lightAt(t0).night > 0.5 ? 1 : Math.floor(r() * BEETLE_COLOURS.length);
        b = { id: k, at: this.ground[Math.floor(r() * this.ground.length)], colour, dir: r() * Math.PI * 2, t0: t0 + r() * BEETLE_SLOT, life: 30000 + r() * 40000 };
      }
      this.beetleVisits.set(k, b);
      if (this.beetleVisits.size > 24) {
        const old = this.beetleVisits.keys().next().value!;
        this.beetleVisits.delete(old);
        this.fled.delete(old);
      }
    }
    return this.beetleVisits.get(k)!;
  }

  /** Where a beetle has crawled to `tau` ms after coming out: legs of crawling and pausing, turning back at anything it can't cross. */
  private crawl(b: Beetle, tau: number): Pose {
    let [x, y] = b.at, dir = b.dir;
    const level = levelAt(Math.floor(x / TILE), Math.floor(y / TILE));
    for (let leg = 0; ; leg++) {
      const t = Math.min(tau - leg * LEG_MS, CRAWL_MS);
      if (leg) dir += (hash2(b.id, leg, 972) - 0.5) * 2;
      const step = (CRAWL_SPEED * Math.max(0, t)) / 1000;
      let nx = x + Math.cos(dir) * step, ny = y + Math.sin(dir) * step * 0.6;
      if (!walkable(Math.floor(nx / TILE), Math.floor(ny / TILE), level)) {
        dir += Math.PI;
        nx = x;
        ny = y;
      }
      if (tau < (leg + 1) * LEG_MS) return { x: nx, y: ny, h: elevAt(x, y), dir, moving: t > 0 && t < CRAWL_MS };
      x = nx;
      y = ny;
    }
  }

  private updateBeetles(gt: number, now: number, cats: CatView[], prey: PreyRef[], view: Phaser.Geom.Rectangle): void {
    for (let k = Math.floor((gt - BEETLE_MAX) / BEETLE_SLOT); k <= Math.floor(gt / BEETLE_SLOT); k++) {
      const b = this.beetleAt(k);
      if (!b || gt < b.t0 || gt > b.t0 + b.life || this.isCaught(Prey.Beetle, b.id)) continue;
      const [ax, ay] = b.at;
      if (ax < view.x - 80 || ax > view.right + 80 || ay < view.y - 80 || ay > view.bottom + 80) continue;
      const tau = gt - b.t0;
      // crawling out of the grass, and back in at the end
      const alpha = clamp01(Math.min(tau, b.life - tau) / 600);
      let p: Pose;
      const f = this.fled.get(b.id);
      if (f) {
        const s = gt - f.t;
        if (s > SKITTER_MS + HIDE_MS) continue;
        const run = (SKITTER_SPEED * Math.min(s, SKITTER_MS)) / 1000;
        p = { x: f.x + Math.cos(f.dir) * run, y: f.y + Math.sin(f.dir) * run * 0.6, h: f.h, dir: f.dir, moving: s < SKITTER_MS };
        this.drawBeetle(b, p, Math.floor(gt / 40) % 2, alpha * clamp01((SKITTER_MS + HIDE_MS - s) / HIDE_MS));
      } else {
        p = this.crawl(b, tau);
        const v = this.wary.watch(preyKey(b.id), p.x, p.y, p.h, cats, gt, now, BEETLE_SENSES);
        if (!v.calm && !v.alert) {
          // off it scuttles, away from the cat
          this.fled.set(b.id, { t: gt, x: p.x, y: p.y, h: p.h, dir: Math.atan2(p.y - v.cat.y, p.x - v.cat.x) });
          this.wary.forget(preyKey(b.id));
        } else if (!v.calm) this.wary.mark(p.x, p.y - p.h - 5);
        this.drawBeetle(b, p, p.moving ? Math.floor(gt / 160) % 2 : 0, alpha);
      }
      if (alpha > 0.5) prey.push({ kind: Prey.Beetle, id: b.id, x: p.x, y: p.y, h: p.h, colour: b.colour });
    }
  }

  private drawBeetle(b: Beetle, p: Pose, frame: number, alpha: number): void {
    this.beetles.get(`beetle-${b.colour}`, frame).setOrigin(0.5, 1).setFlipX(Math.cos(p.dir) > 0)
      .setPosition(Math.round(p.x), Math.round(p.y - p.h)).setDepth(p.y).setAlpha(alpha);
  }

  // ---------------------------------------------------------------- dragonflies

  private dragonAt(k: number): Dragonfly | null {
    if (!this.dragonVisits.has(k)) {
      let d: Dragonfly | null = null;
      const t0 = k * DRAGON_SLOT;
      if (this.hovers.length && hash2(k, 53, 973) < DRAGON_P && lightAt(t0).day > 0.6 && inSeason('dragonfly', t0, hash2(k, 53, 1608))) {
        const r = seedRng(k, 53);
        d = { id: k, home: Math.floor(r() * this.hovers.length), t0: t0 + r() * DRAGON_SLOT, life: 30000 + r() * 40000, from: r() * Math.PI * 2 };
      }
      this.dragonVisits.set(k, d);
      if (this.dragonVisits.size > 16) {
        const old = this.dragonVisits.keys().next().value!;
        this.dragonVisits.delete(old);
        this.fled.delete(1e6 + old);
      }
    }
    return this.dragonVisits.get(k)!;
  }

  /** Hover here, dart there: where a dragonfly is `tau` ms into its visit. */
  private hover(d: Dragonfly, tau: number): Pose {
    let i = d.home, t = 0;
    // it keeps facing the way it last darted
    let dir = d.from + Math.PI;
    const height = (leg: number, [x, y]: Pt) => elevAt(x, y) + 6 + hash2(d.id, leg, 975) * 18;
    for (let leg = 0; ; leg++) {
      const stay = 1200 + hash2(d.id, leg, 974) * 2400;
      const [x, y] = this.hovers[i];
      const h = height(leg, this.hovers[i]);
      if (tau < t + stay) return { x, y, h, dir, moving: false };
      const next = this.near[i].length ? this.near[i][Math.floor(hash2(d.id, leg, 976) * this.near[i].length)] : i;
      const [x2, y2] = this.hovers[next];
      if (next !== i) dir = Math.atan2(y2 - y, x2 - x);
      if (tau < t + stay + DART_MS) {
        const u = smooth((tau - t - stay) / DART_MS);
        return { x: lerp(x, x2, u), y: lerp(y, y2, u), h: lerp(h, height(leg + 1, this.hovers[next]), u), dir, moving: true };
      }
      t += stay + DART_MS;
      i = next;
    }
  }

  private updateDragonflies(gt: number, now: number, cats: CatView[], prey: PreyRef[], view: Phaser.Geom.Rectangle): void {
    for (let k = Math.floor((gt - DRAGON_MAX) / DRAGON_SLOT); k <= Math.floor(gt / DRAGON_SLOT); k++) {
      const d = this.dragonAt(k);
      if (!d || gt < d.t0 || gt > d.t0 + d.life || this.isCaught(Prey.Dragonfly, d.id)) continue;
      const [hx, hy] = this.hovers[d.home];
      if (hx < view.x - 200 || hx > view.right + 200 || hy < view.y - 200 || hy > view.bottom + 200) continue;
      const tau = gt - d.t0;
      const key = 1e6 + d.id;
      const f = this.fled.get(key);
      const wings = Math.floor(gt / 30) % 2;
      if (f) {
        const s = (gt - f.t) / ZIP_MS;
        if (s >= 1) continue;
        const e = s * s;
        this.drawDragonfly(f.x + Math.cos(f.dir) * 220 * e, f.y + Math.sin(f.dir) * 110 * e, f.h + 80 * e, f.dir, wings, clamp01((1 - s) * 3));
        continue;
      }
      let p: Pose = this.hover(d, tau);
      // zipping in from somewhere and off again at the end
      const away = 1 - smooth(clamp01(Math.min(tau, d.life - tau) / ARRIVE_MS));
      if (away > 0) {
        const dir = tau < d.life / 2 ? d.from : d.from + Math.PI;
        p = { x: p.x + Math.cos(dir) * 240 * away, y: p.y + Math.sin(dir) * 120 * away, h: p.h + 60 * away, dir: dir + Math.PI, moving: true };
      } else if (!p.moving) {
        // hovering, with a little drift
        p.x += Math.sin(gt / 230 + d.id) * 1.2;
        p.h += Math.sin(gt / 170 + d.id) * 1.2;
        const v = this.wary.watch(key, p.x, p.y, elevAt(p.x, p.y), cats, gt, now, DRAGON_SENSES);
        if (!v.calm && !v.alert) {
          this.fled.set(key, { t: gt, x: p.x, y: p.y, h: p.h, dir: Math.atan2(p.y - v.cat.y, p.x - v.cat.x) });
          this.wary.forget(key);
        } else if (!v.calm) this.wary.mark(p.x, p.y - p.h - 6);
      }
      this.drawDragonfly(p.x, p.y, p.h, p.dir, wings, clamp01((1 - away) * 3));
      if (away === 0) prey.push({ kind: Prey.Dragonfly, id: d.id, x: p.x, y: p.y, h: p.h, colour: 0 });
    }
  }

  private drawDragonfly(x: number, y: number, h: number, dir: number, frame: number, alpha: number): void {
    const ground = elevAt(x, y);
    this.dragonflies.get('dragonfly', frame).setOrigin(0.5, 1).setFlipX(Math.cos(dir) > 0)
      .setPosition(Math.round(x), Math.round(y - Math.max(h, ground))).setDepth(h - ground > 30 ? 99000 + y : y).setAlpha(alpha);
    this.shadows.get().setScale(0.3, 0.35).setPosition(Math.round(x), Math.round(y - ground)).setDepth(y - 1).setAlpha(Math.max(0, 0.18 - (h - ground) * 0.004) * alpha);
  }
}

const preyKey = (id: number) => 7e9 + id;

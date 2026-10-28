import { Act, Prey } from '../state.ts';
import { Wary, type Senses } from './Wary.ts';
import type { CatView } from '../CatView.ts';
import { MAP_H, MAP_W, TILE, aroundFurniture, elevAt, furnished, levelAt, tileAt } from '../../world/map.ts';
import { lightAt } from '../../world/sky.ts';
import { sound } from '../../audio/sound.ts';
import { Pool, seedRng, hash2, clamp01, type Fauna, type FaunaContext, type FaunaFrame, type PreyRef } from './kit.ts';
import { groundOf, isOpenGround } from '../../world/legend.ts';

// Field mice, out after dark. Most sit tucked away in the tall grass, now and
// then peeking out, and bolt when a cat comes through: a dash across to the
// next patch of grass, where they hide again. Others scurry about the lawns
// and paths in little runs and stops, and make for the grass when they notice
// a cat. Whenever one is out in the open it can be caught. Where each mouse
// is follows from the garden clock like the rest of the fauna; the bolting is
// worked out on each screen by itself.

/**
 * A mouse may settle in the grass every NEST_SLOT ms, and one go out foraging every RUN_SLOT ms
 * (anywhere in the garden: it's big, so that's often enough for a few on screen at a time).
 */
const NEST_SLOT = 1500, NEST_P = 0.9, NEST_MAX = 90000;
const RUN_SLOT = 1000, RUN_P = 0.85, RUN_MAX = 50000;
/** Share of mice out on the open ground that come out round a vegetable bed. */
const BED_P = 0.25;
/** How dark it has to be. */
const DARK = 0.4;
/** Close enough to a hidden mouse to flush it out, walking (or anything louder a bit further). */
const FLUSH = 14, FLUSH_LOUD = 28;
const BOLT_SPEED = 95, RUN_SPEED = 38, FLEE_SPEED = 100;
/** Foragers run in little legs: a quick scurry, then a stop to sniff. */
const LEG_MS = 1300, SCURRY_MS = 420;
const SENSES: Senses = { walking: 26, jumping: 36, hissing: 44, dashing: 52, notice: 24, react: 500, swipe: 22 };

type Pt = [number, number];
interface Nest { id: number; at: Pt; t0: number; life: number }
interface Run { id: number; at: Pt; dir: number; t0: number; life: number }
/** A mouse on the move from one spot to another (bolting nest mice), or off and away (foragers). */
interface Dash { t: number; from: Pt; to: Pt; ms: number; hide: boolean }
interface Pose { x: number; y: number; frame: number; right: boolean; alpha: number }

const open = (tx: number, ty: number, level: number) => isOpenGround(tileAt(tx, ty)) && levelAt(tx, ty) === level && !furnished(tx, ty);

export class Mice implements Fauna {
  private readonly mice: Pool;
  private readonly wary: Wary;
  private readonly grass: Pt[] = [];
  private readonly ground: Pt[] = [];
  /** Round the vegetable beds. */
  private readonly beds: Pt[] = aroundFurniture('bed');
  private readonly nests = new Map<number, Nest | null>();
  private readonly runs = new Map<number, Run | null>();
  /** Where each nest mouse is hiding now (after bolting), and a run in progress. */
  private readonly moved = new Map<number, { at: Pt; n: number; dash: Dash | null }>();
  /** Foragers that took fright. */
  private readonly fled = new Map<number, Dash>();
  private readonly isCaught: (id: number) => boolean;

  constructor({ scene, isCaught }: FaunaContext) {
    this.isCaught = (id) => isCaught(Prey.Mouse, id);
    this.mice = new Pool(scene, 'mouse');
    this.wary = new Wary(scene);
    for (let ty = 1; ty < MAP_H - 1; ty++)
      for (let tx = 1; tx < MAP_W - 1; tx++) {
        const t = tileAt(tx, ty);
        if (groundOf(t) === 'tall' && !furnished(tx, ty)) this.grass.push([tx * TILE + 8, ty * TILE + 11]);
        else if (open(tx, ty, levelAt(tx, ty)) && hash2(tx, ty, 990) < 0.3) this.ground.push([tx * TILE + 8, ty * TILE + 10]);
      }
  }

  update({ gt, now, cats, prey, view }: FaunaFrame): void {
    this.mice.begin();
    this.wary.begin();
    const near = ([x, y]: Pt) => x > view.x - 100 && x < view.right + 100 && y > view.y - 100 && y < view.bottom + 100;
    for (let k = Math.floor((gt - NEST_MAX) / NEST_SLOT); k <= Math.floor(gt / NEST_SLOT); k++) {
      const m = this.nestAt(k);
      if (!m || gt < m.t0 || gt > m.t0 + m.life || this.isCaught(m.id) || !near(m.at)) continue;
      this.updateNest(m, gt, cats, prey);
    }
    for (let k = Math.floor((gt - RUN_MAX) / RUN_SLOT); k <= Math.floor(gt / RUN_SLOT); k++) {
      const m = this.runAt(k);
      if (!m || gt < m.t0 || gt > m.t0 + m.life || this.isCaught(m.id) || !near(m.at)) continue;
      this.updateRun(m, gt, now, cats, prey);
    }
    this.mice.end();
    this.wary.end();
  }

  // ---------------------------------------------------------------- in the grass

  private nestAt(k: number): Nest | null {
    if (!this.nests.has(k)) {
      let m: Nest | null = null;
      const t0 = k * NEST_SLOT;
      if (this.grass.length && hash2(k, 61, 991) < NEST_P && lightAt(t0).night >= DARK) {
        const r = seedRng(k, 61);
        m = { id: k, at: this.grass[Math.floor(r() * this.grass.length)], t0: t0 + r() * NEST_SLOT, life: 40000 + r() * 50000 };
      }
      this.nests.set(k, m);
      if (this.nests.size > NEST_MAX / NEST_SLOT + 8) {
        const old = this.nests.keys().next().value!;
        this.nests.delete(old);
        this.moved.delete(old);
      }
    }
    return this.nests.get(k)!;
  }

  private updateNest(m: Nest, gt: number, cats: CatView[], prey: PreyRef[]): void {
    let s = this.moved.get(m.id);
    if (!s) this.moved.set(m.id, (s = { at: m.at, n: 0, dash: null }));
    if (s.dash) {
      const p = this.dashPose(s.dash, gt, m.id);
      if (p) {
        this.draw(p);
        prey.push({ kind: Prey.Mouse, id: m.id, x: p.x, y: p.y, h: elevAt(p.x, p.y), colour: 0 });
        return;
      }
      s.at = s.dash.to;
      s.dash = null;
    }
    const [x, y] = s.at;
    const flusher = cats.find((c) => {
      const d = Math.hypot(c.x - x, c.y - y);
      return (d < FLUSH && c.speed > 5) || (d < FLUSH_LOUD && (c.act === Act.Hiss || c.act === Act.Jump || c.speed > 110));
    });
    if (flusher) {
      s.n++;
      s.dash = this.bolt(m.id, s.n, s.at, flusher);
      void sound.play('rustle', { at: { x, y }, volume: 0.35, rate: 2 + Math.random() * 0.3 });
      return this.updateNest(m, gt, cats, prey);
    }
    // tucked in the grass: only the ears show now and then
    const tau = gt - m.t0;
    const peek = hash2(m.id, Math.floor(gt / 1800), 992) < 0.3 && tau > 1000 && m.life - tau > 1000;
    if (peek) this.mice.get('mouse', 3).setOrigin(0.5, 1).setFlipX(hash2(m.id, Math.floor(gt / 1800), 993) < 0.5)
      .setPosition(Math.round(x), Math.round(y - elevAt(x, y))).setDepth(y + 0.5).setAlpha(1);
  }

  /** Off to the next tuft of grass, away from the cat, or out of sight altogether if there is none. */
  private bolt(id: number, n: number, from: Pt, cat: CatView): Dash {
    const [x, y] = from;
    const level = levelAt(Math.floor(x / TILE), Math.floor(y / TILE));
    const away = Math.atan2(y - cat.y, x - cat.x);
    const clear = ([tx, ty]: Pt) => {
      for (let i = 1; i < 6; i++) {
        const px = x + ((tx - x) * i) / 6, py = y + ((ty - y) * i) / 6;
        if (!open(Math.floor(px / TILE), Math.floor(py / TILE), level)) return false;
      }
      return true;
    };
    const options = this.grass.filter((g) => {
      const d = Math.hypot(g[0] - x, g[1] - y);
      if (d < 28 || d > 96) return false;
      const turn = Math.abs(((Math.atan2(g[1] - y, g[0] - x) - away + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
      return turn < 1.4 && clear(g);
    });
    if (options.length) {
      const to = options[Math.floor(hash2(id, n, 994) * options.length)];
      return { t: -1, from, to, ms: (Math.hypot(to[0] - x, to[1] - y) / BOLT_SPEED) * 1000, hide: false };
    }
    const to: Pt = [x + Math.cos(away) * 60, y + Math.sin(away) * 36];
    return { t: -1, from, to, ms: 650, hide: true };
  }

  /** Where a dashing mouse is, or null once it got there. */
  private dashPose(d: Dash, gt: number, id: number): Pose | null {
    if (d.t < 0) d.t = gt;
    const u = (gt - d.t) / d.ms;
    if (u >= 1) return null;
    const [x0, y0] = d.from, [x1, y1] = d.to;
    // a little zigzag on the way
    const wig = Math.sin(u * 14 + id) * 2 * (1 - u);
    return {
      x: x0 + (x1 - x0) * u, y: y0 + (y1 - y0) * u + wig,
      frame: 1 + (Math.floor(gt / 45) % 2), right: x1 > x0,
      alpha: d.hide ? clamp01((1 - u) * 3) : 1,
    };
  }

  // ---------------------------------------------------------------- out foraging

  private runAt(k: number): Run | null {
    if (!this.runs.has(k)) {
      let m: Run | null = null;
      const t0 = k * RUN_SLOT;
      if (this.ground.length && hash2(k, 63, 995) < RUN_P && lightAt(t0).night >= DARK) {
        const r = seedRng(k, 63);
        const spots = this.beds.length && r() < BED_P ? this.beds : this.ground;
        m = { id: 1e6 + k, at: spots[Math.floor(r() * spots.length)], dir: r() * Math.PI * 2, t0: t0 + r() * RUN_SLOT, life: 20000 + r() * 30000 };
      }
      this.runs.set(k, m);
      if (this.runs.size > RUN_MAX / RUN_SLOT + 8) {
        const old = this.runs.keys().next().value!;
        this.runs.delete(old);
        this.fled.delete(1e6 + old);
      }
    }
    return this.runs.get(k)!;
  }

  /** Where a forager has got to `tau` ms out: scurry, stop, turn a bit, scurry on; back at anything it can't cross. */
  private forage(m: Run, tau: number): Pose {
    let [x, y] = m.at, dir = m.dir;
    const level = levelAt(Math.floor(x / TILE), Math.floor(y / TILE));
    for (let leg = 0; ; leg++) {
      const t = Math.min(tau - leg * LEG_MS, SCURRY_MS);
      if (leg) dir += (hash2(m.id, leg, 996) - 0.5) * 2.4;
      const step = (RUN_SPEED * Math.max(0, t)) / 1000;
      let nx = x + Math.cos(dir) * step, ny = y + Math.sin(dir) * step * 0.6;
      if (!open(Math.floor(nx / TILE), Math.floor(ny / TILE), level)) {
        dir += Math.PI;
        nx = x;
        ny = y;
      }
      if (tau < (leg + 1) * LEG_MS) {
        const moving = t > 0 && t < SCURRY_MS;
        return { x: nx, y: ny, frame: moving ? 1 + (Math.floor(tau / 50) % 2) : 0, right: Math.cos(dir) > 0, alpha: 1 };
      }
      x = nx;
      y = ny;
    }
  }

  private updateRun(m: Run, gt: number, now: number, cats: CatView[], prey: PreyRef[]): void {
    const tau = gt - m.t0;
    let p: Pose | null;
    const f = this.fled.get(m.id);
    if (f) {
      p = this.dashPose(f, gt, m.id);
      if (!p) return;
    } else {
      p = this.forage(m, tau);
      // creeping out of the grass, and back in at the end
      p.alpha = clamp01(Math.min(tau, m.life - tau) / 500);
      const v = this.wary.watch(m.id, p.x, p.y, elevAt(p.x, p.y), cats, gt, now, SENSES);
      if (!v.calm && !v.alert) {
        // make for the nearest grass, or just away
        const away = Math.atan2(p.y - v.cat.y, p.x - v.cat.x);
        const from: Pt = [p.x, p.y];
        let to: Pt = [p.x + Math.cos(away) * 70, p.y + Math.sin(away) * 42];
        let best = 90;
        for (const g of this.grass) {
          const d = Math.hypot(g[0] - p.x, g[1] - p.y);
          const toCat = Math.hypot(g[0] - v.cat.x, g[1] - v.cat.y);
          if (d < best && toCat > d) { best = d; to = g; }
        }
        this.fled.set(m.id, { t: gt, from, to, ms: (Math.hypot(to[0] - p.x, to[1] - p.y) / FLEE_SPEED) * 1000, hide: true });
        this.wary.forget(m.id);
        void sound.play('rustle', { at: { x: p.x, y: p.y }, volume: 0.25, rate: 2.2 });
      } else if (!v.calm) {
        this.wary.mark(p.x, p.y - elevAt(p.x, p.y) - 6);
        p.frame = 0;
      }
    }
    this.draw(p);
    if (p.alpha > 0.5) prey.push({ kind: Prey.Mouse, id: m.id, x: p.x, y: p.y, h: elevAt(p.x, p.y), colour: 0 });
  }

  private draw(p: Pose): void {
    this.mice.get('mouse', p.frame).setOrigin(0.5, 1).setFlipX(p.right)
      .setPosition(Math.round(p.x), Math.round(p.y - elevAt(p.x, p.y))).setDepth(p.y).setAlpha(p.alpha);
  }
}

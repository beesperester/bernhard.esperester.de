import { BIRD_COLOURS } from '../../art/critters.ts';
import { Act, Prey, SWIPE_AT_MS } from '../state.ts';
import type { CatView } from '../CatView.ts';
import { PUDDLE } from '../Furniture.ts';
import { BATH_H, FORK_Z, FURNITURE, TILE, tileAt, levelAt, elevAt, furnished } from '../../world/map.ts';
import { SEASON } from '../../world/season.ts';
import { zAt } from '../../world/trees.ts';
import { Pool, seedRng, hash2, lerp, clamp01, type Fauna, type FaunaContext, type FaunaFrame, type PreyRef } from './kit.ts';
import type { Effects } from './Effects.ts';
import { lightAt } from '../../world/sky.ts';
import { sound } from '../../audio/sound.ts';
import { groundOf, isLawnOrTall, isOpenGround } from '../../world/legend.ts';

// Birds drop in on a tree, sit in its crown, sometimes flutter down to peck
// for food nearby, and fly off again. Like the other fauna every visit is a
// deterministic function of the garden clock; only scares and catches depend
// on the cats.

/** A new visit may start every SLOT ms with probability P (at night, P_ASLEEP: they stay much longer). */
const SLOT = 4000, P = 0.6, P_ASLEEP = 0.16;
/** A night's sleep in a tree: long enough for a cat to spot one and climb up to it. */
const SLEEP_MS = 240000, SLEEP_MORE_MS = 180000;
/** Share of daytime visits that go to a bird bath rather than a tree: birds love them. */
const BATH_P = 0.4;
/** How often a bird at the bath may have a splash about, and for how long. */
const BATHE_EVERY = 1800, BATHE_P = 0.35;
/** Longest possible visit, so we know how far back to look for birds still around. */
const MAX_VISIT = SLEEP_MS + SLEEP_MORE_MS + 10000;
const ARRIVE_MS = 2200, FLIT_MS = 900, LEAVE_MS = 2600, FLEE_MS = 2400;
/** On the ground a bird hops to a new spot this often. */
const HOP_EVERY = 2200, HOP_MS = 180;
/** How close a cat may get before a bird pecking on the ground takes off. */
const SCARE = { walking: 40, jumping: 48, hissing: 64, dashing: 80 };
/**
 * Even a crouching cat gets noticed this close. The bird looks up and takes
 * off after REACT_MS: only a dash (a pounce) gets there in time.
 */
const NOTICE = 32, REACT_MS = 650;
/** Time to freeze once spotted; creeping on after that scares the bird off. */
const FREEZE_MS = 300;
const DASH_SPEED = 110;
/** Up in a tree, a cat this close along the branches (and this near its height) that isn't creeping is noticed. */
const TREE_NOTICE = 26, TREE_NOTICE_Z = 12;
/** A sleeping bird only wakes for a cat blundering right up to it (or a hiss, or a dash below). */
const SLEEP_NOTICE = 10;

type Pt3 = [number, number, number];
/** A place a bird sits: x, ground line y and height h above it (crowns are high, the lawn is not). */
interface Stop extends Spot { t0: number; t1: number }
interface Visit { id: number; colour: number; from: Pt3; to: Pt3; stops: Stop[]; start: number; end: number; asleep: boolean }
interface Flee { t: number; x: number; y: number; h: number; dir: number }
interface Spot { x: number; y: number; h: number; depth: number; perch: boolean; bath?: boolean }

export class Birds implements Fauna {
  readonly catches = [Prey.Bird] as const;
  private readonly perches: Spot[][];
  private readonly lawns: Spot[][];
  private readonly visits = new Map<number, Visit | null>();
  private readonly fled = new Map<number, Flee>();
  /** Birds that spotted a crouching cat: when, and where the cat was. */
  private readonly alert = new Map<number, { t: number; x: number; y: number }>();
  private readonly marks: Pool;
  private readonly birds: Pool;
  private readonly shadows: Pool;
  private readonly isCaught: (id: number) => boolean;
  /** Bird baths: places on the rim, and lawn around each. */
  private readonly baths: { rim: Spot[]; lawn: Spot[] }[];
  private readonly fx: Effects;
  private readonly splashed = new Map<number, number>();
  /** Birds sitting in a tree right now, for birdsong. */
  private perched: { x: number; y: number }[] = [];
  /** This frame's catchable things, for birds on the wing. */
  private prey: PreyRef[] = [];

  constructor({ scene, trees, isCaught, fx }: FaunaContext) {
    this.isCaught = (id) => isCaught(Prey.Bird, id);
    this.fx = fx;
    this.birds = new Pool(scene, 'bird-0');
    this.shadows = new Pool(scene, 'shadow');
    this.marks = new Pool(scene, 'alert');
    // perches: along the tree's branches, boughs and roofs (the ones a cat can climb to as well), above the lowest
    this.perches = trees.map((t) => {
      const out: Spot[] = [];
      for (const q of t.perches) {
        if (Math.min(q.z0, q.z1) <= FORK_Z || q.kind === 'stump') continue;
        for (let x = q.x0 + 2; x <= q.x1 - 2; x += 3) out.push({ x: t.x + x, y: t.y, h: t.elev + Math.round(zAt(q, x)), depth: t.y + 0.5, perch: true });
      }
      return out;
    });
    // lawns: open grass or path a few steps from the trunk, at the tree's level
    this.lawns = trees.map((t) => this.lawnAround(Math.floor(t.x / TILE), Math.floor(t.y / TILE)));
    // bird baths: on the rim at the front of the basin, and the lawn around; the puddles under the pumps: round their edge
    this.baths = FURNITURE.filter((f) => f.kind === 'birdbath' || f.kind === 'pump').map((f) => {
      if (f.kind === 'pump') {
        const cx = f.tx * TILE + PUDDLE.x, cy = f.ty * TILE + PUDDLE.y;
        return {
          rim: [[-7, -2], [-3, -3], [4, -3], [8, 0], [3, 3]].map(([dx, dy]) => ({ x: cx + dx, y: cy + dy, h: elevAt(cx, cy), depth: cy + dy, perch: false, bath: true })),
          lawn: this.lawnAround(f.tx + 1, f.ty),
        };
      }
      const cx = f.tx * TILE + 8, y = f.ty * TILE + 10;
      return {
        rim: [-4, -1, 2, 5].map((dx) => ({ x: cx + dx, y, h: BATH_H, depth: y, perch: false, bath: true })),
        lawn: this.lawnAround(f.tx, f.ty),
      };
    });
  }

  /** Open grass or path a few steps from tile (tx, ty), at its level. */
  private lawnAround(tx: number, ty: number): Spot[] {
    const out: Spot[] = [];
    for (let y = ty - 3; y <= ty + 3; y++)
      for (let x = tx - 3; x <= tx + 3; x++) {
        if ((x === tx && y === ty) || !(isLawnOrTall(tileAt(x, y)) || groundOf(tileAt(x, y)) === 'path') || levelAt(x, y) !== levelAt(tx, ty) || furnished(x, y)) continue;
        if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !isOpenGround(tileAt(x + dx, y + dy)))) continue;
        const cx = x * TILE + 8, cy = y * TILE + 10;
        out.push({ x: cx, y: cy, h: elevAt(cx, cy), depth: cy, perch: false });
      }
    return out;
  }

  private visitAt(k: number): Visit | null {
    if (!this.visits.has(k)) {
      let v: Visit | null = null;
      const asleep = lightAt(k * SLOT).night >= 0.5;
      if (hash2(k, 11, 920) < (asleep ? P_ASLEEP : P) && this.perches.length) {
        const r = seedRng(k, 11);
        const tree = Math.floor(r() * this.perches.length);
        // by day many go to a bird bath instead
        const bath = !asleep && this.baths.length && r() < BATH_P ? this.baths[Math.floor(r() * this.baths.length)] : null;
        const perches = bath ? bath.rim : this.perches[tree], lawns = bath ? bath.lawn : this.lawns[tree];
        const perch = (): Spot | null => (perches.length ? perches[Math.floor(r() * perches.length)] : null);
        const lawn = (): Spot | null => (lawns.length ? lawns[Math.floor(r() * lawns.length)] : null);
        // sit in the tree; peck on the lawn; or come down for a bit and go back up; at night, just sleep up there
        // (at the bath: drink and splash on the rim, maybe hop down onto the grass first)
        const u = r();
        const plan: [Spot | null, number][] = bath ? (u < 0.6 ? [[perch(), 15000 + r() * 25000]] : [[lawn(), 8000 + r() * 12000], [perch(), 12000 + r() * 20000]])
          : asleep ? [[perch(), SLEEP_MS + r() * SLEEP_MORE_MS]]
          : u < 0.35 ? [[perch(), 15000 + r() * 30000]]
          : u < 0.65 ? [[lawn(), 15000 + r() * 25000]]
          : [[perch(), 6000 + r() * 14000], [lawn(), 12000 + r() * 20000], [perch(), 5000 + r() * 12000]];
        const spots = plan.filter((s): s is [Spot, number] => !!s[0]);
        if (spots.length) {
          const start = k * SLOT + r() * SLOT;
          let t = start + ARRIVE_MS;
          const stops = spots.map(([s, dur]) => {
            const stop: Stop = { ...s, t0: t, t1: t + dur };
            t += dur + FLIT_MS;
            return stop;
          });
          const first = stops[0], last = stops[stops.length - 1];
          const din = r() < 0.5 ? -1 : 1, dout = r() < 0.5 ? -1 : 1;
          v = {
            id: k, colour: Math.floor(r() * BIRD_COLOURS.length), stops, start, end: last.t1 + LEAVE_MS, asleep,
            from: [first.x + din * 160, first.y - 20, first.h + 90],
            to: [last.x + dout * 180, last.y - 30, last.h + 100],
          };
        }
      }
      this.visits.set(k, v);
      if (this.visits.size > MAX_VISIT / SLOT + 16) {
        const old = this.visits.keys().next().value!;
        this.visits.delete(old);
        this.fled.delete(old);
        this.alert.delete(old);
      }
    }
    return this.visits.get(k)!;
  }

  /** A perched bird near (x, y), to sing from. */
  perchedNear(x: number, y: number, range: number): { x: number; y: number } | null {
    const near = this.perched.filter((b) => Math.hypot(b.x - x, b.y - y) < range);
    return near.length ? near[Math.floor(Math.random() * near.length)] : null;
  }

  /** Snatched in a puff of feathers. */
  onCatch(p: PreyRef): void {
    this.fx.feathers(p.x, p.y - p.h - 3, p.colour);
  }

  update({ gt, now, cats, prey }: FaunaFrame): void {
    this.prey = prey;
    this.birds.begin();
    this.shadows.begin();
    this.marks.begin();
    this.perched = [];
    for (let k = Math.floor((gt - MAX_VISIT) / SLOT); k <= Math.floor(gt / SLOT); k++) {
      const v = this.visitAt(k);
      if (!v || gt < v.start || gt > v.end || this.isCaught(v.id)) continue;
      const f = this.fled.get(v.id);
      if (f) {
        if (gt - f.t < FLEE_MS) this.drawFlee(v, f, gt);
        continue;
      }
      this.updateVisit(v, gt, now, cats, prey);
    }
    this.birds.end();
    this.shadows.end();
    this.marks.end();
  }

  private updateVisit(v: Visit, gt: number, now: number, cats: CatView[], prey: PreyRef[]): void {
    const { stops } = v;
    const first = stops[0], last = stops[stops.length - 1];
    const wing = Math.floor(gt / 80) % 2 ? 2 : 3;
    // sleeping birds are simply there in the dark, fading in and out instead of flying
    if (v.asleep) {
      const s = first, alpha = clamp01(Math.min((gt - v.start) / 3000, (v.end - gt) / 3000));
      for (const c of cats) {
        const d = Math.hypot(c.x - s.x, c.y - s.y);
        const creeping = c.act === Act.Crouch || c.act === Act.Sneak || c.act === Act.Catch;
        if ((c.act === Act.Hiss && d < 40) || (c.speed > DASH_SPEED && d < 40)
          || (Math.abs(c.z - s.h) < TREE_NOTICE_Z && Math.abs(c.x - s.x) < SLEEP_NOTICE && !creeping && c.speed > 5))
          return this.scare(v, [s.x, s.y, s.h], c, gt);
      }
      this.draw(v, [s.x, s.y, s.h], 4, hash2(v.id, 926) < 0.5, alpha, s.depth);
      // (fast asleep: a cat that gets up there quietly can have it)
      if (alpha > 0.5) prey.push({ kind: Prey.Bird, id: v.id, x: s.x, y: s.y, h: s.h, colour: v.colour });
      return;
    }
    // flying in, fading in on the way
    if (gt < first.t0) {
      const u = (gt - v.start) / ARRIVE_MS, e = 1 - (1 - u) ** 2;
      const pos: Pt3 = [lerp(v.from[0], first.x, e), lerp(v.from[1], first.y, e), lerp(v.from[2], first.h, e)];
      this.draw(v, pos, wing, first.x > v.from[0], clamp01(u * 3), first.depth);
      this.onTheWing(v, pos);
      return;
    }
    // flying off, fading out
    if (gt >= last.t1) {
      const u = (gt - last.t1) / LEAVE_MS, e = u * u;
      const pos: Pt3 = [lerp(last.x, v.to[0], e), lerp(last.y, v.to[1], e), lerp(last.h, v.to[2], e)];
      this.draw(v, pos, wing, v.to[0] > last.x, clamp01((1 - u) * 3), last.depth);
      this.onTheWing(v, pos);
      return;
    }
    for (let i = 0; i < stops.length; i++) {
      const s = stops[i];
      if (gt >= s.t1) {
        // fluttering between the crown and the lawn
        const n = stops[i + 1];
        if (gt < n.t0) {
          const u = (gt - s.t1) / FLIT_MS;
          const pos: Pt3 = [lerp(s.x, n.x, u), lerp(s.y, n.y, u), lerp(s.h, n.h, u) + 12 * 4 * u * (1 - u)];
          this.draw(v, pos, wing, n.x > s.x, 1, u < 0.5 ? s.depth : n.depth);
          this.onTheWing(v, pos);
          return;
        }
        continue;
      }
      if (s.perch) this.sit(v, s, gt, cats, prey);
      else this.peck(v, s, gt, now, cats, prey);
      return;
    }
  }

  /**
   * In a tree: looks around now and then; a dashing or hissing cat right below
   * scares it off, and so does one up on the branches with it that isn't
   * creeping (a cat that sneaks along the branch can catch it).
   */
  private sit(v: Visit, s: Stop, gt: number, cats: CatView[], prey: PreyRef[]): void {
    const look = Math.floor((gt - s.t0) / 2600);
    const right = hash2(v.id, look, 921) < 0.5;
    this.perched.push({ x: s.x, y: s.y - s.h });
    for (const c of cats) {
      const d = Math.hypot(c.x - s.x, c.y - s.y);
      if ((c.speed > DASH_SPEED && d < 40) || (c.act === Act.Hiss && d < 56)) return this.scare(v, [s.x, s.y, s.h], c, gt);
      const creeping = c.act === Act.Crouch || c.act === Act.Sneak || c.act === Act.Catch;
      if (Math.abs(c.z - s.h) < TREE_NOTICE_Z && Math.abs(c.x - s.x) < TREE_NOTICE && !creeping && c.speed > 5) return this.scare(v, [s.x, s.y, s.h], c, gt);
    }
    this.draw(v, [s.x, s.y, s.h], 0, right, 1, s.depth);
    prey.push({ kind: Prey.Bird, id: v.id, x: s.x, y: s.y, h: s.h, colour: v.colour });
  }

  /** On the lawn: pecks, hops about, and keeps an eye on the cats. */
  private peck(v: Visit, s: Stop, gt: number, now: number, cats: CatView[], prey: PreyRef[]): void {
    const tau = gt - s.t0;
    const j = Math.floor(tau / HOP_EVERY);
    // little shuffles along the rim of a bath, bigger hops on the lawn
    const room = s.bath ? 0.4 : 1;
    const spot = (n: number): [number, number] => (n <= 0 ? [0, 0] : [(hash2(v.id, n, 922) - 0.5) * 10 * room, (hash2(v.id, n, 923) - 0.5) * 6 * room * room]);
    const [ax, ay] = spot(j - 1), [bx, by] = spot(j);
    const u = clamp01((tau - j * HOP_EVERY) / HOP_MS);
    const x = s.x + lerp(ax, bx, u), y = s.y + lerp(ay, by, u);
    const hop = u < 1 ? 2 * 4 * u * (1 - u) : 0;
    let right = bx === ax ? hash2(v.id, j, 924) < 0.5 : bx > ax;
    const pos: Pt3 = [x, y, s.h];

    let alert = this.alert.get(v.id);
    for (const c of cats) {
      if (Math.abs(c.z - s.h) > 20) continue; // a cat up on a ledge is out of the way
      const d = Math.hypot(c.x - x, c.y - y);
      // a swipe that missed
      if (c.act === Act.Catch && now - c.actStart > SWIPE_AT_MS + 80 && d < 32) return this.scare(v, pos, c, gt);
      if (c.act === Act.Crouch || c.act === Act.Sneak) {
        if (d < NOTICE && !alert) this.alert.set(v.id, (alert = { t: gt, x: c.x, y: c.y }));
        // spotted: freeze, or it's gone
        else if (alert && d < NOTICE && c.speed > 5 && gt - alert.t > FREEZE_MS) return this.scare(v, pos, c, gt);
        continue;
      }
      // once it has spotted a cat it is about to go anyway; the pounce has to beat that
      if (alert || c.act === Act.Catch) continue;
      const r = c.act === Act.Hiss ? SCARE.hissing
        : c.act === Act.Jump ? SCARE.jumping
        : c.speed > DASH_SPEED ? SCARE.dashing
        : c.speed > 5 ? SCARE.walking : 0;
      if (d < r) return this.scare(v, pos, c, gt);
    }
    if (alert) {
      if (gt - alert.t >= REACT_MS) {
        this.fled.set(v.id, { t: gt, x, y, h: s.h, dir: Math.sign(x - alert.x) || 1 });
        void sound.play('rustle', { at: { x, y }, volume: 0.3, rate: 1.7 + Math.random() * 0.2 });
        return this.drawFlee(v, this.fled.get(v.id)!, gt);
      }
      // head up, eyeing the cat
      right = alert.x > x;
      this.marks.get().setOrigin(0.5, 1).setPosition(Math.round(x), Math.round(y - s.h) - 9).setDepth(100000);
    }

    const pecking = !alert && u >= 1 && hash2(v.id, Math.floor(gt / 280), 925) < 0.4;
    // at the bath, every now and then a good splash: wings whirring, drops flying
    const bathing = s.bath && !SEASON.frozen && !alert && u >= 1 && hash2(v.id, Math.floor(gt / BATHE_EVERY), 927) < BATHE_P;
    if (bathing) {
      const last = this.splashed.get(v.id) ?? -1e9;
      if (gt - last > 260 || gt < last) {
        this.splashed.set(v.id, gt);
        if (this.splashed.size > 32) this.splashed.delete(this.splashed.keys().next().value!);
        // a few drops, now and then a little splish
        this.fx.drops(x, y - s.h + 1, y + 0.6);
        if (gt - last > BATHE_EVERY) this.fx.splashSound(x, y - s.h + 1, 0.12, 1.9);
      }
    }
    this.draw(v, [x, y, s.h + (alert ? 0 : hop)], bathing ? (Math.floor(gt / 60) % 2 ? 2 : 3) : u < 1 && !alert ? 2 : pecking ? 1 : 0, right, 1, y);
    prey.push({ kind: Prey.Bird, id: v.id, x, y, h: s.h, colour: v.colour });
  }

  private scare(v: Visit, [x, y, h]: Pt3, c: CatView, gt: number): void {
    const f = { t: gt, x, y, h, dir: Math.sign(x - c.x) || 1 };
    this.fled.set(v.id, f);
    void sound.play('rustle', { at: { x, y }, volume: 0.3, rate: 1.7 + Math.random() * 0.2 });
    this.drawFlee(v, f, gt);
  }

  private drawFlee(v: Visit, f: Flee, gt: number): void {
    const s = (gt - f.t) / 1000;
    const pos: Pt3 = [f.x + f.dir * (50 * s + 40 * s * s), f.y - 14 * s, f.h + 45 * s + 10 * s * s];
    this.draw(v, pos, Math.floor(gt / 55) % 2 ? 2 : 3, f.dir > 0, clamp01((FLEE_MS - (gt - f.t)) / 700), f.y);
    // just taking off, it can still be had by a cat leaping after it
    if (gt - f.t < 900) this.onTheWing(v, pos);
  }

  /** A bird flying at pos: catchable in mid-jump (only low ones are within reach anyway). */
  private onTheWing(v: Visit, [x, y, h]: Pt3): void {
    this.prey.push({ kind: Prey.Bird, id: v.id, x, y, h, colour: v.colour, air: true });
  }

  /** Draw a bird at ground point (x, y), height h; flying high it goes over everything. */
  private draw(v: Visit, [x, y, h]: Pt3, frame: number, right: boolean, alpha: number, depth: number): void {
    const above = h - elevAt(x, y);
    this.birds.get(`bird-${v.colour}`, frame).setOrigin(0.5, 1).setFlipX(right)
      .setPosition(Math.round(x), Math.round(y - h)).setAlpha(alpha)
      .setDepth(above > 30 && frame >= 2 ? 99000 + y : depth);
    if (above < 24)
      this.shadows.get().setScale(0.45, 0.5).setPosition(Math.round(x), Math.round(y - elevAt(x, y)))
        .setDepth(y - 1).setAlpha(Math.max(0, 0.2 - above * 0.008) * alpha);
  }
}

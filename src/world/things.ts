// Things a cat can carry about: feathers, leaves, twigs, pine cones and
// flowers. Some lie about the park, where the garden's seed puts them (twigs
// and leaves under the broadleaves, cones under the pines, now and then a
// feather), new ones every so often by the garden clock like the finds; the
// rest are put down by cats: a feather from a bird caught or scared off, a
// twig or a leaf knocked out of a tree, a flower picked in the meadow, and
// whatever a cat carried and put down or tossed away.
//
// A thing put down flies from the cat's mouth to where it lands, in an arc
// worked out the same way on every screen from where and when it set off.
// On the ground it lies for a while; in a stream it floats off down it with
// the current; on a pond it bobs for a bit, then sinks.

import { hash2 } from '../art/raster.ts';
import { LEAF_GREEN, Thing, VARIANTS, plantId, scatterId, type ThingKind } from './thingKinds.ts';
import { worldSeed } from './seed.ts';
import { TILE, frozenAt, tileAt } from './map.ts';
import { isOpenGround, isWaterway } from './legend.ts';
import { TREES, type TreePlan } from './trees.ts';
import { FLOW, STREAMS, along } from './streams.ts';
import { seasonAt } from './season.ts';

export { KINDS, LEAF_GREEN, Thing, VARIANTS, type ThingKind } from './thingKinds.ts';

/** A cat's mouth is this high (px), when it carries something. */
export const MOUTH_Z = 6;
/** A thing this close to a cat's mouth (px) can be picked up. */
export const REACH = 10;
/** Put down, it lands this far in front of the cat; tossed, this far (px), up to this high over the ground. */
export const PUT = 5, TOSS = 34, TOSS_HIGH = 14;
/** How long things lie about: on the ground, bobbing on a pond (then they sink), and fading away at the end (ms). */
export const GROUND_MS = 15 * 60_000, POND_MS = 45_000, FADE_MS = 4000;
/** Past a stream's mouth it floats on this far into the pond, and is gone (px). */
const RUN_ON = 18;
/** Something new may lie in each of the park's places every REFILL_MS (each place at its own moment). */
export const REFILL_MS = 10 * 60_000;
/** A flower picked in the meadow grows again after this long (ms). */
export const REGROW_MS = 10 * 60_000;

export { MAX_ID, PLANT_BASE, SCATTER_BASE, newId, plantId, scatterId } from './thingKinds.ts';

/**
 * A thing put down or tossed: from (x0, y0) at height z0 (above the ground there) to (x1, y1)
 * on the ground, leaving at garden time gt (ms).
 */
export interface Placed { id: number; kind: ThingKind; v: number; x0: number; y0: number; z0: number; x1: number; y1: number; gt: number }

/** Where it ends up: on the ground (or ice), floating down stream `stream` from `s` px along it, or on a pond. */
export type Landing = { on: 'ground' } | { on: 'pond' } | { on: 'stream'; stream: number; s: number };

/** A thing as it is at some moment: where (z its height over the ground), lying, flying or afloat, and how much of it shows. */
export interface ThingNow { id: number; kind: ThingKind; v: number; x: number; y: number; z: number; how: 'flying' | 'ground' | 'afloat'; alpha: number; turn: number }

/** How long it's in the air (ms): a short drop, longer the further it goes and the higher it starts. */
export const flightMs = (p: Placed) => 160 + Math.hypot(p.x1 - p.x0, p.y1 - p.y0) * 9 + Math.sqrt(Math.max(0, p.z0)) * 25;

/** Where the water would carry something that came down at (x, y). */
export function landingAt(x: number, y: number): Landing {
  const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
  if (!isWaterway(tileAt(tx, ty)) || frozenAt(tx, ty)) return { on: 'ground' };
  // the nearest bit of a stream, if it's in one
  let best: Landing = { on: 'pond' }, near = Infinity;
  STREAMS.forEach((st, si) => {
    const r = st.river ? 14 : 9, { box } = st;
    if (x < box.x0 - r || x > box.x1 + r || y < box.y0 - r || y > box.y1 + r) return;
    for (let i = 1; i < st.pts.length; i++) {
      const [ax, ay] = st.pts[i - 1], [bx, by] = st.pts[i], len = st.at[i] - st.at[i - 1] || 1;
      const u = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / (len * len)));
      const d = Math.hypot(ax + (bx - ax) * u - x, ay + (by - ay) * u - y);
      if (d < r && d < near) {
        near = d;
        best = { on: 'stream', stream: si, s: st.at[i - 1] + u * len };
      }
    }
  });
  return best;
}

/** Where placed thing p is at garden time gt, or null once it's gone. `landing` is landingAt its end (worked out once). */
export function placedAt(p: Placed, landing: Landing, gt: number): ThingNow | null {
  const t = gt - p.gt, fly = flightMs(p);
  const base = { id: p.id, kind: p.kind, v: p.v };
  if (t < 0) return null;
  if (t < fly) {
    // an arc: up a little and down, turning over as it goes
    const u = t / fly, lift = Math.min(TOSS_HIGH, Math.hypot(p.x1 - p.x0, p.y1 - p.y0) * 0.35);
    return { ...base, x: p.x0 + (p.x1 - p.x0) * u, y: p.y0 + (p.y1 - p.y0) * u, z: p.z0 * (1 - u) + 4 * lift * u * (1 - u), how: 'flying', alpha: 1, turn: Math.floor(u * 4) };
  }
  const since = t - fly, turn = hash2(p.id % 65536, 1, 71) < 0.5 ? 0 : 2;
  if (landing.on === 'ground') {
    if (since > GROUND_MS) return null;
    return { ...base, x: p.x1, y: p.y1, z: 0, how: 'ground', alpha: fade(GROUND_MS - since), turn };
  }
  if (landing.on === 'pond') {
    if (since > POND_MS) return null;
    // bobbing about where it fell, drifting a little
    const s = since / 1000, ph = (p.id % 997) * 0.01;
    return { ...base, x: p.x1 + Math.sin(s * 0.3 + ph) * 2, y: p.y1 + Math.sin(s * 0.23 + ph * 2) * 1, z: 0, how: 'afloat', alpha: fade(POND_MS - since), turn: Math.floor(s * 0.5) % 4 };
  }
  // down the stream with the current, wandering from side to side of it
  const st = STREAMS[landing.stream], d = landing.s + (since / 1000) * FLOW;
  if (d > st.length + RUN_ON) return null;
  const a = along(st, d), over = Math.max(0, d - st.length), on = over * (1 - over / (RUN_ON * 2));
  const wander = Math.sin(since / 1400 + (p.id % 997)) * 1.5;
  return {
    ...base, x: a.x + a.dx * on - a.dy * wander, y: a.y + a.dy * on + a.dx * wander * 0.7, z: 0, how: 'afloat',
    alpha: Math.min(1, (st.length + RUN_ON - d) / RUN_ON), turn: Math.floor(since / 2000) % 4,
  };
}

const fade = (left: number) => Math.max(0, Math.min(1, left / FADE_MS));

// ---- the park's own things ----

/** A place something turns up time and again: its kind, where, how likely each time round, and when its rounds start (ms). */
export interface ScatterSlot { kind: ThingKind; x: number; y: number; chance: number; phase: number }

/** Somewhere on open ground near the tree's foot (not under the trunk), or null if there's none. */
function spotNear(t: TreePlan, k: number, seed: number): [number, number] | null {
  for (let tries = 0; tries < 6; tries++) {
    const a = hash2(t.tx * 7 + k, t.ty * 13 + tries, seed + 61) * Math.PI * 2;
    const r = t.trunk + 5 + hash2(t.tx + k, t.ty + tries, seed + 62) * 18;
    const x = Math.round(t.x + Math.cos(a) * r), y = Math.round(t.y + Math.sin(a) * r * 0.6);
    if (isOpenGround(tileAt(Math.floor(x / TILE), Math.floor(y / TILE)))) return [x, y];
  }
  return null;
}

/** The places in the park: under each tree twigs and leaves (cones under pines), and now and then a feather. */
export function planScatter(seed: number, trees: readonly TreePlan[] = TREES): ScatterSlot[] {
  const out: ScatterSlot[] = [];
  trees.forEach((t, i) => {
    const kinds: [ThingKind, number][] = t.shape === 'pine' ? [[Thing.Cone, 0.5], [Thing.Twig, 0.25]] : [[Thing.Twig, 0.35], [Thing.Leaf, 1]];
    if (hash2(i, 5, seed + 63) < 0.12) kinds.push([Thing.Feather, 0.3]);
    kinds.forEach(([kind, chance], k) => {
      const at = spotNear(t, k, seed);
      if (at) out.push({ kind, x: at[0], y: at[1], chance, phase: Math.floor(hash2(i, k, seed + 64) * REFILL_MS) });
    });
  });
  return out;
}

/** What lies in slot n (index into slots) at garden time gt, if anything: its id, and which of its kind it is. */
export function scatteredIn(slots: readonly ScatterSlot[], n: number, gt: number, seed: number): { id: number; v: number } | null {
  const s = slots[n], round = Math.floor((gt - s.phase) / REFILL_MS), start = round * REFILL_MS + s.phase;
  const season = seasonAt(start);
  let chance = s.chance;
  // leaves only lie about when they've come down: a lot in autumn, a green one blown down now and then in summer
  if (s.kind === Thing.Leaf) chance = season.leaves > 0.5 && season.turn < 0.2 ? 0.08 : Math.max(season.litter, season.falling) * 0.8 + 0.05;
  if (season.snow > 0.5 && s.kind !== Thing.Cone && s.kind !== Thing.Twig) chance *= 0.2;
  const r = hash2(n, round, seed + 65);
  if (r >= chance) return null;
  const u = hash2(n, round, seed + 66);
  const v = s.kind === Thing.Leaf ? (season.turn < 0.2 ? LEAF_GREEN : Math.floor(u * LEAF_GREEN)) : Math.floor(u * VARIANTS[s.kind]);
  return { id: scatterId(n, round), v };
}

export const SCATTER = planScatter(worldSeed().seed);

// ---- what every cat knows: things put down, and things taken ----

/** The park's things bucketed by area (px), so only those near the view are looked at. */
const CELL = 128;

/**
 * What's lying about, flying or afloat: the park's own things (less those taken) and those cats put
 * down. Taking and placing come from this cat or from others (game/Things.ts and the net); every
 * screen works out the same picture from them and the garden clock.
 */
export class ThingStore {
  private readonly placed = new Map<number, { p: Placed; landing: Landing }>();
  /** Taken things: when (garden ms). A park thing or a flower is gone for its round (or till it regrows); one put down, till it's put down again. */
  private readonly taken = new Map<number, number>();
  private readonly cells = new Map<number, number[]>();
  private readonly slots: readonly ScatterSlot[];
  private readonly seed: number;

  constructor(slots: readonly ScatterSlot[] = SCATTER, seed = worldSeed().seed) {
    this.slots = slots;
    this.seed = seed;
    slots.forEach((s, n) => {
      const key = cellOf(s.x, s.y);
      let list = this.cells.get(key);
      if (!list) this.cells.set(key, (list = []));
      list.push(n);
    });
  }

  /** p was put down (or tossed). A later putting down of the same thing wins. */
  place(p: Placed): void {
    const known = this.placed.get(p.id);
    if (known && known.p.gt > p.gt) return;
    const took = this.taken.get(p.id);
    if (took !== undefined && took > p.gt) return;
    this.taken.delete(p.id);
    this.placed.set(p.id, { p, landing: landingAt(p.x1, p.y1) });
  }

  /** Thing id was picked up at garden time gt. */
  take(id: number, gt: number): void {
    const known = this.placed.get(id);
    if (known && known.p.gt > gt) return;
    this.placed.delete(id);
    this.taken.set(id, Math.max(gt, this.taken.get(id) ?? 0));
  }

  /** Whether a meadow flower (plant index) is picked at gt. */
  picked(plant: number, gt: number): boolean {
    const at = this.taken.get(plantId(plant));
    return at !== undefined && gt - at < REGROW_MS && gt >= at;
  }

  /** Everything in the box at garden time gt. */
  within(x0: number, y0: number, x1: number, y1: number, gt: number): ThingNow[] {
    const out: ThingNow[] = [];
    for (const { p, landing } of this.placed.values()) {
      const t = placedAt(p, landing, gt);
      if (t && t.x >= x0 && t.x <= x1 && t.y >= y0 && t.y <= y1) out.push(t);
    }
    for (let cy = Math.floor(y0 / CELL); cy <= Math.floor(y1 / CELL); cy++)
      for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++)
        for (const n of this.cells.get(cellKey(cx, cy)) ?? []) {
          const s = this.slots[n];
          if (s.x < x0 || s.x > x1 || s.y < y0 || s.y > y1) continue;
          const here = scatteredIn(this.slots, n, gt, this.seed);
          // (taken, or picked up and put down somewhere else)
          if (!here || this.taken.has(here.id) || this.placed.has(here.id)) continue;
          out.push({ id: here.id, kind: s.kind, v: here.v, x: s.x, y: s.y, z: 0, how: 'ground', alpha: 1, turn: here.id % 3 === 0 ? 2 : 0 });
        }
    return out;
  }

  /** The thing nearest (x, y) within reach that a cat can pick up (lying on the ground, or afloat by the bank). */
  nearest(x: number, y: number, gt: number, reach = REACH): ThingNow | null {
    let best: ThingNow | null = null, d0 = reach;
    for (const t of this.within(x - reach, y - reach, x + reach, y + reach, gt)) {
      const d = Math.hypot(t.x - x, (t.y - y) * 1.4);
      if (t.how !== 'flying' && t.alpha > 0.5 && d <= d0) {
        best = t;
        d0 = d;
      }
    }
    return best;
  }

  /** What a newcomer needs to know: things put down that are still about, and what's been taken lately. */
  account(gt: number): { placed: Placed[]; taken: [number, number][] } {
    this.prune(gt);
    const placed = [...this.placed.values()].map((x) => x.p).slice(-256);
    const taken = [...this.taken.entries()].slice(-1024);
    return { placed, taken };
  }

  /** What a cat already here told us. */
  recall(account: { placed: Placed[]; taken: [number, number][] }): void {
    for (const [id, gt] of account.taken) this.take(id, gt);
    for (const p of account.placed) this.place(p);
  }

  /** Forget what's gone: things that have sunk, floated off or lain too long, and takings that no longer matter. */
  prune(gt: number): void {
    for (const [id, { p, landing }] of this.placed) if (!placedAt(p, landing, gt) && gt > p.gt) this.placed.delete(id);
    for (const [id, at] of this.taken) if (gt - at > Math.max(REFILL_MS, REGROW_MS) + 60_000) this.taken.delete(id);
  }
}

const cellKey = (cx: number, cy: number) => (cy + 1) * 4096 + cx + 1;
const cellOf = (x: number, y: number) => cellKey(Math.floor(x / CELL), Math.floor(y / CELL));

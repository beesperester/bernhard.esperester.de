// What peers send each other, and how we check it. Peers are untrusted: every
// message is validated here before the game sees it.
import { Prey, type CatMsg } from '../game/state.ts';
import type { WorldSeed } from '../world/seed.ts';
import { MAX_ID, carriedCode, carriedOf, type ThingKind } from '../world/thingKinds.ts';
import type { Placed } from '../world/things.ts';
import { WORLD_H, WORLD_W } from '../world/size.ts';

/** Accept only a well-formed cat state tuple: [x, y, z, facing, act, seq, coat, mews, stage, carried] (carried may be left off: nothing). */
export function sanitizeCat(d: unknown): CatMsg | null {
  if (!Array.isArray(d) || (d.length !== 9 && d.length !== 10) || !d.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  const [x, y, z, facing, act, seq, coat, mews, stage, carried = 0] = d as number[];
  return [x, y, z, facing | 0, act | 0, seq | 0, coat | 0, mews | 0, Math.min(2, Math.max(0, stage | 0)), carriedOf(carried) ? carried : 0];
}

/**
 * A thing taken (picked up) at garden time gt: ['t', id, gt]; or put down: ['p', id, kind, variant, x0, y0, z0, x1, y1, gt],
 * flying from (x0, y0) z0 up to land at (x1, y1) (world/things.ts' Placed).
 */
export type ThingMsg = ['t', number, number] | ['p', number, number, number, number, number, number, number, number, number];

/** Furthest a thing can be thrown (px), and highest it can start (a cat up a tree). */
const THROW = 60, HIGH = 400;

/** A thing put down: [id, kind, variant, x0, y0, z0, x1, y1, gt], as it goes in a ThingMsg and a WorldMsg. */
export function sanitizePlaced(d: unknown): Placed | null {
  if (!Array.isArray(d) || d.length !== 9 || !d.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  const [id, kind, v, x0, y0, z0, x1, y1, gt] = d as number[];
  if (!isId(id) || !carriedOf(carriedCode({ kind: kind as ThingKind, v })) || !Number.isInteger(gt) || gt <= 0) return null;
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x <= WORLD_W && y <= WORLD_H;
  if (!inside(x0, y0) || !inside(x1, y1) || z0 < 0 || z0 > HIGH || Math.hypot(x1 - x0, y1 - y0) > THROW) return null;
  return { id, kind: kind as ThingKind, v, x0, y0, z0, x1, y1, gt };
}

const isId = (id: unknown): id is number => Number.isSafeInteger(id) && (id as number) > 0 && (id as number) < MAX_ID;
const isTake = (d: unknown): d is [number, number] => Array.isArray(d) && d.length === 2 && isId(d[0]) && Number.isInteger(d[1]) && d[1] > 0;

/** Accept only a well-formed taking or putting down of a thing. */
export function sanitizeThing(d: unknown): ThingMsg | null {
  if (!Array.isArray(d)) return null;
  if (d[0] === 't' && d.length === 3 && isTake(d.slice(1))) return ['t', d[1], d[2]];
  if (d[0] === 'p' && d.length === 10) {
    const p = sanitizePlaced(d.slice(1));
    return p && ['p', p.id, p.kind, p.v, p.x0, p.y0, p.z0, p.x1, p.y1, p.gt];
  }
  return null;
}

/** What a newcomer is told about things: those put down still about ([id, kind, v, x0, y0, z0, x1, y1, gt]), and those taken lately ([id, gt]). */
export type ThingsAccount = { placed: Placed[]; taken: [number, number][] };
/** ...as it's sent. */
export type ThingsWire = { placed: number[][]; taken: [number, number][] };
const placedTuple = (p: Placed) => [p.id, p.kind, p.v, p.x0, p.y0, p.z0, p.x1, p.y1, p.gt];
export const accountMsg = (a: ThingsAccount): ThingsWire => ({ placed: a.placed.map(placedTuple), taken: a.taken });

function sanitizeAccount(d: unknown): ThingsAccount | null {
  if (!d || typeof d !== 'object') return null;
  const { placed, taken } = d as Record<string, unknown>;
  if (!Array.isArray(placed) || placed.length > 256 || !Array.isArray(taken) || taken.length > 1024 || !taken.every(isTake)) return null;
  const p = placed.map(sanitizePlaced);
  return p.every((x) => x) ? { placed: p as Placed[], taken: taken as [number, number][] } : null;
}

const PREY_KINDS = new Set<number>(Object.values(Prey));

/** Accept only a [kind, id] catch with a known kind of prey and an integer id. */
export function sanitizeCatch(d: unknown): [Prey, number] | null {
  if (!Array.isArray(d) || d.length !== 2) return null;
  const [kind, id] = d;
  return PREY_KINDS.has(kind) && Number.isInteger(id) ? [kind as Prey, id as number] : null;
}

/** Accept only a [tree, garden time] paw at a tree: a tree index and a time, both whole numbers. */
export function sanitizeShake(d: unknown, trees: number): [number, number] | null {
  if (!Array.isArray(d) || d.length !== 2) return null;
  const [tree, gt] = d;
  return Number.isInteger(tree) && tree >= 0 && tree < trees && Number.isInteger(gt) && gt > 0 ? [tree, gt] : null;
}

/**
 * The train: how far round the track the lok's front is (px), its speed (px/s, backwards below 0),
 * the throttle's notch, whether the sender is driving it (1) or has just let go (0), the garden
 * time (ms) all that is for, and how many times its driver has sounded the whistle (counting on
 * from 0, round at 65536: a new number is a toot).
 */
export type TrainMsg = [number, number, number, number, number, number];

/** Accept only a train somewhere on the track, going no faster than it can. */
export function sanitizeTrain(d: unknown, length: number, notches: number, top: number): TrainMsg | null {
  if (!Array.isArray(d) || d.length !== 6 || !d.every((x) => typeof x === 'number' && Number.isFinite(x))) return null;
  const [s, v, notch, driving, t, toots] = d as number[];
  if (s < 0 || s >= length || Math.abs(v) > top || !Number.isInteger(notch) || Math.abs(notch) > notches || (driving !== 0 && driving !== 1) || t <= 0) return null;
  if (!Number.isInteger(toots) || toots < 0 || toots > 0xffff) return null;
  return [s, v, notch, driving, t, toots];
}

/**
 * A ride on a funfair's rollercoaster: which coaster (its index among the garden's), the garden time
 * (ms) its car sets off (or set off), and the seat the sender sits in (0 front, 1 back; -1: it got
 * out again before the car left). Riders say it again every so often till the ride is over.
 */
export type CoasterMsg = [number, number, number];

/** Accept only a ride on one of the garden's `coasters` (at most), in one of its two seats. */
export function sanitizeCoaster(d: unknown, coasters: number): CoasterMsg | null {
  if (!Array.isArray(d) || d.length !== 3 || !d.every((x) => typeof x === 'number' && Number.isFinite(x))) return null;
  const [i, t, seat] = d as number[];
  if (!Number.isInteger(i) || i < 0 || i >= coasters || t <= 0 || !Number.isInteger(seat) || seat < -1 || seat > 1) return null;
  return [i, t, seat];
}

/** What the cats already in the garden tell a newcomer: prey caught lately, fruit shaken down ([tree, gt]), where the train is, and things lying about. */
export type WorldMsg = { caught: [Prey, number][]; shakes: [number, number][]; train?: TrainMsg; things?: ThingsWire };
/** ...and as we take it in: the things as they are (Placed). */
export type WorldIn = Omit<WorldMsg, 'things'> & { things?: ThingsAccount };

/** Accept only a well-formed account of the garden, and not an endless one. */
export function sanitizeWorld(d: unknown, trees: number, train: (x: unknown) => TrainMsg | null = () => null): WorldIn | null {
  if (!d || typeof d !== 'object') return null;
  const { caught, shakes, train: tr, things: th } = d as Record<string, unknown>;
  if (!Array.isArray(caught) || caught.length > 512 || !Array.isArray(shakes) || shakes.length > 64) return null;
  const c = caught.map(sanitizeCatch), s = shakes.map((x) => sanitizeShake(x, trees));
  if (!c.every((x) => x) || !s.every((x) => x)) return null;
  const t = tr === undefined ? null : train(tr), things = th === undefined ? null : sanitizeAccount(th);
  if (th !== undefined && !things) return null;
  return { caught: c as [Prey, number][], shakes: s as [number, number][], ...(t ? { train: t } : {}), ...(things ? { things } : {}) };
}

/** Accept only a [seed, born] garden seed: a 32-bit seed, and a time it could have been planted (ms since epoch). */
export function sanitizeSeed(d: unknown): WorldSeed | null {
  if (!Array.isArray(d) || d.length !== 2) return null;
  const [seed, born] = d;
  const ok = Number.isInteger(seed) && seed >= 0 && seed < 2 ** 32 && Number.isInteger(born) && born > 1.7e12 && born < Date.now() + 864e5;
  return ok ? { seed, born } : null;
}

/** A verdict on a catch ('c': catcher, kind, id, confirmed) or on a cat ('a': suspect, accused). */
export type VoteMsg = ['c', string, Prey, number, boolean] | ['a', string, boolean];

const PEER_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Accept only a well-formed vote about a plausible peer id. */
export function sanitizeVote(d: unknown): VoteMsg | null {
  if (!Array.isArray(d) || typeof d[1] !== 'string' || !PEER_ID.test(d[1])) return null;
  if (d[0] === 'c' && d.length === 5 && typeof d[4] === 'boolean') {
    const caught = sanitizeCatch([d[2], d[3]]);
    return caught ? ['c', d[1], caught[0], caught[1], d[4]] : null;
  }
  if (d[0] === 'a' && d.length === 3 && typeof d[2] === 'boolean') return ['a', d[1], d[2]];
  return null;
}

// What peers send each other, and how we check it. Peers are untrusted: every
// message is validated here before the game sees it.
import { Prey, type CatMsg } from '../game/state.ts';
import type { WorldSeed } from '../world/seed.ts';

/** Accept only a well-formed cat state tuple: [x, y, z, facing, act, seq, coat, mews, stage]. */
export function sanitizeCat(d: unknown): CatMsg | null {
  if (!Array.isArray(d) || d.length !== 9 || !d.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  const [x, y, z, facing, act, seq, coat, mews, stage] = d as number[];
  return [x, y, z, facing | 0, act | 0, seq | 0, coat | 0, mews | 0, Math.min(2, Math.max(0, stage | 0))];
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

/** What the cats already in the garden tell a newcomer: prey caught lately, fruit shaken down ([tree, gt]), and where the train is. */
export type WorldMsg = { caught: [Prey, number][]; shakes: [number, number][]; train?: TrainMsg };

/** Accept only a well-formed account of the garden, and not an endless one. */
export function sanitizeWorld(d: unknown, trees: number, train: (x: unknown) => TrainMsg | null = () => null): WorldMsg | null {
  if (!d || typeof d !== 'object') return null;
  const { caught, shakes, train: tr } = d as Record<string, unknown>;
  if (!Array.isArray(caught) || caught.length > 512 || !Array.isArray(shakes) || shakes.length > 64) return null;
  const c = caught.map(sanitizeCatch), s = shakes.map((x) => sanitizeShake(x, trees));
  if (!c.every((x) => x) || !s.every((x) => x)) return null;
  const t = tr === undefined ? null : train(tr);
  return { caught: c as [Prey, number][], shakes: s as [number, number][], ...(t ? { train: t } : {}) };
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

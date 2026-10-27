// What peers send each other, and how we check it. Peers are untrusted: every
// message is validated here before the game sees it.
import { Prey, type CatMsg } from '../game/state.ts';

/** Accept only a well-formed cat state tuple: [x, y, z, facing, act, seq, coat]. */
export function sanitizeCat(d: unknown): CatMsg | null {
  if (!Array.isArray(d) || d.length !== 7 || !d.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  const [x, y, z, facing, act, seq, coat] = d as number[];
  return [x, y, z, facing | 0, act | 0, seq | 0, coat | 0];
}

const PREY_KINDS = new Set<number>(Object.values(Prey));

/** Accept only a [kind, id] catch with a known kind of prey and an integer id. */
export function sanitizeCatch(d: unknown): [Prey, number] | null {
  if (!Array.isArray(d) || d.length !== 2) return null;
  const [kind, id] = d;
  return PREY_KINDS.has(kind) && Number.isInteger(id) ? [kind as Prey, id as number] : null;
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

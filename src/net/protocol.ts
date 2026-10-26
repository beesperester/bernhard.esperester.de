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

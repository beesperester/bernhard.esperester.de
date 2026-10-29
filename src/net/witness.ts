import { Act } from '../game/state.ts';
import { DASH_MS, DASH_SPEED, ICE_GLIDE, WALK_SPEED, JUMP_HEIGHT } from '../game/movement.ts';
import { FEET, WALL, coasterSeatAt, heightUnder } from '../world/map.ts';
import { surfaceAt } from '../world/trees.ts';

// Every visitor keeps an eye on every other cat: does what it reports about
// itself fit the rules of the garden? Nobody can see another browser's
// keyboard, but anybody can tell that a cat crossed the park in a blink,
// stands inside the fence, or hangs in the air. Each such thing is a strike;
// strikes are what a visitor votes on when deciding to ignore a cat (see
// consensus.ts).
//
// The checks are generous: messages arrive late and in bunches, and positions
// are rounded. They are meant to catch cheating, not lag.

/** Fastest a cat ever goes on the ground (a dash), with room to spare. */
const TOP_SPEED = DASH_SPEED * 1.2;
/** Distance credit (px) a cat may run ahead of TOP_SPEED, for messages bunched up by the network (about 400 ms of dashing). */
export const JITTER_PX = 72;
/**
 * The longest way a cat can get in WINDOW_MS: one full dash (the cooldown allows no
 * more than that much dashing in a window), walking the rest, plus sliding on after a dash on ice. Generous by a quarter.
 */
export const WINDOW_MS = 10000;
export const WINDOW_PX = 1.25 * ((DASH_MS / 1000) * DASH_SPEED + ((WINDOW_MS - DASH_MS) / 1000) * WALK_SPEED + DASH_SPEED / ICE_GLIDE);
/**
 * A cat coming back (after a reload) is put back where it was by the cats that
 * remember it, a moment after it showed up at a random spot: one jump in its
 * first RESUME_MS is no teleport. (Anyone could reload to land somewhere else
 * anyway; this only lets the garden choose where.)
 */
export const RESUME_MS = 15000;
/** Rounding and jitter allowance for heights (px). */
const HEIGHT_SLACK = 4;

export type Strike = 'too-fast' | 'too-far' | 'in-wall' | 'too-high' | 'floating';

interface Seen { x: number; y: number; z: number; t: number }

/** Watches one other cat's reported states. */
export class MoveWitness {
  private last: Seen | null = null;
  /** Distance it may still cover right now above TOP_SPEED (refills over time, up to JITTER_PX). */
  private credit = JITTER_PX;
  /** Recent moves, for the distance-per-window check. */
  private trail: { t: number; d: number }[] = [];
  /** Height of the last ground it stood on, for how high a jump can go. */
  private footing = 0;
  /** When it was first seen, and whether it has had its jump back to where it was. */
  private since = -1;
  private resumed = false;

  /**
   * A new state from this cat, received at local time `t` (ms). Returns what
   * is wrong with it, if anything. The state is taken as the new position
   * either way, so one teleport is one strike, not one per message after.
   */
  observe(x: number, y: number, z: number, act: number, t: number): Strike | null {
    const strike = this.judge(x, y, z, act, t);
    this.last = { x, y, z, t };
    if (act !== Act.Jump) this.footing = z;
    return strike;
  }

  private judge(x: number, y: number, z: number, act: number, t: number): Strike | null {
    // nothing stands inside a fence, a trunk (below its fork) (feet box shrunk a pixel for rounding)
    if (heightUnder(x + FEET.x0 + 1, y + FEET.y0 + 1, x + FEET.x1 - 1, y + FEET.y1 - 0.5, z + HEIGHT_SLACK) >= WALL) return 'in-wall';
    // what it could be standing on: the ground, or a branch up a tree (or sitting in a rollercoaster's car, up on its track)
    const ground = coasterSeatAt(x, y, z) ?? surfaceAt(x, y, z + HEIGHT_SLACK);
    // jumping: no higher than a jump from where it last stood (or the ground here)
    const from = Math.max(ground, this.footing);
    if (z > from + JUMP_HEIGHT + HEIGHT_SLACK) return 'too-high';
    // not jumping: on the ground (or a branch)
    if (act !== Act.Jump && ground < WALL && Math.abs(z - ground) > HEIGHT_SLACK) return 'floating';

    const last = this.last;
    if (!last) {
      this.since = t;
      return null;
    }
    const dt = Math.max(0, t - last.t) / 1000;
    const d = Math.hypot(x - last.x, y - last.y);
    // speed: a leaky bucket, so bunched-up messages don't look like a sprint
    const allowed = this.credit + TOP_SPEED * dt;
    const over = d > allowed;
    this.credit = Math.min(JITTER_PX, Math.max(0, allowed - d));
    if (over && !this.resumed && t - this.since < RESUME_MS) {
      this.resumed = true;
      this.credit = JITTER_PX;
      this.trail = [];
      return null;
    }
    if (over) return 'too-fast';
    // stamina: dashing all the time isn't possible either
    this.trail.push({ t, d });
    while (this.trail.length && this.trail[0].t < t - WINDOW_MS) this.trail.shift();
    let total = 0;
    for (const s of this.trail) total += s.d;
    if (total > WINDOW_PX) {
      this.trail = [];
      return 'too-far';
    }
    return null;
  }
}

/** How strikes add up: a cat with STRIKES_TO_ACCUSE strikes within STRIKE_MEMORY_MS is accused. */
export const STRIKES_TO_ACCUSE = 3, STRIKE_MEMORY_MS = 60000;

/** Strikes against each cat, forgotten after a while. */
export class Strikes {
  private readonly log = new Map<string, number[]>();

  add(peer: string, t: number): void {
    const list = this.log.get(peer) ?? [];
    list.push(t);
    this.log.set(peer, list);
  }

  count(peer: string, t: number): number {
    const list = (this.log.get(peer) ?? []).filter((s) => s > t - STRIKE_MEMORY_MS);
    this.log.set(peer, list);
    return list.length;
  }

  accused(peer: string, t: number): boolean {
    return this.count(peer, t) >= STRIKES_TO_ACCUSE;
  }

  forget(peer: string): void {
    this.log.delete(peer);
  }
}

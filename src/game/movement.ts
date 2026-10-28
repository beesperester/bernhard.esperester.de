import { FEET, heightUnder, waterUnder } from '../world/map.ts';
import { surfaceAt } from '../world/trees.ts';
import { GRAVITY, JUMP_V } from './state.ts';

// How a cat moves through the garden: speeds, the dash and its cooldown,
// walking up steps but not cliffs, slipping round corners, and jumping. Kept
// free of Phaser so the rules can be tested, and checked against when other
// cats report where they are.

/** Ground speeds in px/s: walking, dashing, and sneaking up on something. */
export const WALK_SPEED = 64;
export const DASH_SPEED = 168;
export const SNEAK_SPEED = 26;
/** On ice: how quickly the cat's speed follows the keys while pushing (and while dashing), and how slowly a slide dies away (per second). */
export const ICE_GRIP = 1.6, ICE_DASH_GRIP = 7, ICE_GLIDE = 0.45;
/** A dash lasts while held, up to this long. */
export const DASH_MS = 2500;
/** Recovery after a full-length dash; shorter dashes recover proportionally faster, but never quicker than the minimum. */
export const DASH_COOLDOWN_MS = 30000;
export const DASH_COOLDOWN_MIN_MS = 2000;
/** Walking (not jumping) climbs small rises like stairs, but not a rock or a cliff. */
export const STEP_UP = 3;
/** In mid-air the cat only gets onto things a hair below its paws. */
const AIR_CLIMB = 0.5;
/**
 * Corner slip: walking straight into an edge with an opening at most this many px
 * to the side slides the cat over into it, so one-tile gaps (the maze) are easy to enter.
 */
export const SLIP = 8;
/** How high a jump gets from flat ground: v² / 2g (about 14px, enough to clear a low hedge). */
export const JUMP_HEIGHT = (JUMP_V * JUMP_V) / (2 * GRAVITY);

/** Where a cat is: ground position, height, and whether it is in the air. */
export interface Body { x: number; y: number; z: number; airborne: boolean }

/** Would a cat with its feet at (x, y) bump into something (or step into water, on foot)? */
export function blocked(body: Body, x: number, y: number): boolean {
  const x0 = x + FEET.x0, y0 = y + FEET.y0, x1 = x + FEET.x1, y1 = y + FEET.y1;
  return heightUnder(x0, y0, x1, y1, body.z) > body.z + (body.airborne ? AIR_CLIMB : STEP_UP) || (!body.airborne && waterUnder(x0, y0, x1, y1));
}

/**
 * Move `body` by (mx, my), but only onto surfaces no higher than the cat can
 * get: a step on foot, nothing in the air (branches never block: they are
 * jumped through from below). Cats won't walk into the pond, but they can jump in. Walking straight into an edge next to an opening slips
 * the cat sideways into it.
 */
export function step(body: Body, mx: number, my: number): void {
  // small steps, so walking up stairs can't skip past the step-up limit at low frame rates
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(mx), Math.abs(my))));
  let moved = false;
  for (let i = 0; i < n; i++) {
    if (mx && !blocked(body, body.x + mx / n, body.y)) { body.x += mx / n; moved = true; }
    if (my && !blocked(body, body.x, body.y + my / n)) { body.y += my / n; moved = true; }
    if (!body.airborne) body.z = Math.max(body.z, surfaceAt(body.x, body.y, body.z + STEP_UP));
  }
  // only a straight move that got nowhere slips
  if (moved || (mx !== 0) === (my !== 0)) return;

  // look for an opening just to either side; the nearest one wins
  const fx = Math.sign(mx), fy = Math.sign(my);
  const aside = (d: number): [number, number] => (fx ? [body.x, body.y + d] : [body.x + d, body.y]);
  const opensAt = (side: number, d: number) => {
    for (let k = 1; k <= d; k++) {
      const [x, y] = aside(side * k);
      if (blocked(body, x, y)) return false;
    }
    const [x, y] = aside(side * d);
    return !blocked(body, x + fx, y + fy);
  };
  let slip = 0;
  for (let d = 1; d <= SLIP; d++) {
    const left = opensAt(-1, d), right = opensAt(1, d);
    // equally close openings on both sides (dead centre on a post): don't guess
    if (left && right) return;
    if (left || right) { slip = left ? -d : d; break; }
  }
  if (!slip) return;
  const [x, y] = aside(Math.sign(slip) * Math.min(Math.abs(mx || my), Math.abs(slip)));
  if (!blocked(body, x, y)) { body.x = x; body.y = y; }
}

/**
 * Moving diagonally, both axes go at the same speed, but the cat (and the
 * camera on it) is drawn at whole pixels. Unless x and y reach a whole pixel
 * at the same moment, it steps right, then down, then right: a staircase.
 * Call while moving diagonally, after the frame's step: nudges y into step with
 * x, given the direction of travel (dx, dy). Ahead it goes by up to half a
 * pixel; back, never past `fromY` (where y was before this frame's step), so it
 * holds still for a frame or two rather than stepping back a pixel (a jolt of
 * the whole view, plain to see when creeping). Once they are in step it changes nothing.
 */
export function alignDiagonal(body: Body, dx: number, dy: number, fromY = body.y): void {
  const fx = body.x - Math.floor(body.x), fy = body.y - Math.floor(body.y);
  // how far x is past its last whole pixel, going its way; y should be just as far along going its way
  const past = dx > 0 ? fx : 1 - fx;
  let d = (dy > 0 ? past : 1 - past) - fy;
  d -= Math.round(d);
  // (going back: only as far as this frame's step took it)
  if (d * dy < 0) d = dy > 0 ? Math.max(d, fromY - body.y) : Math.min(d, fromY - body.y);
  if (d && !blocked(body, body.x, body.y + d)) body.y += d;
}

/** The dash: runs while held for up to DASH_MS, then needs a rest that grows with how long it ran. */
export class Dash {
  active = false;
  /** Longest a dash runs (a kitten's is short), and whether the last one ran that long. */
  limit = DASH_MS;
  ranOut = false;
  private start = 0;
  private readyAt = 0;

  /** Call every frame with whether dash was just pressed and is held. */
  update(pressed: boolean, held: boolean, now: number): void {
    if (pressed && !this.active && now >= this.readyAt) {
      this.active = true;
      this.ranOut = false;
      this.start = now;
    }
    if (this.active && (!held || now - this.start >= this.limit)) {
      this.ranOut = held;
      this.stop(now);
    }
  }

  /** End the dash now (it ran out, was let go, or ended in a pounce). */
  stop(now: number): void {
    if (!this.active) return;
    this.active = false;
    const used = Math.min(1, (now - this.start) / DASH_MS);
    this.readyAt = now + Math.max(DASH_COOLDOWN_MIN_MS, used * DASH_COOLDOWN_MS);
  }

  /** A good rest: the dash is ready again (unless it is running). */
  rest(now: number): void {
    if (!this.active) this.readyAt = Math.min(this.readyAt, now);
  }

  /** ms until the next dash. */
  cooldown(now: number): number {
    return Math.max(0, this.readyAt - now);
  }
}

// The train on the Ring: where it is (`s`, px round the track, the front of
// the lok), how fast it goes (`v`, px/s, backwards below 0), the driver's
// throttle (`notch`), and who drives (a peer id, or nobody). Kept free of
// Phaser: the scene draws it and the cats ride it; this says where its cars
// are and what of them a cat bumps into or stands on.

import { CAB_LEN, CAR_LEN, CAR_W, CAR_WALL, type CarKind } from '../art/train.ts';
import { TRACK_LENGTH, nearestOnTrack, trackAt, wrap } from '../world/track.ts';

/** The lok, then its waggons. */
export const CARS: CarKind[] = ['lok', 'blue', 'yellow'];
/** Between the cars (px). */
export const CAR_GAP = 3;
/** Speed at each notch of the throttle (px/s; a walking cat does 64). */
export const SPEEDS = [0, 26, 52, 92];
export const NOTCHES = SPEEDS.length - 1;
/** Speeding up, and slowing down (px/s²). */
const ACCEL = 28, BRAKE = 44;
/** How high the walls are, and the floor, for a cat (px): nobody steps over them from either side (cats get in and out by the door). */
export const WALL_H = 4.5, FLOOR_H = 1;
/** The lok's boiler: too tall to get onto. */
const BOILER_H = 16;

export interface TrainState {
  s: number;
  v: number;
  notch: number;
  /** Who drives (peer id), or null. */
  driver: string | null;
  /** Garden time (ms) this is for. */
  t: number;
}

/** Where the train stands in a new garden: on the line nearest the middle of the park. */
export function startState(x: number, y: number, t: number): TrainState {
  return { s: nearestOnTrack(x, y).s, v: 0, notch: 0, driver: null, t };
}

/** The speed the throttle asks for. */
export const wanted = (notch: number): number => Math.sign(notch) * SPEEDS[Math.min(NOTCHES, Math.abs(notch))];

/** The train `t` ms (garden time) on, the throttle as it is. */
export function advance(st: TrainState, t: number): TrainState {
  let { s, v } = st;
  const goal = wanted(st.notch);
  for (let at = st.t; at < t; ) {
    const dt = Math.min(50, t - at) / 1000;
    at += dt * 1000;
    // (slowing down: towards zero, or the other way)
    const a = Math.sign(goal - v) === Math.sign(v) || v === 0 ? ACCEL : BRAKE;
    v = goal > v ? Math.min(goal, v + a * dt) : Math.max(goal, v - a * dt);
    s = wrap(s + v * dt);
  }
  return { ...st, s, v, t: Math.max(t, st.t) };
}

/** One car where it is: its middle, which way it points (unit vector), and what it is. */
export interface CarPose { kind: CarKind; i: number; x: number; y: number; dx: number; dy: number; len: number }

/** Where the cars are with the front of the lok at `s`. */
export function poses(s: number): CarPose[] {
  const out: CarPose[] = [];
  let at = s;
  CARS.forEach((kind, i) => {
    const len = CAR_LEN[kind];
    // pointing from its back end to its front end (steady on the curves)
    const a = trackAt(at), b = trackAt(at - len), mid = trackAt(at - len / 2);
    const dx = a.x - b.x, dy = a.y - b.y, d = Math.hypot(dx, dy) || 1;
    out.push({ kind, i, x: mid.x, y: mid.y, dx: dx / d, dy: dy / d, len });
    at -= len + CAR_GAP;
  });
  return out;
}

/** (x, y) in a car's own frame: u along it (front +), v across. */
export function local(c: CarPose, x: number, y: number): { u: number; v: number } {
  const rx = x - c.x, ry = y - c.y;
  return { u: rx * c.dx + ry * c.dy, v: -rx * c.dy + ry * c.dx };
}

/** And back. */
export function world(c: CarPose, u: number, v: number): { x: number; y: number } {
  return { x: c.x + u * c.dx - v * c.dy, y: c.y + u * c.dy + v * c.dx };
}

/** Is (u, v) inside the car's walls (where a cat can be in it)? The lok: in its cab only. */
export function inside(c: CarPose, u: number, v: number): boolean {
  const hl = c.len / 2 - CAR_WALL, hw = CAR_W / 2 - CAR_WALL;
  if (Math.abs(v) > hw || Math.abs(u) > hl) return false;
  return c.kind !== 'lok' || u < -c.len / 2 + CAB_LEN - 2;
}

/** How high the car is at (u, v) for something on the ground: its floor, its walls, the lok's boiler (0: not over it). */
export function heightAt(c: CarPose, u: number, v: number): number {
  if (Math.abs(u) > c.len / 2 || Math.abs(v) > CAR_W / 2) return 0;
  if (inside(c, u, v)) return FLOOR_H;
  return c.kind === 'lok' && u > -c.len / 2 + CAB_LEN ? BOILER_H : WALL_H;
}

/** The middle of a cat's paws: the points of it a car's walls are checked against (its feet are wider than a car is inside). */
const PAWS: [number, number][] = [[0, -2], [-3, -2], [3, -2], [0, 0], [0, -4]];

/** The highest part of the train under a cat's paws around (x, y). */
export function trainUnder(cars: CarPose[], x: number, y: number): number {
  let h = 0;
  for (const c of cars) {
    if (Math.abs(x - c.x) > c.len || Math.abs(y - c.y) > c.len) continue;
    for (const [px, py] of PAWS) {
      const { u, v } = local(c, x + px, y + py);
      h = Math.max(h, heightAt(c, u, v));
    }
  }
  return h;
}

/** The car a cat at (x, y), height z, is riding in, and where in it: null if it isn't in one. */
export function ridingIn(cars: CarPose[], x: number, y: number, z: number): { car: CarPose; u: number; v: number } | null {
  if (z > FLOOR_H + 1.5) return null;
  for (const c of cars) {
    const { u, v } = local(c, x, y - 2);
    if (inside(c, u, v)) return { car: c, u, v };
  }
  return null;
}

/**
 * Another cat said to be at (x, y, z), seen in a car: where in it (kept inside its walls). Its word is
 * a moment old and the train has rolled on since, so a cat just behind (or ahead of) a car, low down
 * and between its sides, is taken to be in it.
 */
export function aboard(cars: CarPose[], x: number, y: number, z: number, slack = 14): { i: number; u: number; v: number } | null {
  if (z > FLOOR_H + 1.5) return null;
  for (const c of cars) {
    const { u, v } = local(c, x, y - 2);
    const hl = c.len / 2 - CAR_WALL - 0.5, hw = CAR_W / 2 - CAR_WALL - 0.5;
    if (Math.abs(v) > hw + 1 || Math.abs(u) > hl + slack) continue;
    const front = c.kind === 'lok' ? -c.len / 2 + CAB_LEN - 2.5 : hl;
    if (c.kind === 'lok' && u > front + slack) continue;
    return { i: c.i, u: Math.max(-hl, Math.min(front, u)), v: Math.max(-hw, Math.min(hw, v)) };
  }
  return null;
}

/** Is the cat at (x, y) in the lok's cab (the driver's seat)? */
export const inCab = (cars: CarPose[], x: number, y: number, z: number): boolean => ridingIn(cars, x, y, z)?.car.kind === 'lok';

/** How far round the track the train reaches either side of its lok's front: [back end, front end] (px, unwrapped). */
export function span(s: number): [number, number] {
  return [s - CARS.reduce((n, k) => n + CAR_LEN[k] + CAR_GAP, -CAR_GAP), s];
}

export { TRACK_LENGTH };

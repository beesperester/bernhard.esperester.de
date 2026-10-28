import { describe, expect, it } from 'vitest';
import { TRACK_LENGTH, trackAt, trackPoints, nearestOnTrack } from '../world/track.ts';
import { FEET, heightUnder, tileAt } from '../world/map.ts';
import { WORLD_H, WORLD_W } from '../world/size.ts';
import { CAR_LEN, CAR_W } from '../art/train.ts';
import { CAR_GAP, FLOOR_H, NOTCHES, SPEEDS, WALL_H, aboard, advance, inCab, poses, ridingIn, span, startState, trainUnder, world } from './train.ts';
import { STEP_UP } from './movement.ts';
import { STAGE_JUMP, Stage } from './growth.ts';

describe('the Ring', () => {
  it('is one closed line all round the map', () => {
    const a = trackAt(0), b = trackAt(TRACK_LENGTH);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(0.01);
    const { xs, ys } = trackPoints();
    for (let i = 0; i < xs.length; i++) {
      expect(xs[i]).toBeGreaterThan(0);
      expect(ys[i]).toBeGreaterThan(0);
      expect(xs[i]).toBeLessThan(WORLD_W);
      expect(ys[i]).toBeLessThan(WORLD_H);
    }
    // (round the outside: it spans most of the map both ways)
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(WORLD_W * 0.5);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(WORLD_H * 0.5);
  });

  it('has nothing standing on it anywhere: a single clear lane', () => {
    for (let s = 0; s < TRACK_LENGTH; s += 4) {
      const { x, y } = trackAt(s);
      expect(heightUnder(x + FEET.x0, y + FEET.y0, x + FEET.x1, y + FEET.y1), `at ${Math.round(x)},${Math.round(y)} (${tileAt(Math.floor(x / 16), Math.floor(y / 16))})`).toBe(0);
    }
  });

  it('finds the nearest point on it', () => {
    const { x, y } = trackAt(1234);
    const near = nearestOnTrack(x + 1, y);
    expect(near.d).toBeLessThan(2);
    expect(Math.abs(near.s - 1234)).toBeLessThan(4);
  });
});

describe('the train', () => {
  const st = startState(WORLD_W / 2, WORLD_H / 2, 0);

  it('stands still with the throttle closed', () => {
    const later = advance(st, 60000);
    expect(later.s).toBe(st.s);
    expect(later.v).toBe(0);
  });

  it('speeds up to the notch and slows to a stop', () => {
    const going = advance({ ...st, notch: NOTCHES }, 20000);
    expect(going.v).toBeCloseTo(SPEEDS[NOTCHES]);
    const stopped = advance({ ...going, notch: 0 }, 40000);
    expect(stopped.v).toBe(0);
    const back = advance({ ...stopped, notch: -1 }, 60000);
    expect(back.v).toBeCloseTo(-SPEEDS[1]);
  });

  it('comes out the same however it is stepped', () => {
    const a = advance({ ...st, notch: 2 }, 7777);
    const b = advance(advance(advance({ ...st, notch: 2 }, 1000), 3333), 7777);
    expect(b.s).toBeCloseTo(a.s, 6);
    expect(b.v).toBeCloseTo(a.v, 6);
  });

  it('keeps its cars in a row behind the lok', () => {
    const cars = poses(st.s);
    expect(cars.map((c) => c.kind)).toEqual(['lok', 'blue', 'yellow']);
    for (let i = 1; i < cars.length; i++) {
      const gap = Math.hypot(cars[i].x - cars[i - 1].x, cars[i].y - cars[i - 1].y);
      expect(gap).toBeGreaterThan((cars[i].len + cars[i - 1].len) / 2 + CAR_GAP - 3);
      expect(gap).toBeLessThan((cars[i].len + cars[i - 1].len) / 2 + CAR_GAP + 0.5);
    }
    const [back, front] = span(st.s);
    expect(front - back).toBe(CAR_LEN.lok + CAR_LEN.blue + CAR_LEN.yellow + 2 * CAR_GAP);
  });

  it('can be got into by a kitten, not walked into, nor walked out of', () => {
    expect(WALL_H).toBeGreaterThan(STEP_UP);
    expect(WALL_H).toBeGreaterThan(FLOOR_H + STEP_UP);
    expect(STAGE_JUMP[Stage.Kitten] + 0.5).toBeGreaterThanOrEqual(WALL_H);
  });

  it('has a floor inside its waggons and walls round them', () => {
    const cars = poses(st.s);
    const blue = cars[1];
    const mid = world(blue, 0, 0);
    expect(trainUnder(cars, mid.x, mid.y + 2)).toBe(FLOOR_H);
    const wall = world(blue, 0, CAR_W / 2 - 0.5);
    expect(trainUnder(cars, wall.x, wall.y + 2)).toBe(WALL_H);
    expect(ridingIn(cars, mid.x, mid.y + 2, FLOOR_H)?.car.kind).toBe('blue');
    expect(ridingIn(cars, mid.x, mid.y + 2, 10)).toBeNull();
    const far = world(blue, 0, 40);
    expect(trainUnder(cars, far.x, far.y + 2)).toBe(0);
  });

  it("has the driver's seat in the lok's cab, not on its boiler", () => {
    const cars = poses(st.s);
    const lok = cars[0];
    const cab = world(lok, -lok.len / 2 + 4, 0);
    expect(inCab(cars, cab.x, cab.y + 2, FLOOR_H)).toBe(true);
    const boiler = world(lok, lok.len / 2 - 4, 0);
    expect(inCab(cars, boiler.x, boiler.y + 2, FLOOR_H)).toBe(false);
    expect(trainUnder(cars, boiler.x, boiler.y + 2)).toBeGreaterThan(10);
  });

  it('keeps a cat seen a little behind its waggon in it', () => {
    const cars = poses(st.s);
    const blue = cars[1];
    const behind = world(blue, -blue.len / 2 - 6, 1);
    const seat = aboard(cars, behind.x, behind.y + 2, FLOOR_H, 10);
    expect(seat?.i).toBe(1);
    expect(seat!.u).toBeGreaterThan(-blue.len / 2);
    expect(aboard(cars, behind.x, behind.y + 2, FLOOR_H, 1)?.i).not.toBe(1);
  });
});

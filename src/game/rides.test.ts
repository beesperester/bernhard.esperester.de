import { describe, expect, it } from 'vitest';
import { Rides } from './rides.ts';
import { BOARDING_MS, RIDE_MS } from '../world/coaster.ts';

describe('rollercoaster rides', () => {
  it('sets off a moment after the first cat gets in, and takes a second along', () => {
    const r = new Rides(1);
    expect(r.free(0, 1000)).toBe(0);
    expect(r.board('a', 0, 0, 1000)).toEqual([0, 1000 + BOARDING_MS, 0]);
    expect(r.boarding(0, 2000)).toBe(true);
    expect(r.free(0, 2000)).toBe(1);
    r.board('b', 0, 1, 2000);
    expect(r.depart[0]).toBe(1000 + BOARDING_MS);
    expect(r.free(0, 2500)).toBeNull();
    expect(r.away(0, 1000 + BOARDING_MS + 10)).toBe(true);
    expect(r.into(0, 1000 + BOARDING_MS + 10)).toBe(10);
    // (nobody gets in on the way round; it's back after the ride)
    expect(r.free(0, 1000 + BOARDING_MS + 10)).toBeNull();
    expect(r.away(0, 1000 + BOARDING_MS + RIDE_MS)).toBe(false);
    expect(r.free(0, 1000 + BOARDING_MS + RIDE_MS)).toBe(0);
  });

  it('stays if the only cat in it gets out again', () => {
    const r = new Rides(1);
    r.board('a', 0, 0, 1000);
    expect(r.leave('a', 1500)).toEqual([0, 1000 + BOARDING_MS, -1]);
    expect(r.boarding(0, 1600)).toBe(false);
    expect(r.away(0, 1000 + BOARDING_MS + 10)).toBe(false);
  });

  it('two setting it off at once agree on the earlier time', () => {
    const a = new Rides(1), b = new Rides(1);
    const ma = a.board('a', 0, 0, 1000), mb = b.board('b', 0, 1, 1400);
    a.receive('b', mb, 1450);
    b.receive('a', ma, 1450);
    expect(a.depart[0]).toBe(1000 + BOARDING_MS);
    expect(b.depart[0]).toBe(1000 + BOARDING_MS);
    expect(b.seats(0, 1500)).toEqual(['a', 'b']);
  });

  it('puts another cat in its seat for the ride, and out of it after', () => {
    const r = new Rides(1);
    expect(r.receive('b', [0, 5000, 1], 3000)).toBe(true);
    expect(r.seatOf('b', 6000)).toEqual({ i: 0, seat: 1 });
    expect(r.seatOf('b', 5000 + RIDE_MS + 1)).toBeNull();
    // (a ride long over, or one far off, isn't believed)
    expect(r.receive('c', [0, 1000, 0], 1000 + RIDE_MS + 5000)).toBe(false);
    expect(r.receive('c', [0, 90000, 0], 1000)).toBe(false);
    expect(r.receive('c', [3, 2000, 0], 1000)).toBe(false);
  });

  it('a cat that leaves the garden leaves its seat', () => {
    const r = new Rides(1);
    r.receive('b', [0, 5000, 0], 3000);
    r.forget('b', 3500);
    expect(r.seatOf('b', 3600)).toBeNull();
    expect(r.boarding(0, 3600)).toBe(false);
  });
});

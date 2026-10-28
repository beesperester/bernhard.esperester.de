import { describe, expect, it } from 'vitest';
import { CAR_FLOOR, COASTER_SIZE, LOOP, PLATFORM, RIDE_MS, STATION, TRACK_POINTS, carAt, deckAt, rideAt, seatHeightNear, trackAt } from './coaster.ts';

describe('rollercoaster', () => {
  it('runs round a closed loop inside its box', () => {
    const [w, h] = COASTER_SIZE;
    for (const p of TRACK_POINTS) {
      expect(p.x).toBeGreaterThan(4);
      expect(p.x).toBeLessThan(w * 16 - 4);
      expect(p.y - p.z).toBeGreaterThan(-60);
      expect(p.y).toBeLessThan(h * 16);
    }
    const a = trackAt(0), b = trackAt(LOOP);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(0.01);
    // (no sudden steps in the deck)
    for (let s = 0; s < LOOP; s += 0.5) expect(Math.abs(deckAt(s + 0.5) - deckAt(s))).toBeLessThan(1.5);
  });

  it('waits by its platform, level with it', () => {
    const c = carAt(0);
    expect(c.s).toBe(STATION);
    expect(c.x).toBeGreaterThan(PLATFORM.x0);
    expect(c.x).toBeLessThan(PLATFORM.x1);
    expect(c.z).toBe(PLATFORM.h);
    expect(PLATFORM.y0).toBeGreaterThan(c.y);
  });

  it('goes once round in a few seconds and stops where it set off', () => {
    expect(RIDE_MS).toBeGreaterThan(5000);
    expect(RIDE_MS).toBeLessThan(15000);
    let last = 0;
    for (let t = 0; t < RIDE_MS; t += 50) {
      const d = rideAt(t);
      expect(d).toBeGreaterThanOrEqual(last);
      // (no faster than a cat can say where it is: the others keep up)
      expect(d - last).toBeLessThan(120 * 0.05);
      last = d;
    }
    expect(last).toBeGreaterThan(LOOP - 2);
    expect(rideAt(RIDE_MS + 1)).toBe(0);
  });

  it('knows a cat sitting in the car anywhere on the track', () => {
    for (const t of [0, 1500, 3000, 4500, 6000]) {
      const s = carAt(t).s + 4, p = trackAt(s), z = deckAt(s) + CAR_FLOOR;
      expect(Math.abs(seatHeightNear(p.x, p.y, z)! - z)).toBeLessThan(0.5);
    }
    // (not one up in the air beside it)
    const c = carAt(4000);
    expect(seatHeightNear(c.x, c.y + 30, c.z)).toBeNull();
  });
});

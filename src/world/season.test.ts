import { describe, expect, it } from 'vitest';
import { activity, dayOfYear, inSeason, rainfall, seasonAt, snowfall, wetness } from './season.ts';

/** Noon in Berlin on the given date (2026). */
const on = (month: number, day: number, hour = 12) => Date.UTC(2026, month - 1, day, hour - 1);

describe('dayOfYear', () => {
  it('counts from 0 on the first of January', () => {
    expect(Math.floor(dayOfYear(on(1, 1)))).toBe(0);
    expect(Math.floor(dayOfYear(on(3, 1)))).toBe(59);
    expect(Math.floor(dayOfYear(on(12, 31)))).toBe(364);
  });
});

describe('seasonAt', () => {
  it('has a snowy, frozen, leafless January', () => {
    const s = seasonAt(on(1, 15));
    expect(s.snow).toBe(1);
    expect(s.frozen).toBe(true);
    expect(s.leaves).toBe(0);
    expect(s.bloom).toBe(0);
  });

  it('has a green, blooming July without snow', () => {
    const s = seasonAt(on(7, 10));
    expect(s.snow).toBe(0);
    expect(s.frozen).toBe(false);
    expect(s.leaves).toBe(1);
    expect(s.turn).toBe(0);
    expect(s.bloom).toBe(1);
  });

  it('turns and drops the leaves in autumn', () => {
    const s = seasonAt(on(10, 26));
    expect(s.turn).toBe(1);
    expect(s.leaves).toBeGreaterThan(0);
    expect(s.leaves).toBeLessThan(1);
    expect(s.falling).toBeGreaterThan(0);
    expect(s.litter).toBeGreaterThan(0);
  });

  it('blossoms the cherries in mid April', () => {
    expect(seasonAt(on(4, 14)).blossom).toBe(1);
    expect(seasonAt(on(6, 14)).blossom).toBe(0);
  });

  it('changes gradually: no property jumps by more than a little from one day to the next', () => {
    const keys = ['turn', 'leaves', 'falling', 'litter', 'blossom', 'petals', 'bloom', 'drab', 'hay', 'snow'] as const;
    let prev = seasonAt(on(1, 1));
    for (let d = 1; d < 365; d++) {
      const next = seasonAt(Date.UTC(2026, 0, 1, 11) + d * 86400000);
      for (const k of keys) expect(Math.abs(next[k] - prev[k]), `${k} on day ${d}`).toBeLessThan(0.35);
      prev = next;
    }
  });
});

describe('activity', () => {
  it('keeps animals to their seasons', () => {
    expect(activity('butterfly', on(7, 1))).toBe(1);
    expect(activity('butterfly', on(1, 15))).toBe(0);
    expect(activity('firefly', on(6, 30))).toBe(1);
    expect(activity('firefly', on(9, 15))).toBe(0);
    expect(activity('bat', on(12, 1))).toBe(0);
  });

  it('ramps in over about a fortnight', () => {
    const a = activity('bee', on(3, 25));
    expect(a).toBeGreaterThan(0.3);
    expect(a).toBeLessThan(0.7);
  });

  it('inSeason compares a roll against the activity', () => {
    expect(inSeason('butterfly', on(7, 1), 0.99)).toBe(true);
    expect(inSeason('butterfly', on(1, 1), 0.01)).toBe(false);
  });
});

describe('weather', () => {
  it('never snows in summer and never rains in deep snow', () => {
    for (let h = 0; h < 24 * 14; h++) {
      expect(snowfall(on(7, 1) + h * 3600000)).toBe(0);
      expect(rainfall(on(1, 10) + h * 3600000)).toBe(0);
    }
  });

  it('rains now and then, but not most of the time', () => {
    let wet = 0;
    const n = 24 * 60;
    for (let i = 0; i < n; i++) if (rainfall(on(5, 1) + i * 3600000) > 0) wet++;
    expect(wet / n).toBeGreaterThan(0.05);
    expect(wet / n).toBeLessThan(0.45);
  });

  it('snows on and off in winter', () => {
    let snowy = 0;
    const n = 24 * 30;
    for (let i = 0; i < n; i++) if (snowfall(on(1, 1) + i * 3600000) > 0) snowy++;
    expect(snowy / n).toBeGreaterThan(0.2);
    expect(snowy / n).toBeLessThan(0.9);
  });

  it('leaves puddles that fill in the rain and dry up after it', () => {
    // find a shower in May, and a dry spell long enough for the ground to dry out
    const step = 60000;
    let start = -1;
    for (let t = on(5, 1); t < on(6, 1) && start < 0; t += step)
      if (rainfall(t) > 0 && [...Array(240)].every((_, i) => rainfall(t - i * step - step) === 0)) start = t;
    expect(start).toBeGreaterThan(0);
    expect(wetness(start - 30 * step)).toBe(0);
    // fuller after it has rained a while than at the start
    let end = start;
    while (rainfall(end) > 0) end += step;
    expect(wetness(end)).toBeGreaterThan(wetness(start));
    // drying up again in the dry hours after
    expect(wetness(end + 3 * 3600000)).toBeLessThan(wetness(end));
    for (let t = start; t < end + 3600000; t += 7 * step) {
      expect(wetness(t)).toBeGreaterThanOrEqual(0);
      expect(wetness(t)).toBeLessThanOrEqual(1);
    }
  });

  it('is the same for everybody at the same moment and stays in 0..1', () => {
    for (let i = 0; i < 500; i++) {
      const t = on(5, 1) + i * 997000;
      expect(rainfall(t)).toBe(rainfall(t));
      expect(rainfall(t)).toBeGreaterThanOrEqual(0);
      expect(rainfall(t)).toBeLessThanOrEqual(1);
    }
  });
});

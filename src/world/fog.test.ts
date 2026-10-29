import { describe, expect, it } from 'vitest';
import { autumn, byDaylight, foggyDay } from './fog.ts';

describe('autumn fog', () => {
  it('lies in autumn only', () => {
    expect(autumn(180)).toBe(0); // July
    expect(autumn(300)).toBe(1); // late October
    expect(autumn(20)).toBe(0); // January
  });

  it('is thick at dawn and through the night, gone by midday', () => {
    expect(byDaylight(-5, true)).toBe(1);
    expect(byDaylight(5, true)).toBeGreaterThan(0.7);
    expect(byDaylight(25, true)).toBe(0);
    expect(byDaylight(25, false)).toBe(0);
    expect(byDaylight(3, false)).toBeGreaterThan(0.5);
    expect(byDaylight(-8, false)).toBe(1);
  });

  it('comes some days, not others', () => {
    const days = Array.from({ length: 200 }, (_, d) => foggyDay(d, 8919));
    const clear = days.filter((v) => v === 0).length;
    expect(clear).toBeGreaterThan(20);
    expect(clear).toBeLessThan(90);
    for (const v of days) if (v) expect(v).toBeGreaterThanOrEqual(0.35);
  });
});

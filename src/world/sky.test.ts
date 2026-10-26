import { describe, expect, it } from 'vitest';
import { berlinParts, lightAt, moonPhase, sunPosition } from './sky.ts';

// Berlin is UTC+2 in summer (CEST) and UTC+1 in winter (CET).
const summer = (h: number, m = 0) => Date.UTC(2026, 6, 10, h - 2, m);
const winter = (h: number, m = 0) => Date.UTC(2026, 0, 15, h - 1, m);

describe('sunPosition', () => {
  it('puts the summer noon sun high in the south', () => {
    const { elevation, azimuth } = sunPosition(summer(13, 15));
    expect(elevation).toBeGreaterThan(55);
    expect(elevation).toBeLessThan(62);
    expect(Math.abs(azimuth - 180)).toBeLessThan(10);
  });

  it('keeps the winter noon sun low', () => {
    const { elevation } = sunPosition(winter(12, 15));
    expect(elevation).toBeGreaterThan(12);
    expect(elevation).toBeLessThan(18);
  });

  it('is below the horizon at midnight', () => {
    expect(sunPosition(summer(0, 30)).elevation).toBeLessThan(0);
  });
});

describe('lightAt', () => {
  it('is day at noon and night at midnight', () => {
    expect(lightAt(summer(13)).day).toBe(1);
    expect(lightAt(summer(13)).night).toBe(0);
    expect(lightAt(winter(0)).night).toBe(1);
    expect(lightAt(winter(0)).day).toBe(0);
  });

  // The garden's top faces south: the sun rises on the left of the screen,
  // stands at the top at noon and sets on the right; never below the screen.
  it('moves the sun left → top → right across the screen', () => {
    const morning = lightAt(summer(8)), noon = lightAt(summer(13, 15)), evening = lightAt(summer(19));
    expect(morning.sunDir[0]).toBeLessThan(0);
    expect(evening.sunDir[0]).toBeGreaterThan(0);
    expect(Math.abs(noon.sunDir[0])).toBeLessThan(0.2);
    for (const l of [morning, noon, evening]) expect(l.sunDir[1]).toBeLessThan(0);
  });

  it('only ever casts shadows sideways or down (never up the screen) while the sun is up', () => {
    for (let h = 5; h <= 21; h += 0.5) {
      const l = lightAt(summer(Math.floor(h), (h % 1) * 60));
      if (l.elevation <= 0) continue;
      // shadows point away from the sun
      expect(-l.sunDir[1]).toBeGreaterThanOrEqual(0);
    }
  });

  it('gives a unit sun direction and warm tints at sunset', () => {
    const l = lightAt(summer(21, 20));
    expect(Math.hypot(...l.sunDir)).toBeCloseTo(1, 5);
    expect(l.tint[0]).toBeGreaterThan(l.tint[2]);
  });
});

describe('moonPhase', () => {
  it('is new at the reference new moon and full half a month later', () => {
    const NEW = Date.UTC(2000, 0, 6, 18, 14);
    expect(moonPhase(NEW)).toBeCloseTo(0, 5);
    expect(moonPhase(NEW + 14.765 * 86400000)).toBeCloseTo(0.5, 3);
  });
});

describe('berlinParts', () => {
  it('reports Berlin wall-clock time across daylight saving', () => {
    const num = (p: Record<string, string>) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, Number(v)]));
    expect(num(berlinParts(summer(13, 5)))).toMatchObject({ hour: 13, minute: 5, month: 7, day: 10 });
    expect(num(berlinParts(winter(9)))).toMatchObject({ hour: 9, month: 1, day: 15 });
  });
});

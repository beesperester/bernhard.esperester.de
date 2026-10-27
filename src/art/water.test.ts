import { describe, expect, it } from 'vitest';
import { Raster, type RGB } from './raster.ts';
import { buildBed, clarity, reflectance, shoreDistance, surfacePixel, type Sky } from './water.ts';

/** A 20x20 pond with the bank all round it. */
const pond = () => {
  const m = new Raster(24, 24);
  for (let y = 2; y < 22; y++) for (let x = 2; x < 22; x++) m.set(x, y, [255, 255, 255]);
  return m;
};

const SKY: Sky = {
  zenith: [80, 140, 220], horizon: [190, 225, 245], cloud: [245, 250, 255], cover: 0.4, driftX: 0, driftY: 0,
  sun: [0, -0.5, 0.87], glint: 1, rough: 1,
};

describe('water', () => {
  it('measures how far out from the bank each bit of water is', () => {
    const d = shoreDistance(pond());
    expect(d[0]).toBe(0);
    expect(d[2 * 24 + 2]).toBe(1);
    expect(d[2 * 24 + 10]).toBe(1);
    expect(d[11 * 24 + 11]).toBe(10);
  });

  it('runs on under floating things: a lily pad is not a shore', () => {
    const m = pond();
    // a pad in the middle: not water in the mask, but it floats
    for (let y = 10; y < 14; y++) for (let x = 10; x < 14; x++) m.set(x, y, [0, 0, 0], 0);
    const pad = (x: number, y: number) => x >= 10 && x < 14 && y >= 10 && y < 14;
    expect(shoreDistance(m)[9 * 24 + 11]).toBe(1);
    expect(shoreDistance(m, 60, pad)[9 * 24 + 11]).toBe(8);
  });

  it('gets murkier the further out, but never quite clear', () => {
    expect(clarity(1)).toBeGreaterThan(clarity(8));
    expect(clarity(8)).toBeGreaterThan(clarity(40));
    expect(clarity(0)).toBeLessThan(1);
    expect(clarity(60)).toBeGreaterThan(0);
  });

  it('only lays a bed under the water', () => {
    const m = pond();
    const bed = buildBed(m, shoreDistance(m));
    expect(bed.isSet(0, 0)).toBe(false);
    for (let y = 2; y < 22; y++) for (let x = 2; x < 22; x++) expect(bed.isSet(x, y)).toBe(true);
  });

  it('mirrors more where the surface tilts away from the eye (Fresnel)', () => {
    const flat = reflectance(0, 0, 1);
    const away = reflectance(0, -0.5, 0.87);
    expect(flat).toBeGreaterThan(0.1);
    expect(away).toBeGreaterThan(flat);
    expect(reflectance(0, -1, 0)).toBeCloseTo(1, 1);
  });

  it('gives every surface pixel a sane colour and opacity, more opaque over deep water', () => {
    const murk: RGB = [30, 60, 60];
    const out = [0, 0, 0, 0];
    let shallow = 0, deep = 0;
    for (let i = 0; i < 400; i++) {
      surfacePixel(i % 40, Math.floor(i / 40), i * 0.37, clarity(1), murk, SKY, out);
      for (const v of out.slice(0, 3)) expect(v).toBeGreaterThanOrEqual(0), expect(v).toBeLessThanOrEqual(255);
      expect(out[3]).toBeGreaterThanOrEqual(0);
      expect(out[3]).toBeLessThanOrEqual(1);
      shallow += out[3];
      surfacePixel(i % 40, Math.floor(i / 40), i * 0.37, clarity(40), murk, SKY, out);
      deep += out[3];
    }
    expect(deep).toBeGreaterThan(shallow);
  });
});

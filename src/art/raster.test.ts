import { describe, expect, it } from 'vitest';
import { Raster, hash2, hex, mulberry32 } from './raster.ts';

describe('hex', () => {
  it('parses #rrggbb into channels', () => {
    expect(hex('#ff8000')).toEqual([255, 128, 0]);
    expect(hex('102030')).toEqual([16, 32, 48]);
  });
});

describe('Raster', () => {
  it('sets pixels and ignores out-of-bounds writes', () => {
    const r = new Raster(4, 3);
    r.set(1, 2, [10, 20, 30]);
    r.set(-1, 0, [1, 1, 1]);
    r.set(4, 0, [1, 1, 1]);
    expect(r.isSet(1, 2)).toBe(true);
    expect(r.isSet(0, 0)).toBe(false);
    expect(r.isSet(9, 9)).toBe(false);
    expect([...r.data.slice((2 * 4 + 1) * 4, (2 * 4 + 1) * 4 + 4)]).toEqual([10, 20, 30, 255]);
  });

  it('paints a character map, leaving unknown characters transparent, and can mirror it', () => {
    const r = new Raster(3, 1);
    r.paint(['a.b'], 0, 0, { a: [255, 0, 0], b: [0, 0, 255] });
    expect(r.isSet(1, 0)).toBe(false);
    expect(r.data[0]).toBe(255);
    const m = new Raster(3, 1);
    m.paint(['a..'], 0, 0, { a: [255, 0, 0] }, true);
    expect(m.isSet(2, 0)).toBe(true);
    expect(m.isSet(0, 0)).toBe(false);
  });

  it('blits only opaque pixels', () => {
    const src = new Raster(2, 1);
    src.set(0, 0, [9, 9, 9]);
    const dst = new Raster(2, 1);
    dst.set(1, 0, [5, 5, 5]);
    dst.blit(src, 0, 0);
    expect(dst.data[0]).toBe(9);
    expect(dst.data[4]).toBe(5);
  });
});

describe('deterministic randomness', () => {
  it('mulberry32 repeats for the same seed and differs between seeds', () => {
    const a = mulberry32(42), b = mulberry32(42), c = mulberry32(43);
    const seqA = [a(), a(), a()], seqB = [b(), b(), b()], seqC = [c(), c(), c()];
    expect(seqA).toEqual(seqB);
    expect(seqA).not.toEqual(seqC);
    for (const v of seqA) expect(v >= 0 && v < 1).toBe(true);
  });

  it('hash2 stays in [0, 1) and is roughly uniform', () => {
    let sum = 0;
    const n = 10000;
    for (let i = 0; i < n; i++) {
      const v = hash2(i % 100, Math.floor(i / 100), 7);
      expect(v >= 0 && v < 1).toBe(true);
      sum += v;
    }
    expect(sum / n).toBeGreaterThan(0.45);
    expect(sum / n).toBeLessThan(0.55);
    expect(hash2(3, 4, 5)).toBe(hash2(3, 4, 5));
  });
});

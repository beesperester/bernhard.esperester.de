import { describe, expect, it } from 'vitest';
import { COAT_H, COAT_W, buildCatMaps, buildCoatMap, withCoat } from './coat.ts';
import { COATS, FUR, buildCatSheet } from './cat.ts';
import { COAT, PLAIN } from './painted.ts';

describe('coats as maps', () => {
  const maps = buildCatMaps();

  it('takes every pixel of fur from the same kind of fur on the coat', () => {
    const coat = buildCoatMap(0), sheet = buildCatSheet(0);
    let fur = 0;
    for (let o = 0; o < maps.normal.length; o += 4) {
      if (maps.normal[o + 3] !== COAT) continue;
      fur++;
      const u = maps.main[o], v = maps.main[o + 1], letter = FUR[maps.main[o + 2]];
      expect(u).toBeLessThan(COAT_W);
      expect(v).toBeLessThan(COAT_H);
      // (in the coat's colours, it is that letter's colour: as the painted sheet has it)
      const c = (v * COAT_W + u) * 4, hexOf = (d: Uint8ClampedArray, i: number) => (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
      expect(hexOf(coat.data, c)).toBe(parseInt(COATS[0][letter].slice(1), 16));
      expect(sheet.data[o + 3]).toBe(255);
    }
    expect(fur).toBeGreaterThan(1000);
  });

  it('keeps eyes, nose and mouth in their own colours, and leaves room for the coat', () => {
    for (let o = 0; o < maps.normal.length; o += 4) if (maps.normal[o + 3] === PLAIN) expect(maps.main[o + 3]).toBe(255);
    const main = withCoat(maps, buildCoatMap(3)), top = (maps.h - COAT_H) * maps.w * 4;
    expect(main.subarray(top).some((v) => v > 0)).toBe(true);
    expect(maps.main.subarray(top).every((v) => v === 0)).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { Kind, PLAIN, RIM_BIT, Ramps, SPECK, fromByte, ramps, toByte } from './painted.ts';
import { paintedMaps, planned, relightProp } from './trees.ts';
import { seasonAt } from '../world/season.ts';
import { templatePlan } from '../world/trees.ts';
import type { ScreenLight } from './lighting.ts';
import type { RGB } from './raster.ts';

const SUMMER = seasonAt(Date.UTC(2026, 6, 10, 12));

/** game/Painted.ts' shader, step for step: the colour of pixel o of a painted picture in light L. */
function shadeOnGpu(main: Uint8ClampedArray, normal: Uint8Array, o: number, L: ScreenLight): RGB {
  const flags = normal[o + 3];
  if (!flags || flags === PLAIN) return [main[o], main[o + 1], main[o + 2]];
  const { tones, kind } = ramps.rows[main[o]];
  let tone: number;
  if (kind === Kind.Leaf) {
    const nx = fromByte(normal[o], 1), ny = fromByte(normal[o + 1], 1), jit = fromByte(normal[o + 2], 2);
    const rim = flags >= RIM_BIT, speck = (flags - (rim ? RIM_BIT : 0) - 1) / SPECK;
    const facing = nx * L.x + ny * L.y;
    if (rim && facing < 0.15) tone = 3;
    else {
      const l = facing * L.k + (fromByte(main[o + 1], 2) * L.x + fromByte(main[o + 2], 2) * L.y) * 0.8 * L.k + jit;
      tone = l > 0.55 ? 0 : l > 0.05 ? 1 : l > -0.45 ? 2 : 3;
      if ((speck < 0.07 || (speck < 0.16 && ny < -0.25)) && tone > 0) tone--;
      else if (speck > 0.95 && tone < 3) tone++;
    }
  } else {
    const u = (fromByte(normal[o], 1) + 1) / 2, g = fromByte(normal[o + 1], 1), v = (u - 0.5) * 2 * L.x * L.k + g;
    if (kind === Kind.Moss) tone = v > 0.3 ? 0 : v > -0.1 ? 1 : v > -0.5 ? 2 : 3;
    else tone = g < -0.45 ? 4 : v > 0.55 ? 0 : v > 0.12 ? 1 : v > -0.35 ? 2 : 3;
  }
  return tones[tone];
}

describe('painted shading', () => {
  it('keeps each ramp once, by its colours', () => {
    const r = new Ramps(), a: RGB[] = [[1, 2, 3], [4, 5, 6]];
    expect(r.row(a, Kind.Leaf)).toBe(0);
    expect(r.row([[1, 2, 3], [4, 5, 6]], Kind.Leaf)).toBe(0);
    expect(r.row(a, Kind.Bark)).toBe(1);
  });

  it('packs numbers into bytes and back', () => {
    for (const v of [-2, -0.7, 0, 0.3, 1.99]) expect(fromByte(toByte(v, 2), 2)).toBeCloseTo(v, 1);
  });

  it('shades a tree on the GPU as the CPU does, in any light', () => {
    // (a template: the same tree whatever the garden's seed, and whether it's painted or not)
    const tree = templatePlan('broadleaf', 1);
    const lights: ScreenLight[] = [{ x: -0.55, y: -0.85, k: 1 }, { x: 0.95, y: -0.3, k: 0.7 }, { x: 0, y: -1, k: 0.55 }];
    for (const L of lights) {
      const prop = planned(tree, SUMMER);
      relightProp(prop, L);
      const { main, normal } = paintedMaps(prop.raster, prop.lit);
      let same = 0;
      for (const at of prop.lit!.at) {
        const o = at * 4, c = shadeOnGpu(main, normal, o, L), d = prop.raster.data;
        if (c[0] === d[o] && c[1] === d[o + 1] && c[2] === d[o + 2]) same++;
      }
      // (the numbers are rounded to bytes: now and then a pixel right on a step between tones goes the other way)
      // (95-97% on the templates, depending on how many pixels sit on a step)
      expect(same / prop.lit!.size).toBeGreaterThan(0.95);
    }
  });
});

import { describe, expect, it } from 'vitest';
import * as critters from './critters.ts';
import * as furniture from './furniture.ts';
import { COATS, buildCatSheet, buildEyeSheet } from './cat.ts';
import { buildGroundRegion, buildWaterMask, ripplesIn } from './tiles.ts';
import { buildProp } from './trees.ts';
import { TREES } from '../world/trees.ts';
import { buildTerrain } from './terrain.ts';
import { placeFlora } from './flora.ts';
import { seasonAt } from '../world/season.ts';
import { MAP_H, MAP_W, TILE, isChannel, tileAt, waterBoxes } from '../world/map.ts';
import { isWaterway } from '../world/legend.ts';
import { Raster } from './raster.ts';
import { HILLS } from '../world/park.ts';

const opaque = (r: Raster) => {
  let n = 0;
  for (let i = 3; i < r.data.length; i += 4) if (r.data[i]) n++;
  return n;
};

describe('critter and furniture art', () => {
  // every builder that takes no arguments, or just a colour or size (1 suits both)
  const builders = [...Object.entries(critters), ...Object.entries(furniture)]
    .filter(([name, f]) => name.startsWith('build') && typeof f === 'function' && (f as () => unknown).length <= 1);

  it.each(builders)('%s draws something', (_, build) => {
    const r = (build as (i: number) => Raster)(1);
    expect(r).toBeInstanceOf(Raster);
    expect(opaque(r)).toBeGreaterThan(0);
  });

  it('lays sprite sheets out as whole frames', () => {
    expect(critters.buildMouse().w).toBe(critters.MOUSE_W * 4);
    expect(critters.buildDashPuff().w).toBe(critters.PUFF_W * critters.PUFF_FRAMES);
    expect(critters.buildBeetle(0).w).toBe(critters.BEETLE_W * 2);
  });
});

describe('cats', () => {
  it.each(COATS.map((_, i) => i))('coat %i has a full sheet and eyes', (i) => {
    expect(opaque(buildCatSheet(i))).toBeGreaterThan(100);
    expect(buildEyeSheet(i).w).toBeGreaterThan(0);
  });
});

describe('the garden through the seasons', () => {
  const dates = { winter: Date.UTC(2026, 0, 15, 11), spring: Date.UTC(2026, 3, 14, 10), summer: Date.UTC(2026, 6, 10, 10), autumn: Date.UTC(2026, 9, 26, 11) };

  /** A piece of the ground to draw, n tiles square, round the first water. */
  const piece = (n: number) => {
    const { x, y } = waterBoxes()[0];
    return [Math.max(0, Math.min(MAP_W - n, Math.floor(x / TILE) - n / 2)), Math.max(0, Math.min(MAP_H - n, Math.floor(y / TILE) - n / 2))];
  };

  it.each(Object.entries(dates))('draws the ground in pieces that fit together in %s', (_, ms) => {
    const season = seasonAt(ms), [tx, ty] = piece(16);
    const whole = buildGroundRegion(tx, ty, 16, 16, 0, season);
    expect([whole.w, whole.h]).toEqual([16 * TILE, 16 * TILE]);
    // the same ground drawn as two halves: not a pixel different at the seam
    const left = buildGroundRegion(tx, ty, 8, 16, 0, season), right = buildGroundRegion(tx + 8, ty, 8, 16, 0, season);
    const W = 16 * TILE, HW = 8 * TILE;
    let diff = 0;
    for (let y = 0; y < W; y++)
      for (let x = 0; x < W; x++) {
        const half = x < HW ? left : right, hx = x < HW ? x : x - HW;
        for (let c = 0; c < 4; c++) if (whole.data[(y * W + x) * 4 + c] !== half.data[(y * HW + hx) * 4 + c]) diff++;
      }
    expect(diff).toBe(0);
    expect(TREES.length).toBeGreaterThan(20);
    for (const shape of ['broadleaf', 'pine', 'treehouse']) {
      const i = TREES.findIndex((t) => t.shape === shape);
      if (i >= 0) expect(buildProp(i, season).raster.w).toBe(TREES[i].w);
    }
  });

  it('has open water only in the streams when the ponds are frozen', () => {
    const count = (m: { data: Uint8Array }) => m.data.reduce((n, v) => n + v, 0);
    const mask = buildWaterMask(seasonAt(dates.winter));
    expect(count(mask)).toBeGreaterThan(500);
    for (let y = 0; y < mask.h; y += 2)
      for (let x = 0; x < mask.w; x += 2) if (mask.isSet(x, y)) expect(isChannel(Math.floor(x / TILE), Math.floor(y / TILE))).toBe(true);
    expect(count(buildWaterMask(seasonAt(dates.summer)))).toBeGreaterThan(count(mask));
  });

  it.each(['summer', 'autumn'] as const)('ripples the water, and only the water, in %s', (when) => {
    const season = seasonAt(dates[when]), [tx, ty] = piece(16);
    expect(ripplesIn(tx, ty, 16, 16, season)).toBe(true);
    const still = buildGroundRegion(tx, ty, 16, 16, 0, season), rippled = buildGroundRegion(tx, ty, 16, 16, 1, season);
    expect(Buffer.from(still.data).equals(Buffer.from(rippled.data))).toBe(false);
    const W = 16 * TILE;
    for (let y = 0; y < W; y += 3)
      for (let x = 0; x < W; x += 3) {
        const i = (y * W + x) * 4;
        if (still.data[i] !== rippled.data[i]) expect(isWaterway(tileAt(tx + Math.floor(x / TILE), ty + Math.floor(y / TILE)))).toBe(true);
      }
  });

  it('grows the vegetables and the catnip in summer, not in winter; soil in the wheelbarrow in spring', () => {
    const [winter, spring, summer] = [seasonAt(dates.winter), seasonAt(dates.spring), seasonAt(dates.summer)];
    expect(furniture.growth(winter)).toBe(0);
    expect(furniture.growth(summer)).toBe(2);
    expect(furniture.catnipUp(winter)).toBe(false);
    expect(furniture.catnipUp(summer)).toBe(true);
    expect(opaque(furniture.buildCatnip(summer))).toBeGreaterThan(opaque(furniture.buildCatnip(winter)));
    // (the crops differ from bare soil)
    expect(Buffer.from(furniture.buildRaisedBed(summer).data).equals(Buffer.from(furniture.buildRaisedBed(winter).data))).toBe(false);
    expect(opaque(furniture.buildBarrow(spring))).toBeGreaterThan(opaque(furniture.buildBarrow(summer)));
  });

  it('raises the plateaus and scatters the flora', () => {
    if (HILLS) expect(buildTerrain().length).toBeGreaterThan(0);
    expect(placeFlora().length).toBeGreaterThan(100);
  });
});

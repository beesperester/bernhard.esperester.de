import { describe, expect, it } from 'vitest';
import * as critters from './critters.ts';
import * as furniture from './furniture.ts';
import { COATS, buildCatSheet, buildEyeSheet } from './cat.ts';
import { buildGround, buildGrounds, buildWaterMask } from './tiles.ts';
import { buildProps } from './trees.ts';
import { buildTerrain } from './terrain.ts';
import { placeFlora } from './flora.ts';
import { seasonAt } from '../world/season.ts';
import { MAP_H, MAP_W, TILE, isChannel } from '../world/map.ts';
import { Raster } from './raster.ts';

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

  it.each(Object.entries(dates))('builds the whole ground in %s', (_, ms) => {
    const season = seasonAt(ms);
    const ground = buildGround(season.frozen ? 0 : 1, season);
    expect(ground.w).toBe(MAP_W * TILE);
    expect(ground.h).toBe(MAP_H * TILE);
    expect(buildProps(season).length).toBeGreaterThan(20);
  });

  it('has open water only in the streams when the ponds are frozen', () => {
    const winter = seasonAt(dates.winter);
    const mask = buildWaterMask(buildGround(0, winter), buildGround(1, winter));
    expect(opaque(mask)).toBeGreaterThan(500);
    for (let y = 0; y < mask.h; y += 2)
      for (let x = 0; x < mask.w; x += 2) if (mask.isSet(x, y)) expect(isChannel(Math.floor(x / TILE), Math.floor(y / TILE))).toBe(true);
    const summer = seasonAt(dates.summer);
    expect(opaque(buildWaterMask(buildGround(0, summer), buildGround(1, summer)))).toBeGreaterThan(1000);
  });

  it.each(['summer', 'autumn', 'winter'] as const)('copies the still ground and redraws only the water for the ripple in %s', (when) => {
    const season = seasonAt(dates[when]);
    const [, rippled] = buildGrounds(season);
    expect(Buffer.from(rippled.data).equals(Buffer.from(buildGround(1, season).data))).toBe(true);
  });

  it('raises the plateaus and scatters the flora', () => {
    const summer = seasonAt(dates.summer);
    expect(buildTerrain(buildGround(0, summer)).length).toBeGreaterThan(0);
    expect(placeFlora().length).toBeGreaterThan(100);
  });
});

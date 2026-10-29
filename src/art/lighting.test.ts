import { describe, expect, it } from 'vitest';
import { DEFAULT_LIGHT, screenLight, sunLight } from './lighting.ts';
import { groundTile, SUNLIT_TILES } from './tiles.ts';
import { buildProps, relightProp } from './trees.ts';
import { buildRays } from './rays.ts';
import { seasonAt } from '../world/season.ts';
import { MAP_H, MAP_W, TILE, tileAt } from '../world/map.ts';

const SUMMER = seasonAt(Date.UTC(2026, 6, 10, 12));

/** Mean brightness of a prop's lit pixels left and right of the middle. */
const sides = (prop: ReturnType<typeof buildProps>[number]) => {
  const w = prop.raster.w, d = prop.raster.data;
  const sum = [0, 0], n = [0, 0];
  for (const i of prop.lit!.at) {
    const s = i % w < w / 2 ? 0 : 1;
    sum[s] += d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2];
    n[s]++;
  }
  return [sum[0] / n[0], sum[1] / n[1]];
};

describe('lighting', () => {
  it('turns the sun into a light on screen: morning from the left, evening from the right', () => {
    expect(screenLight([-1, 0], 10, 1).x).toBeLessThan(-0.8);
    expect(screenLight([1, 0], 10, 1).x).toBeGreaterThan(0.8);
    // a high sun lights things from the top
    expect(screenLight([0.3, 0], 60, 1).y).toBeLessThan(-0.8);
    // and at night it is a soft light from above
    const night = screenLight([1, 0], 0, 0);
    expect(night.y).toBeCloseTo(-1, 5);
    expect(night.k).toBeLessThan(0.6);
    for (const L of [screenLight([-0.7, -0.7], 30, 0.5), night]) expect(Math.hypot(L.x, L.y)).toBeCloseTo(1, 5);
  });

  it('draws the trees as they always were under the default light', () => {
    const tree = buildProps(SUMMER)[0];
    const before = tree.raster.data.slice();
    relightProp(tree, DEFAULT_LIGHT);
    expect(tree.raster.data).toEqual(before);
    expect(tree.lit!.size).toBeGreaterThan(500);
  });

  it('lights a tree from the side the sun is on', () => {
    const tree = buildProps(SUMMER)[0];
    relightProp(tree, { x: -1, y: 0, k: 1 });
    const [l1, r1] = sides(tree);
    relightProp(tree, { x: 1, y: 0, k: 1 });
    const [l2, r2] = sides(tree);
    expect(l1).toBeGreaterThan(r1);
    expect(r2).toBeGreaterThan(l2);
  });

  it('shades the bushes and rocks from their normals', () => {
    let found = 0;
    for (let ty = 0; ty < MAP_H && found < 4; ty++)
      for (let tx = 0; tx < MAP_W && found < 4; tx++) {
        if (!SUNLIT_TILES.has(tileAt(tx, ty))) continue;
        found++;
        Object.assign(sunLight, { x: -1, y: 0, k: 1 });
        const left = groundTile(tx, ty, 0, SUMMER);
        Object.assign(sunLight, { x: 1, y: 0, k: 1 });
        const right = groundTile(tx, ty, 0, SUMMER);
        Object.assign(sunLight, DEFAULT_LIGHT);
        expect(left.w).toBe(TILE);
        expect(right.data).not.toEqual(left.data);
      }
    expect(found).toBeGreaterThan(0);
  });

  it('lets the sun shafts fall in from the sun', () => {
    const w = 64, h = 48;
    const bright = (sun: [number, number]) => {
      const { intensity } = buildRays(w, h, 0, sun);
      let l = 0, r = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) (x < w / 2 ? (l += intensity[y * w + x]) : (r += intensity[y * w + x]));
      return [l, r];
    };
    const [ml, mr] = bright([-1, -0.3]);
    const [el, er] = bright([1, -0.3]);
    expect(ml).toBeGreaterThan(mr);
    expect(er).toBeGreaterThan(el);
  });
});

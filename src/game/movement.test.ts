import { describe, expect, it } from 'vitest';
import { LEVEL, MAP_H, MAP_W, TILE, groundAt, spawnPoints, tileAt } from '../world/map.ts';
import { DASH_COOLDOWN_MIN_MS, DASH_COOLDOWN_MS, DASH_MS, Dash, JUMP_HEIGHT, STEP_UP, alignDiagonal, blocked, step, type Body } from './movement.ts';

const onFoot = (x: number, y: number): Body => ({ x, y, z: groundAt(x, y), airborne: false });

/** The first tile of this kind with the given neighbour to its east, as world coordinates of its centre. */
function tileWithEast(ch: string, east: string): [number, number] {
  for (let ty = 1; ty < MAP_H - 1; ty++)
    for (let tx = 1; tx < MAP_W - 2; tx++)
      if (tileAt(tx, ty) === ch && tileAt(tx + 1, ty) === east && groundAt(tx * TILE + 8, ty * TILE + 12) === 0) return [tx * TILE + 8, ty * TILE + 12];
  throw new Error(`no '${ch}' next to '${east}'`);
}

describe('walking', () => {
  it('goes where it is told on open ground', () => {
    const [x, y] = spawnPoints()[0];
    const b = onFoot(x, y);
    step(b, 3, 0);
    expect(b.x).toBeCloseTo(x + 3);
    expect(b.y).toBe(y);
  });

  it('never gets through the fence', () => {
    const [x, y] = spawnPoints()[0];
    for (const [mx, my] of [[-3, 0], [3, 0], [0, -3], [0, 3]]) {
      const b = onFoot(x, y);
      for (let i = 0; i < 1000; i++) step(b, mx, my);
      // the feet box (10 px wide, 5 deep) stays off the outermost tiles
      expect(b.x - 5).toBeGreaterThanOrEqual(TILE);
      expect(b.x + 5).toBeLessThanOrEqual((MAP_W - 1) * TILE);
      expect(b.y - 5).toBeGreaterThanOrEqual(TILE);
      expect(b.y).toBeLessThanOrEqual((MAP_H - 1) * TILE);
    }
  });

  it('won’t walk into the pond, but a jump lands in it', () => {
    const [x, y] = tileWithEast('.', 'w');
    const walker = onFoot(x, y);
    for (let i = 0; i < 20; i++) step(walker, 1, 0);
    expect(blocked(walker, walker.x + 1, walker.y)).toBe(true);
    const jumper: Body = { ...walker, z: 8, airborne: true };
    step(jumper, 4, 0);
    expect(jumper.x).toBeGreaterThan(walker.x);
  });

  it('can’t step up a cliff, only a few px at a time', () => {
    expect(STEP_UP).toBeLessThan(LEVEL);
    expect(JUMP_HEIGHT).toBeLessThan(LEVEL);
  });

  it('never moves more than asked, even slipping round corners', () => {
    const [sx, sy] = spawnPoints()[0];
    for (const [mx, my] of [[3, 0], [-3, 0], [0, 3], [0, -3], [2, 2]]) {
      const b = onFoot(sx, sy);
      for (let i = 0; i < 200; i++) {
        const { x, y } = b;
        step(b, mx, my);
        expect(Math.hypot(b.x - x, b.y - y)).toBeLessThanOrEqual(Math.hypot(mx, my) + 1e-9);
      }
    }
  });
});

describe('the dash', () => {
  it('runs while held, up to DASH_MS', () => {
    const d = new Dash();
    d.update(true, true, 0);
    expect(d.active).toBe(true);
    d.update(false, true, DASH_MS - 1);
    expect(d.active).toBe(true);
    d.update(false, true, DASH_MS);
    expect(d.active).toBe(false);
    expect(d.cooldown(DASH_MS)).toBe(DASH_COOLDOWN_MS);
  });

  it('recovers faster from a short dash, but not instantly', () => {
    const d = new Dash();
    d.update(true, true, 0);
    d.update(false, false, 10);
    expect(d.cooldown(10)).toBe(DASH_COOLDOWN_MIN_MS);
    d.update(true, true, 20);
    expect(d.active).toBe(false);
    d.update(true, true, 10 + DASH_COOLDOWN_MIN_MS);
    expect(d.active).toBe(true);
  });
});

describe('diagonal steps', () => {
  it('fall into step without the rounded position ever going back', () => {
    const [x, y] = spawnPoints()[0];
    for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]])
      for (const [ox, oy] of [[0.1, 0.8], [0.45, 0.2], [0.9, 0.5], [0.3, 0.55]]) {
        const b = onFoot(Math.floor(x) + ox, Math.floor(y) + oy);
        let inStep = 0;
        // creeping: a fifth of a pixel a frame
        for (let i = 0; i < 40; i++) {
          const rx = Math.round(b.x), ry = Math.round(b.y), fromY = b.y;
          b.x += dx * 0.2;
          b.y += dy * 0.2;
          alignDiagonal(b, dx, dy, fromY);
          expect((Math.round(b.y) - ry) * dy).toBeGreaterThanOrEqual(0);
          if (i >= 10 && (Math.round(b.x) !== rx) === (Math.round(b.y) !== ry)) inStep++;
        }
        expect(inStep).toBe(30);
      }
  });

  it('get x and y onto whole pixels at the same moment, whichever way', () => {
    const [x, y] = spawnPoints()[0];
    for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]])
      for (const [ox, oy] of [[0.1, 0.8], [0.45, 0.2], [0.9, 0.5]]) {
        const b = onFoot(Math.floor(x) + ox, Math.floor(y) + oy);
        // (having just stepped a whole pixel, so it may go back as far as it needs)
        alignDiagonal(b, dx, dy, b.y - dy);
        expect(Math.abs(b.y - (Math.floor(y) + oy))).toBeLessThanOrEqual(0.5);
        // walk on: the rounded position must change on both axes in the same steps
        for (let i = 0; i < 40; i++) {
          const rx = Math.round(b.x), ry = Math.round(b.y);
          b.x += dx * 0.37;
          b.y += dy * 0.37;
          expect(Math.round(b.x) !== rx).toBe(Math.round(b.y) !== ry);
        }
      }
  });
});

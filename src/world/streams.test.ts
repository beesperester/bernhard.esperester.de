import { describe, expect, it } from 'vitest';
import { STREAMS, along, findStreams } from './streams.ts';
import { TILE, tileAt } from './map.ts';
import { isWaterway } from './legend.ts';

const mapOf = (rows: string[]) => (tx: number, ty: number) => rows[ty]?.[tx] ?? 'F';
const findIn = (rows: string[]) => findStreams(mapOf(rows), rows[0].length, rows.length);

describe('streams', () => {
  it('run from the pond higher up to the pond lower down, round the bends', () => {
    const rows = [
      '..ww......',
      '..ww......',
      '...w......',
      '...wwwww..',
      '.......w..',
      '......www.',
      '......www.',
    ];
    const [s, ...rest] = findIn(rows);
    expect(rest).toEqual([]);
    const top = along(s, 0), bottom = along(s, s.length);
    // starts in the top pond, ends in the bottom one
    expect(Math.floor(top.y / TILE)).toBeLessThanOrEqual(1);
    expect(Math.floor(bottom.y / TILE)).toBeGreaterThanOrEqual(5);
    // heading down the first leg, then right, then down
    expect(along(s, TILE * 1.2).dy).toBeGreaterThan(0.9);
    expect(along(s, TILE * 4.5).dx).toBeGreaterThan(0.9);
    expect(along(s, s.length - 4).dy).toBeGreaterThan(0.9);
  });

  it('flow down the screen even when written the other way round', () => {
    const rows = [
      '.www......',
      '.www......',
      '...w......',
      '...w......',
      '...wwww...',
      '......w...',
      '......w...',
    ];
    const [s] = findIn(rows);
    expect(along(s, 0).y).toBeLessThan(along(s, s.length).y);
  });

  it('are not found in ponds', () => {
    expect(findIn(['.....', '.www.', '.wlw.', '.www.', '.....'])).toEqual([]);
  });

  it('pass under bridges', () => {
    const [s] = findIn(['.ww...', '.ww...', '..w...', '..B...', '..w...', '..w...']);
    expect(s.length).toBeGreaterThanOrEqual(TILE * 4);
  });

  it('every point along stays on the water', () => {
    expect(STREAMS.length).toBeGreaterThan(0);
    for (const s of STREAMS)
      for (let d = 0; d <= s.length; d += 3) {
        const p = along(s, d);
        expect(isWaterway(tileAt(Math.floor(p.x / TILE), Math.floor(p.y / TILE)))).toBe(true);
        expect(Math.hypot(p.dx, p.dy)).toBeCloseTo(1);
      }
  });

  it('in the garden, the longest river runs west, like the Spree', () => {
    const long = STREAMS.filter((s) => s.river).reduce((a, b) => (b.length > a.length ? b : a));
    expect(long.length).toBeGreaterThan(TILE * 40);
    expect(along(long, long.length).x).toBeLessThan(along(long, 0).x);
  });
});

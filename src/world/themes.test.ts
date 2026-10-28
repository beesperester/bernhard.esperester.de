import { describe, expect, it } from 'vitest';
import { layOut } from './layout.ts';
import { ELEV } from './garden.ts';
import { MAX_ZONES, ZONE_FLOOR } from './themes.ts';

describe('themed zones', () => {
  const gardens = Array.from({ length: 40 }, (_, i) => layOut(1000 + i * 7919));

  it('come in some gardens, not all, never more than a few or two alike', () => {
    const counts = gardens.map((g) => g.zones.length);
    expect(Math.max(...counts)).toBeLessThanOrEqual(MAX_ZONES);
    const some = counts.filter((n) => n > 0).length;
    expect(some).toBeGreaterThan(gardens.length * 0.25);
    expect(some).toBeLessThan(gardens.length * 0.85);
    for (const g of gardens) expect(new Set(g.zones.map((z) => z.theme)).size).toBe(g.zones.length);
  });

  it('each fill a cell of the lawn: their own floor, all on one level, in one piece, a fair size', () => {
    for (const g of gardens)
      for (const z of g.zones) {
        const [x0, y0, x1, y1] = z.box;
        expect(x1 - x0 + 1).toBeGreaterThanOrEqual(7);
        expect(y1 - y0 + 1).toBeGreaterThanOrEqual(7);
        expect(x1 - x0 + 1).toBeLessThanOrEqual(21);
        expect(y1 - y0 + 1).toBeLessThanOrEqual(21);
        const level = ELEV[z.tiles[0][1]][z.tiles[0][0]];
        const has = new Set(z.tiles.map(([x, y]) => `${x},${y}`));
        for (const [x, y] of z.tiles) {
          expect(g.rows[y][x]).toBe(ZONE_FLOOR);
          expect(ELEV[y][x]).toBe(level);
        }
        // (in one piece: everything reached from its first tile)
        const seen = new Set([`${z.tiles[0][0]},${z.tiles[0][1]}`]), todo = [z.tiles[0]];
        while (todo.length) {
          const [x, y] = todo.pop()!;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const k = `${x + dx},${y + dy}`;
            if (has.has(k) && !seen.has(k)) { seen.add(k); todo.push([x + dx, y + dy]); }
          }
        }
        expect(seen.size).toBe(z.tiles.length);
      }
  });

  it('are the same for every cat with the same seed', () => {
    expect(layOut(4242).zones).toEqual(layOut(4242).zones);
  });

  it('have nothing growing or standing in them', () => {
    for (const g of gardens) {
      const zoned = new Set(g.zones.flatMap((z) => z.tiles.map(([x, y]) => `${x},${y}`)));
      for (const f of g.furniture) expect(zoned.has(`${f.tx},${f.ty}`)).toBe(false);
      let floor = 0;
      for (const row of g.rows) for (const ch of row) if (ch === ZONE_FLOOR) floor++;
      expect(floor).toBe(zoned.size);
    }
  });
});

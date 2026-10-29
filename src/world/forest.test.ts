import { describe, expect, it } from 'vitest';
import { CLEARINGS } from './garden.ts';
import { MAP_H, MAP_W, biomeAt, inClearing, tileAt } from './map.ts';
import { treeSizeAt } from './layout.ts';

describe('the woods', () => {
  it('are pine, leafy or mixed by a field, their trees after it', () => {
    const count = { pine: [0, 0], leafy: [0, 0], mixed: [0, 0] };
    for (let y = 0; y < MAP_H; y++)
      for (let x = 0; x < MAP_W; x++) {
        const b = biomeAt(x, y), ch = tileAt(x, y);
        if (!b || (ch !== 'T' && ch !== 'P')) continue;
        count[b][ch === 'P' ? 0 : 1]++;
      }
    const share = (b: keyof typeof count) => count[b][0] / (count[b][0] + count[b][1]);
    expect(share('pine')).toBeGreaterThan(0.8);
    expect(share('leafy')).toBeLessThan(0.15);
    expect(share('mixed')).toBeGreaterThan(0.25);
    expect(share('mixed')).toBeLessThan(0.65);
  });

  it('hide clearings no path leads to, open but for a big old tree (or a stone) in the middle', () => {
    expect(CLEARINGS.length).toBeGreaterThan(2);
    for (const c of CLEARINGS) {
      const R = c.r + 3;
      for (let j = -R; j <= R; j++)
        for (let i = -R; i <= R; i++) {
          if (i * i + j * j > R * R) continue;
          expect(tileAt(c.tx + i, c.ty + j)).not.toBe('p');
          if (!inClearing(c.tx + i, c.ty + j) || (i === 0 && j === 0)) continue;
          expect('TPbr').not.toContain(tileAt(c.tx + i, c.ty + j));
        }
      if (c.heart === 'tree') {
        expect('TP').toContain(tileAt(c.tx, c.ty));
        expect(treeSizeAt(c.tx, c.ty)).toBe(2);
      }
    }
  });
});

import { describe, expect, it } from 'vitest';
import { CLEARINGS } from './garden.ts';
import { MAP_H, MAP_W, biomeAt, inClearing, tileAt } from './map.ts';
import { treeSizeAt } from './layout.ts';
import { BRAMBLE, FERN, placeFlora, thicketAt } from '../art/flora.ts';
import { TILE } from './size.ts';
import { trackside } from './track.ts';

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

  it('grow ferns, bracken and thickets on their floor, and only there (not by the railway); thickest round the clearings', () => {
    const plants = placeFlora().filter((p) => p.kind >= FERN && p.kind <= BRAMBLE);
    expect(plants.length).toBeGreaterThan(1000);
    for (const p of plants) {
      const tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE);
      expect(biomeAt(tx, ty)).not.toBeNull();
      // (none over the rails)
      expect(trackside(tx, ty), `undergrowth on the track at ${tx},${ty}`).toBe(false);
    }
    let wall = 0, thick = 0;
    for (const c of CLEARINGS)
      for (let j = -c.r - 3; j <= c.r + 3; j++)
        for (let i = -c.r - 3; i <= c.r + 3; i++) {
          const d = Math.hypot(i, j * 1.15);
          if (d <= c.r + 0.5 || d > c.r + 3) continue;
          wall++;
          if (thicketAt((c.tx + i) * TILE + 8, (c.ty + j) * TILE + 8)) thick++;
        }
    expect(thick / wall).toBeGreaterThan(0.2);
  });
});

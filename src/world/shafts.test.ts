import { describe, expect, it } from 'vitest';
import { SHAFTS } from './shafts.ts';
import { TILE, tileAt } from './map.ts';
import { isOpenGround } from './legend.ts';

describe('shafts of light', () => {
  it('fall in the woods, on open ground, well apart', () => {
    expect(SHAFTS.length).toBeGreaterThan(20);
    for (const s of SHAFTS) expect(isOpenGround(tileAt(Math.floor(s.x / TILE), Math.floor(s.y / TILE)))).toBe(true);
    for (const a of SHAFTS) for (const b of SHAFTS) if (a !== b) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(120);
  });
});

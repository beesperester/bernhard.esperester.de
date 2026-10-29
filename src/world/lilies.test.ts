import { describe, expect, it } from 'vitest';
import { FLOWERS, LILIES, PADS } from './lilies.ts';
import { TILE, isChannel, tileAt } from './map.ts';
import { isPond } from './legend.ts';
import { PAD_SIZES } from '../art/lilies.ts';

describe('water lilies', () => {
  it('float in clusters on the still water near the banks, some in flower', () => {
    expect(LILIES.length).toBeGreaterThan(40);
    for (const l of LILIES) {
      const tx = Math.floor(l.x / TILE), ty = Math.floor(l.y / TILE);
      expect(isPond(tileAt(tx, ty))).toBe(true);
      expect(isChannel(tx, ty), `a lily on running water at ${tx},${ty}`).toBe(false);
      expect(l.pad).toBeLessThan(PADS);
      expect(l.flower).toBeLessThan(FLOWERS);
    }
    const flowering = LILIES.filter((l) => l.flower >= 0).length / LILIES.length;
    expect(flowering).toBeGreaterThan(0.15);
    expect(flowering).toBeLessThan(0.45);
    expect(PAD_SIZES.length).toBe(PADS);
  });
});

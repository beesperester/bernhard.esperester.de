import { describe, expect, it } from 'vitest';
import { artFile } from './files.ts';
import { SIZE_NAMES, isPainted, paintedSize, paintedTree, treePath } from './paintedTrees.ts';
import { TREE_KINDS } from '../world/templates.ts';
import { SEASON, SEASON_NAMES } from '../world/season.ts';
import { guidePerches } from '../../tools/guide.ts';

describe('the trees drawn as files (art/trees/)', () => {
  const trees = TREE_KINDS.flatMap((kind) => SIZE_NAMES.map((_, size) => ({ kind, size, f: artFile(treePath(kind, size)) })));

  it('are there for every kind and size, in summer (the other seasons worked out from it, unless painted)', () => {
    for (const { kind, size, f } of trees) {
      expect(f, treePath(kind, size)).not.toBeNull();
      expect(isPainted(kind, size), `${treePath(kind, size)}: back, mid and front`).toBe(true);
      expect(f!.layer('mid', f!.tags.get('summer')?.[0] ?? 0), `${treePath(kind, size)}: a trunk`).not.toBeNull();
      for (const [tag] of f!.tags) expect(SEASON_NAMES, `${treePath(kind, size)}: a frame tagged ${tag}`).toContain(tag);
    }
  });

  it('turn colour in autumn and lose their leaves in winter, but for the pines', () => {
    const autumn = paintedTree('broadleaf', 1, { ...SEASON, day: 296 })!, winter = paintedTree('broadleaf', 1, { ...SEASON, day: 15 })!;
    const summer = paintedTree('broadleaf', 1, { ...SEASON, day: 190 })!;
    // (most of the leaves turned: what's left is far from the summer ramps, the odd whimsy blossom)
    let leaves = 0, turned = 0;
    for (let o = 0; o < summer.back.data.length; o += 4) {
      if (!summer.back.data[o + 3]) continue;
      leaves++;
      if (summer.back.data[o] !== autumn.back.data[o] || summer.back.data[o + 1] !== autumn.back.data[o + 1]) turned++;
    }
    expect(turned / leaves).toBeGreaterThan(0.9);
    expect(winter.back.data.some((v, i) => i % 4 === 3 && v > 0 && !summer.mid.data[i])).toBe(false);
    expect(paintedTree('pine', 1, { ...SEASON, day: 15 })!.back.data.some((v, i) => i % 4 === 3 && v > 0)).toBe(true);
  });

  it("have guides a cat can stand on: something painted under each line, and a first stump a young cat jumps to", () => {
    for (const { kind, size, f } of trees) {
      const [w, h] = paintedSize(kind, size)!, guide = new Uint8ClampedArray(w * h * 4);
      const g = f!.layer('guide', 0);
      if (!g) continue;
      for (let y = 0; y < h; y++) guide.set(g.data.subarray(y * f!.w * 4, (y + 1) * f!.w * 4), y * w * 4);
      const layers = ['back', 'mid', 'front'].map((l) => f!.layer(l, 0));
      const solid = (x: number, y: number) => x < f!.w && layers.some((r) => r?.isSet(x, y));
      const { problems } = guidePerches(guide, w, h, kind === 'pine' ? 'pine' : 'broadleaf', solid);
      expect(problems, treePath(kind, size)).toEqual([]);
    }
  });
});

describe('the small things drawn as files (art/plants/, art/water/, art/woodland/)', () => {
  it('are there for every plant, and bend in the wind from upright', async () => {
    const { FLORA, LEANS, buildFloraSheet } = await import('./flora.ts');
    for (const k of FLORA) {
      const f = artFile(`plants/${k.key}`);
      expect(f, `plants/${k.key}`).not.toBeNull();
      expect([k.w, k.h]).toEqual([f!.w, f!.h]);
      const sheet = buildFloraSheet(k), frame = (n: number) => sheet.data.subarray(0, sheet.data.length).filter((_, i) => Math.floor((i / 4) % sheet.w / k.w) === n);
      // (upright in the middle frame, as painted; bent either side)
      expect(sheet.w).toBe(k.w * LEANS);
      expect([...frame(0)]).not.toEqual([...frame(2)]);
    }
  });

  it('have the lilies and what lies about in the woods', () => {
    for (const p of ['water/lily-pad-0', 'water/lily-pad-3', 'water/lily-flower-0', 'water/lily-flower-3', 'woodland/log', 'woodland/stump', 'woodland/stone', 'woodland/boulder'])
      expect(artFile(p), p).not.toBeNull();
  });

  it('turn colour with the seasons where they have their colours', async () => {
    const { seasonalArt } = await import('./seasonal.ts');
    const summer = seasonalArt('plants', 'fern', { ...SEASON, day: 190 })!, autumn = seasonalArt('plants', 'fern', { ...SEASON, day: 296 })!;
    expect([...autumn.data]).not.toEqual([...summer.data]);
    const log = seasonalArt('woodland', 'log', { ...SEASON, day: 296 })!;
    expect([...log.data]).toEqual([...seasonalArt('woodland', 'log', { ...SEASON, day: 190 })!.data]);
  });
});

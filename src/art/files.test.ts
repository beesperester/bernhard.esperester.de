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
    const o = summer.back.data.findIndex((v, i) => i % 4 === 3 && v > 0) - 3;
    expect([...autumn.back.data.subarray(o, o + 4)]).not.toEqual([...summer.back.data.subarray(o, o + 4)]);
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

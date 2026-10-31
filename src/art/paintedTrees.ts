// The trees drawn as files (art/trees/<kind>-<s|m>.aseprite, art/files.ts):
// for a kind and size of tree, its leaves at the back, its middle (trunk and
// branches) and its leaves in front, in summer (the other seasons worked out
// from it, art/seasonal.ts, unless they're painted too). Where there's a file, every tree of that kind and
// size is that one (world/trees.ts plans it as its template, and a cat stands
// where the guide layer's lines are drawn); the rest are drawn from their
// plans as ever.
import { Raster } from './raster.ts';
import { artFile, hasArt } from './files.ts';
import { guideLines } from './guide.ts';
import { SEASON, seasonFrames, type Season, type SeasonName } from '../world/season.ts';
import { blendSeasons, seasonal } from './seasonal.ts';
import type { Perch } from '../world/trees.ts';

/** A painted tree's layers, all the same size, its trunk's foot at the bottom middle. */
export interface PaintedTree {
  w: number; h: number; back: Raster; mid: Raster; front: Raster;
  /** Its normal map, if one is painted (the file's `normal` layer, in summer: not for a tree bare in winter, its branches outlined each). */
  normal: Raster | null;
}

export const LAYERS = ['back', 'mid', 'front'] as const;
/** The sizes' names in the files' names. */
export const SIZE_NAMES = ['s', 'm'];

/** The file of a kind and size of tree ('trees/pine-m'). */
export const treePath = (kind: string, size: number) => `trees/${kind}-${SIZE_NAMES[size]}`;

/** Whether a tree of this kind and size is drawn as a file (and has the layers it needs). */
export function isPainted(kind: string, size: number): boolean {
  const f = hasArt(treePath(kind, size)) ? artFile(treePath(kind, size))! : null;
  return !!f && LAYERS.every((l) => f.layers.includes(l));
}

/** The size of the tree of this kind and size drawn as a file, if there is one. */
export function paintedSize(kind: string, size: number): [number, number] | null {
  if (!isPainted(kind, size)) return null;
  const f = artFile(treePath(kind, size))!;
  // (the trunk's foot is the middle of the bottom row: an odd width gets a column more on the right)
  return [f.w + (f.w % 2), f.h];
}

const trees = new Map<string, PaintedTree>();
/** The tree of this kind and size drawn as a file, in this season, if there is one. */
export function paintedTree(kind: string, size: number, season: Season = SEASON): PaintedTree | null {
  if (!isPainted(kind, size)) return null;
  const { from, to, t } = seasonFrames(season.day), key = `${kind}-${size}-${from}-${to}-${Math.round(t * 16)}`;
  let p = trees.get(key);
  if (!p) {
    const f = artFile(treePath(kind, size))!, [w, h] = paintedSize(kind, size)!;
    // (the leaves recoloured for the season, and gone in winter but for the pine's; the middle as it is)
    const get = (l: string) => (s: SeasonName) => (s === 'winter' && kind !== 'pine' && l !== 'mid' && !f.tags.has('winter') ? null : seasonal(f, 'trees', `${kind}-${SIZE_NAMES[size]}`, l, s, l === 'mid' ? null : kind));
    const [back, mid, front] = LAYERS.map((l) => blendSeasons(get(l), w, h, season));
    const bare = kind !== 'pine' && (from === 'winter' || to === 'winter') && !f.tags.has('winter');
    const n = bare ? null : f.layer('normal', f.tags.get('summer')?.[0] ?? 0), normal = n && new Raster(w, h);
    if (n && normal) normal.blit(n, 0, 0);
    trees.set(key, (p = { w, h, back, mid, front, normal }));
  }
  return p;
}

const perches = new Map<string, Perch[] | null>();
/** What a cat stands on in the tree of this kind and size drawn as a file, as drawn on its guide (null: as its template has it). */
export function paintedPerches(kind: string, size: number): Perch[] | null {
  const key = `${kind}-${size}`;
  if (!perches.has(key)) {
    const f = isPainted(kind, size) ? artFile(treePath(kind, size))! : null;
    // (the guide in its first frame that has one)
    let guide: Raster | null = null;
    for (let k = 0; f && k < f.frames && !guide; k++) guide = f.layer('guide', k);
    let got: Perch[] | null = null;
    if (f && guide) {
      const [w, h] = paintedSize(kind, size)!, wide = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < h; y++) wide.set(guide.data.subarray(y * f.w * 4, (y + 1) * f.w * 4), y * w * 4);
      got = guideLines(wide, w, h, kind === 'pine' ? 'pine' : 'broadleaf').map((l) => l.perch);
    }
    perches.set(key, got);
  }
  return perches.get(key)!;
}

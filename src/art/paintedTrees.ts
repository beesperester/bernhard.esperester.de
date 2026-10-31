// The trees drawn as files (art/trees/<kind>-<s|m>.aseprite, art/files.ts):
// for a kind and size of tree, its leaves at the back, its middle (trunk and
// branches) and its leaves in front, a frame for each season (tagged summer,
// autumn, winter, spring). Where there's a file, every tree of that kind and
// size is that one (world/trees.ts plans it as its template, and a cat stands
// where the guide layer's lines are drawn); the rest are drawn from their
// plans as ever.
import { Raster } from './raster.ts';
import { artFile, hasArt, type ArtFile } from './files.ts';
import { guideLines } from './guide.ts';
import { SEASON, seasonFrames, type Season } from '../world/season.ts';
import type { Perch } from '../world/trees.ts';

/** A painted tree's layers, all the same size, its trunk's foot at the bottom middle. */
export interface PaintedTree { w: number; h: number; back: Raster; mid: Raster; front: Raster }

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

/** The first frame of a season's tag (a file without it: its first frame). */
const frameOf = (f: ArtFile, name: string) => f.tags.get(name)?.[0] ?? f.tags.get('summer')?.[0] ?? 0;

/** 4 x 4 ordered dither: the share of pixels (0..1) under which each one goes over. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

/** A layer in one season going over to the next: each pixel from one or the other, dithered. */
function blended(f: ArtFile, name: string, a: number, b: number, t: number, w: number): Raster {
  const out = new Raster(w, f.h);
  const from = f.layer(name, a), to = f.layer(name, b);
  for (let y = 0; y < f.h; y++)
    for (let x = 0; x < f.w; x++) {
      const src = b !== a && BAYER[(y & 3) * 4 + (x & 3)] < t ? to : from;
      if (!src) continue;
      const o = (y * f.w + x) * 4;
      if (src.data[o + 3]) out.set(x, y, [src.data[o], src.data[o + 1], src.data[o + 2]]);
    }
  return out;
}

const trees = new Map<string, PaintedTree>();
/** The tree of this kind and size drawn as a file, in this season, if there is one. */
export function paintedTree(kind: string, size: number, season: Season = SEASON): PaintedTree | null {
  if (!isPainted(kind, size)) return null;
  const { from, to, t } = seasonFrames(season.day), key = `${kind}-${size}-${from}-${to}-${Math.round(t * 16)}`;
  let p = trees.get(key);
  if (!p) {
    const f = artFile(treePath(kind, size))!, [w, h] = paintedSize(kind, size)!;
    const [back, mid, front] = LAYERS.map((l) => blended(f, l, frameOf(f, from), frameOf(f, to), t, w));
    trees.set(key, (p = { w, h, back, mid, front }));
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

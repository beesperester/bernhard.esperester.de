// Water lilies: pads floating in clusters on the still water of the ponds
// and lakes (not the running rivers and streams), near the banks, some of
// them flowering, white or pink. Laid out from the garden's seed;
// game/Lilies.ts floats them on the water and makes the flowers glow at
// night.
import { hash2 } from '../art/raster.ts';
import { noise } from '../art/paint.ts';
import { MAP_H, MAP_W, TILE, isChannel, tileAt } from './map.ts';
import { isPond } from './legend.ts';
import { worldSeed } from './seed.ts';
import { SEASON } from './season.ts';

export interface Lily {
  /** The middle of its pad (world px). */
  x: number;
  y: number;
  /** Which pad picture (art/lilies.ts), and mirrored. */
  pad: number;
  flip: boolean;
  /** Its flower, if it has one: which picture (white or pink), else -1. */
  flower: number;
}

/** Clusters where this smooth field is over CLUSTER, the field's blobs about SPREAD tiles across... */
const CLUSTER = 0.52, SPREAD = 7;
/** ...within this many tiles of a bank (they root in the shallows)... */
const SHALLOWS = 4;
/** ...and this share of pads in flower. */
const FLOWERING = 0.3;

/** How many pad and flower pictures there are (art/lilies.ts draws them). */
export const PADS = 4, FLOWERS = 4;

function layOutLilies(): Lily[] {
  const seed = worldSeed().seed, out: Lily[] = [];
  const still = (tx: number, ty: number) => isPond(tileAt(tx, ty)) && !isChannel(tx, ty);
  const bankWithin = (tx: number, ty: number, d: number) => {
    for (let j = -d; j <= d; j++) for (let i = -d; i <= d; i++) if (!isPond(tileAt(tx + i, ty + j))) return true;
    return false;
  };
  for (let ty = 1; ty < MAP_H - 1; ty++)
    for (let tx = 1; tx < MAP_W - 1; tx++) {
      // (on still water, clear of the bank itself, but in the shallows near it)
      if (!still(tx, ty) || bankWithin(tx, ty, 1) || !bankWithin(tx, ty, SHALLOWS)) continue;
      if (noise(tx / SPREAD, ty / SPREAD, seed + 7101) < CLUSTER) continue;
      const r = (k: number) => hash2(tx, ty * 8 + k, seed + 7102);
      const n = r(0) < 0.45 ? 2 : 1;
      for (let k = 0; k < n; k++)
        out.push({
          x: tx * TILE + 3 + Math.floor(r(1 + k * 3) * 10),
          y: ty * TILE + 3 + Math.floor(r(2 + k * 3) * 10),
          pad: Math.floor(r(3 + k * 3) * PADS),
          flip: r(7) < 0.5,
          flower: r(6 + k) < FLOWERING ? Math.floor(r(5) * FLOWERS) : -1,
        });
    }
  return out;
}

export const LILIES: Lily[] = layOutLilies();

/** The lilies are out from spring to late autumn (days of the year), in flower all that time (they are magic)... */
const OUT_FROM = 100, OUT_TO = 325;
/** ...and not while the ponds are frozen. */
export const liliesOut = (): boolean => !SEASON.frozen && SEASON.day >= OUT_FROM && SEASON.day <= OUT_TO;

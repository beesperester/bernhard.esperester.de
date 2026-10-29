// Where shafts of light fall into the woods: through gaps in the canopy, onto
// open ground among the trees (not under a crown, not on water), well apart.
// Laid out from the garden's seed; game/Shafts.ts draws them, slanting away
// from the sun (or the moon).
import { hash2 } from '../art/raster.ts';
import { worldSeed } from './seed.ts';
import { TREES } from './trees.ts';
import { TILE, WORLD_H, WORLD_W, tileAt } from './map.ts';
import { isOpenGround, isTree } from './legend.ts';

export interface Shaft {
  /** Where it lands (world px). */
  x: number;
  y: number;
  /** Its width where it lands (px). */
  w: number;
  /** For its own slow breathing (0..1). */
  phase: number;
}

/** Candidate spots are tried on a grid this fine (px)... */
const STEP = 40;
/** ...a spot needs this many trees within this far (px) to be in the woods... */
const WOODS = 4, AROUND = 150;
/** ...and the shafts keep this far apart (px). */
const APART = 120;

/** Trees by grid cell, to find those near a spot. */
function nearTrees(): (x: number, y: number, r: number) => number[] {
  const C = 128, cells = new Map<number, number[]>();
  TREES.forEach((t, i) => {
    const k = Math.floor(t.y / C) * 1000 + Math.floor(t.x / C);
    const list = cells.get(k);
    if (list) list.push(i);
    else cells.set(k, [i]);
  });
  return (x, y, r) => {
    const out: number[] = [];
    for (let cy = Math.floor((y - r) / C); cy <= Math.floor((y + r) / C); cy++)
      for (let cx = Math.floor((x - r) / C); cx <= Math.floor((x + r) / C); cx++)
        for (const i of cells.get(cy * 1000 + cx) ?? []) if (Math.hypot(TREES[i].x - x, TREES[i].y - y) < r) out.push(i);
    return out;
  };
}

/** Whether a tree's crown hangs over ground point (x, y) (its leaves' footprint round its foot). */
function under(i: number, x: number, y: number): boolean {
  const t = TREES[i];
  return t.crown.some((b) => Math.abs(x - (t.x + b.x)) < b.rx * 0.85 && Math.abs(y - t.y) < b.rx * 0.5);
}

function layOutShafts(): Shaft[] {
  const seed = worldSeed().seed, near = nearTrees(), out: Shaft[] = [];
  for (let gy = STEP; gy < WORLD_H - STEP; gy += STEP)
    for (let gx = STEP; gx < WORLD_W - STEP; gx += STEP) {
      if (hash2(gx, gy, seed + 2101) < 0.35) continue;
      const x = Math.round(gx + (hash2(gx, gy, seed + 2102) - 0.5) * STEP), y = Math.round(gy + (hash2(gx, gy, seed + 2103) - 0.5) * STEP);
      const ch = tileAt(Math.floor(x / TILE), Math.floor(y / TILE));
      if (!isOpenGround(ch) || isTree(ch)) continue;
      const trees = near(x, y, AROUND);
      if (trees.length < WOODS || trees.some((i) => under(i, x, y))) continue;
      if (out.some((s) => Math.hypot(s.x - x, s.y - y) < APART)) continue;
      out.push({ x, y, w: 12 + Math.round(hash2(gx, gy, seed + 2104) * 14), phase: hash2(gx, gy, seed + 2105) });
    }
  return out;
}

export const SHAFTS: Shaft[] = layOutShafts();

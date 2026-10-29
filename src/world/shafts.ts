// Where rays of light come down through the trees: each stands on a spot
// on the ground somewhere among them (one here and there, not everywhere)
// and goes up from it towards the sun (or the moon) till it leaves the
// screen. game/Shafts.ts draws them, in the world at the depth of that spot,
// so they come down between the trees: in front of those behind it, behind
// those in front. Some reach right down to the ground; most fade out a
// little above it. Laid out from the garden's seed.
import { hash2 } from '../art/raster.ts';
import { worldSeed } from './seed.ts';
import { WORLD_H, WORLD_W } from './size.ts';
import { TREES } from './trees.ts';

export interface Shaft {
  /** The spot on the ground it stands on (world px). */
  x: number;
  y: number;
  /** How wide it is (px). */
  w: number;
  /** How high above the ground it fades out (px; 0: it reaches the ground). */
  lift: number;
  /** For its own slow breathing and shimmer (0..1). */
  phase: number;
}

/** One spot tried in every cell this big (px)... */
const CELL = 112;
/** ...kept this often... */
const SOME = 0.55;
/** ...if a tree stands within this far of it (px): rays come through leaves. */
const NEAR = 72;
/** The share of rays that reach the ground. */
const GROUNDED = 0.3;

function layOutShafts(): Shaft[] {
  const seed = worldSeed().seed, out: Shaft[] = [];
  // the leafy trees, by cell, to find those near a spot
  const byCell = new Map<number, { x: number; y: number }[]>();
  for (const t of TREES) {
    if (t.shape === 'pine') continue;
    const k = Math.floor(t.y / CELL) * 4096 + Math.floor(t.x / CELL);
    const list = byCell.get(k);
    if (list) list.push(t);
    else byCell.set(k, [t]);
  }
  const nearTree = (x: number, y: number) => {
    for (let cy = Math.floor((y - NEAR) / CELL); cy <= Math.floor((y + NEAR) / CELL); cy++)
      for (let cx = Math.floor((x - NEAR) / CELL); cx <= Math.floor((x + NEAR) / CELL); cx++)
        for (const t of byCell.get(cy * 4096 + cx) ?? []) if ((t.x - x) ** 2 + (t.y - y) ** 2 < NEAR * NEAR) return true;
    return false;
  };
  for (let j = 0; j * CELL < WORLD_H; j++)
    for (let i = 0; i * CELL < WORLD_W; i++) {
      const r = (k: number) => hash2(i, j * 8 + k, seed + 2111);
      if (r(0) > SOME) continue;
      const x = Math.round((i + 0.1 + r(1) * 0.8) * CELL), y = Math.round((j + 0.1 + r(2) * 0.8) * CELL);
      if (!nearTree(x, y)) continue;
      out.push({ x, y, w: 5 + Math.round(r(3) * 9), lift: r(4) < GROUNDED ? 0 : 8 + Math.round(r(5) * 40), phase: r(6) });
    }
  return out;
}

export const SHAFTS: Shaft[] = layOutShafts();

/** The rays by 256 px cell of the ground they stand on, to find those near the view. */
export const SHAFT_CELL = 256;
export const SHAFTS_BY_CELL = new Map<number, number[]>();
SHAFTS.forEach((s, i) => {
  const k = Math.floor(s.y / SHAFT_CELL) * 4096 + Math.floor(s.x / SHAFT_CELL);
  const list = SHAFTS_BY_CELL.get(k);
  if (list) list.push(i);
  else SHAFTS_BY_CELL.set(k, [i]);
});

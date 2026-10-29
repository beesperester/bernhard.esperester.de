// Where rays of light come down through the trees: from up in a leafy crown,
// a few to a tree (not every tree has any), each its own width and length
// (none reaches lower than the tree's foot). game/Shafts.ts draws them,
// slanting down away from the sun (or the moon) just as the trees' shadows
// fall, from behind the crown they come through.
// Laid out from the garden's seed.
import { hash2 } from '../art/raster.ts';
import { worldSeed } from './seed.ts';
import { TREES } from './trees.ts';

export interface Shaft {
  /** The tree it comes through. */
  tree: number;
  /** Where in the crown it starts: the crown's middle across (world px) and half its width at that height (on the
   * side the ray slants to, `side` of the way from its middle to its edge: well inside the leaves), and the ground
   * line under that (the tree's foot)... */
  x: number;
  half: number;
  side: number;
  y: number;
  /** ...and how high above that ground (px). */
  h: number;
  /** How wide it is (px). */
  w: number;
  /** How far down it reaches: this much of the way to the tree's foot (0..1). */
  reach: number;
  /** For its own slow breathing and shimmer (0..1). */
  phase: number;
}

/** The most rays through one tree... */
const MOST = 3;
/** ...and the share of trees that have any. */
const SOME = 0.6;

function layOutShafts(): Shaft[] {
  const seed = worldSeed().seed, out: Shaft[] = [];
  TREES.forEach((t, tree) => {
    // (through broad leaves: a pine's needles are too dense)
    if (t.shape === 'pine' || hash2(tree, 1, seed + 2101) > SOME) return;
    const c = t.crown[0], base = c.base ?? c.z - c.rz;
    const n = 1 + Math.floor(hash2(tree, 2, seed + 2102) * MOST);
    for (let k = 0; k < n; k++) {
      const r = (j: number) => hash2(tree, k * 8 + j, seed + 2103);
      // up in the top of the crown, inside its sides
      const top = c.z + c.rz;
      const h = t.elev + base + (top - base) * (0.6 + r(2) * 0.3);
      const half = c.rx * Math.sqrt(Math.max(0, 1 - ((h - t.elev - c.z) / c.rz) ** 2));
      out.push({ tree, x: Math.round(t.x + c.x), half, side: 0.15 + r(1) * 0.45, y: t.y, h: Math.round(h), w: 3 + Math.round(r(3) * 5), reach: 0.55 + r(5) * 0.45, phase: r(4) });
    }
  });
  return out;
}

export const SHAFTS: Shaft[] = layOutShafts();

/** The rays by 256 px cell of the ground they start over, to find those near the view. */
export const SHAFT_CELL = 256;
export const SHAFTS_BY_CELL = new Map<number, number[]>();
SHAFTS.forEach((s, i) => {
  const k = Math.floor(s.y / SHAFT_CELL) * 4096 + Math.floor(s.x / SHAFT_CELL);
  const list = SHAFTS_BY_CELL.get(k);
  if (list) list.push(i);
  else SHAFTS_BY_CELL.set(k, [i]);
});

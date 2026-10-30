// What a cat can stand on in a painted tree, from the lines drawn on its
// guide layer (tools/tree-layers.ts draws them as planned; the painter moves
// them, draws more or rubs some out): red a branch, green a stump up the
// trunk (and the softer red and orange the first exports drew in; their blue
// top is a branch too). Each line becomes one perch, stood on along its top
// edge pixel for pixel (its height in every column: `zs`), x from the trunk's
// middle and z above its foot as world/trees.ts plans them. Where it's too
// steep to walk, a cat slides down it. The checks here are the ones a line can fail by
// itself; whether a cat can climb from one to the next is for the tests
// (world/trees.test.ts climbs every painted tree).
import { MAX_SLOPE, steepAt, type Perch, type PerchKind } from '../src/world/trees.ts';
import { JUMP_HEIGHT, STEP_UP } from '../src/game/movement.ts';
import { STAGE_JUMP, Stage } from '../src/game/growth.ts';

/** The guide's colours (tools/tree-layers.ts draws in these; a painted line is taken for the nearest of them): red a branch, green a stump. */
export const GUIDE = { perch: [255, 0, 0], stump: [0, 255, 0], foot: [255, 255, 255] } as const;
/** (the colours the first exports drew in, still read: red, orange, and blue for the top, now a branch like the rest) */
const OLD = { perch: [232, 40, 60], stump: [255, 150, 30], top: [60, 120, 255], blue: [0, 0, 255] } as const;
/** How far (RGB) a pixel can be from a guide colour and still be one. */
const NEAR = 90;
/** Under how much of a line there must be something painted (in any layer, at most this many px below it)... */
const SUPPORT = 0.7, BELOW = 4;

export interface GuideLine { kind: PerchKind; perches: Perch[]; at: string }

/**
 * The perches on guide (w x h RGBA, the trunk's foot at the bottom middle) of
 * a tree of this shape, what's wrong with any of them and what's left out: `solid` is
 * whether a pixel of the tree (back, mid or front) is painted.
 */
export function guidePerches(guide: Uint8ClampedArray, w: number, h: number, shape: string, solid: (x: number, y: number) => boolean): { perches: Perch[]; problems: string[]; notes: string[] } {
  const kindAt = new Int8Array(w * h);
  const kinds: [number, readonly number[]][] = [[1, GUIDE.perch], [2, GUIDE.stump], [1, OLD.perch], [2, OLD.stump], [1, OLD.top], [1, OLD.blue]];
  for (let o = 0; o < w * h; o++) {
    if (guide[o * 4 + 3] < 128) continue;
    let best = 0, near = NEAR;
    for (const [k, c] of kinds) {
      const d = Math.hypot(guide[o * 4] - c[0], guide[o * 4 + 1] - c[1], guide[o * 4 + 2] - c[2]);
      if (d < near) { near = d; best = k; }
    }
    kindAt[o] = best;
  }
  const names: PerchKind[] = ['branch', shape === 'pine' ? 'tier' : 'branch', 'stump'];
  const cx = w / 2, zOf = (y: number) => h - 1 - y;
  const perches: Perch[] = [], problems: string[] = [], notes: string[] = [];
  const seen = new Uint8Array(w * h);
  for (let o = 0; o < w * h; o++) {
    if (!kindAt[o] || seen[o]) continue;
    // a line: the pixels of one colour touching (corners too)
    const k = kindAt[o], todo = [o], top = new Map<number, number>();
    seen[o] = 1;
    while (todo.length) {
      const q = todo.pop()!, x = q % w, y = (q - x) / w;
      top.set(x, Math.min(top.get(x) ?? y, y));
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const X = x + dx, Y = y + dy, n = Y * w + X;
          if (X >= 0 && Y >= 0 && X < w && Y < h && !seen[n] && kindAt[n] === k) { seen[n] = 1; todo.push(n); }
        }
    }
    const xs = [...top.keys()].sort((a, b) => a - b);
    const at = `the ${names[k] === 'tier' ? 'branch' : names[k]} at ${xs[0]},${top.get(xs[0])}`;
    // one perch, stood on along its top edge exactly, a column at a time
    const zs = xs.map((x) => zOf(top.get(x)!));
    const p: Perch = { x0: xs[0] - cx, z0: zs[0], x1: xs[xs.length - 1] + 1 - cx, z1: zs[zs.length - 1], kind: names[k], zs };
    perches.push(p);
    // (where it's too steep to walk, a cat slides down: just so the painter knows where)
    const runs: string[] = [];
    for (let i = 0; i < xs.length; i++) {
      if (!steepAt(p, xs[i] + 0.5 - cx)) continue;
      let j = i;
      while (j + 1 < xs.length && steepAt(p, xs[j + 1] + 0.5 - cx)) j++;
      runs.push(`${xs[i]},${top.get(xs[i])} to ${xs[j]},${top.get(xs[j])}`);
      i = j;
    }
    if (runs.length) notes.push(`${at}: steeper than ${MAX_SLOPE}° for more than a step, so slid down: ${runs.join('; ')}`);
    const held = xs.filter((x) => { for (let d = 0; d <= BELOW; d++) if (solid(x, top.get(x)! + d)) return true; return false; }).length;
    if (held < xs.length * SUPPORT) problems.push(`${at}: nothing painted under it (paint a branch or a stump there)`);
  }
  const stumps = perches.filter((p) => p.kind === 'stump').map((p) => Math.min(p.z0, p.z1));
  // the lowest stump: a young cat jumps up to it, a kitten doesn't (as world/trees.test.ts has it)
  const low = Math.min(...stumps), lowest = STAGE_JUMP[Stage.Kitten] + STEP_UP, highest = Math.min(JUMP_HEIGHT, STAGE_JUMP[Stage.Young]) - 1;
  if (!stumps.length) problems.push('no stumps (green): a cat needs one to start climbing from the ground');
  else if (low <= lowest || low >= highest)
    problems.push(`the lowest stump is ${low} px up: it needs to be between ${Math.floor(lowest) + 1} and ${Math.ceil(highest) - 1} (row ${h - 1 - Math.ceil(highest) + 1} to ${h - 1 - Math.floor(lowest) - 1})`);
  return { perches, problems, notes };
}

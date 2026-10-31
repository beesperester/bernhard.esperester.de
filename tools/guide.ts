// What's wrong with the lines drawn on a tree file's guide layer (src/art/guide.ts
// reads them; tools/art-trees.ts draws them as planned, the painter moves them,
// draws more or rubs some out), and where they're too steep to walk, so a cat
// slides down. The checks here are the ones a line can fail by itself; whether
// a cat can climb from one to the next is for the tests (world/trees.test.ts
// climbs every painted tree; art/files.test.ts runs these on every file).
import { MAX_SLOPE, steepAt, type Perch } from '../src/world/trees.ts';
import { guideLines } from '../src/art/guide.ts';
export { GUIDE } from '../src/art/guide.ts';
import { JUMP_HEIGHT, STEP_UP } from '../src/game/movement.ts';
import { STAGE_JUMP, Stage } from '../src/game/growth.ts';

/** Under how much of a line there must be something painted (in any layer, at most this many px below it)... */
const SUPPORT = 0.7, BELOW = 4;

/**
 * The perches on guide (w x h RGBA, the trunk's foot at the bottom middle) of
 * a tree of this shape, what's wrong with any of them and what's left out: `solid` is
 * whether a pixel of the tree (back, mid or front) is painted.
 */
export function guidePerches(guide: Uint8ClampedArray, w: number, h: number, shape: string, solid: (x: number, y: number) => boolean): { perches: Perch[]; problems: string[]; notes: string[] } {
  const perches: Perch[] = [], problems: string[] = [], notes: string[] = [];
  const cx = w / 2;
  for (const { perch: p, xs, top } of guideLines(guide, w, h, shape)) {
    const at = `the ${p.kind === 'tier' ? 'branch' : p.kind} at ${xs[0]},${top.get(xs[0])}`;
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

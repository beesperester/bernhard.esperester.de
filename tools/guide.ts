// What a cat can stand on in a painted tree, from the lines drawn on its
// guide layer (tools/tree-layers.ts draws them as planned; the painter moves
// them, draws more or rubs some out): red a branch, green a stump up the
// trunk (and the softer red and orange the first exports drew in; their blue
// top is a branch too). Each line, along its top edge, becomes one perch or a few (where
// it bends), as world/trees.ts plans them: x from the trunk's
// middle, z above its foot. The checks here are the ones a line can fail by
// itself; whether a cat can climb from one to the next is for the tests
// (world/trees.test.ts climbs every painted tree).
import { MAX_SLOPE, type Perch, type PerchKind } from '../src/world/trees.ts';
import { JUMP_HEIGHT, STEP_UP } from '../src/game/movement.ts';
import { STAGE_JUMP, Stage } from '../src/game/growth.ts';

/** The guide's colours (tools/tree-layers.ts draws in these; a painted line is taken for the nearest of them): red a branch, green a stump. */
export const GUIDE = { perch: [255, 0, 0], stump: [0, 255, 0], foot: [255, 255, 255] } as const;
/** (the colours the first exports drew in, still read: red, orange, and blue for the top, now a branch like the rest) */
const OLD = { perch: [232, 40, 60], stump: [255, 150, 30], top: [60, 120, 255], blue: [0, 0, 255] } as const;
/** How far (RGB) a pixel can be from a guide colour and still be one. */
const NEAR = 90;
/** How far a bent line can stray from a straight perch (px) before it's two. */
const BEND = 1.5;
/** Under how much of a line there must be something painted (in any layer, at most this many px below it)... */
const SUPPORT = 0.7, BELOW = 4;

export interface GuideLine { kind: PerchKind; perches: Perch[]; at: string }

/**
 * The perches on guide (w x h RGBA, the trunk's foot at the bottom middle) of
 * a tree of this shape, and what's wrong with any of them: `solid` is
 * whether a pixel of the tree (back, mid or front) is painted.
 */
export function guidePerches(guide: Uint8ClampedArray, w: number, h: number, shape: string, solid: (x: number, y: number) => boolean): { perches: Perch[]; problems: string[] } {
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
  const perches: Perch[] = [], problems: string[] = [];
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
    const pts = xs.map((x) => [x, zOf(top.get(x)!)] as [number, number]);
    // (one perch a stretch, the last reaching to the far edge of its end pixel)
    const line = simplified(pts), most = Math.tan((MAX_SLOPE * Math.PI) / 180) + 0.01;
    if (line.length === 1) line.push(line[0]);
    for (let i = 0; i + 1 < line.length; i++) {
      const [x0, z0] = line[i], [x1, z1] = line[i + 1];
      if (Math.abs(z1 - z0) / Math.max(1, x1 - x0) > most)
        problems.push(`${at}: too steep from ${x0},${h - 1 - z0} to ${x1},${h - 1 - z1} (a cat walks up ${MAX_SLOPE}° at most)`);
      perches.push({ x0: x0 - cx, z0, x1: x1 - cx + (i + 2 === line.length ? 1 : 0), z1, kind: names[k] });
    }
    const held = xs.filter((x) => { for (let d = 0; d <= BELOW; d++) if (solid(x, top.get(x)! + d)) return true; return false; }).length;
    if (held < xs.length * SUPPORT) problems.push(`${at}: nothing painted under it (paint a branch or a stump there)`);
  }
  const stumps = perches.filter((p) => p.kind === 'stump').map((p) => Math.min(p.z0, p.z1));
  // the lowest stump: a young cat jumps up to it, a kitten doesn't (as world/trees.test.ts has it)
  const low = Math.min(...stumps), lowest = STAGE_JUMP[Stage.Kitten] + STEP_UP, highest = Math.min(JUMP_HEIGHT, STAGE_JUMP[Stage.Young]) - 1;
  if (!stumps.length) problems.push('no stumps (green): a cat needs one to start climbing from the ground');
  else if (low <= lowest || low >= highest)
    problems.push(`the lowest stump is ${low} px up: it needs to be between ${Math.floor(lowest) + 1} and ${Math.ceil(highest) - 1} (row ${h - 1 - Math.ceil(highest) + 1} to ${h - 1 - Math.floor(lowest) - 1})`);
  return { perches, problems };
}

/** A line of points (x across, z up), straightened where it's near enough straight (Douglas-Peucker). */
function simplified(pts: [number, number][]): [number, number][] {
  if (pts.length <= 2) return pts;
  const [ax, az] = pts[0], [bx, bz] = pts[pts.length - 1];
  let far = 0, at = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const [x, z] = pts[i], d = Math.abs(az + ((bz - az) * (x - ax)) / Math.max(1, bx - ax) - z);
    if (d > far) { far = d; at = i; }
  }
  if (far <= BEND) return [pts[0], pts[pts.length - 1]];
  return [...simplified(pts.slice(0, at + 1)).slice(0, -1), ...simplified(pts.slice(at))];
}

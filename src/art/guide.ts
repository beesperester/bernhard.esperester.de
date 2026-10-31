// What a cat can stand on in a picture drawn as a file (art/), from the lines
// drawn on its guide layer: red a branch, green a stump up the trunk (and the
// softer red and orange the first exports drew in; their blue top is a branch
// too). Each line becomes one perch, stood on along its top edge pixel for
// pixel (its height in every column: `zs`), x from the middle of the bottom
// row and z above it, as world/trees.ts plans perches. What's wrong with a
// line is for tools/guide.ts and the tests to say.
import type { Perch, PerchKind } from '../world/trees.ts';

/** The guide's colours (a painted line is taken for the nearest of them): red a branch, green a stump. */
export const GUIDE = { perch: [255, 0, 0], stump: [0, 255, 0], foot: [255, 255, 255] } as const;
/** (the colours the first exports drew in, still read: red, orange, and blue for the top, now a branch like the rest) */
const OLD = { perch: [232, 40, 60], stump: [255, 150, 30], top: [60, 120, 255], blue: [0, 0, 255] } as const;
/** How far (RGB) a pixel can be from a guide colour and still be one. */
const NEAR = 90;

/** A line drawn on a guide: its perch, and its top edge as drawn (column -> row). */
export interface GuideLine { perch: Perch; xs: number[]; top: Map<number, number> }

/** The lines on guide (w x h RGBA, the trunk's foot at the bottom middle) of a tree of this shape. */
export function guideLines(guide: Uint8ClampedArray, w: number, h: number, shape: string): GuideLine[] {
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
  const lines: GuideLine[] = [];
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
    // one perch, stood on along its top edge exactly, a column at a time
    const zs = xs.map((x) => zOf(top.get(x)!));
    lines.push({ perch: { x0: xs[0] - cx, z0: zs[0], x1: xs[xs.length - 1] + 1 - cx, z1: zs[zs.length - 1], kind: names[k], zs }, xs, top });
  }
  return lines;
}

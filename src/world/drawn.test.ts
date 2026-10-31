import { describe, expect, it, vi } from 'vitest';
import type { Perch } from './trees.ts';

// The medium broadleaf painted, with lines drawn on its guide to try: a V (a steep arm
// down to a flat bottom, then a gentle one up), and further up a flat line with a
// step in it a cat walks up (3 px) and one it doesn't (6 px).
const line = (x0: number, zs: number[], kind: Perch['kind'] = 'branch'): Perch => ({ x0, x1: x0 + zs.length, z0: zs[0], z1: zs[zs.length - 1], kind, zs });
const V = [...Array.from({ length: 20 }, (_, i) => 130 - 1.5 * i), ...Array(10).fill(101.5), ...Array.from({ length: 20 }, (_, i) => 101.5 + 0.5 * i)].map(Math.round);
const STEPS = [...Array(20).fill(160), 161, 162, 163, ...Array(20).fill(163), 165, 167, 169, ...Array(20).fill(169)];
vi.mock('../art/paintedTrees.ts', async (original) => {
  const one = (kind: string, size: number) => kind === 'broadleaf' && size === 1;
  return {
    ...(await original<typeof import('../art/paintedTrees.ts')>()),
    isPainted: one,
    paintedSize: (kind: string, size: number) => (one(kind, size) ? [404, 283] : null),
    paintedPerches: (kind: string, size: number) => (one(kind, size) ? [line(40, V), line(-60, STEPS), line(-3, [11, 11, 11, 11, 11, 11], 'stump')] : null),
  };
});

const { TREES, lineCrossed, standingOn, steepAt, surfaceAt, zAt } = await import('./trees.ts');
const { blocked, slide, step } = await import('../game/movement.ts');

const DT = 1 / 60;
// (one not mirrored, so its lines run as drawn)
const t = TREES.find((t) => t.painted && !t.painted.flip)!;
const [v, steps] = t.perches;
const at = (p: Perch, x: number) => ({ x: t.x + x, y: t.y + (Math.min(...p.zs!) < 40 ? 6 : 0), z: t.elev + zAt(p, x), airborne: false });

/** A frame of a cat left to itself: sliding, and its paws kept on what's under them. */
function frame(body: ReturnType<typeof at>): void {
  slide(body, DT);
  body.z = surfaceAt(body.x, body.y, body.z);
}

describe('a painted tree\'s drawn branches', () => {
  it('are stood on pixel for pixel, as drawn', () => {
    expect(t.perches.map((p) => p.zs?.length)).toEqual([V.length, STEPS.length, 6]);
    for (let i = 0; i < V.length; i++) expect(standingOn(t.x + 40 + i + 0.5, t.y, t.elev + V[i])).not.toBeNull();
  });

  it('slide a cat down where steep, onto the flat, and never let it fall through', () => {
    const body = at(v, 42);
    expect(steepAt(v, 42)).toBe(true);
    for (let k = 0; k < 120; k++) {
      frame(body);
      expect(standingOn(body.x, body.y, body.z), `on the line after ${k} frames`).not.toBeNull();
    }
    // (at the bottom, at rest)
    expect(body.z - t.elev).toBe(V[25]);
    expect(body.x - t.x).toBeGreaterThan(55);
    const x = body.x;
    frame(body);
    expect(body.x).toBe(x);
  });

  it("can't be walked up where they're steep, but can where they're gentle", () => {
    const body = at(v, 64);
    // left: up the steep arm, no further than its foot
    for (let k = 0; k < 60; k++) { step(body, -1, 0); frame(body); }
    expect(body.x - t.x).toBeGreaterThan(55);
    expect(blocked(body, body.x - 1, body.y)).toBe(true);
    // right: up the gentle one, to its end
    for (let k = 0; k < 28; k++) { step(body, 1, 0); frame(body); }
    expect(body.z - t.elev).toBeGreaterThan(108);
  });

  it('are walked up a step of 3 px like a stair, but not one of 6', () => {
    const body = at(steps, -55);
    for (let k = 0; k < 60; k++) { step(body, 1, 0); frame(body); }
    expect(body.z - t.elev).toBe(163);
    expect(body.x - t.x).toBeLessThan(-60 + 46);
  });

  it('catch a cat coming down across a steep bit', () => {
    // in the air just above the steep arm, then a frame on: further down and across, below the line there
    const x0 = t.x + 45, z0 = t.elev + zAt(v, 45) + 0.2, x1 = t.x + 47, z1 = t.elev + zAt(v, 47) - 1;
    expect(surfaceAt(x1, t.y, z1)).toBeLessThan(t.elev + zAt(v, 47));
    expect(lineCrossed(x0, z0, x1, t.y, z1)).toBeCloseTo(t.elev + zAt(v, 47));
    // (not on the way up through it from below)
    expect(lineCrossed(x0, t.elev + zAt(v, 45) - 3, x1, t.y, t.elev + zAt(v, 47) - 2)).toBe(-Infinity);
  });
});

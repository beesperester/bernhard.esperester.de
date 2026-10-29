import { describe, expect, it } from 'vitest';
import { GRAVITY } from '../game/state.ts';
import { DASH_SPEED, JUMP_HEIGHT, STEP_UP, WALK_SPEED, step } from '../game/movement.ts';
import { MoveWitness } from '../net/witness.ts';
import { Act } from '../game/state.ts';
import { FORK_Z, LEVEL, TILE, WALL, heightUnder, levelAt } from './map.ts';
import { MAX_SLOPE, STUMP_LOW, STUMP_STEP, STUMP_VARY, TREES, perchUnder, standingOn, surfaceAt, treeHolding, zAt, type TreePlan } from './trees.ts';
import { STAGE_JUMP, Stage } from '../game/growth.ts';
import { HILLS } from './park.ts';

const DT = 1 / 60;

/** A jump from (x, y, z) running at vx for the first `frames` frames of it (then letting go): where the cat comes down (as the game moves it). */
function leap(x: number, y: number, z: number, vx: number, frames = Infinity): { x: number; y: number; z: number } {
  const body = { x, y, z, airborne: true };
  let vz = Math.sqrt(2 * GRAVITY * JUMP_HEIGHT);
  for (let i = 0; i < 240; i++) {
    if (i < frames) step(body, vx * DT, 0);
    const ground = surfaceAt(body.x, body.y, body.z);
    body.z += vz * DT - (GRAVITY * DT * DT) / 2;
    vz -= GRAVITY * DT;
    if (body.z <= ground && vz <= 0) return { ...body, z: ground };
  }
  return body;
}

/** The perches of tree t a cat can reach by jumping about (and walking along them), starting on the ground in front of it. */
function climbable(t: TreePlan): Set<number> {
  const reached = new Set<number>(), tree = TREES.indexOf(t);
  const starts: { x: number; y: number; z: number }[] = [];
  for (let dx = -20; dx <= 20; dx += 4) starts.push({ x: t.x + dx, y: t.y + 7, z: surfaceAt(t.x + dx, t.y + 7, 0) });
  const seen = new Set<string>();
  while (starts.length) {
    const s = starts.pop()!;
    // (straight up, or running one way or the other, all the way or letting go part way)
    for (const [vx, frames] of [0, -WALK_SPEED, WALK_SPEED, -DASH_SPEED, DASH_SPEED].flatMap((vx) => [Infinity, 6, 12, 18].map((f) => [vx, f]))) {
      if (vx === 0 && frames !== Infinity) continue;
      const end = leap(s.x, s.y, s.z, vx, frames);
      const p = standingOn(end.x, end.y, end.z);
      if (!p || p.tree !== tree) continue;
      const i = t.perches.findIndex((q) => t.x + q.x0 === p.x0 && t.elev + q.z0 === p.z0);
      if (reached.has(i)) continue;
      reached.add(i);
      // from there, try again from along the whole perch (and walk on from its ends onto what it joins)
      for (let x = p.x0 - 2; x <= p.x1 + 2; x += 3) {
        const z = surfaceAt(x, p.y, zAt(p, x) + STEP_UP);
        const k = `${Math.round(x)},${Math.round(z)}`;
        if (!seen.has(k) && z > t.elev) { seen.add(k); starts.push({ x, y: p.y, z }); }
      }
    }
  }
  return reached;
}

describe('trees', () => {
  it('has broadleaves, pines and the tree house', () => {
    const shapes = new Set(TREES.map((t) => t.shape));
    expect([...shapes].sort()).toEqual(['broadleaf', 'pine']);
    expect(TREES.filter((t) => t.birdhouse).length).toBeGreaterThan(2);
  });

  it('is climbed by stumps a jump apart, out of a kitten\'s reach', () => {
    for (const t of TREES) {
      const stumps = t.perches.filter((p) => p.kind === 'stump').map((p) => p.z0);
      expect(stumps.length).toBeGreaterThan(0);
      // the lowest: a young cat jumps up to it, a kitten doesn't
      const low = Math.min(...stumps);
      expect(low).toBeGreaterThan(STAGE_JUMP[Stage.Kitten] + STEP_UP);
      expect(low).toBeLessThan(Math.min(JUMP_HEIGHT, STAGE_JUMP[Stage.Young]) - 1);
    }
    // never one straight above the last: a jump to one side, a little short of a full jump up
    expect(STUMP_STEP + STUMP_VARY).toBeLessThan(JUMP_HEIGHT - 0.5);
    // (up the trunk, from the first)
    for (const t of TREES.slice(0, 60)) {
      const s = t.perches.filter((p) => p.kind === 'stump' && p.z0 < Math.min(t.fork - 4, 90));
      expect(s[0].z0).toBeCloseTo(STUMP_LOW + 1.25);
      for (let k = 1; k < s.length; k++) {
        expect(s[k].z0 - s[k - 1].z0).toBeGreaterThanOrEqual(STUMP_STEP);
        expect(s[k].x1 <= s[k - 1].x0 || s[k].x0 >= s[k - 1].x1, `stumps at ${s[k - 1].z0} and ${s[k].z0} of the ${t.shape} at ${t.tx},${t.ty}`).toBe(true);
      }
    }
  });

  it('only lets a cat walk along branches no steeper than MAX_SLOPE', () => {
    const most = Math.tan((MAX_SLOPE * Math.PI) / 180) + 0.01;
    let branches = 0;
    for (const t of TREES)
      for (const p of t.perches) {
        expect(p.x1).toBeGreaterThan(p.x0);
        expect(Math.abs(p.z1 - p.z0) / (p.x1 - p.x0)).toBeLessThanOrEqual(most);
        if (p.kind === 'branch' && p.z1 !== p.z0) branches++;
      }
    // (and plenty do slope)
    expect(branches).toBeGreaterThan(TREES.length);
  });

  it('can be climbed all the way to the top, every kind of them', () => {
    // every tree house, and a few of each shape (with and without a bird house): the park has too many to try them all
    const kinds = new Map<string, number>();
    const some = TREES.filter((t) => {
      const k = `${t.shape}${t.birdhouse}`, n = kinds.get(k) ?? 0;
      kinds.set(k, n + 1);
      return t.shape === 'treehouse' || n < 4;
    });
    for (const t of some) {
      const reached = climbable(t);
      const top = t.perches.findIndex((p) => p.kind === 'top');
      expect(reached.has(top), `the top of the ${t.shape} at ${t.tx},${t.ty}`).toBe(true);
      // (most of what's walkable: a stretch of a branch beyond a steep bit of it may be out of reach)
      expect(reached.size, `the perches of the ${t.shape} at ${t.tx},${t.ty}`).toBeGreaterThanOrEqual(t.perches.length * 0.6);
    }
  }, 60000);

  it('blocks at the trunk on the ground, but not up on the fork', () => {
    const t = TREES[0];
    const feet = [t.x - 5, t.y - 5, t.x + 5, t.y] as const;
    expect(heightUnder(...feet)).toBe(WALL);
    expect(heightUnder(...feet, t.elev + FORK_Z)).toBeLessThan(WALL);
    // (and stands on its top: it doesn't fall in and get caught again, over and over)
    for (const z of [t.elev + FORK_Z, t.elev + FORK_Z + 0.3]) expect(surfaceAt(t.x, t.y, z)).toBe(t.elev + FORK_Z);
  });

  it('catches a cat dropping onto a trunk at its fork, not up at wall height', () => {
    // (a fall that ended "on" the wall bounced the cat up out of the tree, faster every time)
    for (const t of TREES.slice(0, 20)) {
      for (const z of [t.elev + FORK_Z - 1, t.elev + FORK_Z - 6, t.elev + 2]) expect(surfaceAt(t.x, t.y, z, t.elev + FORK_Z)).toBe(t.elev + FORK_Z);
      expect(surfaceAt(t.x, t.y + 6, t.elev + FORK_Z, t.elev + FORK_Z)).toBeLessThan(t.elev + FORK_Z);
    }
  });

  it('lets a cat jump up through a branch and land on it from above', () => {
    const t = TREES.find((q) => q.shape === 'pine')!;
    // standing on the ground in front of the trunk, the lowest stump is out of the way
    const low = t.perches.filter((p) => p.kind === 'stump').sort((a, b) => a.z0 - b.z0)[0], x = t.x + (low.x0 + low.x1) / 2;
    expect(perchUnder(x, t.y + 6, t.elev)).toBeNull();
    const up = leap(x, t.y + 6, t.elev, 0);
    expect(up.z).toBe(t.elev + low.z0);
    expect(treeHolding(up.x, up.y, up.z)).toBe(TREES.indexOf(t));
    // and dropping through it (perches below `under` only) comes down to the ground
    expect(surfaceAt(x, t.y + 6, up.z, up.z)).toBe(t.elev);
  });

  it.skipIf(!HILLS)("doesn't count a cat walking on a plateau beside a tree down below as up that tree", () => {
    // (it would be drawn at the tree's depth, behind the plateau it is standing on)
    let checked = 0;
    for (const [i, t] of TREES.entries()) {
      if (t.elev) continue;
      for (let x = t.x - t.w / 2; x <= t.x + t.w / 2; x += 2)
        for (let y = t.y - 24; y <= t.y + 24; y += 2) {
          if (levelAt(Math.floor(x / TILE), Math.floor(y / TILE)) !== 1) continue;
          const ground = heightUnder(x - 5, y - 5, x + 5, y, Infinity);
          if (ground !== LEVEL) continue;
          checked++;
          expect(treeHolding(x, y, ground)).not.toBe(i);
        }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('is not cheating to stand on a branch', () => {
    const t = TREES.find((q) => q.shape === 'broadleaf' && !q.elev)!;
    const w = new MoveWitness();
    const stump = t.perches.filter((p) => p.kind === 'stump').sort((a, b) => a.z0 - b.z0)[0];
    const sx = t.x + (stump.x0 + stump.x1) / 2;
    expect(w.observe(sx, t.y + 6, 0, Act.Idle, 0)).toBeNull();
    expect(w.observe(sx, t.y + 6, stump.z0 + 2, Act.Jump, 200)).toBeNull();
    expect(w.observe(sx, t.y + 6, stump.z0, Act.Idle, 400)).toBeNull();
    // (no jump goes that high)
    expect(new MoveWitness().observe(t.x + 200, t.y + 30, 30, Act.Jump, 0)).toBe('too-high');
    // but hanging in the air beside the tree is
    // (off to one side, clear of every tree: big crowns reach far)
    const h = stump.z0 + 8, x = [1, 2, 3, 4, 5].map((k) => t.x + k * 40).find((x) => surfaceAt(x, t.y + 6, h) < h - 6)!;
    expect(w.observe(x, t.y + 6, h, Act.Idle, 600)).toBe('floating');
  });
});

import { describe, expect, it } from 'vitest';
import { GRAVITY, JUMP_V } from '../game/state.ts';
import { DASH_SPEED, WALK_SPEED, step } from '../game/movement.ts';
import { MoveWitness } from '../net/witness.ts';
import { Act } from '../game/state.ts';
import { FORK_Z, LEVEL, TILE, WALL, heightUnder, levelAt } from './map.ts';
import { RISE, TREES, perchUnder, standingOn, surfaceAt, treeHolding, type TreePlan } from './trees.ts';

const DT = 1 / 60;

/** A jump from (x, y, z) running at vx: where the cat comes down (as the game moves it). */
function leap(x: number, y: number, z: number, vx: number): { x: number; y: number; z: number } {
  const body = { x, y, z, airborne: true };
  let vz = JUMP_V;
  for (let i = 0; i < 240; i++) {
    step(body, vx * DT, 0);
    const ground = surfaceAt(body.x, body.y, body.z);
    vz -= GRAVITY * DT;
    body.z += vz * DT;
    if (body.z <= ground && vz <= 0) return { ...body, z: ground };
  }
  return body;
}

/** The perches of tree t a cat can reach by jumping about, starting on the ground in front of it. */
function climbable(t: TreePlan): Set<number> {
  const reached = new Set<number>();
  const starts: { x: number; z: number }[] = [];
  for (let dx = -20; dx <= 20; dx += 4) starts.push({ x: t.x + dx, z: surfaceAt(t.x + dx, t.y + 7, 0) });
  const seen = new Set<string>();
  while (starts.length) {
    const s = starts.pop()!;
    for (const vx of [0, -WALK_SPEED, WALK_SPEED, -DASH_SPEED, DASH_SPEED]) {
      const y = s.z > t.elev + 1 ? t.y : t.y + 7;
      const end = leap(s.x, y, s.z, vx);
      const p = standingOn(end.x, end.y, end.z);
      if (!p || p.tree !== TREES.indexOf(t)) continue;
      const i = TREES[p.tree].perches.findIndex((q) => t.elev + q.z === p.z && t.x + q.x0 === p.x0);
      reached.add(i);
      // from there, try again from along the whole perch
      for (let x = p.x0 - 2; x <= p.x1 + 2; x += 4) {
        const k = `${x},${p.z}`;
        if (!seen.has(k)) { seen.add(k); starts.push({ x, z: p.z }); }
      }
    }
  }
  return reached;
}

describe('trees', () => {
  it('has broadleaves, pines and the tree house', () => {
    const shapes = new Set(TREES.map((t) => t.shape));
    expect([...shapes].sort()).toEqual(['broadleaf', 'pine', 'treehouse']);
    expect(TREES.filter((t) => t.birdhouse).length).toBeGreaterThan(2);
  });

  it('keeps every step up a tree within a jump', () => {
    for (const t of TREES) {
      const zs = [...new Set(t.perches.map((p) => p.z))].sort((a, b) => a - b);
      expect(zs[0]).toBe(FORK_Z);
      for (let i = 1; i < zs.length; i++) expect(zs[i] - zs[i - 1]).toBeLessThanOrEqual(RISE);
      // the lowest perch spans the trunk, so nothing ends up standing on it
      expect(t.perches[0].x0).toBeLessThanOrEqual(-8);
      expect(t.perches[0].x1).toBeGreaterThanOrEqual(8);
    }
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
      expect(reached.size, `every perch of the ${t.shape} at ${t.tx},${t.ty}`).toBe(t.perches.length);
    }
  }, 60000);

  it('blocks at the trunk on the ground, but not up on the fork', () => {
    const t = TREES[0];
    const feet = [t.x - 5, t.y - 5, t.x + 5, t.y] as const;
    expect(heightUnder(...feet)).toBe(WALL);
    expect(heightUnder(...feet, t.elev + FORK_Z)).toBeLessThan(WALL);
    expect(surfaceAt(t.x, t.y, t.elev + FORK_Z)).toBe(t.elev + FORK_Z);
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
    // standing on the ground in front of the trunk, the first tier is out of the way
    expect(perchUnder(t.x, t.y + 6, t.elev)).toBeNull();
    const up = leap(t.x, t.y + 6, t.elev, 0);
    expect(up.z).toBe(t.elev + FORK_Z);
    expect(treeHolding(up.x, up.y, up.z)).toBe(TREES.indexOf(t));
    // and dropping through it (perches below `under` only) comes down to the ground
    expect(surfaceAt(t.x, t.y, t.elev + FORK_Z, t.elev + FORK_Z)).toBe(t.elev);
  });

  it("doesn't count a cat walking on a plateau beside a tree down below as up that tree", () => {
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
    expect(w.observe(t.x, t.y + 6, 0, Act.Idle, 0)).toBeNull();
    expect(w.observe(t.x, t.y + 4, 12, Act.Jump, 200)).toBeNull();
    expect(w.observe(t.x, t.y, FORK_Z, Act.Idle, 400)).toBeNull();
    // but hanging in the air beside the tree is
    expect(w.observe(t.x + 40, t.y, FORK_Z, Act.Idle, 600)).toBe('floating');
  });
});


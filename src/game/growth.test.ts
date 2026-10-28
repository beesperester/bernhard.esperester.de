import { describe, expect, it } from 'vitest';
import { GROWN_AT, STAGE_JUMP, Stage, YOUNG_AT, canCatch, canLure, canPounce, canShake, nextAt, stageOf } from './growth.ts';
import { Prey } from './state.ts';
import { JUMP_HEIGHT } from './movement.ts';
import { FORK_Z } from '../world/map.ts';
import { LEGEND } from '../world/legend.ts';

describe('growing up', () => {
  it('goes kitten, young, grown', () => {
    expect(stageOf(0)).toBe(Stage.Kitten);
    expect(stageOf(YOUNG_AT - 1)).toBe(Stage.Kitten);
    expect(stageOf(YOUNG_AT)).toBe(Stage.Young);
    expect(stageOf(GROWN_AT)).toBe(Stage.Grown);
    expect(nextAt(Stage.Kitten)).toBe(YOUNG_AT);
    expect(nextAt(Stage.Grown)).toBeNull();
  });

  it("keeps a kitten off the rocks and out of the trees, but not a young cat", () => {
    expect(STAGE_JUMP[Stage.Kitten]).toBeLessThan(LEGEND.r.height!);
    expect(Math.min(JUMP_HEIGHT, STAGE_JUMP[Stage.Young])).toBeGreaterThan(FORK_Z);
  });

  it('gives a kitten only small things, and the tricks to a grown cat', () => {
    for (const k of [Prey.Beetle, Prey.Fly, Prey.Dragonfly, Prey.Firefly, Prey.Find]) expect(canCatch(Stage.Kitten, k)).toBe(true);
    for (const k of [Prey.Fish, Prey.Bird, Prey.Mouse, Prey.Frog, Prey.Squirrel, Prey.Bat]) expect(canCatch(Stage.Kitten, k)).toBe(false);
    expect(canCatch(Stage.Young, Prey.Bird)).toBe(true);
    expect(canCatch(Stage.Young, Prey.Bird, true)).toBe(false);
    expect(canCatch(Stage.Young, Prey.Bat, true)).toBe(false);
    expect(canCatch(Stage.Grown, Prey.Bat, true)).toBe(true);
    for (const can of [canPounce, canLure, canShake]) {
      expect(can(Stage.Young)).toBe(false);
      expect(can(Stage.Grown)).toBe(true);
    }
  });
});

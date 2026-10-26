import { describe, expect, it } from 'vitest';
import { Act, Facing, Prey, frameFor, preyPoints, SWIPE_AT_MS } from './state.ts';

describe('preyPoints', () => {
  it('scores every kind of prey, bigger prey more', () => {
    for (const kind of Object.values(Prey)) expect(typeof preyPoints(kind)).toBe('number');
    expect(preyPoints(Prey.Bee)).toBeLessThan(0);
    expect(preyPoints(Prey.Fly)).toBeLessThan(preyPoints(Prey.Dragonfly));
    expect(preyPoints(Prey.Dragonfly)).toBeLessThan(preyPoints(Prey.Fish));
    expect(preyPoints(Prey.Fish)).toBeLessThan(preyPoints(Prey.Bird));
    expect(preyPoints(Prey.Bird, 3)).toBeGreaterThan(preyPoints(Prey.Bird, 0));
  });
});

describe('frameFor', () => {
  it('mirrors side frames when facing right', () => {
    expect(frameFor(Act.Idle, Facing.Right, 0, 0)).not.toBe(frameFor(Act.Idle, Facing.Left, 0, 0));
  });

  it('animates walking, faster when dashing', () => {
    const frames = new Set([0, 125, 250, 375].map((t) => frameFor(Act.Walk, Facing.Down, 0, t)));
    expect(frames.size).toBeGreaterThan(1);
    expect(frameFor(Act.Walk, Facing.Down, 0, 60, true)).not.toBe(frameFor(Act.Walk, Facing.Down, 0, 60, false));
  });

  it('lands the swipe at SWIPE_AT_MS', () => {
    expect(frameFor(Act.Catch, Facing.Left, SWIPE_AT_MS - 1, 0)).not.toBe(frameFor(Act.Catch, Facing.Left, SWIPE_AT_MS, 0));
  });

  it('has a frame for every act and facing', () => {
    for (const act of Object.values(Act))
      for (const facing of Object.values(Facing)) expect(Number.isInteger(frameFor(act, facing, 100, 100))).toBe(true);
  });
});

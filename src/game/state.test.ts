import { describe, expect, it } from 'vitest';
import { Act, Facing, frameFor, SWIPE_AT_MS } from './state.ts';

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

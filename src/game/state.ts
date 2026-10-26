import { frameIndex, type FrameName } from '../art/cat.ts';

export const Facing = { Down: 0, Up: 1, Left: 2, Right: 3 } as const;
export type Facing = (typeof Facing)[keyof typeof Facing];
export const Act = { Idle: 0, Walk: 1, Sit: 2, Lick: 3, Jump: 4, Hiss: 5, Roll: 6 } as const;
export type Act = (typeof Act)[keyof typeof Act];

/** Jump velocity and gravity in px/s: a jump peaks at ~14px, enough to clear a hedge. */
export const JUMP_V = 130;
export const GRAVITY = 600;
export const HISS_MS = 1400;
export const ROLL_MS = 2400;
export const LICK_MS = 1600;
export const SIT_AFTER_MS = 5000;

/** Everything other visitors need to draw a cat: [x, y, z, facing, act, seq, coat]. */
export type CatMsg = [number, number, number, number, number, number, number];

const cycle = <T>(frames: T[], fps: number, ms: number): T => frames[Math.floor((ms / 1000) * fps) % frames.length];

const DIR: Record<number, 'down' | 'up' | 'side'> = { 0: 'down', 1: 'up', 2: 'side', 3: 'side' };

/** Pick the sprite-sheet frame for a cat's state. `ms` is time since the act started. */
export function frameFor(act: Act, facing: Facing, ms: number, now: number): number {
  const d = DIR[facing];
  const flip = facing === Facing.Right;
  let name: FrameName;
  switch (act) {
    case Act.Walk:
      name = cycle([`${d}Walk1`, `${d}Stand`, `${d}Walk2`, `${d}Stand`] as FrameName[], 8, now);
      break;
    case Act.Jump:
      name = `${d}Walk1` as FrameName;
      break;
    case Act.Sit:
      name = d === 'side' ? 'sitSide' : 'sitDown';
      break;
    case Act.Lick:
      name = d === 'side' ? cycle(['lickSide1', 'lickSide2'], 4, ms) : cycle(['lickDown1', 'lickDown2'], 4, ms);
      break;
    case Act.Hiss:
      name = cycle(['hiss1', 'hiss2'], 6, ms);
      break;
    case Act.Roll:
      name = cycle(['roll1', 'roll2', 'roll1', 'roll3'], 6, ms);
      break;
    default:
      name = `${d}Stand` as FrameName;
  }
  return frameIndex(name, flip);
}

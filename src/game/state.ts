import { frameIndex, type FrameName } from '../art/cat.ts';

export const Facing = { Down: 0, Up: 1, Left: 2, Right: 3 } as const;
export type Facing = (typeof Facing)[keyof typeof Facing];
export const Act = { Idle: 0, Walk: 1, Sit: 2, Lick: 3, Jump: 4, Hiss: 5, Roll: 6, Sleep: 7, Catch: 8, Eat: 9, Munch: 10, Crouch: 11, Sneak: 12, Feast: 13 } as const;
export const ACT_MAX = 13;
export type Act = (typeof Act)[keyof typeof Act];

/** Jump velocity and gravity in px/s: a jump peaks at ~14px, enough to clear a hedge. */
export const JUMP_V = 130;
export const GRAVITY = 600;
export const HISS_MS = 1400;
export const ROLL_MS = 2400;
export const LICK_MS = 1600;
export const SIT_AFTER_MS = 5000;
export const SLEEP_AFTER_MS = 30000;
export const CATCH_MS = 450;
/** When during the catch the paw hits the water. */
export const SWIPE_AT_MS = 180;
export const EAT_MS = 2600;
/** Gulping down a butterfly is quicker than a fish. */
export const MUNCH_MS = 1500;

/** Things a cat can swipe at. */
export const Prey = { Fish: 0, Fly: 1, Bee: 2, Bird: 3, Firefly: 4, Frog: 5 } as const;
export type Prey = (typeof Prey)[keyof typeof Prey];

/** Everything other visitors need to draw a cat: [x, y, z, facing, act, seq, coat]. */
export type CatMsg = [number, number, number, number, number, number, number];

const cycle = <T>(frames: T[], fps: number, ms: number): T => frames[Math.floor((ms / 1000) * fps) % frames.length];

const DIR: Record<number, 'down' | 'up' | 'side'> = { 0: 'down', 1: 'up', 2: 'side', 3: 'side' };

/** Pick the sprite-sheet frame for a cat's state. `ms` is time since the act started. */
export function frameFor(act: Act, facing: Facing, ms: number, now: number, fast = false): number {
  let d = DIR[facing];
  const flip = facing === Facing.Right;
  // catching and eating only exist side-on
  if (act === Act.Catch || act === Act.Eat || act === Act.Munch || act === Act.Feast) d = 'side';
  let name: FrameName;
  switch (act) {
    case Act.Walk:
      name = cycle([`${d}Walk1`, `${d}Stand`, `${d}Walk2`, `${d}Stand`] as FrameName[], fast ? 18 : 8, now);
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
    case Act.Sleep:
      name = cycle(['sleep1', 'sleep2'], 0.8, ms);
      break;
    case Act.Catch:
      name = ms < SWIPE_AT_MS ? 'catch1' : 'catch2';
      break;
    case Act.Crouch:
      name = `${d}Crouch` as FrameName;
      break;
    case Act.Sneak:
      // slow, deliberate paw steps
      name = cycle([`${d}Sneak1`, `${d}Crouch`, `${d}Sneak2`, `${d}Crouch`] as FrameName[], 5, now);
      break;
    case Act.Eat:
    case Act.Feast:
      name = ms < EAT_MS - 600 ? cycle(['sitSide', 'chew'], 4, ms) : 'sitSide';
      break;
    case Act.Munch:
      name = ms < MUNCH_MS - 500 ? cycle(['sitSide', 'chew'], 6, ms) : 'sitSide';
      break;
    default:
      name = `${d}Stand` as FrameName;
  }
  return frameIndex(name, flip);
}

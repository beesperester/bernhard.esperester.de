import { frameIndex, type FrameName } from '../art/cat.ts';

export const Facing = { Down: 0, Up: 1, Left: 2, Right: 3 } as const;
export type Facing = (typeof Facing)[keyof typeof Facing];
export const Act = { Idle: 0, Walk: 1, Sit: 2, Lick: 3, Jump: 4, Hiss: 5, Roll: 6, Sleep: 7, Catch: 8, Eat: 9, Munch: 10, Crouch: 11, Sneak: 12, Feast: 13, Mew: 14 } as const;
export const ACT_MAX = 14;
export type Act = (typeof Act)[keyof typeof Act];

/** Jump velocity and gravity in px/s: a jump peaks at ~14px, enough to clear a hedge. */
export const JUMP_V = 130;
export const GRAVITY = 600;
export const HISS_MS = 1400;
export const ROLL_MS = 2400;
export const LICK_MS = 1600;
export const MEW_MS = 900;
export const SIT_AFTER_MS = 5000;
export const SLEEP_AFTER_MS = 30000;
export const CATCH_MS = 450;
/** When during the catch the paw hits the water. */
export const SWIPE_AT_MS = 180;
export const EAT_MS = 2600;
/** Gulping down a butterfly is quicker than a fish. */
export const MUNCH_MS = 1500;

/** Where a swiping paw comes down, for a cat with its feet at (x, y): beside it, in front, or ahead up the screen. */
export function pawAt(x: number, y: number, facing: Facing): [number, number] {
  switch (facing) {
    case Facing.Left: return [x - 11, y - 3];
    case Facing.Right: return [x + 11, y - 3];
    case Facing.Down: return [x, y + 4];
    default: return [x, y - 10];
  }
}

/** Things a cat can swipe at. */
export const Prey = { Fish: 0, Fly: 1, Bee: 2, Bird: 3, Firefly: 4, Frog: 5, Beetle: 6, Dragonfly: 7, Bat: 8, Mouse: 9, Squirrel: 10, Find: 11 } as const;
export type Prey = (typeof Prey)[keyof typeof Prey];

/**
 * Everything other visitors need to draw a cat: [x, y, z, facing, act, seq, coat, mews].
 * `mews` counts the cat's mews: it can mew whatever it's doing, so a mew isn't an act.
 */
/** [x, y, z, facing, act, seq, coat, mews, stage (growth.ts), what it carries (world/thingKinds.ts' carriedCode)] */
export type CatMsg = [number, number, number, number, number, number, number, number, number, number];

const cycle = <T>(frames: T[], fps: number, ms: number): T => frames[Math.floor((ms / 1000) * fps) % frames.length];

const DIR: Record<number, 'down' | 'up' | 'side'> = { 0: 'down', 1: 'up', 2: 'side', 3: 'side' };

/** Pick the sprite-sheet frame for a cat's state. `ms` is time since the act started. */
export function frameFor(act: Act, facing: Facing, ms: number, now: number, fast = false): number {
  let d = DIR[facing];
  const flip = facing === Facing.Right;
  // a cat facing away turns round to eat, like it does to sit
  if ((act === Act.Eat || act === Act.Munch || act === Act.Feast) && d === 'up') d = 'down';
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
      name = d === 'side' ? cycle(['hiss1', 'hiss2'], 6, ms) : d === 'down' ? cycle(['hissDown1', 'hissDown2'], 6, ms) : cycle(['hissUp1', 'hissUp2'], 6, ms);
      break;
    case Act.Mew:
      // sits up and calls out
      name = d === 'side' ? 'sitSide' : 'sitDown';
      break;
    case Act.Roll:
      name = cycle(['roll1', 'roll2', 'roll1', 'roll3'], 6, ms);
      break;
    case Act.Sleep:
      name = cycle(['sleep1', 'sleep2'], 0.8, ms);
      break;
    case Act.Catch: {
      const swiped = ms >= SWIPE_AT_MS;
      name = d === 'side' ? (swiped ? 'catch2' : 'catch1') : d === 'down' ? (swiped ? 'catchDown2' : 'catchDown1') : swiped ? 'catchUp2' : 'catchUp1';
      break;
    }
    case Act.Crouch:
      name = `${d}Crouch` as FrameName;
      break;
    case Act.Sneak:
      // slow, deliberate paw steps
      name = cycle([`${d}Sneak1`, `${d}Crouch`, `${d}Sneak2`, `${d}Crouch`] as FrameName[], 5, now);
      break;
    case Act.Eat:
    case Act.Feast:
    case Act.Munch: {
      const sit = d === 'side' ? 'sitSide' : 'sitDown', chew = d === 'side' ? 'chew' : 'chewDown';
      const munch = act === Act.Munch;
      name = ms < (munch ? MUNCH_MS - 500 : EAT_MS - 600) ? cycle([sit, chew], munch ? 6 : 4, ms) : sit;
      break;
    }
    default:
      name = `${d}Stand` as FrameName;
  }
  return frameIndex(name, flip);
}

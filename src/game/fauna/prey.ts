import { Act, Prey } from '../state.ts';
import { FOOD_POINTS, type Food } from '../../world/food.ts';

// Everything about a kind of prey that doesn't depend on how it moves: what
// it is worth, what a cat does with it, and how it looks on its way into the
// cat's mouth. A new kind of prey needs an entry here (and a number in Prey,
// state.ts, which is what goes over the network).

export interface PreyInfo {
  name: string;
  /** Scoreboard points (`colour` is the variety: a blackbird beats a sparrow). Bees count against you. */
  points: (colour: number) => number;
  /** What the cat does once it has it. */
  eat: Act;
  /** Fish must be fished for: no pouncing, no catching mid-jump. */
  swipeOnly?: boolean;
  /** Texture held in the mouth while feasting on it. */
  held?: (colour: number) => string;
  /** The picture that flies into the cat's mouth, and how long that takes. Without one it isn't carried off. */
  leap?: { texture: (colour: number) => string; frame: number; seconds: number; centred?: boolean };
}

const fixed = (n: number) => () => n;

export const PREY: Record<Prey, PreyInfo> = {
  [Prey.Fish]: { name: 'fish', points: fixed(3), eat: Act.Eat, swipeOnly: true, leap: { texture: () => 'fish', frame: 0, seconds: 0.3, centred: true } },
  [Prey.Fly]: { name: 'butterfly', points: fixed(1), eat: Act.Munch, leap: { texture: (c) => `butterfly-${c}`, frame: 1, seconds: 0.18 } },
  // ouch, it stung
  [Prey.Bee]: { name: 'bee', points: fixed(-1), eat: Act.Hiss },
  [Prey.Bird]: {
    name: 'bird', points: (c) => (c === 3 ? 5 : 4), eat: Act.Feast, held: (c) => `held-bird-${c}`,
    leap: { texture: (c) => `bird-${c}`, frame: 2, seconds: 0.18 },
  },
  [Prey.Firefly]: { name: 'firefly', points: fixed(1), eat: Act.Munch },
  [Prey.Frog]: { name: 'frog', points: fixed(3), eat: Act.Feast, held: () => 'held-frog', leap: { texture: () => 'frog', frame: 0, seconds: 0.18 } },
  [Prey.Beetle]: { name: 'beetle', points: fixed(1), eat: Act.Munch, leap: { texture: (c) => `beetle-${c}`, frame: 0, seconds: 0.18 } },
  [Prey.Dragonfly]: { name: 'dragonfly', points: fixed(2), eat: Act.Munch, leap: { texture: () => 'dragonfly', frame: 1, seconds: 0.18 } },
  [Prey.Bat]: { name: 'bat', points: fixed(4), eat: Act.Feast, held: () => 'held-bat', leap: { texture: () => 'bat', frame: 1, seconds: 0.18 } },
  [Prey.Squirrel]: { name: 'squirrel', points: fixed(4), eat: Act.Feast, held: () => 'held-squirrel', leap: { texture: () => 'squirrel', frame: 1, seconds: 0.18 } },
  // something found (world/finds.ts): `colour` is what it is; it has to be pawed out of its basket, bucket or nest
  [Prey.Find]: { name: 'find', points: (c) => FOOD_POINTS[c as Food] ?? 0, eat: Act.Feast, swipeOnly: true, held: (c) => `held-food-${c}` },
  [Prey.Mouse]: { name: 'mouse', points: fixed(3), eat: Act.Feast, held: () => 'held-mouse', leap: { texture: () => 'mouse', frame: 1, seconds: 0.18 } },
};

/** What a catch is worth on the scoreboard: the bigger the prey, the more. */
export const preyPoints = (kind: Prey, colour = 0): number => PREY[kind].points(colour);

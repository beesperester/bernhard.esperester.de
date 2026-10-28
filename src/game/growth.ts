import { Prey } from './state.ts';

// Growing up. A cat new to the garden is a kitten: small, all head, a little hop
// for a jump, a short dash that ends in a tumble, and too small for anything
// but bugs, butterflies and the food lying about. Eating its way to YOUNG_AT
// points it grows bigger (and gets to choose its name): now it
// can jump up onto rocks and into the trees, and catch mice, frogs, fish and
// birds that sit still. At GROWN_AT it is fully grown and can do it all:
// pounce, lure fish over with a splash, paw at a tree to shake things down,
// and snatch birds and bats out of the air.
//
// How grown a cat is goes by the most its chain of catches ever added up to
// (net/ledger.ts): it goes with the cat (its key, in this browser or on its
// collar tag), not with a garden, and a bee sting doesn't make it smaller.

export const Stage = { Kitten: 0, Young: 1, Grown: 2 } as const;
export type Stage = (typeof Stage)[keyof typeof Stage];

/** Points eaten (all gardens together) to reach each stage. */
export const YOUNG_AT = 100, GROWN_AT = 500;
/** How big it is (art/kitten.ts draws the smaller ones), as a share of a grown cat. */
export const STAGE_SIZE: Record<Stage, number> = { [Stage.Kitten]: 10 / 14, [Stage.Young]: 12 / 14, [Stage.Grown]: 1 };
/** How high a jump gets (px): a kitten's is a hop, not enough for a rock; from young on it reaches the first branch. */
export const STAGE_JUMP: Record<Stage, number> = { [Stage.Kitten]: 4.5, [Stage.Young]: Infinity, [Stage.Grown]: Infinity };
/** Longest dash (ms); a kitten's ends in a tumble if it runs out. */
export const KITTEN_DASH_MS = 900;

export const STAGE_NAMES: Record<Stage, string> = { [Stage.Kitten]: 'kitten', [Stage.Young]: 'young cat', [Stage.Grown]: 'grown cat' };

export function stageOf(points: number): Stage {
  return points >= GROWN_AT ? Stage.Grown : points >= YOUNG_AT ? Stage.Young : Stage.Kitten;
}

/** Points to the next stage, or null when fully grown. */
export function nextAt(stage: Stage): number | null {
  return stage === Stage.Kitten ? YOUNG_AT : stage === Stage.Young ? GROWN_AT : null;
}

/** Small enough for a kitten. */
const KITTEN_PREY = new Set<Prey>([Prey.Fly, Prey.Bee, Prey.Firefly, Prey.Beetle, Prey.Dragonfly, Prey.Find]);

/** Can a cat this grown catch this (`air`: on the wing, snatched mid-jump)? */
export function canCatch(stage: Stage, kind: Prey, air = false): boolean {
  if (stage === Stage.Kitten) return KITTEN_PREY.has(kind);
  if (stage === Stage.Young) return !(air && (kind === Prey.Bird || kind === Prey.Bat));
  return true;
}

/** Only a grown cat pounces, lures fish and shakes trees. */
export const canPounce = (stage: Stage): boolean => stage === Stage.Grown;
export const canLure = (stage: Stage): boolean => stage === Stage.Grown;
export const canShake = (stage: Stage): boolean => stage === Stage.Grown;

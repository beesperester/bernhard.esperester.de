// The kinds of things a cat can carry, and their ids (world/things.ts has the rest): kept apart, with
// nothing to load, as the net checks them before there is a garden.

import { BIRD_COLOURS } from '../art/critters.ts';

/** The meadow's flower colours (art/flora.ts' PETALS). */
export const PETAL_COUNT = 6;

export const Thing = { Feather: 0, Leaf: 1, Twig: 2, Cone: 3, Flower: 4 } as const;
export type ThingKind = (typeof Thing)[keyof typeof Thing];

/** How many of each kind there are to draw: a feather in each bird's colours; autumn's leaf colours and a green one; three twigs; a cone; a flower in each colour. */
export const LEAF_GREEN = 5;
export const VARIANTS: Record<ThingKind, number> = {
  [Thing.Feather]: BIRD_COLOURS.length, [Thing.Leaf]: LEAF_GREEN + 1, [Thing.Twig]: 3, [Thing.Cone]: 1, [Thing.Flower]: PETAL_COUNT,
};
export const KINDS = Object.keys(VARIANTS).length;

/** Ids: the park's own things (place and round), the meadow's flowers (by plant), and things cats have put down (anything below). */
export const SCATTER_BASE = 2 ** 50, PLANT_BASE = 2 ** 51, MAX_ID = 2 ** 52;
export const scatterId = (slot: number, round: number) => SCATTER_BASE + slot * 2 ** 21 + round;
export const plantId = (plant: number) => PLANT_BASE + plant;
/** A new id for a thing put down (any number under SCATTER_BASE: two cats picking the same one is as good as never). */
export const newId = () => 1 + Math.floor(Math.random() * (SCATTER_BASE - 2));

/** What a cat carries, as one number in its state: 0 nothing, else 1 + kind * 64 + variant. */
export const carriedCode = (c: { kind: ThingKind; v: number } | null): number => (c ? 1 + c.kind * 64 + c.v : 0);
/** ...and back (null for nothing, or for something there's no such thing as). */
export function carriedOf(code: number): { kind: ThingKind; v: number } | null {
  if (!Number.isInteger(code) || code <= 0) return null;
  const kind = Math.floor((code - 1) / 64), v = (code - 1) % 64;
  return kind < KINDS && v < VARIANTS[kind as ThingKind] ? { kind: kind as ThingKind, v } : null;
}

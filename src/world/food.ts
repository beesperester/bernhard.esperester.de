// The food a cat can find about the garden (finds.ts), and what each is worth.
// (Apart from finds.ts, which needs the map: the scoreboard needs this before there is one.)

/** What there is to find (it's the `colour` of the prey: what it's worth, and how it looks). */
export const Food = {
  Sausage: 0, Cheese: 1, Sandwich: 2,
  Pretzel: 3, Currywurst: 4, IceCream: 5,
  Fish: 6,
  Eggs: 7, TreeEggs: 8,
} as const;
export type Food = (typeof Food)[keyof typeof Food];

/** Points for each kind of food: more than any prey (a blackbird is 5). */
export const FOOD_POINTS: Record<Food, number> = {
  [Food.Sausage]: 8, [Food.Cheese]: 7, [Food.Sandwich]: 7,
  [Food.Pretzel]: 6, [Food.Currywurst]: 8, [Food.IceCream]: 6,
  [Food.Fish]: 8,
  [Food.Eggs]: 9, [Food.TreeEggs]: 12,
};

export const FOOD_NAMES: Record<Food, string> = {
  [Food.Sausage]: 'a sausage', [Food.Cheese]: 'some cheese', [Food.Sandwich]: 'a sandwich',
  [Food.Pretzel]: 'a pretzel', [Food.Currywurst]: 'a currywurst', [Food.IceCream]: 'an ice cream',
  [Food.Fish]: "an angler's fish",
  [Food.Eggs]: 'a nest of eggs', [Food.TreeEggs]: 'a nest of eggs',
};

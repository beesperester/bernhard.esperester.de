import { Bees } from './Bees.ts';
import { Birds } from './Birds.ts';
import { Bugs } from './Bugs.ts';
import { Butterflies } from './Butterflies.ts';
import { Fish } from './Fish.ts';
import { Mice } from './Mice.ts';
import { NightFlyers } from './NightFlyers.ts';
import { NightLife } from './NightLife.ts';
import type { Fauna, FaunaContext } from './kit.ts';

// Every kind of animal in the garden. To add one, write a Fauna (see kit.ts)
// and list it here; Ambient builds and updates them in this order, which is
// also the order their prey is offered to a swiping cat.
//
// All fauna is a deterministic function of the shared garden clock and fixed
// seeds, so every visitor sees the same animals without anything being sent.
// Only catches travel over the network; everything else (an animal startled
// by a cat) follows from cat states that are synced anyway.

export const FAUNA: ((ctx: FaunaContext) => Fauna)[] = [
  (ctx) => new Fish(ctx),
  (ctx) => new Bees(ctx),
  (ctx) => new Butterflies(ctx),
  (ctx) => new Birds(ctx),
  (ctx) => new NightLife(ctx),
  (ctx) => new NightFlyers(ctx),
  (ctx) => new Bugs(ctx),
  (ctx) => new Mice(ctx),
];

export { Birds };
export type { Fauna, FaunaContext, FaunaFrame, PreyRef } from './kit.ts';

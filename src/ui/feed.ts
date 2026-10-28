// The snack log, bottom left: a line for every snack a cat in the garden
// eats ("Big Pickles feasted on a currywurst"), ours and everyone else's,
// fading away after a few seconds like the chat in a block-building game.

import { Prey } from '../game/state.ts';
import { FOOD_NAMES, type Food } from '../world/food.ts';

/** What it was, as said in a sentence (`colour` is the variety: which bird, which food). */
export function snackName(kind: Prey, colour: number): string {
  switch (kind) {
    case Prey.Fish: return 'a fish';
    case Prey.Fly: return 'a butterfly';
    case Prey.Bee: return 'a bee';
    case Prey.Bird: return ['a sparrow', 'a robin', 'a blue tit', 'a blackbird'][colour] ?? 'a bird';
    case Prey.Firefly: return 'a firefly';
    case Prey.Frog: return 'a frog';
    case Prey.Beetle: return 'a beetle';
    case Prey.Dragonfly: return 'a dragonfly';
    case Prey.Bat: return 'a bat';
    case Prey.Mouse: return 'a mouse';
    case Prey.Squirrel: return 'a squirrel';
    case Prey.Find: return FOOD_NAMES[colour as Food] ?? 'something tasty';
  }
}

const FEAST = ['{cat} feasted on {food}', '{cat} gobbled up {food}', '{cat} made short work of {food}', '{cat} enjoyed {food}. Delicious!'];
const BUGS = ['{cat} snapped up {food}', '{cat} crunched {food}', '{cat} had {food} as a little snack', '{cat} caught {food} mid-air'];
const LINES: Record<Prey, string[]> = {
  [Prey.Fish]: ['{cat} fished out {food}', '{cat} hooked {food} with one paw', ...FEAST],
  [Prey.Fly]: BUGS,
  [Prey.Bee]: ['{cat} tried to eat {food}. Ouch!', '{cat} got stung by {food}', '{cat} learned that bees bite back'],
  [Prey.Bird]: ['{cat} pounced on {food}', '{cat} caught {food}. Feathers everywhere!', ...FEAST],
  [Prey.Firefly]: ['{cat} snapped up {food}. Glowing from the inside!', ...BUGS],
  [Prey.Frog]: ['{cat} caught {food}. Ribbit no more!', ...FEAST],
  [Prey.Beetle]: BUGS,
  [Prey.Dragonfly]: BUGS,
  [Prey.Bat]: ['{cat} caught {food} in the dark', ...FEAST],
  [Prey.Mouse]: ['{cat} caught {food}. Squeak!', ...FEAST],
  [Prey.Squirrel]: ['{cat} outran {food}', ...FEAST],
  [Prey.Find]: ['{cat} found {food} and ate it all', '{cat} pinched {food}', ...FEAST],
};

/** A line about a cat eating something: `pick` (0..1) chooses which of the ways to say it. */
export function snackLine(kind: Prey, colour: number, pick: number): string {
  const lines = LINES[kind];
  return lines[Math.min(lines.length - 1, Math.floor(pick * lines.length))].replace('{food}', snackName(kind, colour));
}

/** How many lines show at once, and how long each stays (ms). */
const MAX_LINES = 5, SHOW_MS = 7000;

/** Add a line to the log: who ate what. */
export function logSnack(cat: string, kind: Prey, colour: number, ours: boolean): void {
  const feed = document.getElementById('feed');
  if (!feed) return;
  const line = document.createElement('p');
  if (ours) line.className = 'ours';
  // (the name as text: names come from other cats)
  const [before, after] = snackLine(kind, colour, Math.random()).split('{cat}');
  const name = document.createElement('b');
  name.textContent = cat;
  line.append(before, name, after);
  feed.append(line);
  while (feed.children.length > MAX_LINES) feed.firstElementChild!.remove();
  setTimeout(() => {
    line.classList.add('gone');
    setTimeout(() => line.remove(), 600);
  }, SHOW_MS);
}

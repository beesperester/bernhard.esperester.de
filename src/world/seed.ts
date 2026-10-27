// The seed the garden grows from (layout.ts). The first cat into an empty
// garden plants one; every cat that joins is handed it (net.ts), so they all
// lay out the same garden. It has to be known before anything asks about the
// map: main.ts waits for it, then loads the game.

/** A garden's seed, and when it was planted (ms since epoch): of two gardens that meet, the older one stays. */
export interface WorldSeed {
  seed: number;
  born: number;
}

let planted: WorldSeed | null = null;

/** A new garden's seed. */
export const newSeed = (): WorldSeed => ({ seed: crypto.getRandomValues(new Uint32Array(1))[0], born: Date.now() });

/** Of two gardens, the one that stays: the older, or (planted the same moment) the lower seed. */
export const older = (a: WorldSeed, b: WorldSeed): WorldSeed => (a.born !== b.born ? (a.born < b.born ? a : b) : a.seed <= b.seed ? a : b);

export function plant(s: WorldSeed): void {
  if (planted) throw new Error('the garden is already laid out');
  planted = s;
}

/** The seed this garden grew from (in tests, a fixed one). */
export function worldSeed(): WorldSeed {
  if (planted) return planted;
  if (import.meta.env?.MODE === 'test') return (planted = { seed: 1, born: 0 });
  throw new Error('the garden has no seed yet');
}

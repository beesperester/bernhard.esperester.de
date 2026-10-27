// What each character of the park map (garden.ts) stands for. Everything that
// asks "what is on this tile?" goes through here, so a new kind of tile is one
// new entry: give it a character, say how tall it stands and what sort of
// ground it is, and draw it in art/tiles.ts (GROUND_ART).

/** Height that nothing gets over (fences, the gate, tree trunks, the shed). */
export const WALL = 99;

/** What sort of ground a tile is, for animals, flora and footsteps. */
export type Ground = 'lawn' | 'tall' | 'flowers' | 'path';

export interface TileKind {
  /** What it is, for people reading the map. */
  name: string;
  /** Something standing on the tile, this many px above the terrain; WALL for impassable. */
  height?: number;
  /** Where that something leaves room at the tile's edges: [left, top, right, bottom] px. */
  inset?: [number, number, number, number];
  /** How tall it looks for sun shadows, if different from its height (a fence blocks completely but is short). */
  shadowHeight?: number;
  /** Ground you can walk and things can grow on. */
  ground?: Ground;
  /** Pond water ('open'), or water under a footbridge ('bridged'). */
  water?: 'open' | 'bridged';
  /** Cats, birds and paths treat it as a path (paths, the bridge, the gate). */
  path?: boolean;
  /** Stone stairs, climbing one terrain level towards the north. */
  stairs?: boolean;
  /** A tree's trunk stands here (its crown is drawn as a prop). */
  tree?: boolean;
  /** The thing spans this many tiles to the right (the fountain is two wide). */
  span?: number;
  /** Running water: a river or a canal. It flows (world/streams.ts) and never freezes. */
  running?: boolean;
  /** A lily pad floating on the pond (frogs sit on them). */
  lily?: boolean;
  /** Casts a soft round shadow at night (bushes and rocks drawn in the ground art). */
  nightBlob?: boolean;
}

export const LEGEND: Record<string, TileKind> = {
  F: { name: 'fence', height: WALL, shadowHeight: 14 },
  g: { name: 'gate', height: WALL, shadowHeight: 14, path: true },
  '.': { name: 'lawn', ground: 'lawn' },
  ',': { name: 'tall grass', ground: 'tall' },
  f: { name: 'flower bed', ground: 'flowers' },
  p: { name: 'path', ground: 'path', path: true },
  B: { name: 'footbridge', water: 'bridged', path: true },
  w: { name: 'water', water: 'open' },
  '~': { name: 'river', water: 'open', running: true },
  l: { name: 'lily pad', water: 'open', lily: true },
  '#': { name: 'low hedge', height: 8 },
  // taller than a jump, so the labyrinth can't be hopped over
  m: { name: 'maze hedge', height: 20 },
  T: { name: 'tree', tree: true },
  P: { name: 'pine', tree: true },
  H: { name: 'tree with a tree house', tree: true },
  b: { name: 'bush', height: 7, inset: [1, 2, 1, 1], nightBlob: true },
  r: { name: 'rock', height: 5, inset: [1, 4, 1, 2], nightBlob: true },
  o: { name: 'fountain', height: 6, inset: [0, 1, 0, 1], span: 2 },
  S: { name: 'stairs', stairs: true },
};

const kindOf = (ch: string): TileKind | undefined => LEGEND[ch];

/** Pond water, frozen or not (not the water under a bridge). */
export const isPond = (ch: string) => kindOf(ch)?.water === 'open';
/** Pond water with nothing on it (no lily pad). */
export const isOpenWater = (ch: string) => isPond(ch) && !kindOf(ch)?.lily;
/** A river or a canal (see TileKind.running). */
export const isRunning = (ch: string) => !!kindOf(ch)?.running;
export const isLilyPad = (ch: string) => !!kindOf(ch)?.lily;
export const isBridge = (ch: string) => kindOf(ch)?.water === 'bridged';
/** Any water, bridged or not: where reflections and ripples go. */
export const isWaterway = (ch: string) => kindOf(ch)?.water !== undefined;
/** Ground animals can walk about on: lawn, tall grass, flower beds and paths. */
export const isOpenGround = (ch: string) => kindOf(ch)?.ground !== undefined;
/** Lawn, tall grass or flower bed. */
export const isGrassy = (ch: string) => {
  const g = kindOf(ch)?.ground;
  return g === 'lawn' || g === 'tall' || g === 'flowers';
};
/** Lawn or tall grass (not flower beds or paths). */
export const isLawnOrTall = (ch: string) => {
  const g = kindOf(ch)?.ground;
  return g === 'lawn' || g === 'tall';
};
/** Tall grass or flowers: rustles underfoot, hides mice, fireflies drift over it. */
export const isMeadow = (ch: string) => {
  const g = kindOf(ch)?.ground;
  return g === 'tall' || g === 'flowers';
};
export const groundOf = (ch: string): Ground | undefined => kindOf(ch)?.ground;
export const isPath = (ch: string) => !!kindOf(ch)?.path;
export const isStairs = (ch: string) => !!kindOf(ch)?.stairs;
export const isTree = (ch: string) => !!kindOf(ch)?.tree;
/** Something standing up from the ground (bushes, rocks, hedges, fences, the gate, the fountain). */
export const isUpright = (ch: string) => (kindOf(ch)?.height ?? 0) > 0;
export const castsNightBlob = (ch: string) => !!kindOf(ch)?.nightBlob;

// The fixed part of this garden: the park's landscape, grown from the garden's
// seed by park.ts (water, paths and bridges, hills and stairs, the woods, the
// follies, the railway). What grows on its open ground is laid out on top of
// it by layout.ts.

import { generatePark } from './park.ts';
import { worldSeed } from './seed.ts';

export const { BASE, ELEV, ZONES, LANDMARK_SPOTS, RIVERS, TRACK, SPAWN } = generatePark(worldSeed().seed);

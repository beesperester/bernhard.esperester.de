// How big the park is. The same for every garden (only what grows on it
// differs), so this needs no seed and can be asked before the garden is laid out.
import { BASE } from './garden.ts';

export const TILE = 16;
export const MAP_W = BASE[0].length;
export const MAP_H = BASE.length;
export const WORLD_W = MAP_W * TILE;
export const WORLD_H = MAP_H * TILE;

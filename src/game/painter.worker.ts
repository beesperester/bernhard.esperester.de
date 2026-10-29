// The painter: draws the trees and the pieces of ground off the main thread,
// so a frame never waits for one (each takes a few ms to tens of ms). It lays
// out the same garden as the game (from the seed it is sent first), draws
// what it is asked for in the light it is told, and sends the pixels back
// (and the ground's normal map, for the GPU to shade it: art/painted.ts).
import { plant, type WorldSeed } from '../world/seed.ts';
import type { ScreenLight } from '../art/lighting.ts';

export type PaintRequest =
  | { kind: 'init'; seed: WorldSeed }
  | { kind: 'tree'; id: number; i: number; sun: ScreenLight }
  | { kind: 'ground'; id: number; tx0: number; ty0: number; tw: number; th: number; phases: number[]; sun: ScreenLight };

let art: Promise<[typeof import('../art/trees.ts'), typeof import('../art/tiles.ts'), typeof import('../art/lighting.ts'), typeof import('../art/painted.ts')]>;

self.onmessage = async (e: MessageEvent<PaintRequest>) => {
  const m = e.data;
  if (m.kind === 'init') {
    // (the world's modules lay the garden out as they load: only once it's planted)
    plant(m.seed);
    art = Promise.all([import('../art/trees.ts'), import('../art/tiles.ts'), import('../art/lighting.ts'), import('../art/painted.ts')]);
    return;
  }
  const [trees, tiles, { sunLight }, { ramps }] = await art;
  Object.assign(sunLight, m.sun);
  if (m.kind === 'tree') {
    const p = trees.buildProp(m.i);
    trees.relightProp(p, sunLight);
    const [parts, moved] = trees.propParts(m.i, p);
    postMessage({ id: m.id, parts }, { transfer: moved });
  } else {
    // (as the GPU draws it: its bushes and rocks name ramps by their rows here, which the game moves onto its own)
    const { layers, normal } = tiles.buildGroundMaps(m.tx0, m.ty0, m.tw, m.th, m.phases);
    postMessage({ id: m.id, layers: layers.map((r) => ({ w: r.w, h: r.h, data: r.data })), normal, ramps: ramps.rows },
      { transfer: [...layers.map((r) => r.data.buffer as ArrayBuffer), normal.buffer] });
  }
};

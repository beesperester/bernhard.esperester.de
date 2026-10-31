// The park's ground as files to paint over, as drawn from code in summer (the
// game dresses it for the other seasons itself: straw-coloured lawns, fallen
// leaves, snow, ice), in art/ground/:
//
//   lawn, tall-grass, flowers, path, water, hedge, maze-hedge
//       layer `fill`: a seamless texture the park is covered with, repeated
//       (lawn: also a hidden `tones`, its tones dark to light along the top row,
//       which the game shifts it along in broad patches; water: also `ripples`,
//       rocked a pixel to the right and back)
//   path-edges, water-edges, hedge-edges, maze-hedge-edges
//       layer `edges`: 16 pieces laid over the fill where it meets something
//       else, 4 x 4 tiles, piece m at column m % 4, row m >> 2, m the sides
//       that border: 1 north, 2 east, 4 south, 8 west (and, hidden, `under`:
//       the fill, to paint against)
//   bush, rock   layer `art`, one tile
//
// A file that's already there is left alone (it may be painted): a fresh one
// goes next to it as *.new.aseprite.
//
//   node tools/art-ground.ts [names e.g. lawn path-edges]
process.env.ART = 'off';
import { writeFileSync } from 'node:fs';
import { plant } from '../src/world/seed.ts';
import { placed, writeAseprite, type AseLayer } from './aseprite.ts';
import { fresh } from './art-common.ts';

plant({ seed: 8919, born: 0 });
const { Raster, hash2 } = await import('../src/art/raster.ts');
const { GROUND_CODE: G, LAWN } = await import('../src/art/tiles.ts');
const { TILE } = await import('../src/world/map.ts');
type R = InstanceType<typeof Raster>;
type Draw = (r: R, ox: number, oy: number, tx: number, ty: number) => void;

const only = process.argv.slice(2), want = (n: string) => !only.length || only.includes(n);
/** The textures' size (tiles), and how many tiles of it the seam is blended over. */
const N = 8, BLEND = 1, S = N * TILE, M = BLEND * TILE;
/** Which of the park's tiles they're drawn as (any, but not the first few: the hash runs in stripes near 0). */
const AT = 60;

/** A tile-drawing function over a square of tiles, n across, from tile (tx0, ty0). */
function tiles(draw: Draw, n: number, tx0 = AT, ty0 = AT): R {
  const r = new Raster(n * TILE, n * TILE);
  for (let ty = 0; ty < n; ty++) for (let tx = 0; tx < n; tx++) draw(r, tx * TILE, ty * TILE, tx0 + tx, ty0 + ty);
  return r;
}

/**
 * A texture that repeats without a seam: drawn a tile wider and taller than it is, and the
 * overhang dithered into its first tile, more of it the nearer the edge.
 */
function seamless(draw: Draw): R {
  const big = tiles(draw, N + BLEND), out = new Raster(S, S);
  const at = (x: number, y: number) => {
    const o = (y * big.w + x) * 4;
    return [big.data[o], big.data[o + 1], big.data[o + 2]] as [number, number, number];
  };
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const fx = x < M && hash2(x, y, 4401) < (M - x) / M, fy = y < M && hash2(x, y, 4402) < (M - y) / M;
      out.set(x, y, at(x + (fx ? S : 0), y + (fy ? S : 0)));
    }
  return out;
}

/** Things drawn a tile at a time (daisies, flowers, blades) laid over a texture, after its seam is blended (so they're whole). */
function over(t: R, draw: Draw): R {
  for (let ty = 0; ty < N; ty++) for (let tx = 0; tx < N; tx++) draw(t, tx * TILE, ty * TILE, AT + tx, AT + ty);
  return t;
}

const layer = (name: string, r: R, visible = true): AseLayer => ({ name, visible, data: placed(r, r.w, r.h, 0, 0) });
function write(name: string, w: number, h: number, layers: AseLayer[]): void {
  if (!want(name)) return;
  const file = fresh('ground', name);
  writeFileSync(file, writeAseprite(w, h, layers, [{ name: 'summer', from: 0, to: 0 }]));
  console.log(file, `${w}x${h}`);
}

/** The 16 edge pieces, drawn by `edges` for sides m, and the fill under them (hidden). */
function edgeSheet(name: string, fill: R, edges: (r: R, ox: number, oy: number, tx: number, ty: number, m: number) => void): void {
  const r = new Raster(4 * TILE, 4 * TILE), under = new Raster(4 * TILE, 4 * TILE);
  under.blit(fill, 0, 0);
  for (let m = 0; m < 16; m++) edges(r, (m % 4) * TILE, (m >> 2) * TILE, AT + (m % 4), AT + (m >> 2), m);
  write(`${name}-edges`, r.w, r.h, [layer('under', under, false), layer('edges', r)]);
}

const lawn = over(seamless((r, ox, oy, tx, ty) => G.lawnCode(r, ox, oy, tx, ty, false)), G.daisy);
const tones = new Raster(S, S);
LAWN.forEach((c, i) => tones.set(i, 0, c));
write('lawn', S, S, [layer('fill', lawn), layer('tones', tones, false)]);
write('flowers', S, S, [layer('fill', over(seamless((r, ox, oy, tx, ty) => G.flowersBase(r, ox, oy, tx, ty, false)), G.flowerSpots))]);
write('tall-grass', S, S, [layer('fill', over(seamless(G.tallGrassBase), G.blades))]);

const gravel = seamless(G.pathFill);
write('path', S, S, [layer('fill', gravel)]);
edgeSheet('path', gravel, G.pathEdges);

const water = seamless(G.waterFill);
write('water', S, S, [layer('fill', water), layer('ripples', tiles((r, ox, oy, tx, ty) => G.waterRipples(r, ox, oy, tx, ty, 0), N))]);
edgeSheet('water', water, G.waterEdges);

for (const tall of [false, true]) {
  const name = tall ? 'maze-hedge' : 'hedge', top = seamless((r, ox, oy, tx, ty) => G.hedgeFill(r, ox, oy, tx, ty, tall));
  write(name, S, S, [layer('fill', top)]);
  edgeSheet(name, top, (r, ox, oy, tx, ty, m) => G.hedgeEdges(r, ox, oy, tx, ty, m, tall));
}

for (const [name, b] of [['bush', G.bush], ['rock', G.rock]] as const) {
  const { pic } = b();
  write(name, pic.w, pic.h, [layer('art', pic)]);
}

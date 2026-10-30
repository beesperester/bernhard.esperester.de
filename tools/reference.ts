// Pictures to paint against (load one as a reference layer in Aseprite):
// a grown cat side on, and a 16x16-tile piece of the park's ground where
// paths cross the grass, both at 1:1 and drawn as in the game at noon in summer.
//
//   node tools/reference.ts [out dir]   (default: masters/sprites/reference)
import { mkdirSync, writeFileSync } from 'node:fs';
import { plant } from '../src/world/seed.ts';
import { png } from './png.ts';

plant({ seed: 8919, born: 0 });
const { Raster } = await import('../src/art/raster.ts');
const { CAT, buildCatSheet, frameIndex, framePos } = await import('../src/art/cat.ts');
const { buildGroundRegion } = await import('../src/art/tiles.ts');
const { seasonAt } = await import('../src/world/season.ts');
const { MAP_H, MAP_W, tileAt } = await import('../src/world/map.ts');
const { groundOf, isTree, isWaterway } = await import('../src/world/legend.ts');

const out = process.argv[2] ?? 'masters/sprites/reference';
mkdirSync(out, { recursive: true });
const N = 16;

// the cat: grown (the sheet's first row), standing side on, facing right; a tabby
const sheet = buildCatSheet(0), [fx, fy] = framePos(frameIndex('sideStand', true));
const cat = new Raster(CAT, CAT);
for (let y = 0; y < CAT; y++) cat.data.set(sheet.data.subarray(((fy + y) * sheet.w + fx) * 4, ((fy + y) * sheet.w + fx + CAT) * 4), y * CAT * 4);
writeFileSync(`${out}/cat-side.png`, png(cat, 1));

// the ground: the piece of the park with the most path among grass (no water, no trees)
let best = { score: -1, tx: 0, ty: 0 };
for (let ty = 0; ty + N <= MAP_H; ty += 2)
  for (let tx = 0; tx + N <= MAP_W; tx += 2) {
    let path = 0, grass = 0, bad = 0;
    for (let y = ty; y < ty + N; y++)
      for (let x = tx; x < tx + N; x++) {
        const ch = tileAt(x, y), g = groundOf(ch);
        if (isWaterway(ch) || isTree(ch)) bad++;
        else if (g === 'path') path++;
        else if (g === 'lawn' || g === 'tall' || g === 'flowers') grass++;
        else bad++;
      }
    // (about a third path, the rest grass)
    const score = bad ? -1 : Math.min(path, N * N * 0.35) + Math.min(grass, N * N * 0.65);
    if (score > best.score) best = { score, tx, ty };
  }
const summer = seasonAt(Date.UTC(2026, 6, 2, 12));
writeFileSync(`${out}/ground.png`, png(buildGroundRegion(best.tx, best.ty, N, N, 0, summer), 1));
console.log(`${out}/cat-side.png (${CAT}x${CAT}), ${out}/ground.png (${N}x${N} tiles from ${best.tx},${best.ty})`);

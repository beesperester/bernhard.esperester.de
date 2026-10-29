// Render art to PNG files for quick visual checks:
//   node tools/preview.ts <outdir>
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { Raster, hex } from '../src/art/raster.ts';
import { buildCatSheet, COATS, FRAMES, CAT } from '../src/art/cat.ts';
import { buildGroundRegion } from '../src/art/tiles.ts';
import { MAP_H, MAP_W, TILE } from '../src/world/map.ts';
import { SPAWN } from '../src/world/garden.ts';
import { buildProps } from '../src/art/trees.ts';
import { buildTerrain } from '../src/art/terrain.ts';
import { buildLandmark } from '../src/art/landmarks.ts';
import { buildSquirrel, buildHeldSquirrel, buildFruit } from '../src/art/critters.ts';
import { LANDMARK_SPRITE, type LandmarkKind } from '../src/world/landmarks.ts';

const out = process.argv[2] ?? 'preview';
mkdirSync(out, { recursive: true });

function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function png(r: Raster, scale: number): Buffer {
  const w = r.w * scale, h = r.h * scale;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const si = (((y / scale) | 0) * r.w + ((x / scale) | 0)) * 4;
      const di = y * (w * 4 + 1) + 1 + x * 4;
      for (let k = 0; k < 4; k++) raw[di + k] = r.data[si + k];
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const [name, rows] of Object.entries(FRAMES))
  for (const [i, r] of rows.entries())
    if (r.length !== CAT || rows.length !== CAT) throw new Error(`${name} row ${i}: ${r.length}x${rows.length}`);

// all cats, all frames, on a grass-coloured backdrop
const n = Object.keys(FRAMES).length;
const sheet = new Raster(n * 18 * 2, COATS.length * 18);
sheet.rect(0, 0, sheet.w, sheet.h, hex('#78c850'));
COATS.forEach((_, ci) => {
  const s = buildCatSheet(ci);
  for (let f = 0; f < n * 2; f++) {
    const fr = new Raster(CAT, CAT);
    for (let y = 0; y < CAT; y++) for (let x = 0; x < CAT; x++) {
      const i = (y * s.w + f * CAT + x) * 4;
      if (s.data[i + 3]) fr.set(x, y, [s.data[i], s.data[i + 1], s.data[i + 2]]);
    }
    sheet.blit(fr, f * 18 + 1, ci * 18 + 1);
  }
});
writeFileSync(`${out}/cats.png`, png(sheet, 4));

// the park round where cats come in (the whole of it is too big to look at)
const RW = 64, RH = 48;
const rx = Math.max(0, Math.min(MAP_W - RW, Math.round((SPAWN.x0 + SPAWN.x1) / 2) - RW / 2)), ry = Math.max(0, Math.min(MAP_H - RH, Math.round((SPAWN.y0 + SPAWN.y1) / 2) - RH / 2));
const ground = buildGroundRegion(rx, ry, RW, RH, 0);
const scene = new Raster(ground.w, ground.h);
scene.blit(ground, 0, 0);
// raised terrain and trees, painted back to front like the game sorts them
const layers = [
  ...buildTerrain().map((t) => ({ r: t.raster, x: t.x, y: t.y, d: t.depth })),
  ...buildProps().map((p) => ({ r: p.raster, x: p.x, y: p.y, d: p.depthY })),
].sort((a, b) => a.d - b.d);
for (const l of layers) scene.blit(l.r, l.x - rx * TILE, l.y - ry * TILE);
writeFileSync(`${out}/garden.png`, png(scene, 1));
console.log('ok', out);

// one coat, big, for detail checks
const one = buildCatSheet(Number(process.env.COAT ?? 0));
const COLS = 5;
const big = new Raster(COLS * 18, Math.ceil(n / COLS) * 18);
big.rect(0, 0, big.w, big.h, hex('#78c850'));
for (let f = 0; f < n; f++) {
  const fr = new Raster(CAT, CAT);
  for (let y = 0; y < CAT; y++) for (let x = 0; x < CAT; x++) {
    const i = (y * one.w + f * CAT + x) * 4;
    if (one.data[i + 3]) fr.set(x, y, [one.data[i], one.data[i + 1], one.data[i + 2]]);
  }
  big.blit(fr, (f % COLS) * 18 + 1, Math.floor(f / COLS) * 18 + 1);
}
writeFileSync(`${out}/cat-big.png`, png(big, 10));

// trees, big
const trees = buildProps().slice(0, 8);
const tr = new Raster(trees.length * 66, 86);
tr.rect(0, 0, tr.w, tr.h, hex('#68b848'));
trees.forEach((p, i) => tr.blit(p.raster, i * 66 + 1, 1));
writeFileSync(`${out}/trees.png`, png(tr, 4));

// the landmark follies side by side, with a cat for scale
{
  const kinds = Object.keys(LANDMARK_SPRITE) as LandmarkKind[];
  const W = kinds.reduce((a, k) => a + LANDMARK_SPRITE[k].w + 6, 6), H = 110;
  const r = new Raster(W, H);
  r.rect(0, 0, W, H, hex('#78c850'));
  let x = 6;
  for (const k of kinds) {
    const l = buildLandmark(k);
    r.blit(l, x, H - 4 - l.h);
    x += l.w + 6;
  }
  const cat = buildCatSheet(0);
  const fr = new Raster(CAT, CAT);
  fr.blit(cat, 0, 0);
  r.blit(fr, 2, H - 4 - CAT);
  writeFileSync(`${out}/landmarks.png`, png(r, 4));
}

// squirrels and fruit, big
{
  const sq = buildSquirrel(), fr = buildFruit(), held = buildHeldSquirrel();
  const r = new Raster(sq.w + 4, 24);
  r.rect(0, 0, r.w, r.h, hex('#78c850'));
  r.blit(sq, 2, 2);
  r.blit(fr, 2, 12);
  r.blit(held, 2, 18);
  writeFileSync(`${out}/squirrel.png`, png(r, 10));
}

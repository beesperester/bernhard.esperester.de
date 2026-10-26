// Render art to PNG files for quick visual checks:
//   node tools/preview.ts <outdir>
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { Raster, hex } from '../src/art/raster.ts';
import { buildCatSheet, COATS, FRAMES, CAT } from '../src/art/cat.ts';
import { buildGround, buildProps } from '../src/art/tiles.ts';

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

const ground = buildGround(0);
const props = buildProps();
for (const p of props) ground.blit(p.raster, p.x, p.y);
writeFileSync(`${out}/garden.png`, png(ground, 2));
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

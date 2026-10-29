// Writing a sheet out as a PNG file, for looking art over (tools/*-sheet.ts).
import { deflateSync } from 'node:zlib';
import type { Raster } from '../src/art/raster.ts';

function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

/** Raster r as a PNG file, each pixel `scale` px square. */
export function png(r: Raster, scale: number): Buffer {
  const w = r.w * scale, h = r.h * scale;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const si = (((y / scale) | 0) * r.w + ((x / scale) | 0)) * 4, di = y * (w * 4 + 1) + 1 + x * 4;
      for (let k = 0; k < 4; k++) raw[di + k] = r.data[si + k];
    }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

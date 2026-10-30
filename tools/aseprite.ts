// Aseprite files (.aseprite), as far as the tree tools need them: one frame,
// RGBA, a few named layers, each one picture (a cel) on the whole canvas.
// The format: https://github.com/aseprite/aseprite/blob/main/docs/ase-file-specs.md
import { deflateSync, inflateSync } from 'node:zlib';
import type { Raster } from '../src/art/raster.ts';

export interface AseLayer {
  name: string;
  /** Shown in Aseprite (a guide layer can be left hidden or not; it's never brought in). */
  visible: boolean;
  /** w x h RGBA, the canvas' size... */
  data: Uint8ClampedArray | Uint8Array;
  /** ...from this corner of it (where Aseprite trims a cel to what's drawn). */
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  opacity?: number;
}

const word = (v: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(v & 0xffff); return b; };
const short = (v: number) => { const b = Buffer.alloc(2); b.writeInt16LE(v); return b; };
const dword = (v: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0); return b; };
const byte = (v: number) => Buffer.from([v & 255]);
const zeros = (n: number) => Buffer.alloc(n);
const str = (s: string) => Buffer.concat([word(Buffer.byteLength(s)), Buffer.from(s, 'utf8')]);

function chunk(type: number, data: Buffer): Buffer {
  return Buffer.concat([dword(data.length + 6), word(type), data]);
}

/** A w x h picture with these layers (bottom first), as an .aseprite file. */
export function writeAseprite(w: number, h: number, layers: AseLayer[]): Buffer {
  const chunks: Buffer[] = [];
  // its palette (unused in RGBA; Aseprite likes there to be one)
  chunks.push(chunk(0x2019, Buffer.concat([dword(1), dword(0), dword(0), zeros(8), word(0), byte(0), byte(0), byte(0), byte(255)])));
  for (const l of layers)
    chunks.push(chunk(0x2004, Buffer.concat([word(l.visible ? 3 : 2), word(0), word(0), word(0), word(0), word(0), byte(l.opacity ?? 255), zeros(3), str(l.name)])));
  layers.forEach((l, i) => {
    const pixels = deflateSync(Buffer.from(l.data.buffer, l.data.byteOffset, w * h * 4));
    chunks.push(chunk(0x2005, Buffer.concat([word(i), short(0), short(0), byte(255), word(2), short(0), zeros(5), word(w), word(h), pixels])));
  });
  const body = Buffer.concat(chunks);
  const frame = Buffer.concat([dword(16 + body.length), word(0xf1fa), word(Math.min(0xffff, chunks.length)), word(100), zeros(2), dword(chunks.length), body]);
  const header = Buffer.concat([
    dword(128 + frame.length), word(0xa5e0), word(1), word(w), word(h), word(32), dword(1), word(100), dword(0), dword(0),
    byte(0), zeros(3), word(1), byte(1), byte(1), short(0), short(0), word(16), word(16), zeros(84),
  ]);
  return Buffer.concat([header, frame]);
}

/** An .aseprite file's canvas and the first frame's picture on each layer (only RGBA files), each as big as the canvas. */
export function readAseprite(file: Buffer): { w: number; h: number; layers: { name: string; visible: boolean; data: Uint8ClampedArray }[] } {
  if (file.readUInt16LE(4) !== 0xa5e0) throw new Error('not an .aseprite file');
  const w = file.readUInt16LE(8), h = file.readUInt16LE(10), depth = file.readUInt16LE(12);
  if (depth !== 32) throw new Error('only RGBA .aseprite files (Sprite > Color Mode > RGB Color)');
  const layers: { name: string; visible: boolean; data: Uint8ClampedArray }[] = [];
  let p = 128;
  const frameEnd = p + file.readUInt32LE(p);
  const n = file.readUInt32LE(p + 12) || file.readUInt16LE(p + 6);
  p += 16;
  for (let c = 0; c < n && p < frameEnd; c++) {
    const size = file.readUInt32LE(p), type = file.readUInt16LE(p + 4), d = file.subarray(p + 6, p + size);
    if (type === 0x2004) {
      const lflags = d.readUInt16LE(0), ltype = d.readUInt16LE(2), len = d.readUInt16LE(16);
      // (groups and tilemaps hold no picture of their own: kept for the numbering)
      layers.push({ name: d.toString('utf8', 18, 18 + len), visible: (lflags & 1) === 1 && ltype !== 1, data: new Uint8ClampedArray(w * h * 4) });
    } else if (type === 0x2005) {
      const li = d.readUInt16LE(0), x = d.readInt16LE(2), y = d.readInt16LE(4), opacity = d[6], cel = d.readUInt16LE(7);
      const layer = layers[li];
      if (!layer || (cel !== 0 && cel !== 2)) { p += size; continue; }
      const cw = d.readUInt16LE(16), ch = d.readUInt16LE(18);
      const px = cel === 2 ? inflateSync(d.subarray(20)) : d.subarray(20);
      for (let yy = 0; yy < ch; yy++)
        for (let xx = 0; xx < cw; xx++) {
          const X = x + xx, Y = y + yy;
          if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
          const s = (yy * cw + xx) * 4, o = (Y * w + X) * 4;
          for (let k = 0; k < 3; k++) layer.data[o + k] = px[s + k];
          layer.data[o + 3] = Math.round((px[s + 3] * opacity) / 255);
        }
    }
    p += size;
  }
  return { w, h, layers };
}

/** A Raster as an AseLayer's pixels on a canvas cw x ch, placed at (ox, oy). */
export function placed(r: Raster, cw: number, ch: number, ox: number, oy: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < r.h; y++)
    for (let x = 0; x < r.w; x++) {
      const s = (y * r.w + x) * 4, X = ox + x, Y = oy + y;
      if (!r.data[s + 3] || X < 0 || Y < 0 || X >= cw || Y >= ch) continue;
      out.set(r.data.subarray(s, s + 4), (Y * cw + X) * 4);
    }
  return out;
}

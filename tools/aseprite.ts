// Aseprite files (.aseprite), as far as the art needs them: RGBA, named
// layers (and groups of them), frames and the tags naming them.
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
  /** A group (holding no picture of its own: the layers after it one level deeper are in it). */
  group?: boolean;
  /** How deep in groups (0: at the top). */
  level?: number;
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

/** A tag: frames from..to (from 0) under a name, as Aseprite's timeline shows them. */
export interface AseTag { name: string; from: number; to: number }

/**
 * A w x h picture with these layers (bottom first), as an .aseprite file. With
 * `frames`, a layer's picture in each frame (null: nothing there) instead of its `data`.
 */
export function writeAseprite(w: number, h: number, layers: (AseLayer & { frames?: (Uint8ClampedArray | Uint8Array | null)[] })[], tags: AseTag[] = []): Buffer {
  const count = Math.max(1, ...layers.map((l) => l.frames?.length ?? 1));
  const frames: Buffer[] = [];
  for (let f = 0; f < count; f++) {
    const chunks: Buffer[] = [];
    if (f === 0) {
      // its palette (unused in RGBA; Aseprite likes there to be one)
      chunks.push(chunk(0x2019, Buffer.concat([dword(1), dword(0), dword(0), zeros(8), word(0), byte(0), byte(0), byte(0), byte(255)])));
      for (const l of layers)
        chunks.push(chunk(0x2004, Buffer.concat([word(l.visible ? 3 : 2), word(l.group ? 1 : 0), word(l.level ?? 0), word(0), word(0), word(0), byte(l.opacity ?? 255), zeros(3), str(l.name)])));
      if (tags.length)
        chunks.push(chunk(0x2018, Buffer.concat([word(tags.length), zeros(8), ...tags.map((t) => Buffer.concat([word(t.from), word(t.to), byte(0), word(0), zeros(6), zeros(3), byte(0), str(t.name)]))])));
    }
    layers.forEach((l, i) => {
      if (l.group) return;
      const data = l.frames ? l.frames[f] : f === 0 ? l.data : null;
      if (!data) return;
      const pixels = deflateSync(Buffer.from(data.buffer, data.byteOffset, w * h * 4));
      chunks.push(chunk(0x2005, Buffer.concat([word(i), short(0), short(0), byte(255), word(2), short(0), zeros(5), word(w), word(h), pixels])));
    });
    const body = Buffer.concat(chunks);
    frames.push(Buffer.concat([dword(16 + body.length), word(0xf1fa), word(Math.min(0xffff, chunks.length)), word(100), zeros(2), dword(chunks.length), body]));
  }
  const all = Buffer.concat(frames);
  const header = Buffer.concat([
    dword(128 + all.length), word(0xa5e0), word(count), word(w), word(h), word(32), dword(1), word(100), dword(0), dword(0),
    byte(0), zeros(3), word(1), byte(1), byte(1), short(0), short(0), word(16), word(16), zeros(84),
  ]);
  return Buffer.concat([header, all]);
}

/** A layer as read: its picture in the first frame (`data`), and in every frame (null where there's nothing). */
export interface ReadLayer { name: string; visible: boolean; level: number; data: Uint8ClampedArray; frames: (Uint8ClampedArray | null)[] }

/**
 * An .aseprite file's canvas, tags, and each layer's picture in each frame
 * (only RGBA files), each as big as the canvas. A group's picture is what's
 * in it, put together as Aseprite shows it (its hidden layers left out; only
 * the Normal blend mode).
 */
export function readAseprite(file: Buffer): { w: number; h: number; frames: number; tags: AseTag[]; layers: ReadLayer[] } {
  if (file.readUInt16LE(4) !== 0xa5e0) throw new Error('not an .aseprite file');
  const count = file.readUInt16LE(6), w = file.readUInt16LE(8), h = file.readUInt16LE(10), depth = file.readUInt16LE(12);
  if (depth !== 32) throw new Error('only RGBA .aseprite files (Sprite > Color Mode > RGB Color)');
  // (a layer's opacity counts only where the file says so)
  const layerOpacity = (file.readUInt32LE(14) & 1) === 1;
  const layers: { name: string; visible: boolean; level: number; group: boolean; opacity: number; frames: (Uint8ClampedArray | null)[] }[] = [];
  const tags: AseTag[] = [];
  let p = 128;
  for (let f = 0; f < count; f++) {
    const frameEnd = p + file.readUInt32LE(p);
    const n = file.readUInt32LE(p + 12) || file.readUInt16LE(p + 6);
    p += 16;
    for (let c = 0; c < n && p < frameEnd; c++) {
      const size = file.readUInt32LE(p), type = file.readUInt16LE(p + 4), d = file.subarray(p + 6, p + size);
      if (type === 0x2004) {
        const lflags = d.readUInt16LE(0), ltype = d.readUInt16LE(2), level = d.readUInt16LE(4), len = d.readUInt16LE(16);
        // (tilemaps hold no picture we can read: kept for the numbering)
        layers.push({ name: d.toString('utf8', 18, 18 + len), visible: (lflags & 1) === 1, level, group: ltype === 1, opacity: layerOpacity ? d[12] : 255, frames: [] });
      } else if (type === 0x2018) {
        let q = 10;
        for (let t = 0, nt = d.readUInt16LE(0); t < nt; t++) {
          const from = d.readUInt16LE(q), to = d.readUInt16LE(q + 2), len = d.readUInt16LE(q + 17);
          tags.push({ name: d.toString('utf8', q + 19, q + 19 + len), from, to });
          q += 19 + len;
        }
      } else if (type === 0x2005) {
        const li = d.readUInt16LE(0), x = d.readInt16LE(2), y = d.readInt16LE(4), opacity = d[6], cel = d.readUInt16LE(7);
        const layer = layers[li];
        // (a linked cel: the same picture as in another frame)
        if (layer && cel === 1) layer.frames[f] = layer.frames[d.readUInt16LE(16)] ?? null;
        if (!layer || (cel !== 0 && cel !== 2)) { p += size; continue; }
        const cw = d.readUInt16LE(16), ch = d.readUInt16LE(18);
        const px = cel === 2 ? inflateSync(d.subarray(20)) : d.subarray(20);
        const data = (layer.frames[f] = new Uint8ClampedArray(w * h * 4));
        for (let yy = 0; yy < ch; yy++)
          for (let xx = 0; xx < cw; xx++) {
            const X = x + xx, Y = y + yy;
            if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
            const s = (yy * cw + xx) * 4, o = (Y * w + X) * 4;
            for (let k = 0; k < 3; k++) data[o + k] = px[s + k];
            data[o + 3] = Math.round((px[s + 3] * opacity) / 255);
          }
      }
      p += size;
    }
    p = frameEnd;
  }
  for (const l of layers) for (let f = 0; f < count; f++) l.frames[f] ??= null;
  // each group, deepest first, as what's in it: the layers after it one level deeper, bottom first
  const order = layers.map((_, i) => i).filter((i) => layers[i].group).sort((a, b) => layers[b].level - layers[a].level);
  for (const g of order)
    for (let f = 0; f < count; f++) {
      let into: Uint8ClampedArray | null = null;
      for (let i = g + 1; i < layers.length && layers[i].level > layers[g].level; i++) {
        const l = layers[i], px = l.frames[f];
        if (l.level !== layers[g].level + 1 || !l.visible || !px) continue;
        over((into ??= new Uint8ClampedArray(w * h * 4)), px, l.opacity);
      }
      layers[g].frames[f] = into;
    }
  return {
    w, h, frames: count, tags,
    layers: layers.map(({ name, visible, level, frames }) => ({ name, visible, level, frames, data: frames[0] ?? new Uint8ClampedArray(w * h * 4) })),
  };
}

/** Puts picture b over a (the same size, RGBA), at this opacity (0-255). */
function over(a: Uint8ClampedArray, b: Uint8ClampedArray, opacity: number): void {
  for (let o = 0; o < a.length; o += 4) {
    const sa = (b[o + 3] * opacity) / (255 * 255);
    if (!sa) continue;
    const da = a[o + 3] / 255, oa = sa + da * (1 - sa);
    for (let k = 0; k < 3; k++) a[o + k] = Math.round((b[o + k] * sa + a[o + k] * da * (1 - sa)) / oa);
    a[o + 3] = Math.round(oa * 255);
  }
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

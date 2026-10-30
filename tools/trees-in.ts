// Brings the painted trees (masters/sprites/trees/*.aseprite, made by
// tools/tree-layers.ts) into the game: their back, mid and front layers go
// into src/art/paintedTrees.data.ts, and every tree of that kind and size in
// the park is then the painted one (world/templates.ts). Kinds and sizes
// with no file are drawn from their plans as before.
//
//   node tools/trees-in.ts [dir]   (default: masters/sprites/trees)
//   node tools/trees-in.ts --none  (back to none painted)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { readAseprite } from './aseprite.ts';

const OUT = 'src/art/paintedTrees.data.ts';
const none = process.argv[2] === '--none';
const dir = none ? '' : process.argv[2] ?? 'masters/sprites/trees';
const SIZES = ['s', 'm', 'l'], LAYERS = ['back', 'mid', 'front'];

const sizes: string[] = [];
const palette = new Map<number, number>();
const all: Uint16Array[] = [];
if (!none)
  for (const shape of ['broadleaf', 'pine'])
    SIZES.forEach((sz, size) => {
      const file = `${dir}/${shape}-${sz}.aseprite`;
      if (!existsSync(file)) return;
      const ase = readAseprite(readFileSync(file));
      // (the trunk's foot is the middle of the bottom row: an odd width gets a column more on the right)
      const w = ase.w + (ase.w % 2), h = ase.h;
      for (const name of LAYERS) {
        // (a layer or a group of layers; one at the top before one in a group)
      const named = ase.layers.filter((l) => l.name.trim().toLowerCase() === name);
      const layer = named.find((l) => l.level === 0) ?? named[0];
        if (!layer) throw new Error(`${file}: no layer called "${name}"`);
        const px = new Uint16Array(w * h);
        for (let y = 0; y < h; y++)
          for (let x = 0; x < ase.w; x++) {
            const o = (y * ase.w + x) * 4;
            if (layer.data[o + 3] < 128) continue;
            const c = (layer.data[o] << 16) | (layer.data[o + 1] << 8) | layer.data[o + 2];
            if (!palette.has(c)) palette.set(c, palette.size + 1);
            px[y * w + x] = palette.get(c)!;
          }
        all.push(px);
        sizes.push(`  '${shape}-${size}-${name}': [${w}, ${h}],`);
      }
      console.log(`${file}: ${w}x${h}`);
    });
if (palette.size > 65535) throw new Error(`${palette.size} colours: too many`);

const joined = new Uint16Array(all.reduce((a, p) => a + p.length, 0));
let at = 0;
for (const p of all) { joined.set(p, at); at += p.length; }
const packed = all.length ? deflateSync(Buffer.from(joined.buffer), { level: 9 }).toString('base64') : '';
const hex = [...palette.keys()].map((c) => c.toString(16).padStart(6, '0')).join('');

writeFileSync(OUT, [
  '// Made by tools/trees-in.ts from the painted trees in masters/sprites/trees/: do not edit.',
  "/** Each painted layer ('broadleaf-0-back', ...) and its size. */",
  `export const PAINTED_SIZES: Record<string, [number, number]> = {${sizes.length ? `\n${sizes.join('\n')}\n` : ''}};`,
  '/** Their colours, 6 hex digits each (numbered from 1). */',
  `export const PAINTED_PALETTE = '${hex}';`,
  '/** Their pixels, one layer after the other, each a 16-bit number (little-endian; 0 nothing, else its colour), deflated (zlib) and in base64. */',
  `export const PAINTED_PIXELS = '${packed}';`,
  '',
].join('\n'));
console.log(`${OUT}: ${sizes.length / 3} painted trees, ${palette.size} colours, ${Math.round(packed.length / 1024)} KB`);

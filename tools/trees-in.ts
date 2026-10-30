// Brings the painted trees (masters/sprites/trees/*.aseprite, made by
// tools/tree-layers.ts) into the game: their back, mid and front layers go
// into src/art/paintedTrees.data.ts, and every tree of that kind and size in
// the park is then the painted one (world/templates.ts). Kinds and sizes
// with no file are drawn from their plans as before.
//
//   node tools/trees-in.ts [dir]   (default: masters/sprites/trees)
//   node tools/trees-in.ts --none  (back to none painted)
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { readAseprite } from './aseprite.ts';
import { plant } from '../src/world/seed.ts';

plant({ seed: 8919, born: 0 });
const { guidePerches } = await import('./guide.ts');

const OUT = 'src/art/paintedTrees.data.ts';
const none = process.argv[2] === '--none';
const dir = none ? '' : process.argv[2] ?? 'masters/sprites/trees';
const round = (v: number) => Math.round(v * 2) / 2;
const SIZES = ['s', 'm', 'l'], LAYERS = ['back', 'mid', 'front'];

const sizes: string[] = [];
const palette = new Map<number, number>();
const all: Uint16Array[] = [];
const perches: string[] = [], problems: string[] = [];
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
      // what a cat stands on: the guide's lines, over what's painted
      const guide = ase.layers.find((l) => l.name.trim().toLowerCase() === 'guide');
      let note = 'no guide layer: stood on as planned';
      if (guide) {
        const layers = all.slice(-3);
        const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && layers.some((l) => l[y * w + x] > 0);
        const wide = new Uint8ClampedArray(w * h * 4);
        for (let y = 0; y < h; y++) wide.set(guide.data.subarray(y * ase.w * 4, (y + 1) * ase.w * 4), y * w * 4);
        const got = guidePerches(wide, w, h, shape, solid);
        problems.push(...got.problems.map((p) => `${file}: ${p}`));
        perches.push(`  '${shape}-${size}': ${JSON.stringify(got.perches.map((p) => ({ ...p, x0: round(p.x0), x1: round(p.x1) })))},`);
        note = `${got.perches.length} perches from the guide`;
      }
      console.log(`${file}: ${w}x${h}, ${note}`);
    });
if (problems.length) {
  console.error(`Not brought in: what a cat would stand on needs fixing (x,y as in Aseprite):\n${problems.map((p) => `  ${p}`).join('\n')}`);
  process.exit(1);
}
if (palette.size > 65535) throw new Error(`${palette.size} colours: too many`);

const joined = new Uint16Array(all.reduce((a, p) => a + p.length, 0));
let at = 0;
for (const p of all) { joined.set(p, at); at += p.length; }
const packed = all.length ? deflateSync(Buffer.from(joined.buffer), { level: 9 }).toString('base64') : '';
const hex = [...palette.keys()].map((c) => c.toString(16).padStart(6, '0')).join('');

const before = readFileSync(OUT, 'utf8');
writeFileSync(OUT, [
  '// Made by tools/trees-in.ts from the painted trees in masters/sprites/trees/: do not edit.',
  "import type { Perch } from '../world/trees.ts';",
  '',
  "/** Each painted layer ('broadleaf-0-back', ...) and its size. */",
  `export const PAINTED_SIZES: Record<string, [number, number]> = {${sizes.length ? `\n${sizes.join('\n')}\n` : ''}};`,
  "/** What a cat stands on in each painted tree ('broadleaf-0', ...), drawn on its guide (as world/trees.ts plans perches); none: as planned. */",
  `export const PAINTED_PERCHES: Record<string, Perch[]> = {${perches.length ? `\n${perches.join('\n')}\n` : ''}};`,
  '/** Their colours, 6 hex digits each (numbered from 1). */',
  `export const PAINTED_PALETTE = '${hex}';`,
  '/** Their pixels, one layer after the other, each a 16-bit number (little-endian; 0 nothing, else its colour), deflated (zlib) and in base64. */',
  `export const PAINTED_PIXELS = '${packed}';`,
  '',
].join('\n'));
console.log(`${OUT}: ${sizes.length / 3} painted trees, ${palette.size} colours, ${Math.round(packed.length / 1024)} KB`);

// and can a cat climb each of them, as the guides are drawn? (the tree tests, which climb every painted tree; if not, back as it was)
if (sizes.length) {
  try {
    execFileSync('npx', ['vitest', 'run', 'src/world/trees.test.ts'], { stdio: 'pipe' });
    console.log('Climbed every painted tree to its top: brought in.');
  } catch (e) {
    writeFileSync(OUT, before);
    const { stdout, stderr } = e as { stdout?: Buffer; stderr?: Buffer };
    const why = [...new Set(`${stdout ?? ''}\n${stderr ?? ''}`.split('\n').filter((l) => /AssertionError/.test(l)).map((l) => l.replace(/^.*AssertionError: /, '').replace(/: expected .*$/, '').trim()))];
    console.error(`Not brought in: a cat can't climb a tree as its guide is drawn:\n${why.map((l) => `  ${l}`).join('\n')}`);
    process.exit(1);
  }
}

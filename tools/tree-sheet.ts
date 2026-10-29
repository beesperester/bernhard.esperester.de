// A sheet of the park's trees, to look the art over before it goes into the
// game: small, medium and big broadleaves and pines, as they stand and with
// their leaves in front taken away (a cat up them), and through the seasons;
// and the sheet of puffs of leaves they are made from.
//
//   npx tsx tools/tree-sheet.ts [out dir]   (default: preview/)
import { writeFileSync, mkdirSync } from 'node:fs';
import { plant } from '../src/world/seed.ts';
import { png } from './png.ts';

plant({ seed: Number(process.env.SEED ?? 8919), born: 0 });
const { Raster, hex } = await import('../src/art/raster.ts');
const { buildProp, puffSheet } = await import('../src/art/trees.ts');
const { TREES } = await import('../src/world/trees.ts');
const { treeSizeAt } = await import('../src/world/layout.ts');
const { seasonAt } = await import('../src/world/season.ts');
type Raster = InstanceType<typeof Raster>;

const out = process.argv[2] ?? 'preview';
mkdirSync(out, { recursive: true });

// two of each kind of tree there is
const picks: number[] = [];
const kinds: [string, number][] = [['broadleaf', 0], ['broadleaf', 1], ['broadleaf', 2], ['pine', 0], ['pine', 1], ['pine', 2]];
for (const [shape, size] of kinds) {
  const found = TREES.map((t, i) => [t, i] as const).filter(([t]) => t.shape === shape && (shape === 'treehouse' || treeSizeAt(t.tx, t.ty) === size));
  picks.push(...found.slice(0, shape === 'treehouse' ? 1 : 2).map(([, i]) => i));
}

const dates = { spring: Date.UTC(2026, 3, 14, 10), summer: Date.UTC(2026, 6, 10, 10), autumn: Date.UTC(2026, 9, 26, 11), winter: Date.UTC(2026, 0, 15, 11) };
const GRASS = hex('#7cb85a'), GROUND = hex('#5e9a44'), PAD = 10;

/** A sheet: one row per (season, whether the front leaves show), the picked trees side by side on the grass. */
function sheet(rows: { season: keyof typeof dates; front: boolean }[]): Raster {
  const props = rows.map(({ season }) => picks.map((i) => buildProp(i, seasonAt(dates[season]))));
  const colW = picks.map((_, k) => Math.max(...props.map((r) => r[k].raster.w)) + PAD);
  const rowH = Math.max(...props.flat().map((p) => p.raster.h)) + PAD;
  const s = new Raster(colW.reduce((a, b) => a + b, 0), rowH * rows.length);
  s.rect(0, 0, s.w, s.h, GRASS);
  rows.forEach(({ front }, j) => {
    let x = 0;
    picks.forEach((_, k) => {
      const p = props[j][k], foot = (j + 1) * rowH - PAD / 2;
      s.rect(x, foot - 2, colW[k], 3, GROUND);
      const px = x + Math.floor((colW[k] - p.raster.w) / 2), py = foot - p.raster.h;
      s.blit(p.raster, px, py);
      if (front && p.front) s.blit(p.front.raster, px, py);
      x += colW[k];
    });
  });
  return s;
}

writeFileSync(`${out}/trees-summer.png`, png(sheet([{ season: 'summer', front: true }, { season: 'summer', front: false }]), 2));
writeFileSync(`${out}/trees-seasons.png`, png(sheet([{ season: 'spring', front: true }, { season: 'autumn', front: true }, { season: 'winter', front: true }]), 1));
writeFileSync(`${out}/leaves.png`, png(puffSheet(), 3));
console.log('ok', out, picks.map((i) => `${TREES[i].shape}/${treeSizeAt(TREES[i].tx, TREES[i].ty)}`).join(' '));

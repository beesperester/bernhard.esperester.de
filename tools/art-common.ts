// What the art exporters (tools/art-*.ts) share: where a file goes (never over
// one that's there: it may be painted), and the seasons' swatches
// (art/<folder>/seasons.aseprite, as src/art/seasonal.ts reads them).
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { placed, writeAseprite, type AseLayer } from './aseprite.ts';
import type { Raster, RGB } from '../src/art/raster.ts';

/** Where file <name> of art/<dir>/ goes: next to one that's there as *.new.aseprite. */
export function fresh(dir: string, name: string): string {
  mkdirSync(`art/${dir}`, { recursive: true });
  return existsSync(`art/${dir}/${name}.aseprite`) ? `art/${dir}/${name}.new.aseprite` : `art/${dir}/${name}.aseprite`;
}

/** Write one picture (in summer) as art/<dir>/<name>.aseprite, its layer `layer`, and more layers on top if given. */
export function writeArt(dir: string, name: string, r: Raster, more: AseLayer[] = [], layer = 'art'): void {
  const file = fresh(dir, name);
  writeFileSync(file, writeAseprite(r.w, r.h, [{ name: layer, visible: true, data: placed(r, r.w, r.h, 0, 0) }, ...more]));
  console.log(file, `${r.w}x${r.h}`);
}

/** A season's colours for one file: up to three ramps (light to dark), and the dots. */
export interface Look { ramps: RGB[][]; dots?: RGB[] }

/** art/<dir>/seasons.aseprite: a layer per file named, each season's colours in its column (src/art/seasonal.ts). */
export async function writeSeasons(dir: string, looks: Record<string, Partial<Record<'summer' | 'autumn' | 'winter' | 'spring', Look>>>): Promise<void> {
  const { Raster } = await import('../src/art/raster.ts');
  const { SWATCHES_W, SWATCHES_H, RAMPS, SW, swatchAt } = await import('../src/art/seasonal.ts');
  const { SEASON_NAMES } = await import('../src/world/season.ts');
  const layers = Object.entries(looks).map(([name, seasons]) => {
    const r = new Raster(SWATCHES_W, SWATCHES_H);
    SEASON_NAMES.forEach((season, s) => {
      const l = seasons[season];
      if (!l) return;
      [...l.ramps, ...Array(RAMPS - l.ramps.length).fill([]), l.dots ?? []].forEach((cs: RGB[], row) => cs.forEach((c, i) => {
        const [x0, y0] = swatchAt(s, row, i);
        for (let y = 0; y < SW; y++) for (let x = 0; x < SW; x++) r.set(x0 + x, y0 + y, c);
      }));
    });
    return { name, visible: true, data: placed(r, SWATCHES_W, SWATCHES_H, 0, 0) };
  });
  const file = fresh(dir, 'seasons');
  writeFileSync(file, writeAseprite(SWATCHES_W, SWATCHES_H, layers));
  console.log(file, `${layers.length} layers`);
}

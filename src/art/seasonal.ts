// Art drawn as a file is its summer (its first frame): the other seasons are
// worked out from it, unless the file has a frame of its own tagged with the season. The
// colours come from the folder's seasons.aseprite (art/<folder>/seasons.aseprite):
// a layer for each file, named as it is ('fern'; the trees: by kind, 'broadleaf'), in it a column of
// swatches for each season, summer first; a row for each ramp, light to dark
// (up to RAMPS), and a row of dots below them. A pixel near one of the summer
// swatches finds its tone in summer's first ramp (by how light it is) and takes
// that tone from the season's ramps (in soft clouds, mostly the first); others
// (a flower's petals, berries) are left as painted. The dots are sprinkled over
// what's recoloured (blossom, apples, berries). No layer, or no ramps in a
// season: as in summer. Going from one season to the next, the game dithers
// from one to the other (blendSeasons).
import { Raster, hash2, type RGB } from './raster.ts';
import { artFile, type ArtFile } from './files.ts';
import { SEASON_NAMES, seasonFrames, type Season, type SeasonName } from '../world/season.ts';

/** The swatch files' layout: a swatch is SW px square; a season a column of them (up to RAMP_MAX across); RAMPS ramps a column, then the dots. */
export const SW = 8, RAMP_MAX = 8, RAMPS = 3;
export const COLUMN = SW * (RAMP_MAX + 1), SWATCHES_W = COLUMN * SEASON_NAMES.length, SWATCHES_H = SW * (RAMPS + 1);
/** Where swatch i of row `row` (0..RAMPS-1 a ramp, RAMPS the dots) of a season (its number) is (its top left). */
export const swatchAt = (season: number, row: number, i: number): [number, number] => [season * COLUMN + i * SW, row * SW];

/** A season's colours for one file: its ramps, and the dots. */
export interface Look { ramps: RGB[][]; dots: RGB[] }

const looks = new Map<string, Look>();
/** The colours file `name` of art/<dir>/ has in a season. */
export function look(dir: string, name: string, season: SeasonName): Look {
  const key = `${dir}/${name}/${season}`;
  let l = looks.get(key);
  if (!l) {
    const f = artFile(`${dir}/seasons`), r = f?.layers.includes(name) ? f.layer(name, 0) : null, s = SEASON_NAMES.indexOf(season);
    const row = (n: number): RGB[] => {
      const out: RGB[] = [];
      for (let i = 0; i < RAMP_MAX && r; i++) {
        const [x, y] = swatchAt(s, n, i), o = ((y + SW / 2) * r.w + x + SW / 2) * 4;
        if (!r.data[o + 3]) break;
        out.push([r.data[o], r.data[o + 1], r.data[o + 2]]);
      }
      return out;
    };
    l = { ramps: Array.from({ length: RAMPS }, (_, n) => row(n)).filter((x) => x.length), dots: row(RAMPS) };
    looks.set(key, l);
  }
  return l;
}

const lum = (c: ArrayLike<number>, o = 0) => c[o] * 0.3 + c[o + 1] * 0.59 + c[o + 2] * 0.11;
/** How near (RGB) a pixel must be to one of the summer swatches to be recoloured. */
const NEAR = 80;

/** Soft noise (0..1) on a grid `size` px across. */
function smooth(x: number, y: number, size: number, seed: number): number {
  const gx = Math.floor(x / size), gy = Math.floor(y / size), fx = x / size - gx, fy = y / size - gy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const h = (i: number, j: number) => hash2(gx + i, gy + j, seed);
  return (h(0, 0) * (1 - sx) + h(1, 0) * sx) * (1 - sy) + (h(0, 1) * (1 - sx) + h(1, 1) * sx) * sy;
}

/** Which of n ramps what's at (x, y) turns to: in clouds about CLOUD px across, mostly the first. */
const CLOUD = 32;
function rampAt(x: number, y: number, n: number, seed: number): number {
  // (each other ramp has its clouds of its own, so one never rings another)
  const at = (k: number) => smooth(x, y, CLOUD, seed + k * 7) * 0.9 + smooth(x, y, CLOUD / 4, seed + k * 7 + 1) * 0.1;
  if (n > 2 && at(2) > 0.7) return 2;
  return n > 1 && at(1) > 0.66 ? 1 : 0;
}

/** A picture drawn for summer, in another season: recoloured tone for tone as art/<dir>/seasons.aseprite has it for `name`. */
export function recoloured(summer: Raster, dir: string, name: string, season: SeasonName): Raster {
  const from = look(dir, name, 'summer'), to = look(dir, name, season);
  const out = new Raster(summer.w, summer.h);
  out.data.set(summer.data);
  if (!from.ramps.length || !to.ramps.length) return out;
  const ref = from.ramps[0], tones = ref.map((c) => lum(c)), all = from.ramps.flat();
  const changed = new Uint8Array(summer.w * summer.h);
  for (let k = 0; k < summer.w * summer.h; k++) {
    const o = k * 4, d = summer.data;
    if (!d[o + 3]) continue;
    if (!all.some((c) => Math.hypot(c[0] - d[o], c[1] - d[o + 1], c[2] - d[o + 2]) < NEAR)) continue;
    const L = lum(d, o);
    let i = 0;
    for (let j = 1; j < tones.length; j++) if (Math.abs(tones[j] - L) < Math.abs(tones[i] - L)) i = j;
    const x = k % summer.w, y = Math.floor(k / summer.w);
    const ramp = to.ramps[rampAt(x, y, to.ramps.length, 1720)];
    out.set(x, y, ramp[Math.round((i * (ramp.length - 1)) / Math.max(1, tones.length - 1))]);
    changed[k] = 1;
  }
  // little dots over it (blossom, apples, berries), each 2 x 2 with its shadow in a corner, where it's recoloured all round
  const dots = to.dots, at = (x: number, y: number) => x >= 0 && y >= 0 && x < out.w && y < out.h && changed[y * out.w + x] === 1;
  if (dots.length)
    for (let y = 1; y < summer.h - 2; y++)
      for (let x = 1; x < summer.w - 2; x++) {
        if (hash2(x, y, 1730) >= DOTS) continue;
        if (!at(x - 1, y) || !at(x + 2, y + 2) || !at(x, y)) continue;
        const c = dots[Math.floor(hash2(x, y, 1731) * dots.length)];
        const o = (y * out.w + x) * 4, shade: RGB = [out.data[o], out.data[o + 1], out.data[o + 2]];
        out.set(x, y, c); out.set(x + 1, y, c); out.set(x, y + 1, c); out.set(x + 1, y + 1, lum(shade) < lum(c) ? shade : c);
      }
  return out;
}
/** How many of the pixels a dot starts at (where there's room for it). */
const DOTS = 1 / 120;

const made = new Map<string, Raster | null>();
/**
 * Layer `layer` of file f (art/<dir>/<name>.aseprite) in a season: its own frame for the season if
 * it's painted, else its first frame (summer), recoloured with the colours of `swatches` (the layer of
 * seasons.aseprite: as a rule the file's name; null: as it is).
 */
export function seasonal(f: ArtFile, dir: string, name: string, layer: string, season: SeasonName, swatches: string | null = name): Raster | null {
  const own = f.tags.get(season);
  if (own) return f.layer(layer, own[0]);
  const summer = f.layer(layer, 0);
  if (!summer || swatches === null || season === 'summer') return summer;
  const key = `${dir}/${name}/${layer}/${season}`;
  if (!made.has(key)) made.set(key, recoloured(summer, dir, swatches, season));
  return made.get(key)!;
}

/** 4 x 4 ordered dither: the share of pixels (0..1) under which each one goes over. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

/** A picture (w x h) in this season, going over from one season's (`get`) to the next's, dithered. */
export function blendSeasons(get: (s: SeasonName) => Raster | null, w: number, h: number, season: Season): Raster {
  const { from, to, t } = seasonFrames(season.day);
  const out = new Raster(w, h), a = get(from), b = to !== from ? get(to) : a;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const src = b !== a && BAYER[(y & 3) * 4 + (x & 3)] < t ? b : a;
      if (!src || x >= src.w || y >= src.h) continue;
      const o = (y * src.w + x) * 4;
      if (src.data[o + 3]) out.set(x, y, [src.data[o], src.data[o + 1], src.data[o + 2]]);
    }
  return out;
}

/** The file art/<dir>/<name>.aseprite's picture (its layer `layer`) in this season, if there's the file. */
export function seasonalArt(dir: string, name: string, season: Season, layer = 'art'): Raster | null {
  const f = artFile(`${dir}/${name}`);
  if (!f || !f.layers.includes(layer)) return null;
  return blendSeasons((s) => seasonal(f, dir, name, layer, s), f.w, f.h, season);
}

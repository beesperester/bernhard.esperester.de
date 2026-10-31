// A tree drawn as a file needs only its summer: autumn and spring are its
// leaves (back and front) recoloured, and in winter the leaves are gone but
// for the pine's, leaving the middle (the trunk and branches). The colours come
// from art/trees/seasons.aseprite: for each kind a ramp of its summer leaves,
// light to dark, and in each other season up to three ramps a leaf of that tone
// turns to (each cloud of leaves one of them: mostly the first), and a row of
// little dots sprinkled over the leaves (blossom, apples). A season's own frame
// in a tree's file, where it's painted, is shown instead.
import { Raster, hash2, type RGB } from './raster.ts';
import { artFile, type ArtFile } from './files.ts';
import { SEASON_NAMES, type SeasonName } from '../world/season.ts';
import { TREE_KINDS } from '../world/templates.ts';

/** The swatch file's layout: a swatch is SW px square; a season is a column of them, a kind a block of rows (RAMPS ramps, then the dots). */
export const SW = 8, RAMP_MAX = 8, RAMPS = 3;
export const COLUMN = SW * (RAMP_MAX + 1), BLOCK = SW * (RAMPS + 2);

/** Where swatch i of row `row` (0..RAMPS-1 a ramp, RAMPS the dots) of a kind (its number) in a season is (its top left). */
export const swatchAt = (season: number, kind: number, row: number, i: number): [number, number] => [season * COLUMN + i * SW, kind * BLOCK + row * SW];

interface Look { ramps: RGB[][]; dots: RGB[] }

const looks = new Map<string, Look>();
/** A kind's colours in a season, as the swatch file has them. */
function look(kind: string, season: SeasonName): Look {
  const key = `${kind}-${season}`;
  let l = looks.get(key);
  if (!l) {
    const f = artFile('trees/seasons'), r = f?.layer(f.layers[0] ?? '', 0) ?? null;
    const row = (k: number, n: number): RGB[] => {
      const out: RGB[] = [];
      for (let i = 0; i < RAMP_MAX && r; i++) {
        const [x, y] = swatchAt(SEASON_NAMES.indexOf(season), TREE_KINDS.indexOf(kind as never), n, i), o = ((y + SW / 2) * r.w + x + SW / 2) * 4;
        if (k < 0 || !r.data[o + 3]) break;
        out.push([r.data[o], r.data[o + 1], r.data[o + 2]]);
      }
      return out;
    };
    const k = TREE_KINDS.indexOf(kind as never);
    l = { ramps: [0, 1, 2].map((n) => row(k, n)).filter((x) => x.length), dots: row(k, RAMPS) };
    looks.set(key, l);
  }
  return l;
}

const lum = (c: ArrayLike<number>, o = 0) => c[o] * 0.3 + c[o + 1] * 0.59 + c[o + 2] * 0.11;

/** Soft noise (0..1) on a grid `size` px across. */
function smooth(x: number, y: number, size: number, seed: number): number {
  const gx = Math.floor(x / size), gy = Math.floor(y / size), fx = x / size - gx, fy = y / size - gy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const h = (i: number, j: number) => hash2(gx + i, gy + j, seed);
  return (h(0, 0) * (1 - sx) + h(1, 0) * sx) * (1 - sy) + (h(0, 1) * (1 - sx) + h(1, 1) * sx) * sy;
}

/** Which of n ramps the leaves at (x, y) turn to: in clouds about CLOUD px across, mostly the first ramp. */
const CLOUD = 32;
function rampAt(x: number, y: number, n: number, seed: number): number {
  // (each other ramp has its clouds of its own, so one never rings another)
  const at = (k: number) => smooth(x, y, CLOUD, seed + k * 7) * 0.9 + smooth(x, y, CLOUD / 4, seed + k * 7 + 1) * 0.1;
  if (n > 2 && at(2) > 0.7) return 2;
  return n > 1 && at(1) > 0.66 ? 1 : 0;
}

/** Leaves (a layer of the summer frame) in another season, recoloured tone for tone. */
function recoloured(summer: Raster, kind: string, season: SeasonName): Raster {
  const from = look(kind, 'summer').ramps[0], to = look(kind, season);
  const out = new Raster(summer.w, summer.h);
  out.data.set(summer.data);
  if (!from?.length || !to.ramps.length) return out;
  const tones = from.map((c) => lum(c));
  for (let k = 0; k < summer.w * summer.h; k++) {
    const o = k * 4;
    if (!summer.data[o + 3]) continue;
    const L = lum(summer.data, o);
    let i = 0;
    for (let j = 1; j < tones.length; j++) if (Math.abs(tones[j] - L) < Math.abs(tones[i] - L)) i = j;
    const x = k % summer.w, y = Math.floor(k / summer.w);
    const ramp = to.ramps[rampAt(x, y, to.ramps.length, 1720)];
    out.set(x, y, ramp[Math.round((i * (ramp.length - 1)) / Math.max(1, tones.length - 1))]);
  }
  // little dots over the leaves (blossom, apples), each 2 x 2 with its shadow in a corner, where there are leaves all round
  const dots = to.dots;
  if (dots.length)
    for (let y = 1; y < summer.h - 2; y++)
      for (let x = 1; x < summer.w - 2; x++) {
        if (hash2(x, y, 1730) >= 1 / 120) continue;
        if (!out.isSet(x - 1, y) || !out.isSet(x + 2, y + 2) || !out.isSet(x, y)) continue;
        const c = dots[Math.floor(hash2(x, y, 1731) * dots.length)];
        const o = (y * out.w + x) * 4, shade: RGB = [out.data[o], out.data[o + 1], out.data[o + 2]];
        out.set(x, y, c); out.set(x + 1, y, c); out.set(x, y + 1, c); out.set(x + 1, y + 1, lum(shade) < lum(c) ? shade : c);
      }
  return out;
}

const made = new Map<string, Raster | null>();
/**
 * Layer `name` (back, mid, front) of tree file f of this kind in a season: its own frame
 * for the season if it's painted, else worked out from the summer frame.
 */
export function seasonLayer(f: ArtFile, path: string, kind: string, name: string, season: SeasonName): Raster | null {
  const own = f.tags.get(season);
  if (own) return f.layer(name, own[0]);
  const summer = f.layer(name, f.tags.get('summer')?.[0] ?? 0);
  if (name === 'mid' || !summer) return summer;
  if (season === 'winter' && kind !== 'pine') return null;
  const key = `${path}-${name}-${season}`;
  if (!made.has(key)) made.set(key, recoloured(summer, kind, season));
  return made.get(key)!;
}

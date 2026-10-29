// Painted shading, as the GPU does it (game/Painted.ts): a picture is drawn
// not in its colours but in what it is made of, and the light picks the
// colours. Each pixel names a ramp (a row of the painted tones of one
// material, light to dark: a crown's leaves, the bark, the moss) and carries
// its normal and the numbers that shade it; the shader works out how lit it
// is and takes that tone from its ramp, as art/trees.ts' shade() would. So
// the sun can move on smoothly, and nothing is repainted for it.
//
// Two pictures go to the GPU: the main one, where a shaded pixel holds its
// ramp's row and two numbers in its colour, and the normal map (its data
// source), where it holds its normal, a third number, and whether it is
// shaded at all. Pixels not shaded (a bird house's paint) keep their colour.
import type { RGB } from './raster.ts';

/** What a ramp is of: it is shaded differently (the leaves by their normals, bark round its trunk). */
export const Kind = { Leaf: 0, Bark: 1, Moss: 2, Blob: 3 } as const;
export type Kind = (typeof Kind)[keyof typeof Kind];

/** A ramp has up to this many tones (its last slot holds its kind)... */
export const RAMP_W = 8;
/** ...and there are this many rows of them. */
export const RAMP_ROWS = 256;

/** The ramps every painted picture shades from, by row: added as pictures need them, never taken away. */
export class Ramps {
  readonly rows: { tones: RGB[]; kind: Kind }[] = [];
  private readonly byKey = new Map<string, number>();

  /** The row of ramp `tones` of `kind` (added if it's new; the last row once they're all used). */
  row(tones: RGB[], kind: Kind): number {
    const key = `${kind}:${tones.join(';')}`;
    let r = this.byKey.get(key);
    if (r === undefined) {
      if (this.rows.length >= RAMP_ROWS) return RAMP_ROWS - 1;
      r = this.rows.push({ tones: tones.slice(0, RAMP_W - 1), kind }) - 1;
      this.byKey.set(key, r);
    }
    return r;
  }

  /** The ramps as pixels, RAMP_W x RAMP_ROWS, the kind in the red of each row's last pixel. */
  pixels(out = new Uint8ClampedArray(RAMP_W * RAMP_ROWS * 4)): Uint8ClampedArray {
    this.rows.forEach(({ tones, kind }, r) => {
      for (let t = 0; t < RAMP_W; t++) {
        const o = (r * RAMP_W + t) * 4, c = t === RAMP_W - 1 ? [kind, 0, 0] : tones[Math.min(t, tones.length - 1)];
        out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = 255;
      }
    });
    return out;
  }
}

export const ramps = new Ramps();

/** A number in -range..range as a byte, and back (the GLSL in game/Painted.ts undoes it the same way). */
export const toByte = (v: number, range: number): number => Math.max(0, Math.min(255, Math.round((v / range / 2 + 0.5) * 255)));
export const fromByte = (b: number, range: number): number => (b / 255 - 0.5) * 2 * range;

/** How far the numbers kept in each channel go either way: normals, the place in a crown, the texture. */
export const N_RANGE = 1, C_RANGE = 2, J_RANGE = 2;
/**
 * In the normal map's alpha: 0 nothing standing (empty, or the flat ground); PLAIN for something
 * standing but not shaded, in its own colours; COAT for fur, its colour looked up in a coat map
 * (art/coat.ts); else shaded from a ramp: 1 + speck (0..1) * SPECK on a leaf, plus RIM_BIT on a
 * puff's rim, 1 for anything else.
 */
export const SPECK = 62, RIM_BIT = 64, COAT = 128, PLAIN = 255;

/** Pictures encoded against another thread's ramps (`theirs`, its rows: the painter's), moved onto this thread's, in place. */
export function adoptRamps(mains: Uint8ClampedArray[], normal: Uint8Array, theirs: Ramps['rows']): void {
  const to = theirs.map((t) => ramps.row(t.tones, t.kind));
  for (let o = 0; o < normal.length; o += 4) {
    const f = normal[o + 3];
    if (f !== 0 && f < COAT) for (const m of mains) m[o] = to[m[o]];
  }
}

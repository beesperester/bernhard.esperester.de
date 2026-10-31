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
 * (art/coat.ts); AUTO for a picture's own colours, a little lighter or darker as it faces the light
 * (autoMaps); else shaded from a ramp: 1 + speck (0..1) * SPECK on a leaf, plus RIM_BIT on a
 * puff's rim, 1 for anything else.
 */
export const SPECK = 62, RIM_BIT = 64, COAT = 128, AUTO = 129, PLAIN = 255;

/** Pictures encoded against another thread's ramps (`theirs`, its rows: the painter's), moved onto this thread's, in place. */
export function adoptRamps(mains: Uint8ClampedArray[], normal: Uint8Array, theirs: Ramps['rows']): void {
  const to = theirs.map((t) => ramps.row(t.tones, t.kind));
  for (let o = 0; o < normal.length; o += 4) {
    const f = normal[o + 3];
    if (f !== 0 && f < COAT) for (const m of mains) m[o] = to[m[o]];
  }
}

/**
 * Which way a picture's surface faces at (x, y), from its outline alone: away from the inside, more
 * so nearer the edge (within `reach` px), flat further in. `solid` says where the picture is.
 */
export function outlineNormal(solid: (x: number, y: number) => boolean, x: number, y: number, reach = 3): [number, number] {
  let ax = 0, ay = 0;
  for (let dy = -reach; dy <= reach; dy++)
    for (let dx = -reach; dx <= reach; dx++) {
      const d2 = dx * dx + dy * dy;
      if (!d2 || d2 > reach * reach || solid(x + dx, y + dy)) continue;
      ax += dx / d2;
      ay += dy / d2;
    }
  const len = Math.hypot(ax, ay);
  if (len < 1e-6) return [0, 0];
  const k = Math.min(1, len / 1.5);
  return [(ax / len) * k, (ay / len) * k];
}

/**
 * A picture as the GPU draws anything with no normals of its own: its colours, and normals from its
 * outline (AUTO), or where it has a normal map painted (`painted`, as fileNormal() has them), from that.
 */
export function autoMaps(r: { w: number; h: number; data: Uint8ClampedArray }, painted?: Uint8ClampedArray): { main: Uint8ClampedArray; normal: Uint8Array } {
  const { w, h, data } = r, main = new Uint8ClampedArray(data), normal = new Uint8Array(data.length);
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && data[(y * w + x) * 4 + 3] > 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!solid(x, y)) continue;
      const o = (y * w + x) * 4, [nx, ny] = painted?.[o + 3] ? fromFileNormal(painted, o) : outlineNormal(solid, x, y);
      main[o + 3] = 255;
      normal[o] = toByte(nx, N_RANGE);
      normal[o + 1] = toByte(ny, N_RANGE);
      normal[o + 3] = AUTO;
    }
  return { main, normal };
}

/**
 * A normal as a normal map painted in a file shows it (the usual way: red to the right, green up,
 * blue towards you), from the way it faces on screen (x right, y down; -1..1).
 */
export function fileNormal(nx: number, ny: number): [number, number, number] {
  const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
  return [toByte(nx, 1), toByte(-ny, 1), toByte(nz, 1)];
}
/** ...and back (RGBA at o). */
const fromFileNormal = (m: Uint8ClampedArray, o: number): [number, number] => [fromByte(m[o], 1), -fromByte(m[o + 1], 1)];

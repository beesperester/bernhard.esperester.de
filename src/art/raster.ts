// A tiny RGBA pixel buffer. All art is drawn into rasters so it can be
// rendered both in the browser (as Phaser textures) and in Node (PNG previews).

export type RGB = readonly [number, number, number];

export function hex(h: string): RGB {
  const n = parseInt(h.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** One bit of a picture per pixel (a byte each): where the water is, say. Asked like a raster's alpha. */
/** Anything that says, pixel by pixel, whether it is set. */
export interface Bits { readonly w: number; readonly h: number; isSet(x: number, y: number): boolean }

export class Mask implements Bits {
  readonly data: Uint8Array;
  readonly w: number;
  readonly h: number;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.data = new Uint8Array(w * h);
  }

  set(x: number, y: number): void {
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.data[y * this.w + x] = 1;
  }

  isSet(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h && this.data[y * this.w + x] === 1;
  }

  /** The part in box (x, y, w, h), looked at as if it were all there is. */
  window(x: number, y: number, w: number, h: number): Bits {
    return { w, h, isSet: (i, j) => i >= 0 && j >= 0 && i < w && j < h && this.isSet(x + i, y + j) };
  }

  /** The part in box (x, y, w, h) as a raster: white where set. */
  crop(x: number, y: number, w: number, h: number): Raster {
    const r = new Raster(w, h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (this.isSet(x + i, y + j)) r.set(i, j, [255, 255, 255]);
    return r;
  }
}

export class Raster {
  readonly data: Uint8ClampedArray<ArrayBuffer>;
  readonly w: number;
  readonly h: number;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.data = new Uint8ClampedArray(w * h * 4);
  }

  set(x: number, y: number, c: RGB, a = 255): void {
    x |= 0;
    y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    this.data[i] = c[0];
    this.data[i + 1] = c[1];
    this.data[i + 2] = c[2];
    this.data[i + 3] = a;
  }

  isSet(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return false;
    return this.data[(y * this.w + x) * 4 + 3] > 0;
  }

  rect(x: number, y: number, w: number, h: number, c: RGB): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }

  /** Draw a character-map sprite. Characters missing from the palette are transparent. */
  paint(rows: readonly string[], ox: number, oy: number, pal: Record<string, RGB>, flip = false): void {
    for (let y = 0; y < rows.length; y++) {
      const row = rows[y];
      for (let x = 0; x < row.length; x++) {
        const c = pal[row[x]];
        if (c) this.set(ox + (flip ? row.length - 1 - x : x), oy + y, c);
      }
    }
  }

  blit(src: Raster, ox: number, oy: number): void {
    for (let y = 0; y < src.h; y++)
      for (let x = 0; x < src.w; x++) {
        const i = (y * src.w + x) * 4;
        if (src.data[i + 3] === 0) continue;
        this.set(ox + x, oy + y, [src.data[i], src.data[i + 1], src.data[i + 2]]);
      }
  }
}

/** Deterministic PRNG so the garden looks identical for every visitor. */
/** A dark outline round everything drawn on `r` so far, in `c`. */
export function outline(r: Raster, c: RGB): void {
  const edge: [number, number][] = [];
  for (let y = 0; y < r.h; y++)
    for (let x = 0; x < r.w; x++)
      if (!r.isSet(x, y) && (r.isSet(x - 1, y) || r.isSet(x + 1, y) || r.isSet(x, y - 1) || r.isSet(x, y + 1))) edge.push([x, y]);
  for (const [x, y] of edge) r.set(x, y, c);
}

/** Colour a mixed towards b by t (0..1). */
export const mix = (a: readonly number[], b: readonly number[], t: number): [number, number, number] =>
  [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable per-tile hash in [0,1). */
export function hash2(x: number, y: number, s = 0): number {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

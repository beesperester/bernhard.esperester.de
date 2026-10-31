// The art drawn as files (art/**/*.aseprite, brought in by tools/art-plugin.ts):
// each file's layers in each frame, and its tags (the seasons, say). Unpacked
// once as the game loads (here, and in the painter's thread); a layer's picture
// is made the first time it's asked for. A tool run with ART=off (drawing the
// art from code, to write the files) goes without.
import { Raster } from './raster.ts';
import type ART_TYPE from 'virtual:art';

type Packed = typeof ART_TYPE;

export interface ArtFile {
  w: number;
  h: number;
  frames: number;
  /** Its tags by name (lower case): their first and last frames. */
  tags: Map<string, [number, number]>;
  /** The layers at the top, bottom first (lower case). */
  layers: string[];
  /** A layer's picture in frame f (null: nothing there, or no such layer). */
  layer(name: string, f?: number): Raster | null;
}

const off = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.ART === 'off';
const packed: Packed = off ? { files: {}, palette: '' } : (await import('virtual:art')).default;

async function inflate(packed: Packed): Promise<Uint16Array> {
  const bytes = packed.pixels !== undefined ? Uint8Array.from(atob(packed.pixels), (c) => c.charCodeAt(0))
    : packed.url ? new Uint8Array(await (await fetch(packed.url)).arrayBuffer()) : new Uint8Array();
  if (!bytes.length) return new Uint16Array();
  const raw = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer();
  return new Uint16Array(raw);
}

const PIXELS = await inflate(packed);
const PALETTE: [number, number, number][] = [];
for (let i = 0; i < packed.palette.length; i += 6) {
  const c = parseInt(packed.palette.slice(i, i + 6), 16);
  PALETTE.push([c >> 16, (c >> 8) & 255, c & 255]);
}

const FILES = new Map<string, ArtFile>();
for (const [path, f] of Object.entries(packed.files)) {
  const made = new Map<string, Raster | null>();
  FILES.set(path, {
    w: f.w, h: f.h, frames: f.frames,
    tags: new Map(f.tags.map(([n, a, b]) => [n, [a, b]])),
    layers: f.layers.map((l) => l.name),
    layer(name, frame = 0) {
      const key = `${name}@${frame}`;
      if (made.has(key)) return made.get(key)!;
      const at = f.layers.find((l) => l.name === name)?.at[frame] ?? -1;
      let r: Raster | null = null;
      if (at >= 0) {
        r = new Raster(f.w, f.h);
        for (let k = 0; k < f.w * f.h; k++) {
          const c = PIXELS[at + k];
          if (c) r.set(k % f.w, Math.floor(k / f.w), PALETTE[c - 1]);
        }
      }
      made.set(key, r);
      return r;
    },
  });
}

/** The file art/<path>.aseprite (as 'trees/pine-m'), if there is one. */
export const artFile = (path: string): ArtFile | null => FILES.get(path) ?? null;

/** Whether there's a file art/<path>.aseprite. */
export const hasArt = (path: string): boolean => FILES.has(path);

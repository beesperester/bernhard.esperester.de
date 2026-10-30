// The trees as painted by hand (masters/sprites/trees/, brought in by
// tools/trees-in.ts): for a kind and size of tree, its leaves at the back,
// its middle (trunk and branches) and its leaves in front. Where one is
// painted, every tree of that kind and size is that one (world/trees.ts
// plans it as its template, so a cat climbs what is painted); the rest are
// drawn from their plans as ever. Unpacked once as the game loads (here,
// and in the painter's thread).
import { Raster } from './raster.ts';
import { PAINTED_PALETTE, PAINTED_PIXELS, PAINTED_SIZES } from './paintedTrees.data.ts';

/** A painted tree's layers, all the same size, its trunk's foot at the bottom middle. */
export interface PaintedTree { w: number; h: number; back: Raster; mid: Raster; front: Raster }

export const LAYERS = ['back', 'mid', 'front'] as const;

/** The key of a kind and size of tree's layer. */
export const layerKey = (shape: string, size: number, layer: (typeof LAYERS)[number]) => `${shape}-${size}-${layer}`;

async function unpack(): Promise<Map<string, Raster>> {
  const out = new Map<string, Raster>();
  if (!PAINTED_PIXELS) return out;
  const pal: [number, number, number][] = [];
  for (let i = 0; i < PAINTED_PALETTE.length; i += 6) {
    const c = parseInt(PAINTED_PALETTE.slice(i, i + 6), 16);
    pal.push([c >> 16, (c >> 8) & 255, c & 255]);
  }
  const bytes = Uint8Array.from(atob(PAINTED_PIXELS), (c) => c.charCodeAt(0));
  const raw = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
  const px = new DataView(raw.buffer);
  let at = 0;
  for (const [key, [w, h]] of Object.entries(PAINTED_SIZES)) {
    const r = new Raster(w, h);
    for (let k = 0; k < w * h; k++, at += 2) {
      const c = px.getUint16(at, true);
      if (c) r.set(k % w, Math.floor(k / w), pal[c - 1]);
    }
    out.set(key, r);
  }
  return out;
}

const LAYERED = await unpack();

/** The painted tree of this kind ('broadleaf' or 'pine') and size (0..2), if there is one. */
export function paintedTree(shape: string, size: number): PaintedTree | null {
  const [back, mid, front] = LAYERS.map((l) => LAYERED.get(layerKey(shape, size, l)));
  if (!back || !mid || !front) return null;
  return { w: back.w, h: back.h, back, mid, front };
}

/** Whether a tree of this kind and size is painted (without unpacking anything: for laying out the garden). */
export const isPainted = (shape: string, size: number): boolean => LAYERS.every((l) => layerKey(shape, size, l) in PAINTED_SIZES);

/** The size of the painted tree of this kind and size (its layers'), if there is one. */
export function paintedSize(shape: string, size: number): [number, number] | null {
  return isPainted(shape, size) ? PAINTED_SIZES[layerKey(shape, size, 'back')] : null;
}

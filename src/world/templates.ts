// The trees painted by hand (art/paintedTrees.ts) are each one tree, the
// template for every tree of its kind and size: planned from a fixed seed
// and trunk (here), so the picture painted over it (tools/tree-layers.ts)
// and the branches a cat climbs (world/trees.ts) are the same tree's.
import { isPainted } from '../art/paintedTrees.ts';

/** Each template's seed and the half width of its trunk, by size (0 small .. 2 big). */
export const TEMPLATE_SEED = { broadleaf: [11, 12, 13], pine: [21, 22, 23] } as const;
export const TEMPLATE_TRUNK = { broadleaf: [6, 9, 14], pine: [5, 8, 11] } as const;

export type TemplateShape = keyof typeof TEMPLATE_SEED;

/** The kind of tree on a map tile ('P' a pine, 'H' the tree house), if it has a template. */
export const templateShape = (ch: string): TemplateShape | null => (ch === 'P' ? 'pine' : ch === 'H' ? null : 'broadleaf');

/** Whether a tree on map tile ch of this size is painted, and so its template. */
export function paintedShape(ch: string, size: number): TemplateShape | null {
  const shape = templateShape(ch);
  return shape && isPainted(shape, size) ? shape : null;
}

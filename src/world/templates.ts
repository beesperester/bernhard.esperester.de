// The trees are drawn as files (art/trees/<kind>-<s|m>.aseprite, art/paintedTrees.ts):
// each kind and size one tree, the template for every tree of its kind and size,
// planned from a fixed seed and trunk (here), so the picture drawn from code to
// paint over (tools/art-trees.ts) and the branches a cat climbs (world/trees.ts)
// are the same tree's.
import { hash2 } from '../art/raster.ts';
import { isPainted } from '../art/paintedTrees.ts';

/** The kinds of tree: the green ones, a cooler green, the cherry and the apple tree, and the pine. */
export const TREE_KINDS = ['broadleaf', 'beech', 'cherry', 'apple', 'pine'] as const;
export type TreeKind = (typeof TREE_KINDS)[number];

/** Each kind's template's seed and the half width of its trunk, by size (0 small, 1 medium). */
export const TEMPLATE_SEED: Record<TreeKind, readonly number[]> = { broadleaf: [11, 12], beech: [14, 15], cherry: [16, 24], apple: [18, 19], pine: [21, 22] };
export const TEMPLATE_TRUNK: Record<TreeKind, readonly number[]> = { broadleaf: [6, 9], beech: [6, 9], cherry: [6, 9], apple: [6, 9], pine: [5, 8] };

/** A broad-leaved kind's leaves, as the plans number them (art/trees.ts): 0 green, 1 cooler green, 2 cherry, 3 apple. */
export const KIND_COLOUR: Record<TreeKind, number> = { broadleaf: 0, beech: 1, cherry: 2, apple: 3, pine: 0 };

/** The kind of tree on map tile ch at (tx, ty) ('P' a pine; null: the tree house, which has no template). */
export function treeKindAt(ch: string, tx: number, ty: number): TreeKind | null {
  if (ch === 'H') return null;
  if (ch === 'P') return 'pine';
  const h = hash2(tx, ty, 55);
  return h < 0.22 ? 'cherry' : h < 0.36 ? 'apple' : h < 0.6 ? 'beech' : 'broadleaf';
}

/** The kind of the tree on map tile ch at (tx, ty) of this size, if it's drawn as a file, and so its template. */
export function paintedKind(ch: string, tx: number, ty: number, size: number): TreeKind | null {
  const kind = treeKindAt(ch, tx, ty);
  return kind && isPainted(kind, size) ? kind : null;
}

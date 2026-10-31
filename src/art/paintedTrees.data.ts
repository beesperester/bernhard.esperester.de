// Made by tools/trees-in.ts from the painted trees in masters/sprites/trees/: do not edit.
import type { Perch } from '../world/trees.ts';

/** Each painted layer ('broadleaf-0-back', ...) and its size. */
export const PAINTED_SIZES: Record<string, [number, number]> = {};
/** What a cat stands on in each painted tree ('broadleaf-0', ...), drawn on its guide (as world/trees.ts plans perches); none: as planned. */
export const PAINTED_PERCHES: Record<string, Perch[]> = {};
/** Their colours, 6 hex digits each (numbered from 1). */
export const PAINTED_PALETTE = '';
/** Their pixels, one layer after the other, each a 16-bit number (little-endian; 0 nothing, else its colour), deflated (zlib) and in base64. */
export const PAINTED_PIXELS = '';

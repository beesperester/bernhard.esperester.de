// The follies about the park: weathered stone monuments and statues, some
// fallen into ruin with their stones scattered about, stepped stone
// platforms, and tea-garden pavilions under curved tiled roofs; most a cat
// can climb, ledge by ledge (world/park.ts places them, garden.ts lists where
// they ended up, art/landmarks.ts draws them).
//
// Each one is built from a few simple shapes (blocks, columns, balls, domes
// and roofs) in px from the top-left of its tiles, with heights. The same shapes
// are what cats bump into and stand on, and what gets drawn, so a ledge
// that looks reachable is.

export type LandmarkKind = 'rotunda' | 'tower' | 'colonnade' | 'terrace' | 'obelisk' | 'catstatue' | 'urn' | 'pavilion' | 'teahouse' | 'lookout';

export interface LandmarkInfo {
  /** Its name, shown on a plaque when a cat comes by. */
  name: string;
}

export const LANDMARKS: Record<LandmarkKind, LandmarkInfo> = {
  rotunda: { name: 'The Rotunda' },
  tower: { name: 'Old Tower' },
  colonnade: { name: 'Colonnade' },
  terrace: { name: 'Stone Terrace' },
  obelisk: { name: 'Obelisk' },
  catstatue: { name: 'The Great Cat' },
  urn: { name: 'Stone Urn' },
  pavilion: { name: 'Tea Pavilion' },
  teahouse: { name: 'Teahouse' },
  lookout: { name: 'Lookout' },
};

/** Tiles each one takes up, across and deep. */
export const LANDMARK_SIZE: Record<LandmarkKind, [number, number]> = {
  rotunda: [3, 2], tower: [2, 2], colonnade: [4, 1], terrace: [4, 2], obelisk: [2, 2], catstatue: [2, 2], urn: [2, 2],
  pavilion: [3, 3], teahouse: [4, 3], lookout: [3, 3],
};

/** What a shape is made of (art/landmarks.ts has the colours). */
export type Material = 'stone' | 'dark' | 'bronze' | 'gold' | 'paper' | 'lacquer' | 'wood' | 'tile';

interface Common {
  mat: Material;
  /** Bottom and top height (px above the ground). */
  z: [number, number];
  /** Something to look at, not to stand on. */
  solid?: false;
  /** Broken off: its top is jagged by up to this many px (drawn only; it stands flat). */
  ragged?: number;
  /** Ivy grows down its front. */
  ivy?: boolean;
  /** Overhead (a roof): drawn over a cat up on the folly, not under it. */
  over?: true;
}
/** A block: x0, y0, x1, y1 on the ground. */
export interface Block extends Common { box: [number, number, number, number] }
/** A round column: centre and radius on the ground (seen at a slant: ROUND as deep as it is wide). */
export interface Column extends Common { cyl: [number, number, number] }
/** A ball: centre on the ground, radius (z is [the height of its centre, the same]). */
export interface Ball extends Common { ball: [number, number, number] }
/** A dome over a ring: centre and radius on the ground, from z[0] up (z[1] is the top). */
export interface Dome extends Common { dome: [number, number, number]; ribs?: boolean }
/** A hipped roof over x0, y0, x1, y1 on the ground: from its eaves at z[0] up to its ridge at z[1], its slopes
 * sweeping up (steeper near the ridge) and its corners turned up by `curl` px. */
export interface Roof extends Common { roof: [number, number, number, number]; curl: number }
export type Shape = Block | Column | Ball | Dome | Roof;

/** Round things on the ground are ellipses, this much as deep as they are wide. */
export const ROUND = 0.6;

/** Rubble: a few low fallen stones, from a seed, inside the box x0, y0, x1, y1. */
function rubble(seed: number, x0: number, y0: number, x1: number, y1: number, n: number, mat: Material = 'stone', tall = 6): Block[] {
  const out: Block[] = [];
  let s = seed * 9301 + 49297;
  const r = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < n; i++) {
    const w = 3 + Math.floor(r() * 4), d = 2 + Math.floor(r() * 3), h = 2 + Math.floor(r() * (tall - 1));
    const x = x0 + Math.floor(r() * Math.max(1, x1 - x0 - w)), y = y0 + Math.floor(r() * Math.max(1, y1 - y0 - d));
    out.push({ box: [x, y, x + w, y + d], z: [0, h], mat, solid: false });
  }
  return out;
}

/** A stone lantern of a tea garden standing at (x, y) on ground z: its post, the lamp box (paper) and its cap. */
function lantern(x: number, y: number, z: number): Shape[] {
  return [
    { cyl: [x, y, 1], z: [z, z + 6], mat: 'dark', solid: false },
    { box: [x - 3, y - 2, x + 4, y + 2], z: [z + 6, z + 10], mat: 'paper', solid: false },
    { box: [x - 4, y - 3, x + 5, y + 3], z: [z + 10, z + 12], mat: 'dark', solid: false },
  ];
}

/** Where the lookout's stone lanterns stand (px from the top-left of its tiles; on its first step, 6 px up). */
export const LOOKOUT_LANTERNS: [number, number][] = [[4, 10], [44, 10], [4, 42], [44, 42]];

/** Lacquered posts at the corners of x0, y0, x1, y1, standing on z0 up to z1. */
const posts = (x0: number, y0: number, x1: number, y1: number, z0: number, z1: number): Column[] =>
  [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]): Column => ({ cyl: [x, y, 2], z: [z0, z1], mat: 'lacquer' }));

export const LANDMARK_SHAPES: Record<LandmarkKind, Shape[]> = {
  // a round temple: steps, six columns and a green dome
  rotunda: [
    { cyl: [24, 17, 15], z: [0, 5], mat: 'stone' },
    { cyl: [24, 17, 13], z: [0, 10], mat: 'stone' },
    ...[0, 1, 2, 3, 4, 5].map((i): Column => {
      const a = (i / 6) * Math.PI * 2 + 0.5;
      return { cyl: [Math.round(24 + Math.cos(a) * 10), Math.round(17 + Math.sin(a) * 8), 2], z: [10, 30], mat: 'stone' };
    }),
    { cyl: [24, 17, 12], z: [30, 33], mat: 'stone', solid: false },
    { dome: [24, 17, 12], z: [33, 45], mat: 'bronze', solid: false },
    { cyl: [24, 17, 1], z: [45, 50], mat: 'gold', solid: false },
  ],
  // a broken tower: ledge by ledge, all the way up its stump
  tower: [
    { box: [2, 8, 30, 30], z: [0, 13], mat: 'dark', ragged: 2 },
    { box: [22, 10, 30, 19], z: [0, 24], mat: 'dark', ragged: 2 },
    { box: [21, 5, 29, 10], z: [0, 35], mat: 'dark', ragged: 2 },
    { box: [9, 4, 21, 16], z: [0, 46], mat: 'dark', ragged: 6, ivy: true },
    { box: [4, 26, 12, 31], z: [0, 6], mat: 'dark' },
    ...rubble(11, 14, 25, 31, 32, 4, 'dark'),
  ],
  // columns under a beam, the right end fallen in: the stones it dropped make steps up onto it
  colonnade: [
    ...[2, 22, 42].map((x): Column => ({ cyl: [x, 10, 2], z: [0, 26], mat: 'stone' })),
    { cyl: [62, 10, 2], z: [0, 13], mat: 'stone', ragged: 3 },
    { box: [-1, 6, 47, 14], z: [26, 33], mat: 'stone', ragged: 2, ivy: true },
    // the fallen block leaning in the last arch, and a stone at its foot
    { box: [49, 6, 58, 13], z: [0, 22], mat: 'stone', ragged: 1 },
    { box: [51, 12, 59, 16], z: [0, 11], mat: 'stone' },
    ...rubble(3, 64, 9, 76, 16, 3),
  ],
  // a stepped stone terrace, its corner towers broken short, an urn on the top
  terrace: [
    { box: [0, 4, 64, 32], z: [0, 8], mat: 'stone' },
    { box: [6, 8, 58, 30], z: [0, 17], mat: 'stone', ivy: true },
    { box: [14, 12, 50, 28], z: [0, 26], mat: 'stone' },
    { box: [0, 4, 9, 12], z: [0, 19], mat: 'stone', ragged: 3 },
    { box: [55, 4, 64, 12], z: [0, 30], mat: 'stone', ragged: 3, ivy: true },
    { cyl: [32, 20, 3], z: [26, 31], mat: 'stone', solid: false },
    { ball: [32, 20, 5], z: [35, 35], mat: 'bronze', solid: false },
  ],
  // a needle of stone on two steps, its tip far out of reach
  obelisk: [
    { box: [3, 14, 29, 31], z: [0, 6], mat: 'stone' },
    { box: [7, 16, 25, 29], z: [0, 12], mat: 'stone' },
    { box: [11, 19, 21, 26], z: [12, 40], mat: 'stone' },
    { box: [12, 20, 20, 25], z: [40, 60], mat: 'stone' },
  ],
  // a great bronze cat sitting on its plinth: up the plinth, onto its shoulders (not its head)
  catstatue: [
    { box: [2, 12, 30, 30], z: [0, 11], mat: 'stone' },
    { box: [22, 26, 31, 31], z: [0, 5], mat: 'stone' },
    { cyl: [16, 20, 7], z: [11, 24], mat: 'bronze' },
    { box: [10, 24, 22, 28], z: [11, 14], mat: 'bronze', solid: false },
    { ball: [16, 20, 6], z: [30, 30], mat: 'bronze', solid: false },
  ],
  // an urn on a pedestal, on two steps
  urn: [
    { box: [2, 14, 30, 31], z: [0, 5], mat: 'stone' },
    { box: [6, 16, 26, 29], z: [0, 12], mat: 'stone' },
    { cyl: [16, 22, 5], z: [12, 22], mat: 'stone' },
    { ball: [16, 22, 7], z: [29, 29], mat: 'bronze', solid: false },
    { cyl: [16, 22, 5], z: [34, 37], mat: 'bronze', solid: false },
  ],
  // the tea pavilion: an open floor on red posts under a curved roof, a bench inside, a step up
  pavilion: [
    { box: [2, 8, 46, 44], z: [0, 6], mat: 'stone' },
    { box: [18, 44, 30, 47], z: [0, 3], mat: 'stone' },
    { box: [10, 16, 38, 20], z: [6, 12], mat: 'wood' },
    ...posts(7, 13, 41, 39, 6, 30),
    { roof: [-4, 6, 52, 44], z: [30, 46], curl: 9, mat: 'tile', solid: false, over: true },
  ],
  // the teahouse: a raised floor on a stone base, a low paper screen at its back to climb, under a long roof
  teahouse: [
    { box: [2, 8, 62, 44], z: [0, 10], mat: 'stone' },
    { box: [24, 44, 40, 48], z: [0, 5], mat: 'stone' },
    { box: [6, 11, 58, 15], z: [10, 18], mat: 'paper' },
    ...posts(6, 13, 58, 40, 10, 32),
    { box: [6, 30, 14, 34], z: [10, 14], mat: 'wood', solid: false },
    { roof: [-6, 4, 70, 46], z: [32, 50], curl: 10, mat: 'tile', solid: false, over: true },
  ],
  // the lookout: a stone platform in three steps, stone lanterns at the corners of the first
  lookout: [
    { box: [0, 6, 48, 46], z: [0, 6], mat: 'stone' },
    { box: [7, 10, 41, 40], z: [0, 13], mat: 'stone', ivy: true },
    { box: [14, 14, 34, 34], z: [0, 20], mat: 'stone' },
    ...LOOKOUT_LANTERNS.flatMap(([x, y]) => lantern(x, y, 6)),
  ],
};

/** Where a shape is on the screen, from the top-left of its tiles: x0, y0, x1, y1 (px). */
export function shapeBounds(s: Shape): [number, number, number, number] {
  const [z0, z1] = s.z;
  if ('box' in s) { const [x0, y0, x1, y1] = s.box; return [x0, y0 - z1 - 1, x1, y1 - z0]; }
  if ('cyl' in s) { const [cx, cy, r] = s.cyl; return [cx - r, Math.floor(cy - r * ROUND) - z1 - 1, cx + r + 1, Math.ceil(cy + r * ROUND) - z0 + 1]; }
  if ('ball' in s) { const [cx, cy, r] = s.ball; return [cx - r, cy - z0 - r - 1, cx + r + 1, cy - z0 + r + 1]; }
  if ('roof' in s) { const [x0, y0, x1, y1] = s.roof; return [x0, y0 - z1 - s.curl - 1, x1, y1 - z0 + 2]; }
  const [cx, cy, r] = s.dome;
  return [cx - r, cy - z1 - 1, cx + r + 1, Math.ceil(cy + r * ROUND) - z0 + 1];
}

/**
 * How each one is drawn: the sprite's size, and where its top-left corner is
 * from the top-left of its tiles (px), so that it covers all its shapes.
 */
export const LANDMARK_SPRITE = Object.fromEntries(
  (Object.keys(LANDMARK_SHAPES) as LandmarkKind[]).map((k) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of LANDMARK_SHAPES[k]) {
      const b = shapeBounds(s);
      x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3]);
    }
    // a pixel all round for the outline
    return [k, { w: x1 - x0 + 2, h: y1 - y0 + 2, ox: x0 - 1, oy: y0 - 1 }];
  }),
) as Record<LandmarkKind, { w: number; h: number; ox: number; oy: number }>;

/**
 * The solid parts, from the top-left of its tiles (px): x0, y0, x1, y1, top
 * height and bottom height (something with room under it, like the gate's
 * beam, only gets in the way of a cat up at its height).
 */
export const LANDMARK_SOLIDS = Object.fromEntries(
  (Object.keys(LANDMARK_SHAPES) as LandmarkKind[]).map((k) => [k, LANDMARK_SHAPES[k].filter((s) => s.solid !== false).map((s) => {
    const [z0, z1] = s.z;
    if ('box' in s) return [...s.box, z1, z0];
    if ('roof' in s) return [...s.roof, z1, z0];
    const [cx, cy, r] = 'cyl' in s ? s.cyl : 'ball' in s ? s.ball : s.dome;
    const d = Math.round(r * ROUND);
    return [cx - r, cy - d, cx + r + 1, cy + d + 1, z1, z0];
  })]),
) as Record<LandmarkKind, [number, number, number, number, number, number][]>;

/**
 * Where each part is on screen, from the top-left of its tiles (px): x0, y0,
 * x1, y1, and the ground y of its front (a cat behind that is hidden by it).
 * Statues and the like count too, solid or not.
 */
export const LANDMARK_COVERS = Object.fromEntries(
  (Object.keys(LANDMARK_SHAPES) as LandmarkKind[]).map((k) => [k, LANDMARK_SHAPES[k].map((s) => {
    const [z0, z1] = s.z;
    const [x0, y0, x1, y1] = 'box' in s ? s.box : 'roof' in s ? s.roof : (() => {
      const [cx, cy, r] = 'cyl' in s ? s.cyl : 'ball' in s ? s.ball : s.dome;
      const d = Math.round(r * ROUND);
      return [cx - r, cy - d, cx + r + 1, cy + d + 1];
    })();
    return [x0, y0 - z1, x1, y1 - z0, y1];
  })]),
) as Record<LandmarkKind, [number, number, number, number, number][]>;

/** How deep each one is, front to back, for its sun shadow (px either side), or round. */
export const LANDMARK_DEPTH: Record<LandmarkKind, number | 'round'> = {
  rotunda: 'round', tower: 9, colonnade: 3, terrace: 11, obelisk: 6, catstatue: 'round', urn: 'round', pavilion: 16, teahouse: 16, lookout: 18,
};

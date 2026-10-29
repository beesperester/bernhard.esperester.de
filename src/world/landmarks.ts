// Famous places of Berlin, as follies in the park: weathered stone monuments
// about the park, some whole, some fallen into ruin with their stones
// scattered about, and some a cat can climb, ledge by ledge (world/park.ts
// places them, garden.ts lists where they ended up, art/landmarks.ts draws them).
//
// Each one is built from a few simple shapes (blocks, columns, balls and
// domes) in px from the top-left of its tiles, with heights. The same shapes
// are what cats bump into and stand on, and what gets drawn, so a ledge
// that looks reachable is.

export type LandmarkKind = 'tvtower' | 'gate' | 'reichstag' | 'victory' | 'dom' | 'rathaus' | 'church' | 'wall' | 'checkpoint' | 'oberbaum' | 'schloss';

export interface LandmarkInfo {
  /** Its name, shown on a plaque when a cat comes by. */
  name: string;
  /** Where the real one is. */
  lat: number;
  lon: number;
}

export const LANDMARKS: Record<LandmarkKind, LandmarkInfo> = {
  tvtower: { name: 'Fernsehturm', lat: 52.5208, lon: 13.4094 },
  gate: { name: 'Brandenburger Tor', lat: 52.5163, lon: 13.3777 },
  reichstag: { name: 'Reichstag', lat: 52.5186, lon: 13.3762 },
  victory: { name: 'Siegessäule', lat: 52.5145, lon: 13.3501 },
  dom: { name: 'Berliner Dom', lat: 52.5191, lon: 13.4011 },
  rathaus: { name: 'Rotes Rathaus', lat: 52.5185, lon: 13.4083 },
  church: { name: 'Gedächtniskirche', lat: 52.5048, lon: 13.335 },
  wall: { name: 'East Side Gallery', lat: 52.505, lon: 13.4397 },
  checkpoint: { name: 'Checkpoint Charlie', lat: 52.5075, lon: 13.3904 },
  oberbaum: { name: 'Oberbaumbrücke', lat: 52.5019, lon: 13.4458 },
  schloss: { name: 'Schloss Charlottenburg', lat: 52.5208, lon: 13.2957 },
};

/** Tiles each one takes up, across and deep. */
export const LANDMARK_SIZE: Record<LandmarkKind, [number, number]> = {
  tvtower: [2, 2], gate: [4, 1], reichstag: [4, 2], victory: [2, 2], dom: [3, 2], rathaus: [3, 2],
  church: [2, 2], wall: [5, 1], checkpoint: [2, 1], oberbaum: [3, 1], schloss: [6, 2],
};

/** What a shape is made of (art/landmarks.ts has the colours). */
export type Material = 'stone' | 'dark' | 'brick' | 'bronze' | 'gold' | 'white' | 'paint' | 'iron' | 'ochre';

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
}
/** A block: x0, y0, x1, y1 on the ground. */
export interface Block extends Common { box: [number, number, number, number] }
/** A round column: centre and radius on the ground (seen at a slant: ROUND as deep as it is wide). */
export interface Column extends Common { cyl: [number, number, number] }
/** A ball: centre on the ground, radius (z is [the height of its centre, the same]). */
export interface Ball extends Common { ball: [number, number, number] }
/** A dome over a ring: centre and radius on the ground, from z[0] up (z[1] is the top). */
export interface Dome extends Common { dome: [number, number, number]; ribs?: boolean }
export type Shape = Block | Column | Ball | Dome;

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

/** The gate's columns: their centres (two px either side of each is solid), three wide arches between. */
const GATE_COLUMNS = [2, 22, 42, 62];

export const LANDMARK_SHAPES: Record<LandmarkKind, Shape[]> = {
  // a stone needle on a mossy plinth, with its ball and a spike on top
  tvtower: [
    { box: [3, 14, 29, 31], z: [0, 6], mat: 'stone' },
    { cyl: [16, 22, 3], z: [6, 72], mat: 'stone' },
    { ball: [16, 22, 9], z: [54, 54], mat: 'stone', solid: false },
    { cyl: [16, 22, 1], z: [72, 86], mat: 'iron', solid: false },
  ],
  // six columns under the beam, the right end fallen in: the stones it dropped make steps up onto it
  gate: [
    ...GATE_COLUMNS.slice(0, 3).map((x): Column => ({ cyl: [x, 10, 2], z: [0, 26], mat: 'stone' })),
    { cyl: [62, 10, 2], z: [0, 13], mat: 'stone', ragged: 3 },
    { box: [-1, 6, 47, 14], z: [26, 33], mat: 'stone', ragged: 2 },
    // the bronze horses, worn to a lump, on top
    { box: [17, 7, 27, 12], z: [33, 39], mat: 'bronze', ragged: 2 },
    // the fallen block leaning in the last arch, and a stone at its foot
    { box: [49, 6, 58, 13], z: [0, 22], mat: 'stone', ragged: 1 },
    { box: [51, 12, 59, 16], z: [0, 11], mat: 'stone' },
    ...rubble(3, 64, 9, 76, 16, 3),
  ],
  // a stepped stone terrace, its corner towers broken short, an iron dome over the top
  reichstag: [
    { box: [0, 4, 64, 32], z: [0, 8], mat: 'stone' },
    { box: [6, 8, 58, 30], z: [0, 17], mat: 'stone', ivy: true },
    { box: [14, 12, 50, 28], z: [0, 26], mat: 'stone' },
    { box: [0, 4, 9, 12], z: [0, 19], mat: 'stone', ragged: 3 },
    { box: [55, 4, 64, 12], z: [0, 30], mat: 'stone', ragged: 3, ivy: true },
    { dome: [32, 20, 12], z: [26, 38], mat: 'iron', solid: false, ribs: true },
  ],
  // the round plinth, the column snapped off, a drum of it fallen, and golden Victoria in pieces on the grass
  victory: [
    { cyl: [16, 18, 13], z: [0, 10], mat: 'dark' },
    { cyl: [16, 16, 4], z: [10, 30], mat: 'stone', ragged: 4 },
    { cyl: [16, 16, 5], z: [17, 19], mat: 'gold', solid: false },
    { cyl: [16, 16, 5], z: [25, 27], mat: 'gold', solid: false },
    { box: [5, 20, 12, 27], z: [10, 19], mat: 'stone' },
    { box: [22, 27, 30, 31], z: [0, 4], mat: 'gold' },
    { ball: [6, 29, 2], z: [2, 2], mat: 'gold', solid: false },
    ...rubble(5, 1, 4, 31, 9, 2),
  ],
  // a round temple: steps, six columns and a green dome
  dom: [
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
  // a red brick clock tower, and the stub of a wall beside it to climb
  rathaus: [
    { box: [0, 6, 48, 32], z: [0, 6], mat: 'stone' },
    { box: [13, 9, 31, 27], z: [0, 58], mat: 'brick' },
    { box: [31, 13, 46, 21], z: [0, 18], mat: 'brick', ragged: 4, ivy: true },
    { box: [2, 15, 13, 23], z: [0, 11], mat: 'brick', ragged: 3 },
    ...rubble(7, 32, 23, 47, 31, 3, 'brick'),
  ],
  // the broken church tower: ledge by ledge, all the way up its stump
  church: [
    { box: [2, 8, 30, 30], z: [0, 13], mat: 'dark', ragged: 2 },
    { box: [22, 10, 30, 19], z: [0, 24], mat: 'dark', ragged: 2 },
    { box: [21, 5, 29, 10], z: [0, 35], mat: 'dark', ragged: 2 },
    { box: [9, 4, 21, 16], z: [0, 46], mat: 'dark', ragged: 6, ivy: true },
    { box: [4, 26, 12, 31], z: [0, 6], mat: 'dark' },
    ...rubble(11, 14, 25, 31, 32, 4, 'dark'),
  ],
  // the painted concrete slabs, one broken low with its pieces at its foot: up there and along the top
  wall: [
    ...[0, 1, 2, 3, 4, 6].map((i): Block => ({ box: [i * 10, 5, i * 10 + 10, 11], z: [0, 22], mat: 'paint' })),
    { box: [50, 5, 60, 11], z: [0, 12], mat: 'paint', ragged: 3 },
    { box: [70, 11, 80, 16], z: [0, 3], mat: 'paint' },
    { box: [52, 11, 59, 16], z: [0, 6], mat: 'stone' },
  ],
  // the little white hut behind its sandbags: up the bags, onto the roof
  checkpoint: [
    { box: [8, 2, 24, 12], z: [0, 19], mat: 'white' },
    { box: [0, 7, 8, 15], z: [0, 6], mat: 'stone' },
    { box: [1, 4, 7, 10], z: [0, 11], mat: 'stone' },
    { box: [24, 7, 32, 15], z: [0, 6], mat: 'stone' },
    { cyl: [16, 6, 1], z: [19, 27], mat: 'iron', solid: false },
  ],
  // the brick bridge with its two towers, and a ramp of steps at each end
  oberbaum: [
    { box: [5, 4, 43, 13], z: [0, 14], mat: 'brick' },
    { box: [0, 6, 5, 13], z: [0, 7], mat: 'brick' },
    { box: [43, 6, 48, 13], z: [0, 7], mat: 'brick' },
    { box: [15, 3, 21, 11], z: [0, 33], mat: 'brick', ragged: 2 },
    { box: [27, 3, 33, 11], z: [0, 33], mat: 'brick', ragged: 2 },
  ],
  // the long ochre palace: up the front terrace, onto the east wing (fallen low) or the west wing
  // (ivy all down it), and from the west wing onto the middle block; the green dome with golden
  // Fortuna on top stays out of reach
  schloss: [
    { box: [0, 24, 96, 32], z: [0, 5], mat: 'stone' },
    { box: [2, 9, 34, 25], z: [0, 16], mat: 'ochre', ivy: true },
    { box: [62, 9, 94, 25], z: [0, 11], mat: 'ochre', ragged: 4 },
    { box: [34, 5, 62, 27], z: [0, 26], mat: 'ochre' },
    { cyl: [48, 15, 7], z: [26, 32], mat: 'white', solid: false },
    { dome: [48, 15, 7], z: [32, 42], mat: 'bronze', solid: false },
    { cyl: [48, 15, 1], z: [42, 50], mat: 'gold', solid: false },
    ...rubble(13, 70, 26, 95, 32, 3, 'ochre'),
  ],
};

/** Where a shape is on the screen, from the top-left of its tiles: x0, y0, x1, y1 (px). */
export function shapeBounds(s: Shape): [number, number, number, number] {
  const [z0, z1] = s.z;
  if ('box' in s) { const [x0, y0, x1, y1] = s.box; return [x0, y0 - z1 - 1, x1, y1 - z0]; }
  if ('cyl' in s) { const [cx, cy, r] = s.cyl; return [cx - r, Math.floor(cy - r * ROUND) - z1 - 1, cx + r + 1, Math.ceil(cy + r * ROUND) - z0 + 1]; }
  if ('ball' in s) { const [cx, cy, r] = s.ball; return [cx - r, cy - z0 - r - 1, cx + r + 1, cy - z0 + r + 1]; }
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
    const [x0, y0, x1, y1] = 'box' in s ? s.box : (() => {
      const [cx, cy, r] = 'cyl' in s ? s.cyl : 'ball' in s ? s.ball : s.dome;
      const d = Math.round(r * ROUND);
      return [cx - r, cy - d, cx + r + 1, cy + d + 1];
    })();
    return [x0, y0 - z1, x1, y1 - z0, y1];
  })]),
) as Record<LandmarkKind, [number, number, number, number, number][]>;

/** How deep each one is, front to back, for its sun shadow (px either side), or round. */
export const LANDMARK_DEPTH: Record<LandmarkKind, number | 'round'> = {
  tvtower: 'round', gate: 3, reichstag: 11, victory: 'round', dom: 'round', rathaus: 9, church: 9, wall: 3, checkpoint: 5, oberbaum: 4, schloss: 9,
};

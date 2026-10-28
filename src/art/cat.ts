import { Raster, hex, type RGB } from './raster.ts';
import { KITTEN_FRAMES, youngFrame } from './kitten.ts';

// Cat sprites are 16x16 character maps.
//   o outline   b fur   d fur shade/stripes   k patch (calico)
//   w white fur p pink  e eyes   r mouth   . transparent

export const CAT = 16;

/** Mirror an 8-wide left half into a symmetric 16-wide row. */
const sym = (rows: string[]): string[] => rows.map((l) => l + [...l].reverse().join(''));

/** Return a copy of rows with characters overwritten at (x, y). */
function patch(rows: string[], edits: [number, number, string][]): string[] {
  const out = rows.map((r) => [...r]);
  for (const [x, y, s] of edits) for (let i = 0; i < s.length; i++) out[y][x + i] = s[i];
  return out.map((r) => r.join(''));
}

const flipRows = (rows: string[]): string[] => rows.map((r) => [...r].reverse().join(''));

// ---- front (facing down) ----
const downStand = sym([
  '........',
  '........',
  '...o....',
  '..obo...',
  '..opbo..',
  '..obbboo',
  '.obdbbdb',
  '.obbbbbb',
  '.obbebbb',
  '.obbebbb',
  '.owwbbbp',
  '..owwwwo',
  '...oowww',
  '..obbwww',
  '..obwwob',
  '...oooo.',
]);
const downWalk1 = patch(downStand, [
  [0, 13, '..obbwwwwowwbo..'],
  [0, 14, '..obwwobbooooo..'],
  [0, 15, '...oooo.........'],
]);
const downWalk2 = flipRows(downWalk1);

// ---- back (facing up) ----
const upStand = patch(
  sym([
    '........',
    '........',
    '...o....',
    '..obo...',
    '..obbo..',
    '..obbboo',
    '.obdbbdb',
    '.obbbbbb',
    '.obbbbbb',
    '.obdbbbb',
    '.obbbbbb',
    '..obbbbb',
    '...obdbb',
    '..obbbdb',
    '..obbobb',
    '...oooo.',
  ]),
  [
    [13, 8, 'oo'],
    [12, 9, 'obdo'],
    [12, 10, 'obo'],
    [12, 11, 'bo'],
  ],
);
const upWalk1 = patch(upStand, [
  [0, 14, '..obbobbbbbbbo..'],
  [0, 15, '...oooo..oooo...'],
  [9, 14, 'oooo'],
  [9, 15, '....'],
]);
const upWalk2 = patch(upStand, [
  [0, 14, '..obbbbbbobbbo..'],
  [0, 15, '.........oooo...'],
  [3, 14, 'oooo'],
]);

// ---- side (facing left; flipped for right) ----
const sideStand = [
  '................',
  '................',
  '..o..o..........',
  '.opoobo.........',
  '.obbbbbo.....oo.',
  'obbdbdbo....obbo',
  'obebbbbo....obo.',
  'obebbbbo....obo.',
  'pbbbbbbbo...obo.',
  'owwbbbbbooooobo.',
  '.owwwbbdbdbdbbo.',
  '..oowbbbbbbbbbo.',
  '...owwwbbbbbbbo.',
  '...obwobbbbobwo.',
  '...obwo.oooobwo.',
  '...ooo......ooo.',
];
const sideWalk1 = patch(sideStand, [
  [0, 13, '..obwwobbbbobbwo'],
  [0, 14, '..oooo..ooo.ooo.'],
  [0, 15, '................'],
]);
const sideWalk2 = patch(sideStand, [
  [0, 13, '...owbobbbobwo..'],
  [0, 14, '...obwoooooooo..'],
  [0, 15, '...ooo..........'],
]);

// ---- sitting ----
const sitDown = patch(downStand, [
  [0, 12, '...oowwwwwwoo...'],
  [0, 13, '..obbwwwwwwbbo..'],
  [0, 14, '.obbwwowwowwbbo.'],
  [0, 15, '..oooooooooooddo'],
]);
const sitSide = [
  '................',
  '................',
  '...o..o.........',
  '..opoobo........',
  '..obbbbbo.......',
  '.obbdbdbo.......',
  '.obebbbbo.......',
  '.obebbbbo.......',
  '.pbbbbbbbo......',
  '.owwbbbbbbo.....',
  '..owwwbbdbbo....',
  '...owwbbbdbbo...',
  '...owwbbbbdbo...',
  '...owwbbbbbbo...',
  '..owwobbbbbbboo.',
  '..oooooooooddddo',
];

// ---- licking paw (sitting) ----
const lickDown1 = patch(sitDown, [
  [0, 8, '.obboobbbbebbbo.'],
  [0, 9, '.obbbbbbbbebbbo.'],
  [0, 11, '..owowwwwwwwwo..'],
  [2, 10, 'owwo'],
  [2, 11, 'owwo'],
  [3, 12, 'oo'],
]);
const lickDown2 = patch(lickDown1, [
  [3, 10, 'ww'],
  [5, 10, 'rp'],
]);
const lickSide1 = patch(sitSide, [
  [0, 6, '.obobbbbo.......'],
  [0, 7, '.obbbbbbo.......'],
  [0, 9, 'oowwbbbbbbo.....'],
  [0, 10, 'owwowbbdbbo.....'],
  [0, 11, '.oowwbbbbdbbo...'],
]);
const lickSide2 = patch(lickSide1, [
  [0, 8, 'rpbbbbbbbo......'],
  [0, 9, 'owwwbbbbbbo.....'],
]);

// ---- hissing (side, arched back, puffed tail) ----
const hiss1 = [
  '...........o.o.o',
  '.....ooooo..obdo',
  '....obdbdbo.obbo',
  '.o.obbbbbbboobdo',
  'opoobbbbbbbbbbo.',
  'obbbbdbbbbbbbbo.',
  'oebbbbbbbbbbbo..',
  'oebbbbdbbdbbbo..',
  'prbbbbbbbbbbbo..',
  'owwwbooooobbbo..',
  '.owwbo...obbo...',
  '..obwo...obwo...',
  '..obwo...obwo...',
  '..obwo...obwo...',
  '..obwo...obwo...',
  '..ooo....ooo....',
];
const hiss2 = patch(hiss1, [
  [0, 0, '..........o.o.o.'],
  [0, 7, 'orbbbbdbbdbbbo..'],
  [0, 8, 'prrbbbbbbbbbbo..'],
  [0, 9, 'orrwbooooobbbo..'],
]);

// ---- hissing, facing us: ears flat, fur on end, mouth wide open ----
const hissDown1 = sym([
  '........',
  '........',
  '........',
  '.oo.....',
  '.obo....',
  '..obbooo',
  '.obdbbdb',
  '.obobbbb',
  '.obbebbb',
  '.obbbbbb',
  '.owwbprr',
  '..owwwrr',
  'o.oowwww',
  '.obbbwww',
  'obbwwobb',
  'oooo....',
]);
const hissDown2 = patch(hissDown1, [
  [0, 10, '.owwbbprrpbbwwo.'],
  [0, 11, '..owwwwrrwwwwo..'],
  [0, 12, '.o.owwwwwwwwo.o.'],
]);
// ---- hissing, facing away: the tail straight up and bristling, ears flat ----
const hissUp1 = sym([
  '........',
  '......o.',
  '.....obd',
  '.oo..obb',
  '.obooobd',
  '..obbobb',
  '.obdbobd',
  '.obbbobb',
  'o.bbbobd',
  '.obbbobb',
  'o.bbbobd',
  '.obbbbob',
  '..obbbbo',
  '.obbbbbb',
  '.obbobbb',
  '.oooo...',
]);
const hissUp2 = patch(hissUp1, [
  [0, 0, '.......oo.......'],
  [0, 1, '......obbo......'],
  [0, 8, '.obbbobddbobbbo.'],
  [0, 9, 'o.bbbobbbbobbb.o'],
]);

// ---- rolling on back ----
const roll1 = [
  '................',
  '................',
  '................',
  '................',
  '.....o..o..o..o.',
  '....owo.owoowo..',
  '..oowwo.owwwo...',
  '.obbowwwwwwwwo..',
  'opbebwwwwwwwwbo.',
  'obbbbwwwwwwwwbbo',
  'obbebwwwwwwwbbo.',
  'opbbbbbbbbbbbbo.',
  '.obbobbdbdbdbo.o',
  '..oo.ooooooooobo',
  '..............o.',
  '................',
];
const roll2 = patch(roll1, [
  [0, 4, '....o..o..o..o..'],
  [0, 5, '...owo.owoowo...'],
  [0, 6, '...owwoowwwo....'],
  [12, 12, 'o.o'],
  [13, 13, 'obo'],
  [14, 14, '.'],
]);
const roll3 = patch(roll1, [
  [0, 4, '......o..o..o..o'],
  [0, 5, '.....owo.owoowo.'],
  [0, 6, '..oooowo.owwwo..'],
]);

// ---- curled up asleep (side; two breathing frames) ----
const sleep1 = [
  ...Array(7).fill('................'),
  '..o..o..........',
  '.opoobooooooo...',
  '.obbbbbbbdbdbboo',
  'obbbbbbdbbbbdbbo',
  'oboobbbbbdbbbbbo',
  'pwwbbbbbbbbbdbbo',
  'owwwwobbbbbbbbbo',
  '.ooddddddddddoo.',
  '...oooooooooo...',
];
const sleep2 = patch(sleep1, [
  [0, 7, '..o..o..ooooo...'],
  [0, 8, '.opoobobbbdbboo.'],
]);

// ---- catching: paw raised, then swiped down-forward ----
const catch1 = patch(sitSide, [
  [0, 9, 'owwobbbbbbo.....'],
  [0, 10, 'owwowwbbdbbo....'],
  [0, 11, '.oo.owbbbdbbo...'],
]);
const catch2 = patch(sitSide, [
  [0, 11, '..owwwbbbdbbo...'],
  [0, 12, '.owwobbbbbdbo...'],
  [0, 13, 'owwo.owbbbbbo...'],
  [0, 14, 'oooo.obbbbbbboo.'],
]);
// facing us: a paw raised beside the face, then slammed down in front
const catchDown1 = patch(sitDown, [
  [0, 5, '.oo.'],
  [0, 6, 'owwo'],
  [0, 7, 'owwo'],
  [0, 8, 'owwo'],
  [0, 9, '.oo'],
  [0, 14, '.obbbbbowwowwbbo'],
]);
const catchDown2 = patch(sitDown, [
  [0, 13, '..obbwwwwwwbbo..'],
  [0, 14, '.obbbbbowwowwbbo'],
  [0, 15, '..ooowwwoooooddo'],
  [3, 15, 'owwwo'],
]);
// facing away: a paw raised by the head, then reaching out ahead (up the screen)
const catchUp1 = patch(upStand, [
  [0, 2, '.oo'],
  [0, 3, 'owwo'],
  [0, 4, 'owwo'],
  [0, 5, 'owo'],
]);
const catchUp2 = patch(upStand, [
  [3, 0, 'oooo'],
  [2, 1, 'owwwwo'],
  [3, 2, 'owwo'],
  [3, 3, 'obo'],
]);
// ---- eating: chewing with the mouth open ----
const chew = patch(sitSide, [
  [0, 8, '.prbbbbbbo......'],
  [0, 9, '.orwbbbbbbo.....'],
]);
const chewDown = patch(sitDown, [
  [0, 10, '.owwbbprrpbbwwo.'],
  [0, 11, '..owwwwrrwwwwo..'],
]);

// ---- crouching low and sneaking: belly to the ground, head forward, tail flat ----
const sideCrouch = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '..o..o..........',
  '.opoobo.........',
  '.obbbbboooooooo.',
  'obbdbdbbbdbdbbbo',
  'obebbbbbbbbbbbbo',
  'obebbbbbbbbbbbo.',
  'pbbbbbbbbbbbboo.',
  'owwwbbbbbbbbbddo',
  '.owwobbbbbbbboo.',
  '.obwoowwoobwwo..',
  '.oooo.oo..ooo...',
];
const sideSneak1 = patch(sideCrouch, [
  [0, 14, '.obwooowwobbwo..'],
  [0, 15, 'ooooo..ooo.ooo..'],
]);
const sideSneak2 = patch(sideCrouch, [
  [0, 14, '..obwoowwwoobwo.'],
  [0, 15, '..oooo.....oooo.'],
]);
const downCrouch = [
  '................',
  '................',
  '................',
  ...downStand.slice(2, 11),
  '.obowwwoowwwobo.',
  '.obbbowwwwobbbo.',
  '.obwwboooobwwbo.',
  '..oooo....oooo..',
];
const downSneak1 = patch(downCrouch, [
  [0, 14, '.obwwbooooobbbo.'],
  [0, 15, '..oooo....oooo..'],
  [9, 14, 'obwwbo'],
]);
const downSneak2 = flipRows(downSneak1);
const upCrouch = [
  '................',
  '................',
  '................',
  ...upStand.slice(2, 9),
  ...upStand.slice(10, 16),
];
const upSneak1 = patch(upCrouch, [
  [0, 14, '..obbobbbbbbbo..'],
  [0, 15, '...oooo..oooo...'],
  [9, 14, 'oooo'],
  [9, 15, '....'],
]);
const upSneak2 = patch(upCrouch, [
  [0, 14, '..obbbbbbobbbo..'],
  [0, 15, '.........oooo...'],
  [3, 14, 'oooo'],
]);

export const FRAMES = {
  downStand, downWalk1, downWalk2,
  upStand, upWalk1, upWalk2,
  sideStand, sideWalk1, sideWalk2,
  sitDown, sitSide,
  lickDown1, lickDown2, lickSide1, lickSide2,
  hiss1, hiss2, hissDown1, hissDown2, hissUp1, hissUp2,
  roll1, roll2, roll3,
  sleep1, sleep2,
  catch1, catch2, catchDown1, catchDown2, catchUp1, catchUp2, chew, chewDown,
  sideCrouch, sideSneak1, sideSneak2,
  downCrouch, downSneak1, downSneak2,
  upCrouch, upSneak1, upSneak2,
} as const;

export type FrameName = keyof typeof FRAMES;
export const FRAME_NAMES = Object.keys(FRAMES) as FrameName[];
/** Frames in one row of the sheet: every frame, then all of them mirrored. */
export const ROW_FRAMES = FRAME_NAMES.length * 2;
/**
 * The sheet has a row for each size of cat (growth.ts): grown cats first (so
 * frameFor's numbers are theirs), then young ones, then kittens.
 */
export const stageRow = (stage: number): number => (2 - stage) * ROW_FRAMES;
/** Where frame f is on the sheet (px). */
export const framePos = (f: number): [number, number] => [(f % ROW_FRAMES) * CAT, Math.floor(f / ROW_FRAMES) * CAT];

/** A frame for each size: grown, young (a few rows and columns of body taken out), kitten (drawn on its own). */
const SIZED: ((name: FrameName) => readonly string[])[] = [
  (name) => FRAMES[name],
  (name) => youngFrame(name, FRAMES[name]),
  (name) => KITTEN_FRAMES[name],
];

/** Frame index in the sheet; right-facing frames are mirrored copies appended after. */
export const frameIndex = (name: FrameName, flip = false): number =>
  FRAME_NAMES.indexOf(name) + (flip ? FRAME_NAMES.length : 0);

// ---- coats ----
export interface Coat {
  name: string;
  o: string; b: string; d: string; k: string; w: string; e: string;
}

export const COATS: Coat[] = [
  { name: 'tabby', o: '#302018', b: '#a08060', d: '#685038', k: '#685038', w: '#f0e8d8', e: '#58a030' },
  { name: 'ginger', o: '#482010', b: '#f09838', d: '#c06018', k: '#c06018', w: '#f8f0e0', e: '#a8a020' },
  { name: 'black', o: '#100c10', b: '#383040', d: '#28202c', k: '#28202c', w: '#383040', e: '#e8d020' },
  { name: 'tuxedo', o: '#100c10', b: '#383040', d: '#28202c', k: '#28202c', w: '#f8f8f8', e: '#58b048' },
  { name: 'white', o: '#504850', b: '#f8f8f8', d: '#d8d0d8', k: '#d8d0d8', w: '#ffffff', e: '#4890e8' },
  { name: 'grey', o: '#282830', b: '#8890a0', d: '#606878', k: '#606878', w: '#d8d8e0', e: '#e0a020' },
  { name: 'calico', o: '#302018', b: '#f8f0e0', d: '#e08830', k: '#383038', w: '#ffffff', e: '#58a030' },
  { name: 'cream', o: '#584028', b: '#f0d8a8', d: '#d8b078', k: '#d8b078', w: '#fff8e8', e: '#4890e8' },
  { name: 'siamese', o: '#302018', b: '#f0e0c8', d: '#685040', k: '#685040', w: '#f8f0e0', e: '#3878e8' },
];

const PINK = hex('#f090a0');
const MOUTH = hex('#a02838');

/** Calico: replace some stripe pixels with the black patch colour in a fixed pattern. */
function coatPalette(c: Coat): Record<string, RGB> {
  return { o: hex(c.o), b: hex(c.b), d: hex(c.d), k: hex(c.k), w: hex(c.w), e: hex(c.e), p: PINK, r: MOUTH };
}

/** Build the sprite sheet (one row: all frames, then all frames mirrored). */
export function buildCatSheet(coatIndex: number): Raster {
  const coat = COATS[((coatIndex % COATS.length) + COATS.length) % COATS.length];
  const pal = coatPalette(coat);
  const n = FRAME_NAMES.length;
  const sheet = new Raster(CAT * n * 2, CAT * SIZED.length);
  SIZED.forEach((sized, row) =>
    FRAME_NAMES.forEach((name, i) => {
      let rows = sized(name);
      if (coat.name === 'calico') rows = calicoize(rows);
      if (coat.name === 'siamese') rows = siamesize(rows);
      sheet.paint(rows, i * CAT, row * CAT, pal);
      sheet.paint(rows, (i + n) * CAT, row * CAT, pal, true);
    }),
  );
  return sheet;
}

/** Calico: big black patches on the upper-left of every frame, orange stripes elsewhere. */
function calicoize(rows: readonly string[]): string[] {
  return rows.map((r, y) =>
    [...r].map((ch, x) => (ch === 'b' && ((x + y * 2) % 11 < 3 || (x > 9 && y < 9 && y > 4)) ? 'k' : ch)).join(''),
  );
}

/** Siamese: dark points on ears, face centre, paws and tail tip. */
function siamesize(rows: readonly string[]): string[] {
  // (the head is the top four rows of whatever size of cat this is)
  const top = rows.findIndex((r) => /[^.]/.test(r));
  return rows.map((r, y) => [...r].map((ch) => (ch === 'b' && (y - top < 4 || y > 12) ? 'd' : ch)).join(''));
}

/** Just the eyes of every frame (in the coat's eye colour, brightened), to make them glow at night. */
export function buildEyeSheet(coatIndex: number): Raster {
  const coat = COATS[((coatIndex % COATS.length) + COATS.length) % COATS.length];
  const [r, g, b] = hex(coat.e);
  const glow: RGB = [Math.min(255, r * 0.6 + 110), Math.min(255, g * 0.6 + 110), Math.min(255, b * 0.6 + 90)];
  const n = FRAME_NAMES.length;
  const sheet = new Raster(CAT * n * 2, CAT * SIZED.length);
  SIZED.forEach((sized, row) =>
    FRAME_NAMES.forEach((name, i) => {
      sheet.paint(sized(name), i * CAT, row * CAT, { e: glow });
      sheet.paint(sized(name), (i + n) * CAT, row * CAT, { e: glow }, true);
    }),
  );
  return sheet;
}

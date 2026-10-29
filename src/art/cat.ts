import { Raster, hex, type RGB } from './raster.ts';
import { KITTEN_FRAMES, youngFrame } from './kitten.ts';

// Cat sprites are 16x16 character maps.
//   o outline   b fur   d fur shade/stripes   k markings
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

// ---- side (facing left; flipped for right): the head turned to us, on a short body, the tail up ----
const sideStand = [
  '................',
  '................',
  '..............o.',
  '.o.......o...obo',
  'opo.....opo..obo',
  'obbooooobbo.obo.',
  'obdbbdbbdbo.obo.',
  'obbbbbbbbbo.obo.',
  'obbebbbebbooobo.',
  'obbebbbebbbdbdbo',
  'owwwbpbwwwbbbbbo',
  '.owwwrwwwobbbbbo',
  '..owwwwwobbbbbo.',
  '..obwoobwoobwo..',
  '..obwoobwoobwo..',
  '..ooo.ooo.ooo...',
];
const sideWalk1 = [
  '................',
  '................',
  '..............o.',
  '.o.......o...obo',
  'opo.....opo..obo',
  'obbooooobbo.obo.',
  'obdbbdbbdbo.obo.',
  'obbbbbbbbbo.obo.',
  'obbebbbebbooobo.',
  'obbebbbebbbdbdbo',
  'owwwbpbwwwbbbbbo',
  '.owwwrwwwobbbbbo',
  '..owwwwwobbbbbo.',
  '..obwoobwoobwo..',
  '.obwo.obwo..obwo',
  '.ooo..ooo...ooo.',
];
const sideWalk2 = [
  '................',
  '................',
  '..............o.',
  '.o.......o...obo',
  'opo.....opo..obo',
  'obbooooobbo.obo.',
  'obdbbdbbdbo.obo.',
  'obbbbbbbbbo.obo.',
  'obbebbbebbooobo.',
  'obbebbbebbbdbdbo',
  'owwwbpbwwwbbbbbo',
  '.owwwrwwwobbbbbo',
  '..owwwwwobbbbbo.',
  '..obwoobwoobwo..',
  '...obwobwoobwo..',
  '...oooooooooo...',
];

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
  '.o.......o......',
  'opo.....opo.....',
  'obbooooobbo.....',
  'obdbbdbbdbo.....',
  'obbbbbbbbbo.....',
  'obbebbbebbo.....',
  'obbebbbebbooo...',
  'owwwbpbwwwbbbo..',
  '.owwwrwwwobdbbo.',
  '..owwwwwobbbdbo.',
  '..owwwwwobbbbbo.',
  '..owwowwobbbbbo.',
  '..owwowwobbbbboo',
  '..oooooooooodddo',
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
const lickSide1 = [
  '................',
  '................',
  '.o.......o......',
  'opo.....opo.....',
  'obbooooobbo.....',
  'obdbbdbbdbo.....',
  'obbbbbbbbbo.....',
  'obbbbbbebbo.....',
  'obbobbbebbooo...',
  'owwwbpbwwwbbbo..',
  '.owworwwwobdbbo.',
  '.owwowwwobbbdbo.',
  '..oowwwwobbbbbo.',
  '..owwowwobbbbbo.',
  '..owwowwobbbbboo',
  '..oooooooooodddo',
];
const lickSide2 = [
  '................',
  '................',
  '.o.......o......',
  'opo.....opo.....',
  'obbooooobbo.....',
  'obdbbdbbdbo.....',
  'obbbbbbbbbo.....',
  'obbbbbbebbo.....',
  'obbobbbebbooo...',
  'owwwbpbwwwbbbo..',
  '.owworwwwobdbbo.',
  '.owwowwwobbbdbo.',
  '..oowwwwobbbbbo.',
  '..owwowwobbbbbo.',
  '..owwowwobbbbboo',
  '..oooooooooodddo',
];

// ---- hissing (side): mouth wide open, fur on end, the tail puffed up ----
const hiss1 = [
  '................',
  '............oo.o',
  '............obob',
  '.o.......o..obbo',
  'opo.....opo.obbo',
  'obbooooobbo.obbo',
  'obdbbdbbdbo.obbo',
  'obbbbbbbbbooobbo',
  'obbebbbebbbbobo.',
  'obbebbbebbbdbdbo',
  'owwwbpbwwwbbbbbo',
  '.oowrrrwoobbbbbo',
  '..owwwwwobbbbbo.',
  '..obwoobwoobwo..',
  '..obwoobwoobwo..',
  '..ooo.ooo.ooo...',
];
const hiss2 = [
  '................',
  '............o.oo',
  '............bobo',
  '.o.......o..obbo',
  'opo.....opo.obbo',
  'obbooooobbo.obbo',
  'obdbbdbbdbo.obbo',
  'obbbbbbbbbooobbo',
  'obbebbbebbbbobo.',
  'obbebbbebbbdbdbo',
  'owwwbpbwwwbbbbbo',
  '.oowrrrwoobbbbbo',
  '..owwwwwobbbbbo.',
  '..obwoobwoobwo..',
  '..obwoobwoobwo..',
  '..ooo.ooo.ooo...',
];

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
const catch1 = [
  '................',
  '................',
  '.o.......o......',
  'opo.....opo.....',
  'obbooooobbo.....',
  'obdbbdbbdbo.....',
  'obbbbbbbbbo.....',
  'obbebbbebbo.....',
  'obbebbbebbooo...',
  'owwwbpbwwwbbbo..',
  '.owwwrwwwobdbbo.',
  'owwowwwwobbbdbo.',
  'ooowwwwwobbbbbo.',
  '..owwowwobbbbbo.',
  '..owwowwobbbbboo',
  '..oooooooooodddo',
];
const catch2 = [
  '................',
  '................',
  '.o.......o......',
  'opo.....opo.....',
  'obbooooobbo.....',
  'obdbbdbbdbo.....',
  'obbbbbbbbbo.....',
  'obbebbbebbo.....',
  'obbebbbebbooo...',
  'owwwbpbwwwbbbo..',
  '.owwwrwwwobdbbo.',
  '..owwwwwobbbdbo.',
  '..owwwwwobbbbbo.',
  'owwowowwobbbbbo.',
  'owwowowwobbbbboo',
  'oooooooooooodddo',
];
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
const chew = [
  '................',
  '................',
  '.o.......o......',
  'opo.....opo.....',
  'obbooooobbo.....',
  'obdbbdbbdbo.....',
  'obbbbbbbbbo.....',
  'obbebbbebbo.....',
  'obbebbbebbooo...',
  'owwwbpbwwwbbbo..',
  '.owwwrwwwobdbbo.',
  '..owwrwwobbbdbo.',
  '..owwwwwobbbbbo.',
  '..owwowwobbbbbo.',
  '..owwowwobbbbboo',
  '..oooooooooodddo',
];
const chewDown = patch(sitDown, [
  [0, 10, '.owwbbprrpbbwwo.'],
  [0, 11, '..owwwwrrwwwwo..'],
]);

// ---- crouching low and sneaking: belly to the ground, tail out flat behind ----
const sideCrouch = [
  '................',
  '................',
  '................',
  '................',
  '.o.......o......',
  'opo.....opo.....',
  'obbooooobbo.....',
  'obdbbdbbdbo.....',
  'obbbbbbbbbo.....',
  'obbebbbebboooo..',
  'obbebbbebbbdbdo.',
  'owwwbpbwwwbbbbbo',
  '.owwwrwwwobbbddo',
  '..owwwwwobbbbbo.',
  '.obwwoowwoobbwo.',
  '.oooo.oooo.ooo..',
];
const sideSneak1 = [
  '................',
  '................',
  '................',
  '................',
  '.o.......o......',
  'opo.....opo.....',
  'obbooooobbo.....',
  'obdbbdbbdbo.....',
  'obbbbbbbbbo.....',
  'obbebbbebboooo..',
  'obbebbbebbbdbdo.',
  'owwwbpbwwwbbbbbo',
  '.owwwrwwwobbbddo',
  '..owwwwwobbbbbo.',
  'obwwo.owwoobbwo.',
  'ooooo.oooo.ooo..',
];
const sideSneak2 = [
  '................',
  '................',
  '................',
  '................',
  '.o.......o......',
  'opo.....opo.....',
  'obbooooobbo.....',
  'obdbbdbbdbo.....',
  'obbbbbbbbbo.....',
  'obbebbbebboooo..',
  'obbebbbebbbdbdo.',
  'owwwbpbwwwbbbbbo',
  '.owwwrwwwobbbddo',
  '..owwwwwobbbbbo.',
  '..obwwowwoobbbwo',
  '..ooooooooooooo.',
];
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
export const SIZED: ((name: FrameName) => readonly string[])[] = [
  (name) => FRAMES[name],
  (name) => youngFrame(name, FRAMES[name]),
  (name) => KITTEN_FRAMES[name],
];

/** Frame index in the sheet; right-facing frames are mirrored copies appended after. */
export const frameIndex = (name: FrameName, flip = false): number =>
  FRAME_NAMES.indexOf(name) + (flip ? FRAME_NAMES.length : 0);

// ---- coats ----
// One cat, drawn once (MASTER: its fur in placeholder colours), and every
// coat a palette swap of its fur: the outline, the fur, its shade and
// stripes, its markings and its white. Eyes, nose and mouth are the same on
// every cat.

/** A coat: the colours its fur's letters (o b d k w) are swapped to. */
export interface Coat {
  name: string;
  o: string; b: string; d: string; k: string; w: string;
}

export const COATS: Coat[] = [
  { name: 'tabby', o: '#302018', b: '#a08060', d: '#685038', k: '#685038', w: '#f0e8d8' },
  { name: 'ginger', o: '#482010', b: '#f09838', d: '#c06018', k: '#c06018', w: '#f8f0e0' },
  { name: 'black', o: '#100c10', b: '#383040', d: '#28202c', k: '#28202c', w: '#383040' },
  { name: 'tuxedo', o: '#100c10', b: '#383040', d: '#28202c', k: '#28202c', w: '#f8f8f8' },
  { name: 'white', o: '#504850', b: '#f8f8f8', d: '#d8d0d8', k: '#d8d0d8', w: '#ffffff' },
  { name: 'grey', o: '#282830', b: '#8890a0', d: '#606878', k: '#606878', w: '#d8d8e0' },
  { name: 'blue', o: '#202430', b: '#6c7894', d: '#4c5670', k: '#4c5670', w: '#c8d0e0' },
  { name: 'cream', o: '#584028', b: '#f0d8a8', d: '#d8b078', k: '#d8b078', w: '#fff8e8' },
  { name: 'chocolate', o: '#281810', b: '#7a5440', d: '#563828', k: '#563828', w: '#e8d8c8' },
];

export const EYES = hex('#a8b830');
export const PINK = hex('#f090a0');
export const MOUTH = hex('#a02838');
export const FUR = ['o', 'b', 'd', 'k', 'w'] as const;

/** The master's placeholder colour for each fur letter: (n, 0, 255), n its place in FUR (nothing else on a cat is drawn so). */
const MARK: Record<string, RGB> = Object.fromEntries(FUR.map((ch, n) => [ch, [n + 1, 0, 255] as RGB]));

/** The one cat: every frame (and mirrored) in every size, its fur in MARK colours. */
let master: Raster | null = null;
function masterSheet(): Raster {
  if (master) return master;
  const pal = { ...MARK, e: EYES, p: PINK, r: MOUTH };
  const n = FRAME_NAMES.length;
  const sheet = new Raster(CAT * n * 2, CAT * SIZED.length);
  SIZED.forEach((sized, row) =>
    FRAME_NAMES.forEach((name, i) => {
      sheet.paint(sized(name), i * CAT, row * CAT, pal);
      sheet.paint(sized(name), (i + n) * CAT, row * CAT, pal, true);
    }),
  );
  return (master = sheet);
}

/** The cat in coat `coatIndex`: the master with its fur swapped to the coat's colours. */
export function buildCatSheet(coatIndex: number): Raster {
  const coat = COATS[((coatIndex % COATS.length) + COATS.length) % COATS.length];
  const swap = FUR.map((ch) => hex(coat[ch]));
  const m = masterSheet(), out = new Raster(m.w, m.h);
  out.data.set(m.data);
  for (let i = 0; i < out.data.length; i += 4) {
    if (out.data[i + 3] === 0 || out.data[i + 1] !== 0 || out.data[i + 2] !== 255) continue;
    const c = swap[out.data[i] - 1];
    if (!c) continue;
    out.data[i] = c[0]; out.data[i + 1] = c[1]; out.data[i + 2] = c[2];
  }
  return out;
}

/** Just the eyes of every frame, brightened, to make them glow at night (the same for every cat). */
export function buildEyeSheet(): Raster {
  const [r, g, b] = EYES;
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

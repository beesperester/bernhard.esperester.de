// The things a cat can find about the garden (world/finds.ts): the food, the
// angler's bucket, the birds' nests, and the glint that gives a hidden one away.
import { Raster, hex, type RGB } from './raster.ts';
import { HELD_W } from './critters.ts';

/** Each food is 8×5, in the order of Food (world/finds.ts). */
export const FOOD_W = 8, FOOD_H = 5;

const PAL: Record<string, RGB> = {
  o: hex('#2a1c14'), // outline
  s: hex('#b04a30'), S: hex('#d8784a'), // sausage
  c: hex('#f0c040'), C: hex('#c89020'), // cheese, and its holes
  b: hex('#e8c890'), B: hex('#b88850'), g: hex('#6ab040'), r: hex('#d84830'), // bread, crust, lettuce, tomato
  p: hex('#9a5a28'), P: hex('#c8823c'), w: hex('#f4f0e8'), // pretzel, salt
  t: hex('#f8f4ec'), k: hex('#c83820'), y: hex('#e8a830'), // tray, ketchup-curry sauce, curry powder
  i: hex('#ffb0c8'), I: hex('#ff90b0'), n: hex('#d8a060'), N: hex('#a87038'), // ice cream, cone
  f: hex('#7898b0'), F: hex('#a8c8d8'), // fish
  h: hex('#7a5a30'), H: hex('#a88048'), e: hex('#a8d8f0'), E: hex('#e8f8ff'), // nest, eggs
};

const FOODS: string[][] = [
  // sausage
  ['........', '.oooooo.', 'oSSSSSso', 'osssssso', '.oooooo.'],
  // cheese wedge
  ['......o.', '....occo', '..occcCo', 'occCccco', 'oooooooo'],
  // sandwich
  ['.oooooo.', 'obbbbbbo', 'grgrgrgg', 'obbbbbbo', '.oBBBBo.'],
  // pretzel
  ['.oo..oo.', 'oPwppPPo', 'op.pp.po', 'oPp..pPo', '.oppppo.'],
  // currywurst in its paper tray
  ['........', '.kykkyk.', 'osksksko', 'otttttto', '.oooooo.'],
  // ice cream, dropped: the cone on its side and the scoop beside it
  ['....oo..', 'oo.oiIo.', 'onnoiiIo', 'oNnnoIo.', '.ooooo..'],
  // fish (in the bucket only its tail shows)
  ['........', '.offo..o', 'ofFFfoFo', '.offo..o', '........'],
  // eggs in a nest
  ['..oeo...', '.oeEeoo.', 'hoeoeEeh', 'hHhHhHhh', '.hhhhhh.'],
  ['..oeo...', '.oeEeoo.', 'hoeoeEeh', 'hHhHhHhh', '.hhhhhh.'],
];

/** All the foods side by side. */
export function buildFoods(): Raster {
  const r = new Raster(FOOD_W * FOODS.length, FOOD_H);
  FOODS.forEach((rows, i) => r.paint(rows, i * FOOD_W, 0, PAL));
  return r;
}

/** A food held in the mouth: whole, half eaten, crumbs (like the other held prey, HELD_W wide). */
export function buildHeldFood(food: number): Raster {
  const r = new Raster(HELD_W * 3, FOOD_H);
  const rows = FOODS[food];
  r.paint(rows, 0, 0, PAL);
  r.paint(rows.map((row) => row.slice(0, 4)), HELD_W, 0, PAL);
  r.paint(['........', '........', '...o....', '.....o..', '........'], HELD_W * 2, 0, { o: PAL[rows[2][2]] ?? PAL.o });
  return r;
}

/** An angler's tin bucket, 9×9: frame 0 with the catch's tail sticking out, 1 empty. */
export const BUCKET_W = 9, BUCKET_H = 9;
export function buildBucket(): Raster {
  const r = new Raster(BUCKET_W * 2, BUCKET_H);
  const pal = { o: hex('#202428'), m: hex('#8a96a0'), l: hex('#c0ccd4'), d: hex('#5a646c'), w: hex('#3a5a70'), f: PAL.f, F: PAL.F };
  const body = ['.o.....o.', 'o.......o', 'ooooooooo', 'odwwwwwdo', 'omllmmmdo', 'omllmmmdo', '.omlmmdo.', '.omlmmdo.', '..ooooo..'];
  r.paint(body, 0, 0, pal);
  r.paint(['..oo.....', '..fFo....', '...fo....'], 3, 0, pal);
  r.paint(body, BUCKET_W, 0, pal);
  return r;
}

/** The glint of something hidden, 5×5: three frames of a twinkle. */
export const GLINT = 5;
export function buildGlint(): Raster {
  const r = new Raster(GLINT * 3, GLINT);
  const pal = { w: hex('#fffbe0'), y: hex('#ffe070') };
  r.paint(['.....', '.....', '..w..', '.....', '.....'], 0, 0, pal);
  r.paint(['.....', '..y..', '.ywy.', '..y..', '.....'], GLINT, 0, pal);
  r.paint(['..y..', '..y..', 'yywyy', '..y..', '..y..'], GLINT * 2, 0, pal);
  return r;
}

import { Raster, hex } from './raster.ts';

const PAL = { o: hex('#202020'), w: hex('#f8f8f8'), r: hex('#e83040'), k: hex('#383038'), s: hex('#000000') };

const HISS = [
  '..ooooooooo..',
  '.owwwwwwwwwo.',
  'owwrwwwwwrwwo',
  'owwwrwwwrwwwo',
  'owwrwrwrwrwwo',
  'owwwwwwwwwwwo',
  'owrwrwwwrwrwo',
  '.owwwwwwwwwo.',
  '..oooowwoooo.',
  '......owo....',
  '.......o.....',
];

const HEART = [
  '..ooooooooo..',
  '.owwwwwwwwwo.',
  'owwrrwwwrrwwo',
  'owrrrrwrrrrwo',
  'owrrrrrrrrrwo',
  'owwrrrrrrrwwo',
  'owwwrrrrrwwwo',
  '.owwwwrwwwwo.',
  '..oooowwoooo.',
  '......owo....',
  '.......o.....',
];

const YOU = [
  'ooooooo',
  'owwwwwo',
  '.owwwo.',
  '..owo..',
  '...o...',
];

const SHADOW = [
  '...ssssss...',
  '.ssssssssss.',
  'ssssssssssss',
  '.ssssssssss.',
  '...ssssss...',
];

function make(rows: string[]): Raster {
  const r = new Raster(rows[0].length, rows.length);
  r.paint(rows, 0, 0, PAL);
  return r;
}

export const ICONS = {
  'bubble-hiss': () => make(HISS),
  'bubble-roll': () => make(HEART),
  you: () => make(YOU),
  shadow: () => make(SHADOW),
};

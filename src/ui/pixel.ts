// The UI's pixel art: text-box frames, buttons, wooden planks, the d-pad and
// the icons, drawn in code like everything else, each once, and handed to the
// CSS as image variables (each shown at a whole multiple of its pixels).
// Pictures of one size that take turns in the same place (the icon buttons,
// the d-pad's pressed arms, the arrow keys) share a sprite sheet: one row of
// frames, picked with background-position (see .sheet in style.css). Frames
// that stretch round text (border-image) can't come from a sheet and get an
// image each.
import { Raster, hex, type RGB } from '../art/raster.ts';
import { WOODS, buildPlank, buildSign, rasterURL } from '../art/plank.ts';

/** The pixel font of the UI and the in-game text (bundled with the site). */
export const PIXEL_FONT = "'Pixelify Sans', ui-monospace, monospace";

const INK = hex('#183018'), PAPER = hex('#f8f4e0'), WHITE = hex('#ffffff'), LINE = hex('#88b860'), SHADE = hex('#d8d0b0');

type Shape = (x: number, y: number) => boolean;

/** A rounded box `w`×`h` with corner radius `r` (in whole pixels, Game Boy style). */
const rounded = (w: number, h: number, r: number): Shape => (x, y) => {
  if (x < 0 || y < 0 || x >= w || y >= h) return false;
  const cx = x < r ? r - x : x >= w - r ? x - (w - r - 1) : 0;
  const cy = y < r ? r - y : y >= h - r ? y - (h - r - 1) : 0;
  return cx * cx + cy * cy <= r * r + 1;
};

/** Paint a shape: outline where it meets the outside, the rest by `fill(x, y)`. */
function paint(r: Raster, inside: Shape, outline: RGB, fill: (x: number, y: number) => RGB, ox = 0, oy = 0): void {
  for (let y = 0; y < r.h; y++)
    for (let x = 0; x < r.w; x++) {
      if (!inside(x - ox, y - oy)) continue;
      const edge = !inside(x - ox - 1, y - oy) || !inside(x - ox + 1, y - oy) || !inside(x - ox, y - oy - 1) || !inside(x - ox, y - oy + 1);
      r.set(x, y, edge ? outline : fill(x - ox, y - oy));
    }
}

/** A text box: dark outline, a white rim, a thin green line inside, cream paper. 12×12, slice 4. */
function frame(paper: RGB = PAPER): Raster {
  const r = new Raster(12, 12);
  const box = rounded(12, 12, 2);
  paint(r, box, INK, (x, y) => (x === 1 || y === 1 || x === 10 || y === 10 ? WHITE : x === 2 || y === 2 || x === 9 || y === 9 ? LINE : paper));
  return r;
}

/** A pill-shaped push button with a lip underneath; pressed it sinks onto the lip. 16×11, slice 5. */
function pill(face: RGB, light: RGB, dark: RGB, outline: RGB, pressed: boolean): Raster {
  const r = new Raster(16, 11);
  const h = 9, top = pressed ? 2 : 0;
  // the lip
  if (!pressed) paint(r, rounded(16, h, 4), outline, () => dark, 0, 2);
  paint(r, rounded(16, h, 4), outline, (x, y) => (y <= 1 && x > 1 && x < 14 ? light : y >= h - 2 ? dark : face), 0, top);
  return r;
}

/** A round A/B button, 22×24 with its lip. */
function roundButton(face: RGB, light: RGB, dark: RGB, outline: RGB, pressed: boolean): Raster {
  const r = new Raster(22, 24);
  const disc = (x: number, y: number) => (x - 10.5) ** 2 + (y - 10.5) ** 2 <= 11 * 11;
  const top = pressed ? 2 : 0;
  if (!pressed) paint(r, disc, outline, () => dark, 0, 2);
  paint(r, disc, outline, (x, y) => {
    const d = (x - 6) ** 2 + (y - 5) ** 2;
    return d < 5 ? hex('#fff0f6') : d < 18 ? light : (x - 10.5) + (y - 10.5) > 9 ? dark : face;
  }, 0, top);
  return r;
}

const PAD = { o: hex('#101018'), b: hex('#383844'), l: hex('#5a5a6a'), d: hex('#24242e'), p: hex('#1a1a22'), a: hex('#14141a'), al: hex('#7a7a8a') };

/** The d-pad's frames in its sheet: which arms are pressed in each (ui.ts picks one). */
export const DPAD_STATES = ['', 'u', 'd', 'l', 'r', 'ul', 'ur', 'dl', 'dr'];

/** The d-pad, 44×46, with the pressed arms (a string of u/d/l/r) pushed in. */
function dpad(dir: string): Raster {
  const r = new Raster(44, 46);
  const arm = 14, a0 = 15, a1 = a0 + arm;
  const cross = (x: number, y: number) => x >= 0 && y >= 0 && x < 44 && y < 44 && ((x >= a0 && x < a1) || (y >= a0 && y < a1));
  // the lip below the whole cross
  paint(r, cross, PAD.o, () => PAD.d, 0, 2);
  const which = (x: number, y: number) => (y < a0 ? 'u' : y >= a1 ? 'd' : x < a0 ? 'l' : x >= a1 ? 'r' : '');
  paint(r, cross, PAD.o, (x, y) => {
    const w = which(x, y);
    if (w && dir.includes(w)) return PAD.p;
    // light catches the top edges
    return y === 1 || (y === a0 + 1 && (x < a0 || x >= a1)) ? PAD.l : PAD.b;
  });
  // a dimple in the middle
  for (let y = a0 + 4; y < a1 - 4; y++) for (let x = a0 + 4; x < a1 - 4; x++) if ((x - 21.5) ** 2 + (y - 21.5) ** 2 < 10) r.set(x, y, PAD.d);
  // arrows pressed into each arm
  // a triangle with its tip at (tx, ty), pointing along (dx, dy)
  const arrow = (tx: number, ty: number, dx: number, dy: number, lit: boolean) => {
    for (let k = 0; k < 4; k++)
      for (let s = -k; s <= k; s++) r.set(tx - dx * k + (dy ? s : 0), ty - dy * k + (dx ? s : 0), lit ? PAD.al : PAD.a);
  };
  arrow(21, 4, 0, -1, dir.includes('u'));
  arrow(21, 39, 0, 1, dir.includes('d'));
  arrow(4, 21, -1, 0, dir.includes('l'));
  arrow(39, 21, 1, 0, dir.includes('r'));
  return r;
}

const NOTE = [
  '....oooo',
  '....o..o',
  '....o..o',
  '....o...',
  '.ooo....',
  'oooo....',
  'ooo.....',
];
const SPEAKER = [
  '...o....',
  '..oo..o.',
  'oooo.o.o',
  'oooo.o.o',
  'oooo.o.o',
  '..oo..o.',
  '...o....',
];
/** Four corners pointing out: go full screen. */
const EXPAND = [
  'ooo..ooo',
  'oo....oo',
  'o......o',
  '........',
  'o......o',
  'oo....oo',
  'ooo..ooo',
];
/** Four corners pointing in: leave full screen. */
const SHRINK = [
  '.o....o.',
  'oo....oo',
  '........',
  '........',
  '........',
  'oo....oo',
  '.o....o.',
];

/** A question mark: open the help. */
const QUESTION = [
  '..oooo..',
  '.oo..oo.',
  '.....oo.',
  '....oo..',
  '...oo...',
  '........',
  '...oo...',
];

/** The seal for a cat whose chain is proven in Bitcoin: gold, with a tick. 8×8. */
function seal(): Raster {
  const r = new Raster(8, 8);
  r.paint(['..oooo..', '.oyyyyo.', 'oyyyyywo', 'oyyyywyo', 'owyywyyo', 'oywwyyyo', '.oyyyyo.', '..oooo..'], 0, 0, { o: hex('#5a340c'), y: hex('#f2c23a'), w: hex('#fffae8') });
  return r;
}

/** Frames of one size side by side in a row: a sprite sheet. */
function sheet(frames: Raster[]): Raster {
  const { w, h } = frames[0];
  const r = new Raster(w * frames.length, h);
  frames.forEach((f, k) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (f.data[i + 3]) r.set(k * w + x, y, [f.data[i], f.data[i + 1], f.data[i + 2]], f.data[i + 3]);
    }
  });
  return r;
}

/** The icon buttons' frames in their sheet, in order (style.css picks them by number). */
export const ICONS = ['music', 'music-off', 'sound', 'sound-off', 'fullscreen', 'fullscreen-exit', 'help'] as const;

/** A little arrow for the arrow keys, pointing up; the rest are turned from it. 7×7. */
function arrowIcon(dir: 'up' | 'down' | 'left' | 'right'): Raster {
  const r = new Raster(7, 7);
  const up = ['...o...', '..ooo..', '.ooooo.', 'ooooooo', '..ooo..', '..ooo..', '..ooo..'];
  for (let y = 0; y < 7; y++)
    for (let x = 0; x < 7; x++) {
      const [ux, uy] = dir === 'up' ? [x, y] : dir === 'down' ? [x, 6 - y] : dir === 'left' ? [y, x] : [y, 6 - x];
      if (up[uy][ux] === 'o') r.set(x, y, INK);
    }
  return r;
}

/** A keyboard key: a pale cap on a darker skirt, seen a little from the front; pressed it sinks. 12×14, slice 4 4 6 4. */
function keycap(pressed: boolean): Raster {
  const r = new Raster(12, 14);
  const cap = rounded(12, 11, 2);
  const top = pressed ? 2 : 0;
  if (!pressed) paint(r, cap, INK, () => hex('#a8a090'), 0, 3);
  paint(r, cap, INK, (x, y) => (y === 1 && x > 1 && x < 10 ? WHITE : y >= 9 || x >= 10 ? SHADE : PAPER), 0, top);
  return r;
}

/** A square paper button with an icon; muted, the icon fades and gets a red slash. 16×17. */
function iconButton(icon: string[], muted: boolean): Raster {
  const r = new Raster(16, 17);
  paint(r, rounded(16, 15, 3), INK, () => INK, 0, 2);
  paint(r, rounded(16, 15, 3), INK, (_x, y) => (y === 1 ? WHITE : y >= 12 ? SHADE : PAPER));
  const ink = muted ? hex('#8a9a88') : INK;
  r.paint(icon, 4, 4, { o: ink });
  if (muted) for (let k = 0; k < 10; k++) { r.set(3 + k, 12 - k, hex('#d83838')); r.set(4 + k, 12 - k, hex('#d83838')); }
  return r;
}

/** Put all the art into CSS variables. */
export function applyPixelUI(): void {
  const root = document.documentElement.style;
  const set = (name: string, r: Raster) => root.setProperty(name, `url(${rasterURL(r)})`);
  set('--px-frame', frame());
  set('--px-field', frame(WHITE));
  const grey = [hex('#9098a8'), hex('#c0c8d4'), hex('#606878'), hex('#282838')] as const;
  const pink = [hex('#c83878'), hex('#f070a8'), hex('#801848'), hex('#401020')] as const;
  const green = [hex('#58a048'), hex('#90d070'), hex('#2e6e24'), INK] as const;
  const cream = [PAPER, WHITE, SHADE, INK] as const;
  for (const [name, c] of [['grey', grey], ['pink', pink], ['green', green], ['cream', cream]] as const) {
    set(`--px-pill-${name}`, pill(c[0], c[1], c[2], c[3], false));
    set(`--px-pill-${name}-down`, pill(c[0], c[1], c[2], c[3], true));
  }
  set('--px-round', roundButton(pink[0], pink[1], pink[2], pink[3], false));
  set('--px-round-down', roundButton(pink[0], pink[1], pink[2], pink[3], true));
  set('--px-icons', sheet([iconButton(NOTE, false), iconButton(NOTE, true), iconButton(SPEAKER, false), iconButton(SPEAKER, true), iconButton(EXPAND, false), iconButton(SHRINK, false), iconButton(QUESTION, false)]));
  set('--px-key', keycap(false));
  set('--px-key-down', keycap(true));
  set('--px-arrows', sheet((['up', 'down', 'left', 'right'] as const).map(arrowIcon)));
  set('--px-dpad', sheet(DPAD_STATES.map(dpad)));
  set('--px-seal', seal());
  // the wood: the help sign, and planks to write on (the snack board's names on oak, yours on pine)
  set('--px-sign', buildSign(7));
  set('--px-plank-walnut', buildPlank(WOODS.walnut, 31));
  set('--px-plank-pine', buildPlank(WOODS.pine, 21));
  [11, 12, 13, 14].forEach((seed, k) => set(`--px-plank-oak-${k}`, buildPlank(WOODS.oak, seed)));
}

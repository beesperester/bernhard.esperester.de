// The landmark follies: little garden models of famous places in Berlin,
// standing where the real ones are (world/landmarks.ts). Drawn pixel by pixel
// like the furniture, lit from the upper left, with a dark outline. Each
// sprite is LANDMARK_SPRITE's size, its foot on the bottom row.
import { Raster, hex, hash2, type RGB } from './raster.ts';
import { bayer } from './tiles.ts';
import { snowCap } from './furniture.ts';
import { SEASON, type Season } from '../world/season.ts';
import { LANDMARK_SPRITE, type LandmarkKind } from '../world/landmarks.ts';

type Tone = { o: RGB; d: RGB; b: RGB; l: RGB; s: RGB };
const tone = (o: string, d: string, b: string, l: string, s: string): Tone => ({ o: hex(o), d: hex(d), b: hex(b), l: hex(l), s: hex(s) });

const SAND = tone('#3e3020', '#9a8462', '#c4ae86', '#dccaa4', '#f0e4c4');
const CONCRETE = tone('#26282c', '#7c8088', '#a4a8ae', '#c8ccd0', '#e8eaec');
const COPPER = tone('#1a3a30', '#3e7c66', '#5ea88c', '#86c8ac', '#b8e6d0');
const BRICK = tone('#3a1210', '#8a2e22', '#b4402e', '#cc5a40', '#e48262');
const GRANITE = tone('#2a1814', '#6e4234', '#8e5a48', '#a8735e', '#c89480');
const STEEL = tone('#1c2430', '#5a6a80', '#8496ac', '#aebcd0', '#dce6f2');
const GOLD = tone('#4a3008', '#b07a18', '#d8a828', '#f0cc48', '#fff0a0');
const SOOT = tone('#141216', '#3a3438', '#544c50', '#6e6468', '#8c8286');
const GLASS = { d: hex('#2a4a78'), b: hex('#4c7cc0'), l: hex('#8ab8ec'), s: hex('#d4ecff') };
const DARK = hex('#1a1418');
const WHITE = hex('#f4f2ec');
const RED = hex('#d83030'), YELLOW = hex('#f8d030'), BLACK = hex('#202020');

/** A dark outline around everything drawn so far. */
function outline(r: Raster, c: RGB): void {
  const edge: [number, number][] = [];
  for (let y = 0; y < r.h; y++)
    for (let x = 0; x < r.w; x++)
      if (!r.isSet(x, y) && (r.isSet(x - 1, y) || r.isSet(x + 1, y) || r.isSet(x, y - 1) || r.isSet(x, y + 1))) edge.push([x, y]);
  for (const [x, y] of edge) r.set(x, y, c);
}

/** The shade of a round thing at column x of [x0, x1): lit on the left, dark on the right. */
function round(t: Tone, x: number, x0: number, x1: number, y = 0): RGB {
  const u = (x + 0.5 - x0) / (x1 - x0);
  const v = u + (bayer(x, y) - 0.5) * 0.12;
  return v < 0.18 ? t.l : v < 0.32 ? t.s : v < 0.62 ? t.l : v < 0.82 ? t.b : t.d;
}

/** A column from y0 to y1 (exclusive), w wide at x, shaded round. */
function column(r: Raster, t: Tone, x: number, w: number, y0: number, y1: number): void {
  for (let y = y0; y < y1; y++) for (let i = 0; i < w; i++) r.set(x + i, y, round(t, x + i, x, x + w, y));
}

/** A disc (a dome is half of one) centred at (cx, cy), shaded from the upper left. */
function disc(r: Raster, t: Tone, cx: number, cy: number, rx: number, ry: number, below = Infinity): void {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy > 1 || y >= below) continue;
      const lit = -dx * 0.6 - dy * 0.5 + (bayer(x, y) - 0.5) * 0.25;
      r.set(x, y, lit > 0.55 ? t.s : lit > 0.15 ? t.l : lit > -0.3 ? t.b : t.d);
    }
}

/** A wall of stone blocks: courses of `course` px with staggered joints. */
function masonry(r: Raster, t: Tone, x0: number, y0: number, w: number, h: number, course = 3, block = 6, seed = 0): void {
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) {
      const row = Math.floor((y - y0) / course);
      const joint = (y - y0) % course === course - 1 || (x - x0 + (row % 2) * (block >> 1)) % block === 0;
      r.set(x, y, joint ? t.d : hash2(x, y, seed + 900) < 0.12 ? t.l : t.b);
    }
}

/** A window: dark glass with a lit top-left pane, or an arch-topped one. */
function window(r: Raster, x: number, y: number, w: number, h: number, arch = false, glass: RGB = DARK): void {
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      if (arch && j === 0 && (i === 0 || i === w - 1) && w > 2) continue;
      r.set(x + i, y + j, glass);
    }
  if (w > 2 && h > 2) r.set(x + (arch ? 1 : 0), y + 1, GLASS.b);
}

/** A little flag on a pole: black, red and gold. */
function flag(r: Raster, x: number, y: number): void {
  r.rect(x, y, 1, 7, STEEL.d);
  r.rect(x + 1, y, 5, 1, BLACK);
  r.rect(x + 1, y + 1, 5, 1, RED);
  r.rect(x + 1, y + 2, 5, 1, YELLOW);
}

// ---------------------------------------------------------------- the follies

/** The Fernsehturm: a concrete needle with its silver ball and the red and white mast. */
function tvtower(): Raster {
  const { w, h } = LANDMARK_SPRITE.tvtower;
  const r = new Raster(w, h);
  const cx = 16;
  // the pavilion at its foot, with its folded roof
  for (let y = h - 12; y < h; y++)
    for (let x = 2; x < 30; x++) {
      const roof = y < h - 8;
      if (roof && Math.abs(((x - 2) % 7) - 3) > 3 - (y - (h - 12))) continue;
      r.set(x, y, roof ? (((x - 2) % 7) < 3 ? CONCRETE.s : CONCRETE.l) : y === h - 1 ? CONCRETE.d : (x - 2) % 4 === 0 ? CONCRETE.d : GLASS.b);
    }
  // the shaft, tapering from the pavilion up to the ball, then on up to the mast
  for (let y = 18; y < h - 10; y++) {
    const half = y > 46 ? 2.5 + ((y - 46) / (h - 56)) * 2.5 : 2;
    const x0 = Math.round(cx - half), x1 = Math.round(cx + half);
    for (let x = x0; x < x1; x++) r.set(x, y, round(CONCRETE, x, x0, x1, y));
  }
  // the ball: steel facets in a dither, with its band of windows round the middle
  disc(r, STEEL, cx, 34, 9.5, 9);
  for (let y = 26; y < 43; y++)
    for (let x = 6; x < 26; x++) if (r.isSet(x, y) && (x + y) % 4 === 0 && y !== 33 && y !== 34) r.set(x, y, STEEL.b);
  for (let x = 7; x < 26; x++) if (r.isSet(x, 33)) { r.set(x, 33, x % 2 ? DARK : GLASS.d); r.set(x, 34, STEEL.d); }
  // the mast, red and white
  for (let y = 1; y < 18; y++) {
    const c = Math.floor((y - 1) / 3) % 2 ? WHITE : RED;
    r.set(cx - 1, y, c);
    if (y > 8) r.set(cx, y, c === WHITE ? CONCRETE.l : hex('#a82424'));
  }
  r.set(cx - 1, 0, hex('#ff6060'));
  outline(r, CONCRETE.o);
  return r;
}

/** The Brandenburger Tor: six columns under the attic, and the quadriga on top. */
function gate(): Raster {
  const { w, h } = LANDMARK_SPRITE.gate;
  const r = new Raster(w, h);
  // the step it stands on
  r.rect(0, h - 3, w, 1, SAND.l);
  r.rect(0, h - 2, w, 2, SAND.d);
  // the columns (where world/landmarks.ts makes them solid), fluted
  for (const x of [0, 16, 32, 52, 68, 84]) {
    column(r, SAND, x, 4, 21, h - 3);
    r.rect(x - (x ? 1 : 0), 20, x && x < 84 ? 6 : 5, 1, SAND.l);
    r.rect(x - (x ? 1 : 0), h - 4, x && x < 84 ? 6 : 5, 1, SAND.b);
  }
  // the beam across, with its frieze of triglyphs
  r.rect(0, 13, w, 2, SAND.s);
  r.rect(0, 15, w, 4, SAND.l);
  for (let x = 2; x < w; x += 4) r.rect(x, 15, 1, 3, SAND.d);
  r.rect(0, 19, w, 1, SAND.d);
  // the attic, stepping in, and the plinth for the quadriga
  r.rect(4, 8, w - 8, 5, SAND.b);
  r.rect(4, 8, w - 8, 1, SAND.s);
  for (let x = 8; x < w - 8; x += 9) r.rect(x, 10, 6, 2, SAND.d);
  r.rect(34, 6, 20, 2, SAND.l);
  // the quadriga: four green horses abreast pulling Victoria, her standard raised
  for (const hx of [35, 39, 45, 49]) {
    r.rect(hx, 3, 4, 3, COPPER.b);
    r.set(hx, 3, COPPER.l);
    r.set(hx + (hx < 44 ? -1 : 4), 2, COPPER.l);
    r.set(hx + (hx < 44 ? -1 : 4), 1, COPPER.b);
  }
  r.rect(42, 2, 3, 4, COPPER.d);
  r.set(43, 1, COPPER.l);
  r.rect(44, 0, 1, 2, GOLD.l);
  r.set(45, 0, GOLD.b);
  outline(r, SAND.o);
  return r;
}

/** The Reichstag: corner towers, the portico, and the glass dome on top. */
function reichstag(): Raster {
  const { w, h } = LANDMARK_SPRITE.reichstag;
  const r = new Raster(w, h);
  // the roof seen above the front, and the glass dome on it
  r.rect(6, 15, w - 12, 5, CONCRETE.b);
  r.rect(6, 15, w - 12, 1, CONCRETE.l);
  for (let y = 2; y < 16; y++)
    for (let x = 18; x < 46; x++) {
      const dx = (x + 0.5 - 32) / 13, dy = (y + 0.5 - 16) / 14;
      if (dx * dx + dy * dy > 1) continue;
      // steel ribs up the dome and the rings round it
      const rib = Math.abs(((Math.asin(Math.max(-1, Math.min(1, dx))) / Math.PI) * 10) % 1) < 0.18 || y % 4 === 0;
      r.set(x, y, rib ? STEEL.d : dx < -0.3 && dy < -0.2 ? GLASS.s : dx < 0.2 ? GLASS.l : GLASS.b);
    }
  r.rect(30, 1, 4, 1, STEEL.l);
  // the front, in sandstone, and its four corner towers
  masonry(r, SAND, 0, 20, w, h - 20, 3, 8, 1);
  for (const x of [0, w - 11]) {
    masonry(r, SAND, x, 12, 11, h - 12, 3, 6, 2);
    r.rect(x, 11, 11, 1, SAND.s);
    for (const wy of [16, 26, 36]) window(r, x + 4, wy, 3, 5, true);
  }
  flag(r, w - 6, 3);
  // windows in two rows along the front
  for (let x = 14; x < w - 14; x += 6) if (x < 21 || x > 41) { window(r, x, 26, 3, 5, true); window(r, x, 37, 3, 6, true); }
  // the portico: six columns under a pediment with its dedication (a line of letters)
  r.rect(19, 22, 26, 2, SAND.s);
  for (let i = 0; i < 13; i++) {
    r.rect(20 + i, 21 - Math.floor(i / 2), 1, Math.floor(i / 2) + 1, SAND.l);
    r.rect(43 - i, 21 - Math.floor(i / 2), 1, Math.floor(i / 2) + 1, SAND.b);
  }
  for (let x = 23; x < 41; x++) if (x % 2) r.set(x, 23, SAND.o);
  for (const x of [20, 24, 28, 33, 37, 41]) column(r, SAND, x, 3, 24, h - 4);
  r.rect(23, 25, 1, h - 30, DARK);
  r.rect(0, h - 3, w, 3, SAND.d);
  r.rect(16, h - 4, 32, 1, SAND.l);
  outline(r, SAND.o);
  return r;
}

/** The Siegessäule: a red granite plinth, the column ringed in gold, and golden Victoria. */
function victory(): Raster {
  const { w, h } = LANDMARK_SPRITE.victory;
  const r = new Raster(w, h);
  // the round hall at the foot, its pillars, and the plinth
  for (let y = h - 22; y < h; y++)
    for (let x = 2; x < 30; x++) {
      if (y < h - 10 && (x < 6 || x > 25)) continue;
      const hall = y >= h - 18 && y < h - 11 && (x - 6) % 4 === 3;
      r.set(x, y, hall ? DARK : y === h - 22 || y === h - 10 ? GRANITE.s : round(GRANITE, x, y < h - 10 ? 6 : 2, y < h - 10 ? 26 : 30, y));
    }
  // the column, with the three rings of gilded cannon barrels
  column(r, SAND, 13, 6, 22, h - 22);
  for (const y of [h - 32, h - 44, h - 56]) {
    column(r, GOLD, 12, 8, y, y + 3);
    for (let x = 12; x < 20; x += 2) r.set(x, y + 1, GOLD.d);
  }
  r.rect(11, 20, 10, 2, SAND.s);
  r.rect(12, 22, 8, 1, SAND.l);
  // Victoria: wings spread, the laurel wreath held high
  const g = GOLD;
  r.rect(15, 9, 2, 11, g.l);
  r.rect(14, 13, 4, 7, g.b);
  r.set(14, 13, g.s);
  r.rect(15, 7, 2, 2, g.s);
  for (let i = 0; i < 6; i++) {
    r.rect(13 - i, 10 + Math.floor(i / 2), 1, 4 - Math.floor(i / 2), i % 2 ? g.l : g.s);
    r.rect(18 + i, 10 + Math.floor(i / 2), 1, 4 - Math.floor(i / 2), i % 2 ? g.b : g.d);
  }
  r.rect(17, 3, 1, 5, g.l);
  r.rect(16, 1, 3, 1, g.b);
  r.set(16, 2, g.b);
  r.set(18, 2, g.b);
  outline(r, GRANITE.o);
  return r;
}

/** The Berliner Dom: the great green dome with its lantern and cross, and the corner towers. */
function dom(): Raster {
  const { w, h } = LANDMARK_SPRITE.dom;
  const r = new Raster(w, h);
  // the drum the dome sits on
  masonry(r, SAND, 12, 24, 24, 8, 3, 4, 3);
  for (let x = 14; x < 34; x += 4) window(r, x, 25, 2, 5, true);
  disc(r, COPPER, 24, 24, 13, 15, 24);
  // ribs running up it
  for (const x of [17, 24, 31]) for (let y = 11; y < 24; y++) if (r.isSet(x, y)) r.set(x, y, COPPER.d);
  // the lantern and the golden cross
  column(r, COPPER, 22, 4, 5, 10);
  r.rect(21, 5, 6, 1, COPPER.s);
  r.rect(23, 0, 2, 5, GOLD.l);
  r.rect(22, 1, 4, 1, GOLD.b);
  // corner towers with their little domes
  for (const x of [1, w - 11]) {
    masonry(r, SAND, x, 20, 10, h - 20, 3, 5, 4);
    disc(r, COPPER, x + 5, 20, 5, 6, 20);
    r.rect(x + 4, 12, 2, 3, GOLD.l);
    window(r, x + 3, 26, 4, 7, true);
  }
  // the front: a great arched doorway between the pillars
  masonry(r, SAND, 11, 32, 26, h - 32, 3, 6, 5);
  r.rect(11, 32, 26, 1, SAND.s);
  for (const x of [12, 18, 28, 34]) column(r, SAND, x, 2, 34, h - 3);
  window(r, 20, 40, 8, h - 43, true);
  for (let x = 21; x < 27; x++) r.set(x, 40, SAND.l);
  window(r, 21, 34, 6, 4, true, GLASS.d);
  r.rect(0, h - 3, w, 3, SAND.d);
  outline(r, SAND.o);
  return r;
}

/** The Rotes Rathaus: red brick, rows of arched windows, and the clock tower. */
function rathaus(): Raster {
  const { w, h } = LANDMARK_SPRITE.rathaus;
  const r = new Raster(w, h);
  // the tower: brick, a clock, corner turrets, a flag on top
  masonry(r, BRICK, 17, 10, 14, 26, 2, 4, 6);
  for (const x of [16, 30]) column(r, BRICK, x, 2, 6, 36);
  r.rect(16, 6, 16, 1, BRICK.s);
  for (let x = 16; x < 32; x += 2) r.set(x, 5, BRICK.l);
  disc(r, { ...STEEL, l: WHITE, s: WHITE, b: hex('#e8e0d0') }, 24, 15, 3.5, 3.5);
  r.set(24, 13, DARK);
  r.set(24, 14, DARK);
  r.set(25, 15, DARK);
  for (const y of [22, 29]) { window(r, 20, y, 2, 5, true); window(r, 26, y, 2, 5, true); }
  flag(r, 24, 0);
  // the hall: three floors of arched windows and the long cornice
  masonry(r, BRICK, 0, 34, w, h - 34, 2, 5, 7);
  r.rect(0, 34, w, 2, BRICK.s);
  r.rect(0, 36, w, 1, BRICK.d);
  for (const y of [39, 47, 55]) {
    r.rect(0, y + 6, w, 1, BRICK.l);
    for (let x = 3; x < w - 2; x += 5) window(r, x, y, 3, 5, true);
  }
  // the door
  r.rect(20, h - 9, 8, 9, BRICK.d);
  window(r, 21, h - 8, 6, 8, true);
  r.rect(0, h - 1, w, 1, BRICK.d);
  outline(r, BRICK.o);
  return r;
}

/** The Gedächtniskirche: the broken tower, dark with soot, and the blue glass of the new hall. */
function church(): Raster {
  const { w, h } = LANDMARK_SPRITE.church;
  const r = new Raster(w, h);
  // the new belfry behind: a honeycomb of blue glass
  for (let y = 30; y < h; y++)
    for (let x = 22; x < 31; x++) r.set(x, y, (x - 22) % 3 === 0 || (y - 30) % 3 === 0 ? CONCRETE.b : (x + y) % 5 === 0 ? GLASS.l : GLASS.d);
  // the old tower: its base with the great arch, then up to where the spire broke off
  masonry(r, SOOT, 2, 32, 21, h - 32, 3, 5, 8);
  for (let y = 7; y < 32; y++) {
    for (let x = 5; x < 20; x++) {
      // the broken top: jagged, missing more on the right
      const ragged = y < 12 + Math.floor(hash2(x, 0, 910) * 6) + (x > 13 ? 3 : 0);
      if (ragged) continue;
      r.set(x, y, (y - 7) % 3 === 2 || (x - 5) % 5 === 0 ? SOOT.d : x < 9 ? SOOT.l : SOOT.b);
    }
  }
  // the clock face, and the tall windows
  disc(r, { ...SOOT, l: hex('#9a9080'), s: hex('#b8ae9c') }, 12, 22, 3, 3);
  r.set(12, 21, DARK);
  r.set(13, 22, DARK);
  window(r, 7, 26, 2, 5, true);
  window(r, 16, 26, 2, 5, true);
  // the porch below, its arch and rose window
  r.rect(2, 32, 21, 1, SOOT.s);
  disc(r, { ...GLASS, o: DARK, s: GLASS.s }, 12.5, 38, 3, 3);
  window(r, 9, 45, 8, h - 45, true);
  r.rect(0, h - 2, w, 2, SOOT.d);
  outline(r, SOOT.o);
  return r;
}

/** A stretch of the Wall, as the East Side Gallery: concrete slabs painted bright, the round pipe on top. */
function wall(): Raster {
  const { w, h } = LANDMARK_SPRITE.wall;
  const r = new Raster(w, h);
  const paint = [hex('#f04060'), hex('#f8c030'), hex('#40b0e8'), hex('#58c858'), hex('#a060d8'), hex('#f88838'), WHITE, hex('#2850c0')];
  r.rect(0, 0, w, 3, CONCRETE.s);
  r.rect(0, 2, w, 1, CONCRETE.l);
  for (let x = 0; x < w; x++)
    for (let y = 3; y < h - 1; y++) {
      const slab = Math.floor(x / 10), u = x % 10;
      if (u === 0) { r.set(x, y, CONCRETE.d); continue; }
      // a different painting on every slab: stripes, blobs, a heart, a face
      const a = paint[Math.floor(hash2(slab, 1, 920) * paint.length)], b = paint[Math.floor(hash2(slab, 2, 920) * paint.length)];
      const style = Math.floor(hash2(slab, 3, 920) * 4);
      let c = a;
      if (style === 0) c = Math.floor((y + u) / 3) % 2 ? a : b;
      else if (style === 1) c = hash2(Math.floor(u / 3), Math.floor(y / 3), slab + 921) < 0.4 ? b : a;
      else if (style === 2) {
        const hx = Math.abs(u - 5) / 4, hy = (y - 6 - 3) / 7;
        c = hy < 0.3 && (hx - 0.5) ** 2 + (hy + 0.15) ** 2 < 0.12 * 2 || (hy >= -0.2 && hx < 0.9 - (hy + 0.2) * 1.2 && hy < 0.8) ? RED : a;
      } else c = y > 12 ? b : a;
      if (style === 3 && y > 6 && y < 11 && (u === 3 || u === 7) && y < 9) c = BLACK;
      if (style === 3 && y === 10 && u > 2 && u < 8) c = BLACK;
      r.set(x, y, c);
    }
  r.rect(0, h - 1, w, 1, CONCRETE.d);
  outline(r, CONCRETE.o);
  return r;
}

/** Checkpoint Charlie: the little white booth behind its sandbags, its sign on the roof. */
function checkpoint(): Raster {
  const { w, h } = LANDMARK_SPRITE.checkpoint;
  const r = new Raster(w, h);
  // the booth
  r.rect(7, 16, 18, h - 16, WHITE);
  r.rect(22, 16, 3, h - 16, CONCRETE.l);
  r.rect(6, 13, 20, 3, CONCRETE.d);
  r.rect(6, 13, 20, 1, CONCRETE.l);
  window(r, 9, 18, 5, 5, false, GLASS.d);
  window(r, 16, 18, 5, 5, false, GLASS.d);
  r.rect(13, h - 12, 6, 12, CONCRETE.b);
  // the sign on its post: a white board with a line of black letters
  r.rect(15, 9, 2, 4, CONCRETE.d);
  r.rect(5, 1, 22, 8, WHITE);
  for (let x = 7; x < 25; x++) { if (x % 3) r.set(x, 3, BLACK); if (x % 2 && x > 9 && x < 23) r.set(x, 6, BLACK); }
  // sandbags stacked either side
  const BAG = tone('#4a3a1c', '#9a8450', '#bca46c', '#d4c088', '#e8d8a8');
  for (const [x0, x1] of [[0, 9], [23, 32]])
    for (let row = 0; row < 3; row++)
      for (let x = x0 + (row % 2) * 2; x + 4 <= x1; x += 5) {
        const y = h - 4 - row * 3;
        r.rect(x, y, 4, 3, BAG.b);
        r.rect(x, y, 4, 1, BAG.l);
        r.set(x + 3, y + 2, BAG.d);
      }
  outline(r, CONCRETE.o);
  return r;
}

/** The Oberbaumbrücke: red brick arches, its two towers, and a yellow U-Bahn train crossing on top. */
function oberbaum(): Raster {
  const { w, h } = LANDMARK_SPRITE.oberbaum;
  const r = new Raster(w, h);
  // the arcade: brick piers with arches between
  masonry(r, BRICK, 0, 24, w, h - 24, 2, 4, 9);
  for (let x = 2; x < w - 4; x += 8)
    for (let y = 30; y < h; y++) {
      for (let i = 0; i < 6; i++) {
        const ax = (i + 0.5 - 3) / 3, ay = (y - 33) / 3;
        if (y < 33 && ax * ax + ay * ay > 1) continue;
        r.set(x + 1 + i, y, i === 0 ? BRICK.o : DARK);
      }
    }
  r.rect(0, 24, w, 2, BRICK.s);
  r.rect(0, 26, w, 1, BRICK.d);
  // the U-Bahn viaduct on top, and a yellow train on it
  r.rect(0, 20, w, 4, BRICK.d);
  for (let x = 0; x < w; x += 4) r.rect(x, 21, 2, 2, BRICK.b);
  const TRAIN = tone('#5a4008', '#c89818', '#f0c020', '#f8d840', '#fff090');
  r.rect(4, 13, 14, 7, TRAIN.b);
  r.rect(4, 13, 14, 1, TRAIN.s);
  r.rect(4, 19, 14, 1, TRAIN.d);
  for (let x = 6; x < 17; x += 4) r.rect(x, 15, 2, 2, GLASS.d);
  // the two towers, crenellated, with their pointed windows
  for (const x of [17, 27]) {
    masonry(r, BRICK, x, 6, 6, 18, 2, 3, 10);
    for (let i = 0; i < 6; i += 2) r.rect(x + i, 4, 1, 2, BRICK.l);
    r.rect(x, 6, 6, 1, BRICK.s);
    window(r, x + 2, 10, 2, 5, true);
    window(r, x + 2, 17, 2, 4, true);
  }
  outline(r, BRICK.o);
  return r;
}

const BUILD: Record<LandmarkKind, () => Raster> = { tvtower, gate, reichstag, victory, dom, rathaus, church, wall, checkpoint, oberbaum };

/** The folly of this kind, dressed for the season (snow on its ledges in winter). */
export function buildLandmark(kind: LandmarkKind, s: Season = SEASON): Raster {
  const r = BUILD[kind]();
  snowCap(r, s.snow, kind.length + 7);
  return r;
}

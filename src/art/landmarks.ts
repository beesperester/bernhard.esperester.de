// The landmark follies: weathered garden monuments of famous places in
// Berlin. Each is drawn from the shapes it is built of (world/landmarks.ts),
// seen from the front and above like the rest of the park: a block shows its
// top and its front, a column its round top and its shaded side. Moss grows
// on the tops, ivy down some fronts, and broken things have jagged tops.
import { Raster, hex, hash2, type RGB } from './raster.ts';
import { bayer } from './tiles.ts';
import { snowCap } from './furniture.ts';
import { SEASON, type Season } from '../world/season.ts';
import { LANDMARK_SHAPES, LANDMARK_SPRITE, ROUND, type LandmarkKind, type Material, type Shape } from '../world/landmarks.ts';

/** Outline, shadow side, front, lit top, highlight. */
type Tone = { o: RGB; d: RGB; b: RGB; l: RGB; s: RGB };
const tone = (o: string, d: string, b: string, l: string, s: string): Tone => ({ o: hex(o), d: hex(d), b: hex(b), l: hex(l), s: hex(s) });

const TONES: Record<Material, Tone> = {
  stone: tone('#3a3830', '#8a8678', '#aaa594', '#c8c3b0', '#e2dccb'),
  dark: tone('#1e1c1e', '#4a4448', '#5e585a', '#78706e', '#958c86'),
  brick: tone('#3a1a14', '#7e3a2c', '#9c4a36', '#b45e46', '#cc7c60'),
  bronze: tone('#1a3a30', '#3e7c66', '#5a9a80', '#7cbaa0', '#a8d8c0'),
  gold: tone('#4a3410', '#a07a2a', '#c49a3a', '#dcb850', '#f0d880'),
  white: tone('#4a4a48', '#b8b6ae', '#d8d6ce', '#ecebe4', '#faf9f4'),
  paint: tone('#3a3a3a', '#8c8c88', '#a8a8a2', '#c4c4be', '#dcdcd6'),
  iron: tone('#141418', '#2a2a30', '#3c3c44', '#56565e', '#74747c'),
};
const MOSS = [hex('#4c7a34'), hex('#6a9640'), hex('#8ab050')];
const IVY = [hex('#2e5a26'), hex('#3e7430'), hex('#5a9438')];
/** Faded murals on the wall's slabs. */
const MURAL = [hex('#d88890'), hex('#e8cc78'), hex('#88b8d8'), hex('#98c890'), hex('#b8a0d0'), hex('#e8a878')];

/** What the canvas holds at a pixel: how far forward on the ground it is (bigger is nearer the viewer). */
class Canvas {
  readonly r: Raster;
  private readonly near: Float32Array;
  constructor(w: number, h: number) {
    this.r = new Raster(w, h);
    this.near = new Float32Array(w * h).fill(-Infinity);
  }
  /** Paint (x, y) if this is in front of what is there: `near` is its ground y, ties go to the later shape. */
  put(x: number, y: number, near: number, c: RGB): void {
    if (x < 0 || y < 0 || x >= this.r.w || y >= this.r.h) return;
    const i = y * this.r.w + x;
    if (near < this.near[i] - 0.01) return;
    this.near[i] = near;
    this.r.set(x, y, c);
  }
}

/** A shape's jagged top at column x: how many px lower it is broken off there. */
const broken = (s: Shape, x: number, seed: number) =>
  s.ragged ? Math.floor(hash2(x >> 1, seed, 960) * (s.ragged + 1)) : 0;

/** Stone courses on a front face: joints every few px, staggered. */
function joint(mat: Material, x: number, y: number): boolean {
  if (mat === 'brick') return y % 2 === 1 || (x + (y % 4 < 2 ? 0 : 2)) % 4 === 0 && y % 2 === 0;
  if (mat === 'stone' || mat === 'dark') return y % 4 === 3 || (x + (y % 8 < 4 ? 0 : 4)) % 8 === 0;
  if (mat === 'white') return x % 3 === 0;
  return false;
}

function drawShape(c: Canvas, s: Shape, ox: number, oy: number, seed: number): void {
  const t = TONES[s.mat];
  const [z0, z1] = s.z;
  if ('box' in s) {
    const [x0, y0, x1, y1] = s.box;
    for (let x = x0; x < x1; x++) {
      const top = z1 - broken(s, x, seed);
      const left = x === x0, right = x === x1 - 1;
      // the top face, lit, its back edge catching the light
      for (let y = y0; y < y1; y++) {
        let col = y === y0 ? t.s : left ? t.s : t.l;
        if (s.mat !== 'paint' && s.mat !== 'white' && hash2(x, y + top, seed + 961) < 0.08) col = t.b;
        c.put(x + ox, y - top + oy, y, col);
      }
      // the front face, darker towards the bottom
      for (let z = top - 1; z >= z0; z--) {
        const fy = y1 - 1 - z;
        const k = z - z0;
        let col = left ? t.l : right ? t.d : t.b;
        if (joint(s.mat, x - x0, top - 1 - z)) col = t.d;
        if (s.mat === 'paint') col = mural(x, z, seed, t);
        if (k < 2 && bayer(x, fy) < 0.5) col = t.d;
        c.put(x + ox, fy + oy, y1 - 0.5, col);
      }
    }
    return;
  }
  if ('cyl' in s) {
    const [cx, cy, r] = s.cyl;
    for (let dx = -r; dx <= r; dx++) {
      const h = Math.sqrt(Math.max(0, r * r - dx * dx)) * ROUND;
      const x = cx + dx, top = z1 - broken(s, x, seed);
      const u = (dx + r + 0.5) / (2 * r + 1);
      // the round top
      for (let dy = -Math.floor(h); dy <= Math.floor(h); dy++)
        c.put(x + ox, cy + dy - top + oy, cy + dy, dx < 0 && dy < 0 ? t.s : t.l);
      // its side, lit on the left, in shade on the right
      for (let z = top - 1; z >= z0; z--) {
        const v = u + (bayer(x, z) - 0.5) * 0.15;
        let col = v < 0.25 ? t.l : v < 0.4 ? t.s : v < 0.65 ? t.l : v < 0.85 ? t.b : t.d;
        if ((s.mat === 'stone' || s.mat === 'dark') && (top - 1 - z) % 6 === 5) col = t.b;
        if (s.mat === 'brick' && (top - 1 - z) % 2 === 1) col = t.d;
        c.put(x + ox, cy + Math.floor(h) - z + oy, cy + h, col);
      }
    }
    return;
  }
  // a ball or a dome: a disc, shaded from the upper left (a dome only its upper half)
  const [cx, cy, r] = 'ball' in s ? s.ball : s.dome;
  const cz = z0, ry = 'dome' in s ? z1 - z0 : r;
  // (a dome stands on an ellipse: its front edge curves down a little)
  const lip = 'dome' in s ? Math.round(r * ROUND) : r;
  for (let dy = -ry; dy <= lip; dy++)
    for (let dx = -r; dx <= r; dx++) {
      const nx = dx / r, ny = dy <= 0 ? dy / ry : dy / lip;
      if (nx * nx + ny * ny > 1) continue;
      const lit = -nx * 0.6 - ny * 0.5 + (bayer(dx, dy) - 0.5) * 0.25;
      let col = lit > 0.55 ? t.s : lit > 0.15 ? t.l : lit > -0.3 ? t.b : t.d;
      if ('dome' in s && s.ribs) {
        // an open iron frame: ribs and rings, the sky (nothing) between
        const rib = Math.abs(((Math.asin(Math.max(-1, Math.min(1, nx))) / Math.PI) * 8) % 1) < 0.2 || (dy + ry) % 4 === 0;
        if (!rib) continue;
        col = t.l;
      }
      c.put(cx + dx + ox, cy - cz + dy + oy, cy + Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny)) * r, col);
    }
}

/** Faded paintings on the wall: each slab its own, in soft stripes and blobs. */
function mural(x: number, z: number, seed: number, t: Tone): RGB {
  const slab = Math.floor(x / 10);
  if (x % 10 === 0) return t.d;
  const a = MURAL[Math.floor(hash2(slab, 1, seed + 970) * MURAL.length)], b = MURAL[Math.floor(hash2(slab, 2, seed + 970) * MURAL.length)];
  const style = Math.floor(hash2(slab, 3, seed + 970) * 3);
  if (z > 19) return t.l;
  if (style === 0) return Math.floor((z + x) / 3) % 2 ? a : b;
  if (style === 1) return hash2(Math.floor(x / 3), Math.floor(z / 3), slab + 971) < 0.4 ? b : a;
  return z < 9 ? b : a;
}

/** Moss on the tops, at the feet, and ivy hanging down some fronts. */
function overgrow(r: Raster, shapes: Shape[], ox: number, oy: number, seed: number): void {
  const isStone = (x: number, y: number) => r.isSet(x, y);
  for (let y = 1; y < r.h; y++)
    for (let x = 0; x < r.w; x++) {
      // a top surface: lit stone with open air above
      if (!isStone(x, y) || isStone(x, y - 1)) continue;
      if (hash2(x >> 1, y >> 1, seed + 980) < 0.35) r.set(x, y, MOSS[(x + y) % 2 ? 1 : 2]);
      if (hash2(x, y, seed + 981) < 0.2 && isStone(x, y + 1)) r.set(x, y + 1, MOSS[0]);
    }
  for (const s of shapes) {
    if (!s.ivy || !('box' in s)) continue;
    const [x0, , x1, y1] = s.box;
    for (let x = x0; x < x1; x++) {
      const len = Math.floor(hash2(x >> 1, 3, seed + 982) * (s.z[1] - s.z[0]) * 0.8);
      if (hash2(x >> 1, 4, seed + 982) < 0.35) continue;
      for (let k = 0; k < len; k++) {
        const y = y1 - 1 - (s.z[1] - 1 - broken(s, x, seed)) + k + oy;
        if (isStone(x + ox, y) && hash2(x, k, seed + 983) < 0.8) r.set(x + ox, y, IVY[(x * 3 + k) % 3]);
      }
    }
  }
}

/** A dark outline around everything drawn so far. */
function outline(r: Raster, c: RGB): void {
  const edge: [number, number][] = [];
  for (let y = 0; y < r.h; y++)
    for (let x = 0; x < r.w; x++)
      if (!r.isSet(x, y) && (r.isSet(x - 1, y) || r.isSet(x + 1, y) || r.isSet(x, y - 1) || r.isSet(x, y + 1))) edge.push([x, y]);
  for (const [x, y] of edge) r.set(x, y, c);
}

/** Little touches a shape can't make: a clock face, a sign on its post. */
function details(kind: LandmarkKind, r: Raster, ox: number, oy: number): void {
  const at = (x: number, y: number, z: number) => [x + ox, y - z + oy] as const;
  if (kind === 'rathaus') {
    // the clock, on the tower's front
    const [cx, cy] = at(22, 27, 48);
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (dx * dx + dy * dy <= 10) r.set(cx + dx, cy + dy, dx * dx + dy * dy > 6 ? TONES.stone.d : TONES.white.s);
    r.set(cx, cy - 1, TONES.iron.o);
    r.set(cx, cy - 2, TONES.iron.o);
    r.set(cx + 1, cy, TONES.iron.o);
  }
  if (kind === 'checkpoint') {
    // the sign on its post: a white board with a line of letters
    const [sx, sy] = at(8, 6, 32);
    r.rect(sx, sy, 16, 6, TONES.white.s);
    for (let x = 2; x < 14; x++) if (x % 3) r.set(sx + x, sy + 2, TONES.iron.o);
    // a window in the hut
    const [wx, wy] = at(11, 12, 14);
    r.rect(wx, wy, 10, 4, TONES.iron.b);
    r.rect(wx, wy, 3, 1, TONES.paint.l);
  }
  if (kind === 'tvtower') {
    // the band of windows round the ball
    const [bx, by] = at(16, 22, 54);
    for (let dx = -8; dx <= 8; dx++) r.set(bx + dx, by, dx % 2 ? TONES.iron.b : TONES.iron.l);
  }
  if (kind === 'oberbaum') {
    // its arches, dark under the deck
    for (const ax of [8, 22, 36]) {
      const [x, y] = at(ax, 13, 9);
      for (let k = 0; k < 9; k++) for (let i = 0; i < 6; i++) if (k > 1 || (i > 0 && i < 5)) r.set(x + i, y + k, TONES.iron.b);
    }
  }
}

/** The folly of this kind, dressed for the season (snow on its ledges in winter). */
export function buildLandmark(kind: LandmarkKind, s: Season = SEASON): Raster {
  const { w, h, ox, oy } = LANDMARK_SPRITE[kind];
  const c = new Canvas(w, h);
  const seed = kind.length * 13 + kind.charCodeAt(0);
  for (const shape of LANDMARK_SHAPES[kind]) drawShape(c, shape, -ox, -oy, seed);
  details(kind, c.r, -ox, -oy);
  overgrow(c.r, LANDMARK_SHAPES[kind], -ox, -oy, seed);
  outline(c.r, TONES[LANDMARK_SHAPES[kind][0].mat].o);
  snowCap(c.r, s.snow, seed);
  return c.r;
}

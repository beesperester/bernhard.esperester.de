// The follies: weathered stone monuments, statues and tea-garden pavilions.
// Each is drawn from the shapes it is built of (world/landmarks.ts), seen
// from the front and above like the rest of the park: a block shows its top
// and its front, a column its round top and its shaded side, a roof its
// tiled slopes. Moss grows on the tops, ivy down some fronts, and broken
// things have jagged tops. A roof is drawn on its own (it hangs over a cat
// up on the folly).
import { Raster, hex, hash2, outline, type RGB } from './raster.ts';
import { dab, paintOver } from './paint.ts';
import { snowCap } from './furniture.ts';
import { SEASON, type Season } from '../world/season.ts';
import { LANDMARK_SHAPES, LANDMARK_SPRITE, LOOKOUT_LANTERNS, PAPER_LANTERNS, ROUND, type LandmarkKind, type Material, type Shape } from '../world/landmarks.ts';

/** Outline, shadow side, front, lit top, highlight. */
type Tone = { o: RGB; d: RGB; b: RGB; l: RGB; s: RGB };
const tone = (o: string, d: string, b: string, l: string, s: string): Tone => ({ o: hex(o), d: hex(d), b: hex(b), l: hex(l), s: hex(s) });

const TONES: Record<Material, Tone> = {
  stone: tone('#2e2c36', '#827e84', '#a29e9e', '#c2beb6', '#dedad0'),
  dark: tone('#1e1c1e', '#4a4448', '#5e585a', '#78706e', '#958c86'),
  bronze: tone('#1a3a30', '#3e7c66', '#5a9a80', '#7cbaa0', '#a8d8c0'),
  gold: tone('#4a3410', '#a07a2a', '#c49a3a', '#dcb850', '#f0d880'),
  paper: tone('#3a3024', '#c8bca0', '#e2d8bc', '#f0e8d0', '#faf4e2'),
  lacquer: tone('#2a0e0e', '#6a1e1a', '#922c22', '#b4402c', '#d0624a'),
  wood: tone('#24160e', '#5a3a22', '#7a5432', '#9a6e42', '#ba8e5a'),
  tile: tone('#16202a', '#384c5c', '#4e6676', '#6e8a98', '#a2bcc4'),
};
const MOSS = [hex('#4c7a34'), hex('#6a9640'), hex('#8ab050')];
/** A lantern's window. */
const LAMP = hex('#f4cc78');
const IVY = [hex('#2e5a26'), hex('#3e7430'), hex('#5a9438')];

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
  if (mat === 'stone' || mat === 'dark') return y % 4 === 3 || (x + (y % 8 < 4 ? 0 : 4)) % 8 === 0;
  // (paper screens in a wooden lattice; planks)
  if (mat === 'paper') return x % 5 === 0 || y % 5 === 0;
  if (mat === 'wood') return y % 3 === 2;
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
        if (s.mat !== 'paper' && hash2(x, y + top, seed + 961) < 0.08) col = t.b;
        c.put(x + ox, y - top + oy, y, col);
      }
      // the front face, darker towards the bottom
      for (let z = top - 1; z >= z0; z--) {
        const fy = y1 - 1 - z;
        const k = z - z0;
        let col = left ? t.l : right ? t.d : t.b;
        if (joint(s.mat, x - x0, top - 1 - z)) col = s.mat === 'paper' ? TONES.wood.b : t.d;
        if (k < 2 && dab(x, fy, seed) < 0) col = t.d;
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
        const v = u + dab(x, z, seed) * 0.25;
        let col = v < 0.25 ? t.l : v < 0.4 ? t.s : v < 0.65 ? t.l : v < 0.85 ? t.b : t.d;
        if ((s.mat === 'stone' || s.mat === 'dark') && (top - 1 - z) % 6 === 5) col = t.b;
        c.put(x + ox, cy + Math.floor(h) - z + oy, cy + h, col);
      }
    }
    return;
  }
  if ('roof' in s) {
    drawRoof(c, s, ox, oy);
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
      const lit = -nx * 0.6 - ny * 0.5 + dab(dx, dy, seed) * 0.35;
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

/**
 * A hipped roof, as a height over the ground: low at the eaves, sweeping up
 * steeper and steeper to the ridge, its corners turned up. Each ground point
 * is drawn lifted by its height, nearer ones over farther (so the near slope
 * hides the far one), the gaps a steep slope leaves filled down to the last.
 * Its tiles run in rows down every slope; its ridge and hips catch the light.
 */
function drawRoof(c: Canvas, s: Shape & { roof: [number, number, number, number]; curl: number }, ox: number, oy: number): void {
  const t = TONES[s.mat], [x0, y0, x1, y1] = s.roof, [eave, peak] = s.z;
  const reach = Math.min(x1 - x0, y1 - y0) / 2;
  const height = (x: number, y: number) => {
    const dx = Math.min(x - x0 + 0.5, x1 - 0.5 - x), dy = Math.min(y - y0 + 0.5, y1 - 0.5 - y);
    const u = Math.max(0, Math.min(1, Math.min(dx, dy) / reach));
    const turn = Math.max(0, 1 - dx / 11) * Math.max(0, 1 - dy / 11);
    return eave + (peak - eave) * u ** 1.6 + s.curl * turn * turn;
  };
  for (let x = x0; x < x1; x++) {
    let last = -Infinity;
    for (let y = y0; y < y1; y++) {
      const h = height(x, y), sy = Math.round(y - h);
      const gx = height(x + 1, y) - height(x - 1, y), gy = height(x, y + 1) - height(x, y - 1);
      const dx = Math.min(x - x0, x1 - 1 - x), dy = Math.min(y - y0, y1 - 1 - y);
      let col: RGB;
      if (Math.abs(gx) > Math.abs(gy)) col = gx > 0 ? (y % 3 === 0 ? t.b : t.l) : y % 3 === 0 ? t.o : t.d;
      else col = gy < 0 ? (x % 3 === 0 ? t.d : t.b) : t.l;
      // (the ridge, and the hips running down from it, lighter)
      if (h > peak - 1.5 || Math.abs(Math.abs(gx) - Math.abs(gy)) < 0.25 && h > eave + 3) col = t.s;
      if (Math.min(dx, dy) === 0) col = t.d;
      const from = Number.isFinite(last) && sy > last + 1 ? last + 1 : sy;
      for (let py = from; py <= sy; py++) c.put(x + ox, py + oy, y, col);
      last = sy;
    }
  }
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


/** Little touches a shape can't make: a cat's ears and face, the tip of a needle, the lanterns' light. */
function details(kind: LandmarkKind, r: Raster, ox: number, oy: number): void {
  const at = (x: number, y: number, z: number) => [x + ox, y - z + oy] as const;
  const B = TONES.bronze;
  if (kind === 'catstatue') {
    // ears on its head, two slit eyes and a nose, and its tail curled round its feet
    const [hx, hy] = at(16, 20, 30);
    for (const side of [-1, 1])
      for (let k = 0; k < 5; k++)
        for (let w = 0; w <= (4 - k) >> 1; w++) r.set(hx + side * (3 + w), hy - 5 - k, k === 0 || w === 0 ? (side < 0 ? B.l : B.b) : B.s);
    for (const ex of [-3, 2]) { r.set(hx + ex, hy, B.o); r.set(hx + ex + 1, hy, B.o); }
    r.set(hx, hy + 2, B.d);
    const [tx, ty] = at(23, 27, 13);
    for (let k = 0; k < 7; k++) r.set(tx - k, ty + Math.round(Math.sin(k * 0.5)), k % 3 ? B.b : B.l);
  }
  if (kind === 'obelisk') {
    // its pointed tip
    const [px, py] = at(12, 25, 60);
    for (let k = 0; k < 6; k++) for (let i = k; i < 8 - k; i++) r.set(px + i, py - 5 - k, i < 4 ? TONES.stone.s : TONES.stone.d);
  }
  if (kind === 'urn') {
    // its handles
    const [ux, uy] = at(16, 22, 30);
    for (const side of [-1, 1]) for (let k = -2; k <= 2; k++) r.set(ux + side * (8 + (Math.abs(k) < 2 ? 1 : 0)), uy + k, B.d);
  }
  if (kind === 'lookout') {
    // the lanterns' little windows, warm
    for (const [x, y] of LOOKOUT_LANTERNS) {
      const [wx, wy] = at(x - 1, y + 1, 15);
      r.rect(wx, wy, 3, 3, LAMP);
    }
  }
  const paper = PAPER_LANTERNS[kind];
  if (paper) {
    // a paper lantern hanging from the eaves
    const [lx, ly] = at(...paper);
    r.set(lx, ly - 2, TONES.wood.o);
    for (let k = 0; k < 4; k++) for (let i = -1; i <= 1; i++) r.set(lx + i, ly + k, k === 0 || k === 3 ? TONES.lacquer.d : i < 0 ? TONES.lacquer.s : TONES.lacquer.l);
  }
}

/** Does this kind have a roof (drawn on its own, over cats up on it)? */
export const hasRoof = (kind: LandmarkKind): boolean => LANDMARK_SHAPES[kind].some((s) => s.over);

/** The folly of this kind, dressed for the season (snow on its ledges in winter): all but its roof, or (`over`) its roof alone. */
export function buildLandmark(kind: LandmarkKind, s: Season = SEASON, over = false): Raster {
  const { w, h, ox, oy } = LANDMARK_SPRITE[kind];
  const c = new Canvas(w, h);
  const seed = kind.length * 13 + kind.charCodeAt(0);
  const shapes = LANDMARK_SHAPES[kind].filter((sh) => !!sh.over === over);
  for (const shape of shapes) drawShape(c, shape, -ox, -oy, seed);
  if (!over) {
    details(kind, c.r, -ox, -oy);
    overgrow(c.r, shapes, -ox, -oy, seed);
  }
  outline(c.r, TONES[shapes[0].mat].o);
  paintOver(c.r, seed);
  snowCap(c.r, s.snow, seed);
  return c.r;
}

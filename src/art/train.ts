// The Ring's little train: a red steam lok with a gold-banded boiler, a
// chimney and an open cab, and two open waggons (blue and yellow), all
// round and toy-like. The track curves every which way, so the cars aren't
// painted but modelled: each is a few solid shapes (boxes, cylinders,
// wheels) in its own frame, u along it (front +), v across, z up, and
// pictures of it are made by looking at the model from the garden's view
// (straight down the screen, things higher up drawn higher) at one of
// HEADINGS headings. Each picture comes in two halves: what is beyond the
// space riders sit in (its near wall, say), and everything else, so a cat
// riding in it can be drawn in between (its lower half hidden by the near
// wall), wherever in the car it sits.

import { Raster, hex, type RGB } from './raster.ts';
import { paintOver } from './paint.ts';

/** Pictures for this many headings round the circle. */
export const HEADINGS = 16;

/** The train's cars, and a funfair rollercoaster's little car (world/coaster.ts), modelled the same way. */
export type CarKind = 'lok' | 'blue' | 'yellow' | 'coaster';

/** Length of each car (px along the track); all are CAR_W wide. */
export const CAR_LEN: Record<CarKind, number> = { lok: 28, blue: 22, yellow: 22, coaster: 18 };
export const CAR_W = 12;
/** The coaster car is narrower: two cats one behind the other. */
const COASTER_W = 10;
const halfWidth = (kind: CarKind) => (kind === 'coaster' ? COASTER_W : CAR_W) / 2;
/** Thickness of the cars' walls (px). */
export const CAR_WALL = 1.5;
/** The lok's cab: from its back end this far forward. */
export const CAB_LEN = 12;

/** The pictures are this big, with the middle of the car's footprint at (OX, OY). */
const W = 40, H = 58, OX = 20, OY = 39;
/** The model's highest point (px). */
const TOP = 19;

type Mat = 'frame' | 'wheel' | 'hub' | 'floor' | 'body' | 'rim' | 'buffer' | 'boiler' | 'band' | 'smoke' | 'chimney' | 'dome' | 'lamp' | 'cab';

const BODY: Record<CarKind, RGB> = { lok: hex('#d8443c'), blue: hex('#3c7ad8'), yellow: hex('#f0b030'), coaster: hex('#e04a78') };
const COLOURS: Record<Exclude<Mat, 'body'>, RGB> = {
  frame: hex('#3a3a44'), wheel: hex('#c03028'), hub: hex('#f0c040'), floor: hex('#8a5a32'), rim: hex('#fff2d8'),
  buffer: hex('#2a2a30'), boiler: hex('#d8443c'), band: hex('#f0c040'), smoke: hex('#2e2e36'), chimney: hex('#26262c'),
  dome: hex('#f0c040'), lamp: hex('#fff6a0'), cab: hex('#b8342e'),
};
const OUTLINE = hex('#2a1418');

/** What the model of a `kind` car is made of at (u, v, z), if anything. */
function solid(kind: CarKind, u: number, v: number, z: number): Mat | null {
  if (kind === 'coaster') return coasterSolid(u, v, z);
  const hl = CAR_LEN[kind] / 2, hw = CAR_W / 2, av = Math.abs(v);
  // buffers at both ends
  if (Math.abs(u) > hl && Math.abs(u) < hl + 1.5 && av > 2 && av < 4 && z > 3.5 && z < 5.5) return 'buffer';
  if (Math.abs(u) > hl) return null;
  // the wheels, along both sides
  const wheels = kind === 'lok' ? [-hl + 4.5, 0, hl - 5.5] : [-hl + 5, hl - 5];
  const wr = kind === 'lok' ? 3.2 : 2.6;
  if (av > hw - 1.6 && av <= hw)
    for (const wu of wheels) {
      const d = (u - wu) ** 2 + (z - wr) ** 2;
      if (d <= wr * wr) return d < 1.3 ? 'hub' : 'wheel';
    }
  if (av > hw) return null;
  // the frame they hang from
  if (z >= 2 && z < 3.5 && av < hw - 1.5) return 'frame';
  if (kind !== 'lok' || u < -hl + CAB_LEN) {
    // an open box: floor, four walls with a pale rim (the lok's cab a little taller, its front wall taller still)
    const top = kind === 'lok' ? (u > -hl + CAB_LEN - 2 ? 14 : 11) : 10;
    if (z < 3.5 || z > top) return null;
    const wall = Math.abs(u) > hl - CAR_WALL || av > hw - CAR_WALL || (kind === 'lok' && u > -hl + CAB_LEN - 2);
    if (wall) return z > top - 1 ? 'rim' : kind === 'lok' ? 'cab' : 'body';
    return z < 4.5 ? 'floor' : null;
  }
  // the lok's front: running board, boiler with gold bands, black smokebox, chimney, dome, lamp
  if (z >= 3.5 && z < 4.5 && av < hw) return 'frame';
  const boiler = v * v + (z - 8.5) ** 2;
  if (boiler <= 4.6 * 4.6 && z >= 4) {
    if (u > hl - 3.5) return 'smoke';
    return Math.abs(((u + 100) % 5) - 2.5) < 0.6 ? 'band' : 'boiler';
  }
  if (Math.abs(u - hl) < 1 && av < 1.2 && z > 8 && z < 10.5) return 'lamp';
  const cu = hl - 5;
  if ((u - cu) ** 2 + v * v <= (z > TOP - 2 ? 2.6 : 1.8) ** 2 && z <= TOP && z > 12) return 'chimney';
  if ((u - 1) ** 2 + v * v + (z - 13) ** 2 <= 5.5) return 'dome';
  return null;
}

/**
 * The rollercoaster car, standing on the track's deck (z 0): little wheels under it, a floor, low
 * sides with a gold rim (so its riders show), a divider between its two seats, and a rounded nose
 * in front rising higher.
 */
function coasterSolid(u: number, v: number, z: number): Mat | null {
  const hl = CAR_LEN.coaster / 2, hw = COASTER_W / 2, av = Math.abs(v);
  if (Math.abs(u) > hl || av > hw) return null;
  // the nose: rounded off at the front, as high as a cat's chin
  const nose = u > hl - 4;
  if (nose && (u - (hl - 4)) ** 2 / 16 + (av / hw) ** 2 > 1) return null;
  const top = nose ? 9 : 6;
  if (z > top) return null;
  if (z < 1.6) {
    for (const wu of [-hl + 4, hl - 5]) if (av > hw - 2 && (u - wu) ** 2 + (z - 0.9) ** 2 <= 1.2) return 'wheel';
    return z > 0.7 && av < hw - 1 ? 'frame' : null;
  }
  const wall = nose || Math.abs(u) > hl - CAR_WALL || av > hw - CAR_WALL || (Math.abs(u) < 0.8 && z < 5);
  if (wall) return z > top - 1 ? 'band' : 'body';
  return z < 2.6 ? 'floor' : null;
}

/** Lighter or darker (k > 0 lighter). */
const tone = (c: RGB, k: number): RGB => (k >= 0 ? (c.map((x) => Math.round(x + (255 - x) * k)) as unknown as RGB) : (c.map((x) => Math.round(x * (1 + k))) as unknown as RGB));

/**
 * The car seen heading `h` (0 = to the right, then clockwise in HEADINGS steps): the half behind its
 * riders and the half in front of them, and where the middle of its footprint is in the pictures.
 */
export function buildCar(kind: CarKind, h: number): { back: Raster; front: Raster; ox: number; oy: number } {
  const a = (h / HEADINGS) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
  const local = (gx: number, gy: number): [number, number] => [gx * ca + gy * sa, -gx * sa + gy * ca];
  const at = (gx: number, gy: number, z: number) => {
    const [u, v] = local(gx, gy);
    return solid(kind, u, v, z);
  };
  // what lies further down the screen than anywhere a rider can sit is in front of it: the near
  // wall, or the boiler of a lok heading down (the cab with its rider is behind the boiler then)
  const hl = CAR_LEN[kind] / 2 - CAR_WALL, hw = halfWidth(kind) - CAR_WALL;
  const front = kind === 'lok' ? -CAR_LEN.lok / 2 + CAB_LEN - 2 : kind === 'coaster' ? CAR_LEN.coaster / 2 - 4 : hl;
  const seats = Math.max(...[-hl, front].flatMap((u) => [-hw, hw].map((v) => u * sa + v * ca)));
  const colour = new Array<RGB | null>(W * H).fill(null);
  const near = new Array<boolean>(W * H).fill(false);
  for (let py = 0; py < H; py++)
    for (let px = 0; px < W; px++) {
      const sx = px - OX + 0.5, sy = py - OY + 0.5;
      // down the line of sight: from high up near the viewer, to the ground further back
      for (let z = TOP + 0.25; z >= 0; z -= 0.5) {
        const gx = sx, gy = sy + z;
        const m = at(gx, gy, z);
        if (!m) continue;
        const base = m === 'body' ? BODY[kind] : COLOURS[m];
        // lit from above and the left: tops brightest, faces turned right darkest
        const k = !at(gx, gy, z + 0.6) ? 0.22 : !at(gx + 0.7, gy, z) ? -0.28 : !at(gx - 0.7, gy, z) ? 0.08 : 0;
        colour[py * W + px] = m === 'lamp' || m === 'hub' ? base : tone(base, k);
        near[py * W + px] = gy > seats + 0.25;
        break;
      }
    }
  // a dark outline round the whole car, given to the half next to it
  const outlined = colour.slice();
  for (let py = 0; py < H; py++)
    for (let px = 0; px < W; px++) {
      if (colour[py * W + px]) continue;
      const by = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => [px + dx, py + dy]).find(([x, y]) => x >= 0 && y >= 0 && x < W && y < H && colour[y * W + x]);
      if (!by) continue;
      outlined[py * W + px] = OUTLINE;
      near[py * W + px] = near[by[1] * W + by[0]];
    }
  const behind = new Raster(W, H), before = new Raster(W, H);
  for (let i = 0; i < W * H; i++) {
    const c = outlined[i];
    if (c) (near[i] ? before : behind).set(i % W, Math.floor(i / W), c);
  }
  // (painted over like everything else; the same dabs on both halves)
  paintOver(behind, 70 + h, 0.8);
  paintOver(before, 70 + h, 0.8);
  return { back: behind, front: before, ox: OX, oy: OY };
}

/** The old-school engine driver's cap: hickory stripes, a stiff peak to the front (facing right). 10×6. */
export function buildDriverCap(): Raster {
  const r = new Raster(10, 6);
  const BLUE = hex('#2e4a8a'), WHITE = hex('#e8eef8'), DARK = hex('#1a2a4e');
  for (let y = 1; y < 5; y++)
    for (let x = 1; x < 8; x++) {
      if (y === 1 && (x < 2 || x > 6)) continue;
      r.set(x, y, x % 2 ? BLUE : WHITE);
    }
  // the band, and the peak sticking out at the front
  r.rect(1, 4, 7, 1, DARK);
  r.rect(7, 4, 3, 1, DARK);
  r.set(4, 0, BLUE);
  for (let y = 0; y < 6; y++)
    for (let x = 0; x < 10; x++)
      if (!r.isSet(x, y) && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => r.isSet(x + dx, y + dy) && !(r.data[((y + dy) * 10 + x + dx) * 4 + 3] === 254))) r.set(x, y, hex('#10182e'), 254);
  return r;
}

/** A 4×4 ordered dither (as art/tiles.ts has; kept here so the train's art doesn't need the map). */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const bayer = (x: number, y: number) => BAYER[(y & 3) * 4 + (x & 3)];

/** How far ahead of the lok's middle its headlamp is (px along it). */
export const NOSE = CAR_LEN.lok / 2 + 1;

/**
 * The headlamp's beam on the ground ahead of a lok heading `h`: a soft wedge widening away from the
 * lamp, fading out with distance, with the lok's own picture cut out of it (the beam lies on the
 * ground, so a lok heading up the screen stands in front of it). The lok's middle is at (ox, oy), on
 * the same pixels as its own pictures.
 */
export function buildBeam(h: number): { r: Raster; ox: number; oy: number } {
  const L = 64, Wd = 30, R = L + 2, r = new Raster(2 * R, 2 * R);
  const a = (h / HEADINGS) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
  const lok = buildCar('lok', h);
  const warm = hex('#fff0b0');
  for (let py = 0; py < 2 * R; py++)
    for (let px = 0; px < 2 * R; px++) {
      // (from the lamp: along the beam, and across it)
      const dx = px + 0.5 - R, dy = py + 0.5 - R;
      const along = dx * ca + dy * sa, across = -dx * sa + dy * ca;
      const u = along / L, half = 2 + u * (Wd / 2 - 2), v = Math.abs(across) / half;
      if (u <= 0 || u >= 1 || v >= 1) continue;
      const cx = px + lok.ox + Math.floor(NOSE * ca + 0.5) - R, cy = py + lok.oy + Math.floor(NOSE * sa + 0.5) - R;
      if (lok.back.isSet(cx, cy) || lok.front.isSet(cx, cy)) continue;
      // brightest near the lamp and along the middle, in a few bands like the lanterns' pools,
      // dying away to nothing well before its far end
      const k = (1 - u) ** 2 * (1 - v * v) * 5;
      // (the faintest band thins out into a dither, so the light dissolves rather than stops)
      const al = k >= 1 ? Math.round(k) / 5 : bayer(px, py) < k ? 0.2 : 0;
      if (al > 0) r.set(px, py, warm, Math.round(al * 200));
    }
  return { r, ox: R - Math.floor(NOSE * ca + 0.5), oy: R - Math.floor(NOSE * sa + 0.5) };
}

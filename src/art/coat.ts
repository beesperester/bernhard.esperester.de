// Coats as maps. A coat is one small picture: the cat standing side on,
// facing left, in its colours (COAT_W x COAT_H). Every frame of the cat, in
// every size and facing, is drawn not in colours but in where on that
// picture each of its pixels comes from (and which way the fur faces
// there), and the GPU looks the colour up and shades it (game/Painted.ts).
// So a coat is just its picture: any picture that size is a coat.
//
// Which pixel of the coat a frame's pixel comes from: the frame and the
// side-on cat are laid over each other, their bounding boxes matched, and
// it is the nearest of the side-on cat's pixels of the same kind of fur
// (outline, fur, shade, markings, white).
import { Raster, hex, type RGB } from './raster.ts';
import { CAT, COATS, EYES, FRAME_NAMES, FUR, MOUTH, PINK, SIZED, framePos, frameIndex, stageRow, type Coat } from './cat.ts';
import { COAT as COAT_FLAG, N_RANGE, PLAIN, toByte } from './painted.ts';

export const COAT_W = CAT, COAT_H = CAT;

/** The side-on cat every coat is a picture of (letters as in cat.ts). */
const MODEL = SIZED[0]('sideStand');

/** Coat `c` as its picture (one of COATS, in their colours). */
export function buildCoatMap(c: Coat | number): Raster {
  const coat = typeof c === 'number' ? COATS[((c % COATS.length) + COATS.length) % COATS.length] : c;
  const r = new Raster(COAT_W, COAT_H);
  r.paint(MODEL, 0, 0, { ...Object.fromEntries(FUR.map((ch) => [ch, hex(coat[ch])])), e: EYES, p: PINK, r: MOUTH });
  return r;
}

/** The fur pixels of letter rows, by letter: [x, y] each. */
function furOf(rows: readonly string[]): Map<string, [number, number][]> {
  const out = new Map<string, [number, number][]>();
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (!(FUR as readonly string[]).includes(ch)) return;
    if (!out.has(ch)) out.set(ch, []);
    out.get(ch)!.push([x, y]);
  }));
  return out;
}

function box(rows: readonly string[]): [number, number, number, number] {
  let x0 = 99, y0 = 99, x1 = -1, y1 = -1;
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === '.') return;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }));
  return [x0, y0, x1, y1];
}

const MODEL_FUR = furOf(MODEL), MODEL_BOX = box(MODEL);
const ALL_FUR = [...MODEL_FUR.values()].flat();

/** Where on the coat pixel (x, y) (letter `ch`) of a frame whose cat fills box `b` comes from. */
function coatPixel(b: [number, number, number, number], x: number, y: number, ch: string): [number, number] {
  const [x0, y0, x1, y1] = b, [mx0, my0, mx1, my1] = MODEL_BOX;
  const fx = mx0 + ((x - x0 + 0.5) / (x1 - x0 + 1)) * (mx1 - mx0 + 1) - 0.5;
  const fy = my0 + ((y - y0 + 0.5) / (y1 - y0 + 1)) * (my1 - my0 + 1) - 0.5;
  let best: [number, number] = [0, 0], bd = Infinity;
  for (const [px, py] of MODEL_FUR.get(ch) ?? ALL_FUR) {
    const d = (px - fx) ** 2 + (py - fy) ** 2;
    if (d < bd) { bd = d; best = [px, py]; }
  }
  return best;
}

/** Which way the fur faces at (x, y) of frame `rows`: away from the inside of its outline, more so near the edge. */
function furNormal(rows: readonly string[], x: number, y: number): [number, number] {
  const R = 3, solid = (px: number, py: number) => (rows[py]?.[px] ?? '.') !== '.';
  let ax = 0, ay = 0;
  for (let dy = -R; dy <= R; dy++)
    for (let dx = -R; dx <= R; dx++) {
      const d2 = dx * dx + dy * dy;
      if (!d2 || d2 > R * R || solid(x + dx, y + dy)) continue;
      ax += dx / d2;
      ay += dy / d2;
    }
  const len = Math.hypot(ax, ay);
  if (len < 1e-6) return [0, 0];
  const k = Math.min(1, len / 1.5);
  return [(ax / len) * k, (ay / len) * k];
}

/**
 * The cat's sheet as the GPU draws it (art/painted.ts): every frame of every size and facing, its fur
 * holding where on the coat it comes from (red, green) and its letter (blue), its eyes, nose and mouth
 * in their colours; and its normal map. Room is left under it for a coat (COAT_H rows): withCoat().
 */
export function buildCatMaps(): { w: number; h: number; main: Uint8ClampedArray; normal: Uint8Array } {
  const n = FRAME_NAMES.length, w = CAT * n * 2, h = CAT * SIZED.length;
  const H = h + COAT_H, main = new Uint8ClampedArray(w * H * 4), normal = new Uint8Array(w * H * 4);
  const fixed: Record<string, RGB> = { e: EYES, p: PINK, r: MOUTH };
  SIZED.forEach((sized, size) =>
    FRAME_NAMES.forEach((name) => {
      const rows = sized(name), b = box(rows);
      for (const flip of [false, true]) {
        const [ox, oy] = framePos(stageRow(2 - size) + frameIndex(name, flip));
        rows.forEach((row, y) => [...row].forEach((ch, x) => {
          if (ch === '.') return;
          const o = ((oy + y) * w + ox + (flip ? CAT - 1 - x : x)) * 4;
          main[o + 3] = 255;
          if (fixed[ch]) {
            main.set(fixed[ch], o);
            normal[o + 3] = PLAIN;
            return;
          }
          const [u, v] = coatPixel(b, x, y, ch), [nx, ny] = furNormal(rows, x, y);
          main[o] = u;
          main[o + 1] = v;
          main[o + 2] = FUR.indexOf(ch as (typeof FUR)[number]);
          normal[o] = toByte(flip ? -nx : nx, N_RANGE);
          normal[o + 1] = toByte(ny, N_RANGE);
          normal[o + 3] = COAT_FLAG;
        }));
      }
    }),
  );
  return { w, h: H, main, normal };
}

/** A copy of the cat's main picture (buildCatMaps) with coat `coat` in the room under it. */
export function withCoat(maps: { w: number; h: number; main: Uint8ClampedArray }, coat: Raster): Uint8ClampedArray {
  const out = new Uint8ClampedArray(maps.main), top = maps.h - COAT_H;
  for (let y = 0; y < COAT_H; y++) out.set(coat.data.subarray(y * COAT_W * 4, (y + 1) * COAT_W * 4), ((top + y) * maps.w) * 4);
  return out;
}

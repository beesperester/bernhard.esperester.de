// The forest floor's plants, drawn like the meadow's (art/flora.ts: each in
// 5 lean frames, so the wind and passing cats bend them): ferns and taller
// bracken, low leafy shrubs and brambles. They stand about a cat's height or
// more, so a cat among them is half or wholly hidden by those in front.
// Painted in dabs of close tones (paint.ts); the ferns and bracken go rusty
// in autumn and brown in winter, the shrubs turn a little and thin out.
import { Raster, hash2, mix, type RGB } from './raster.ts';
import { dab, ramp, tone } from './paint.ts';
import { puff } from './leaves.ts';
import { SEASON } from '../world/season.ts';
import type { FloraKind } from './flora.ts';

const FERN = ramp(6, '#173a36', '#2a5a3c', '#467e3e', '#76a448', '#b4c460');
const BRACKEN = ramp(6, '#2a4030', '#3e6a36', '#6a9440', '#9cb84c', '#d0cc6a');
const RUST = ramp(6, '#3a2422', '#6a3424', '#9a5228', '#c4782e', '#e0a448');
const SHRUB = ramp(7, '#152c2e', '#21443a', '#336040', '#4c7c44', '#6e9a4a', '#9cb85a', '#c8cc72');
const SHRUB_TURNED = ramp(7, '#2a1e26', '#4a2a28', '#6e3a2a', '#9a5a2e', '#c07e34', '#dca048', '#ecc66c');
const CANE = ramp(4, '#2a1624', '#4a2232', '#6e3440', '#94504c');
const BRAMBLE_LEAF = ramp(5, '#1a3230', '#2c4c38', '#466c3e', '#6c8c46', '#98aa58');
const BERRY: RGB[] = [[34, 18, 40], [70, 34, 66], [150, 40, 60]];

/** How far the fronds have gone rusty (autumn), and died back to brown (winter). */
const rusty = () => Math.min(1, SEASON.turn * 0.9 + (1 - SEASON.leaves) * 0.6);

/** Set a pixel of frame `ox` (`w` wide) of a sheet, clipped to the frame. */
function put(r: Raster, ox: number, w: number, x: number, y: number, c: RGB): void {
  if (x < ox || x >= ox + w) return;
  r.set(x, y, c);
}

/** A frond: arching from the foot to its tip (tx across, ty up from the foot), bowed up through a control point `bow` high. */
interface Frond { tx: number; ty: number; bow: number }

/** A point on a quadratic curve from a through c to b. */
const bez = (a: number, c: number, b: number, t: number) => (1 - t) * (1 - t) * a + 2 * (1 - t) * t * c + t * t * b;

/** Draw one frond (its rachis from (x0, y0) through (cx, cy) to (x1, y1)) with leaflets either side, longest at its base. */
function frond(r: Raster, ox: number, w: number, h: number, lean: number, pts: [number, number, number, number, number, number], leaf: number, every: number, col: (v: number, x: number, y: number) => RGB): void {
  const [x0, y0, cx, cy, x1, y1] = pts, steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 1.4) + 2;
  // (the wind bends it more the higher it is)
  const sway = (y: number) => lean * 1.3 * ((h - 1 - y) / h) ** 2;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps, x = bez(x0, cx, x1, t), y = bez(y0, cy, y1, t);
    const dx = 2 * (1 - t) * (cx - x0) + 2 * t * (x1 - cx), dy = 2 * (1 - t) * (cy - y0) + 2 * t * (y1 - cy), L = Math.hypot(dx, dy) || 1;
    // (across the frond: its upper side lit)
    const nx = -dy / L, ny = dx / L;
    const X = Math.round(x + sway(y)), Y = Math.round(y);
    put(r, ox, w, X, Y, col(0.25 + t * 0.2, X, Y));
    if (s % every || t < 0.06) continue;
    const n = Math.max(1, Math.round(leaf * (1 - t) + 0.8));
    for (const side of [1, -1])
      for (let j = 1; j <= n; j++) {
        // (leaflets sweep a little towards the tip, and hang a little)
        const lx = x + nx * j * side + (dx / L) * j * 0.35, ly = y + ny * j * side + (dy / L) * j * 0.35 + j * j * 0.06;
        const LX = Math.round(lx + sway(ly)), LY = Math.round(ly);
        const up = ny * side < 0;
        put(r, ox, w, LX, LY, col((up ? 0.62 : 0.4) + (1 - j / (n + 1)) * 0.2 + t * 0.15, LX, LY));
      }
  }
}

/** A fern: a rosette of fronds arching up and out from its foot, the outer ones bowed lowest. */
function fern(key: string, w: number, h: number, fronds: Frond[], greens: readonly RGB[]): FloraKind {
  return {
    key, w, h,
    draw: (r, ox, lean) => {
      const rust = rusty(), cx = ox + Math.floor(w / 2), seed = key.length * 97, foot = h - 1;
      const col = (v: number, x: number, y: number) => mix(tone(greens, v + dab(x, y, seed) * 0.35), tone(RUST, v + dab(x, y, seed) * 0.35), rust);
      // the outer fronds first, the upright ones over them
      for (const f of [...fronds].sort((a, b) => Math.abs(b.tx) - Math.abs(a.tx)))
        frond(r, ox, w, h, lean, [cx, foot, cx + f.tx * 0.45, foot - f.bow, cx + f.tx, foot - f.ty], 2.4, 3, col);
    },
  };
}

/** Bracken: a low clump of short stems, each holding a broad frond out and down to one side, its leaflets hanging: wide at the foot. */
function bracken(key: string, w: number, h: number): FloraKind {
  // each stem: where it stands (from the middle), how high, and which way its frond reaches
  const stems: [number, number, number][] = [[-3, 4, -1], [3, 5, 1], [-1, 8, -1], [1, 9, 1], [0, 6, 1]];
  return {
    key, w, h,
    draw: (r, ox, lean) => {
      const rust = Math.min(1, rusty() * 1.2), mid = ox + Math.floor(w / 2), seed = 5303, foot = h - 1;
      const col = (v: number, x: number, y: number) => mix(tone(BRACKEN, v + dab(x, y, seed) * 0.35), tone(RUST, v + dab(x, y, seed) * 0.35), rust);
      for (const [dx, tall, side] of stems) {
        const sx = mid + dx, top = foot - tall;
        for (let y = foot; y > top; y--) {
          const X = Math.round(sx + lean * 1.3 * ((foot - y) / h) ** 2);
          put(r, ox, w, X, y, col(0.18, X, y));
        }
        frond(r, ox, w, h, lean, [sx, top, sx + side * 4, top - 2, sx + side * 10, top + 4], 3.4, 2, col);
      }
    },
  };
}

/** A low shrub: a few puffs of leaves heaped up (lit from the top left), its top swaying a pixel in the wind. */
function shrub(key: string, w: number, h: number, puffs: [number, number, number][], berries: boolean): FloraKind {
  return {
    key, w, h,
    draw: (r, ox, lean) => {
      const turned = SEASON.turn * 0.7, thin = (1 - SEASON.leaves) * 0.55, seed = key.length * 131;
      // back to front, so the near puffs' round undersides show against those behind
      for (const [k, [px, py, pr]] of [...puffs.entries()].sort((a, b) => a[1][1] - b[1][1])) {
        const p = puff(pr, k + key.length), R = (p.w - 1) / 2;
        for (let j = 0; j < p.w; j++)
          for (let i = 0; i < p.w; i++) {
            const n = j * p.w + i;
            if (!p.on[n]) continue;
            const y = Math.round(py - R + j);
            // (the higher, the more it sways)
            const x = Math.round(px - R + i + lean * 0.5 * Math.max(0, 1 - y / h));
            if (y < 0 || y >= h) continue;
            if (thin > 0 && hash2(x, y, seed + 5) < thin * (1 - y / h + 0.3)) continue;
            const lit = 0.55 - p.nx[n] * 0.3 - p.ny[n] * 0.4 + p.jit[n] + (p.rim[n] ? -0.25 : 0) + (p.seam[n] ? -0.3 : 0) - (y / h) * 0.2;
            const c = mix(tone(SHRUB, lit), tone(SHRUB_TURNED, lit), turned);
            put(r, ox, w, ox + x, y, c);
          }
      }
      if (!berries) return;
      // a few berries in late summer and autumn, red at first, then dark
      const ripe = SEASON.day > 200 && SEASON.day < 300 ? (SEASON.day > 235 ? 1 : 2) : -1;
      if (ripe < 0) return;
      for (let k = 0; k < 7; k++) {
        const x = 3 + Math.floor(hash2(k, 1, seed) * (w - 6)), y = 3 + Math.floor(hash2(k, 2, seed) * (h - 8));
        if (!r.isSet(ox + x, y)) continue;
        put(r, ox, w, ox + x, y, BERRY[ripe]);
      }
    },
  };
}

/** A bramble: thorny canes arching out and down from its foot, leaves in threes along them, blackberries in late summer. */
const bramble: FloraKind = {
  key: 'bramble', w: 27, h: 16,
  draw: (r, ox, lean) => {
    const w = 27, h = 16, cx = ox + 13, seed = 7121;
    const canes: [number, number, number][] = [[-1, 12, 15], [1, 11, 14], [-1, 8, 11], [1, 9, 12], [0.2, 4, 15], [-0.3, 5, 14]];
    const thin = (1 - SEASON.leaves) * 0.6;
    const ripe = SEASON.day > 205 && SEASON.day < 290 ? (SEASON.day > 230 ? 0 : 2) : -1;
    for (const [k, [dir, reach, top]] of canes.entries()) {
      const steps = Math.ceil(reach * 2 + top);
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        // an arch: up and out, then down towards the ground at its far end
        const x = cx + dir * reach * t + lean * 0.8 * Math.sin(t * Math.PI);
        const y = h - 1 - Math.sin(t * Math.PI * 0.85) * top * (1 - t * 0.25);
        const X = Math.round(x), Y = Math.round(y);
        put(r, ox, w, X, Y, tone(CANE, 0.3 + (1 - t) * 0.3 + dab(X, Y, seed) * 0.4));
        // (thorns: a lighter pixel sticking out now and then)
        if (s % 4 === 2) put(r, ox, w, X, Y - 1, CANE[3]);
        // leaves in threes along it
        if (s % 5 === 3 && hash2(k, s, seed) > thin) {
          for (const [lx, ly] of [[0, -1], [-1, -1], [1, -1], [0, -2], [-1, 0], [1, 0], [-2, -1], [2, -1]]) {
            const v = 0.45 + (ly < -1 ? 0.3 : 0) + dab(X + lx, Y + ly, seed + 2) * 0.5;
            put(r, ox, w, X + lx, Y + ly, mix(tone(BRAMBLE_LEAF, v), tone(RUST, v), SEASON.turn * 0.5));
          }
        }
        if (ripe >= 0 && s % 7 === 5 && hash2(k, s, seed + 3) < 0.7) {
          put(r, ox, w, X, Y + 1, BERRY[ripe]);
          put(r, ox, w, X + 1, Y + 1, BERRY[ripe === 0 ? 1 : 2]);
        }
      }
    }
  },
};

export const UNDERGROWTH: FloraKind[] = [
  fern('fern', 23, 14, [
    { tx: -10, ty: 1, bow: 5 }, { tx: 10, ty: 2, bow: 5 }, { tx: -8, ty: 5, bow: 8 },
    { tx: 8, ty: 5, bow: 9 }, { tx: -4, ty: 9, bow: 11 }, { tx: 4, ty: 10, bow: 11 }, { tx: 0, ty: 12, bow: 12 },
  ], FERN),
  bracken('bracken', 25, 15),
  shrub('shrub', 30, 22, [[8, 15, 7], [21, 15, 7], [15, 11, 8], [10, 8, 5], [20, 8, 5], [15, 17, 6]], false),
  shrub('shrub-berries', 26, 19, [[8, 12, 6], [18, 12, 6], [13, 9, 7], [13, 14, 6]], true),
  bramble,
];

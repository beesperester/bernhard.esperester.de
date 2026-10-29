// What lies about on the forest floor: fallen logs and old stumps, mossy,
// to jump onto and hide behind, and the old standing stone in the middle of
// some clearings (a boulder at its foot to climb it by). Drawn in the
// painted style (paint.ts ramps and dabs), lit from the top left, each with
// a dark outline of itself; the furniture's season dressing puts snow on
// them in winter.
import { Raster, hash2, type RGB } from './raster.ts';
import { dab, ramp, tone } from './paint.ts';

const BARK = ramp(6, '#20161c', '#3a2622', '#58382a', '#7a5034', '#9a6a40', '#b8885a');
const HEART = ramp(5, '#5a3824', '#8a5e3a', '#b08454', '#ccA46c', '#e4c48a');
const MOSS = ramp(5, '#1e3426', '#30502c', '#4c7232', '#72963c', '#a0b84e');
const STONE = ramp(7, '#1e1e2a', '#34343e', '#4c4a52', '#66626a', '#827c82', '#a09a9c', '#c2bcb8');
const LICHEN: RGB[] = [[150, 160, 96], [196, 184, 110], [210, 150, 80]];

/** A dark outline round everything drawn so far: the darkest tone of `r`. */
function outline(r: Raster, c: RGB): void {
  const edge: [number, number][] = [];
  for (let y = 0; y < r.h; y++)
    for (let x = 0; x < r.w; x++)
      if (!r.isSet(x, y) && (r.isSet(x - 1, y) || r.isSet(x + 1, y) || r.isSet(x, y - 1) || r.isSet(x, y + 1))) edge.push([x, y]);
  for (const [x, y] of edge) r.set(x, y, c);
}

/** Moss over the top of whatever is drawn at (x, y), in soft patches: true if it put some. */
function mossy(r: Raster, x: number, y: number, v: number, seed: number, amount: number): boolean {
  const m = hash2(x >> 2, y >> 1, seed) * 0.6 + hash2(x, y, seed + 1) * 0.4;
  if (m > amount) return false;
  r.set(x, y, tone(MOSS, v + dab(x, y, seed + 2) * 0.5));
  return true;
}

/** A fallen log lying across: 48×16, its cut end towards us on the right, moss along its top. */
export function buildLog(): Raster {
  const r = new Raster(48, 16), seed = 811;
  const x0 = 2, x1 = 40, cy = 9, rad = 5;
  // the trunk: a cylinder seen from the side, lit along its top, bark grain running along it
  for (let x = x0; x <= x1; x++) {
    const sag = Math.round(Math.sin((x - x0) / (x1 - x0) * Math.PI) * 0.6);
    for (let dy = -rad; dy <= rad; dy++) {
      const y = cy + dy + sag, u = dy / rad;
      const lit = 0.62 - u * 0.45 - u * u * 0.2;
      const grain = (hash2(x >> 2, dy + 9, seed) - 0.5) * 0.3 + ((dy + 20) % 3 === 0 ? -0.18 : 0);
      if (u < -0.35 && mossy(r, x, y, lit, seed, 0.38 + Math.sin(x * 0.21) * 0.15)) continue;
      r.set(x, y, tone(BARK, lit + grain + dab(x, y, seed) * 0.35));
    }
  }
  // a broken-off branch stub on top
  for (let j = 0; j < 4; j++) { r.set(14 + j, cy - rad - 1 - (j >> 1), tone(BARK, 0.5 + j * 0.08)); r.set(14 + j, cy - rad - (j >> 1), tone(BARK, 0.3)); }
  // the cut end: rings round its heart
  for (let dy = -rad; dy <= rad; dy++)
    for (let dx = -3; dx <= 3; dx++) {
      const e = Math.hypot(dx / 3.2, dy / (rad + 0.4));
      if (e > 1) continue;
      const x = x1 + 2 + dx, y = cy + dy;
      const ring = Math.floor(e * 4);
      r.set(x, y, e > 0.82 ? tone(BARK, 0.35) : tone(HEART, 0.85 - ring * 0.18 + (dx < 0 ? -0.15 : 0.05) + dab(x, y, seed + 5) * 0.2));
    }
  outline(r, BARK[0]);
  return r;
}

/** An old stump: 18×18, a squat cylinder with its cut top showing rings, roots spreading at its foot, mossy. */
export function buildStump(): Raster {
  const r = new Raster(18, 18), seed = 823;
  const cx = 9, top = 6, foot = 15, rad = 5;
  // roots running out into the ground either side
  for (const [dir, len] of [[-1, 5], [1, 6], [-1, 3]] as const)
    for (let k = 0; k <= len; k++) r.set(cx + dir * (rad - 1 + k), foot - 1 + (k > len / 2 ? 1 : 0) - (len === 3 ? 0 : 0), tone(BARK, 0.35 + (dir < 0 ? 0.2 : 0)));
  // the side: lit on the left, bark ridges running up it
  for (let y = top; y <= foot; y++)
    for (let dx = -rad; dx <= rad; dx++) {
      const x = cx + dx, u = dx / rad, flare = y > foot - 2 ? 1 : 0;
      if (Math.abs(dx) > rad - 1 + flare && Math.abs(dx) > rad) continue;
      const lit = 0.6 - u * 0.4 - u * u * 0.25;
      if (y > foot - 3 && mossy(r, x, y, lit - 0.1, seed, 0.3)) continue;
      r.set(x, y, tone(BARK, lit + (x % 2 === 0 ? -0.12 : 0) + dab(x, y, seed) * 0.35));
    }
  // the cut top: rings round its heart, its far rim in shadow
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -rad; dx <= rad; dx++) {
      const e = Math.hypot(dx / (rad + 0.3), dy / 2.4);
      if (e > 1) continue;
      const x = cx + dx, y = top + dy;
      if (dy < 0 && e > 0.6 && mossy(r, x, y, 0.55, seed + 9, 0.45)) continue;
      r.set(x, y, e > 0.8 ? tone(BARK, 0.45) : tone(HEART, 0.9 - Math.floor(e * 4) * 0.17 + dab(x, y, seed + 3) * 0.25));
    }
  outline(r, BARK[0]);
  return r;
}

/** The standing stone: 26×40, tall, weathered and leaning a little, lichen and moss on it. */
export function buildStone(): Raster {
  const r = new Raster(26, 40), seed = 839;
  const foot = 38, top = 3;
  for (let y = top; y <= foot; y++) {
    const t = (y - top) / (foot - top);
    // (tapering to a rounded top, leaning to the right, its edges a little ragged)
    const half = 5 + t * 5 - (t < 0.12 ? (0.12 - t) * 30 : 0) + (hash2(y, 1, seed) - 0.5) * 1.2;
    const mid = 13 + (1 - t) * 2;
    for (let x = Math.round(mid - half); x <= Math.round(mid + half); x++) {
      const u = (x - mid) / half;
      // its broad front face lit from the left, a darker side on the right
      const lit = u < 0.55 ? 0.62 - u * 0.25 - t * 0.12 : 0.3 - (u - 0.55) * 0.5;
      const v = lit + dab(x, y, seed) * 0.4 + (hash2(x >> 1, y >> 2, seed + 1) - 0.5) * 0.15;
      if ((y > foot - 6 || (u < -0.5 && t > 0.4)) && mossy(r, x, y, v - 0.05, seed + 2, 0.32 + (y - foot + 6) * 0.06)) continue;
      r.set(x, y, tone(STONE, v));
      // lichen, in small round blotches
      const l = hash2(x >> 1, y >> 1, seed + 3);
      if (l < 0.07 && u < 0.6) r.set(x, y, LICHEN[Math.floor(hash2(x, y, seed + 4) * LICHEN.length)]);
    }
  }
  // a crack down its face
  let cx = 12;
  for (let y = top + 8; y < top + 20; y++) {
    cx += hash2(y, 2, seed) < 0.3 ? 1 : hash2(y, 2, seed) > 0.8 ? -1 : 0;
    r.set(cx, y, STONE[1]);
  }
  outline(r, STONE[0]);
  return r;
}

/** The boulder at the standing stone's foot (a step up onto it): 16×11, round and mossy on top. */
export function buildBoulder(): Raster {
  const r = new Raster(16, 11), seed = 853;
  for (let y = 1; y < 11; y++)
    for (let x = 1; x < 15; x++) {
      const nx = (x - 7.5) / 7, ny = (y - 6.5) / 5.2;
      if (nx * nx + ny * ny > 1) continue;
      const lit = 0.58 - nx * 0.3 - ny * 0.35;
      if (ny < -0.3 && mossy(r, x, y, lit, seed, 0.45)) continue;
      r.set(x, y, tone(STONE, lit + dab(x, y, seed) * 0.4));
    }
  outline(r, STONE[0]);
  return r;
}

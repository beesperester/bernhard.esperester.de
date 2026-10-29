// Swaying plants: each kind is drawn in 5 lean frames (-2..2) so the wind
// (and passing cats) can bend them.
import { Raster, hex, hash2, type RGB } from './raster.ts';
import { TILE, MAP_W, MAP_H, biomeAt, tileAt, furnished, inClearing, nearClearing } from '../world/map.ts';
import { noise } from './paint.ts';
import { UNDERGROWTH } from './undergrowth.ts';
import { SEASON } from '../world/season.ts';
import { drabFor } from './tiles.ts';
import { groundOf, isPond } from '../world/legend.ts';
import { trackside } from '../world/track.ts';

export const LEANS = 5;

/** Blades: a deep teal root, olive along them, a warm lit tip (the tall grass in tiles.ts, standing up). */
const G = { d: hex('#28483a'), m: hex('#46724a'), l: hex('#76a056'), t: hex('#b4ba68') };
const CATTAIL = { h0: hex('#6a3c20'), h1: hex('#9a6034'), s: hex('#5a8a34') };
const PETALS: RGB[] = [hex('#f04858'), hex('#f8d838'), hex('#f8f8f8'), hex('#c078f0'), hex('#58a0f8'), hex('#f890c8')];

interface Blade { x: number; h: number; tilt: number }

export interface FloraKind { key: string; w: number; h: number; draw: (r: Raster, ox: number, lean: number) => void }

/** Draw one blade from its base, bending more towards the tip. Returns the tip position. */
function blade(r: Raster, ox: number, H: number, b: Blade, lean: number, wide = false): [number, number] {
  let tip: [number, number] = [0, 0];
  for (let j = 0; j <= b.h; j++) {
    const t = j / b.h;
    const x = Math.round(ox + b.x + b.tilt * t + lean * (b.h / 6) * t * t);
    const y = H - 1 - j;
    const c = t < 0.3 ? G.d : t < 0.65 ? G.m : t < 0.9 ? G.l : G.t;
    r.set(x, y, c);
    if (wide && t < 0.4) r.set(x + 1, y, G.d);
    tip = [x, y];
  }
  return tip;
}

function blades(key: string, w: number, h: number, set: Blade[], wide = false): FloraKind {
  return { key, w, h, draw: (r, ox, lean) => set.forEach((b) => blade(r, ox, h, b, lean, wide)) };
}

const tuft = blades('tuft', 11, 10, [
  { x: 3, h: 5, tilt: -2 }, { x: 4, h: 8, tilt: -1 }, { x: 5, h: 9, tilt: 0 }, { x: 6, h: 7, tilt: 1 }, { x: 7, h: 5, tilt: 2 },
]);

// (a dense clump of short, nearly upright blades)
const tall = blades('tall', 15, 12, [
  { x: 3, h: 6, tilt: -2 }, { x: 4, h: 9, tilt: -1 }, { x: 5, h: 7, tilt: -1 }, { x: 6, h: 10, tilt: 0 }, { x: 7, h: 8, tilt: 0 },
  { x: 8, h: 11, tilt: 1 }, { x: 9, h: 7, tilt: 1 }, { x: 10, h: 9, tilt: 1 }, { x: 11, h: 6, tilt: 2 }, { x: 6, h: 5, tilt: -1 },
], true);

function flower(i: number): FloraKind {
  const petal = PETALS[i];
  const centre = petal === PETALS[1] ? hex('#e88a20') : hex('#f8d038');
  return {
    key: `flower${i}`, w: 11, h: 14,
    draw: (r, ox, lean) => {
      blade(r, ox, 14, { x: 3, h: 4, tilt: -2 }, lean);
      blade(r, ox, 14, { x: 7, h: 4, tilt: 2 }, lean);
      const [x, y] = blade(r, ox, 14, { x: 5, h: 10, tilt: 0 }, lean);
      r.set(x - 1, y, petal); r.set(x + 1, y, petal); r.set(x, y - 1, petal); r.set(x, y + 1, petal);
      r.set(x, y, centre);
    },
  };
}

const cattail: FloraKind = {
  key: 'cattail', w: 13, h: 20,
  draw: (r, ox, lean) => {
    blade(r, ox, 20, { x: 2, h: 9, tilt: -3 }, lean);
    blade(r, ox, 20, { x: 10, h: 10, tilt: 2 }, lean);
    for (const [bx, bh] of [[5, 17], [7, 14]]) {
      for (let j = 0; j <= bh; j++) {
        const t = j / bh;
        const x = Math.round(ox + bx + lean * (bh / 7) * t * t);
        const y = 19 - j;
        if (t > 0.62 && t < 0.92) { r.set(x, y, CATTAIL.h0); r.set(x + 1, y, CATTAIL.h1); }
        else r.set(x, y, t > 0.92 ? CATTAIL.h1 : CATTAIL.s);
      }
    }
    blade(r, ox, 20, { x: 6, h: 7, tilt: -1 }, lean);
  },
};

export const FLORA: FloraKind[] = [tuft, tall, cattail, ...PETALS.map((_, i) => flower(i)), ...UNDERGROWTH];

/** The kinds of plant (FLORA's order): the wildflowers... */
export const FLOWER_0 = 3, FLOWER_1 = FLOWER_0 + PETALS.length;
/** ...and the forest floor's: ferns, bracken, two shrubs, a bramble. */
export const FERN = FLOWER_1, BRACKEN = FERN + 1, SHRUB = FERN + 2, BERRY_SHRUB = FERN + 3, BRAMBLE = FERN + 4;
export const isFlower = (kind: number): boolean => kind >= FLOWER_0 && kind < FLOWER_1;

/** The tiles (ty * MAP_W + tx) thick with shrubs and brambles: a cat pushes through them slowly. */
const THICKET = new Set<number>();
/** The tiles with any of the forest floor's plants on them (ferns, bracken, thickets). */
const UNDER = new Set<number>();
/** Whether world point (x, y) is among the forest floor's plants. */
export const undergrowthAt = (x: number, y: number): boolean => UNDER.has(Math.floor(y / TILE) * MAP_W + Math.floor(x / TILE));
/** Whether world point (x, y) is in a thicket of shrubs or brambles. */
export const thicketAt = (x: number, y: number): boolean => THICKET.has(Math.floor(y / TILE) * MAP_W + Math.floor(x / TILE));

/** A sheet with the 5 lean frames side by side, the green gone straw-coloured in autumn and winter. */
export function buildFloraSheet(k: FloraKind): Raster {
  const r = new Raster(k.w * LEANS, k.h);
  for (let f = 0; f < LEANS; f++) k.draw(r, f * k.w, f - 2);
  if (SEASON.hay > 0) {
    // (going over only half way: tufts of straw in the green, not a field of wheat)
    const greens = new Map([G.d, G.m, G.l, G.t, CATTAIL.s].map((c) => [c.join(), drabFor(c, SEASON.hay * 0.5)]));
    for (let i = 0; i < r.data.length; i += 4) {
      const c = greens.get(`${r.data[i]},${r.data[i + 1]},${r.data[i + 2]}`);
      if (c) r.set((i / 4) % r.w, Math.floor(i / 4 / r.w), c);
    }
  }
  return r;
}

export interface Plant { kind: number; x: number; y: number }

const nearWater = (tx: number, ty: number) => {
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (isPond(tileAt(tx + dx, ty + dy))) return true;
  return false;
};

/** Deterministic placement so every visitor sees the same meadow. */
export function placeFlora(): Plant[] {
  const out: Plant[] = [];
  const at = (kind: number, tx: number, ty: number, k: number) =>
    out.push({
      kind,
      x: tx * TILE + 2 + Math.floor(hash2(tx, ty, 200 + k) * 12),
      y: ty * TILE + 3 + Math.floor(hash2(tx, ty, 300 + k) * 13),
    });
  const flowerKind = (tx: number, ty: number) => 3 + Math.floor(hash2(tx, ty, 400) * PETALS.length);
  for (let ty = 1; ty < MAP_H - 1; ty++)
    for (let tx = 1; tx < MAP_W - 1; tx++) {
      const ground = groundOf(tileAt(tx, ty));
      if (furnished(tx, ty)) continue;
      const h = hash2(tx, ty, 100);
      if ((ground === 'lawn' || ground === 'tall') && !inClearing(tx, ty) && undergrowth(tx, ty, h, at)) continue;
      if (ground === 'lawn' && inClearing(tx, ty)) {
        // a clearing: grass and wildflowers, two or three to a tile
        at(0, tx, ty, 0);
        if (h < 0.6) at(0, tx, ty, 1);
        at(flowerKind(tx, ty), tx, ty, 2);
        if (h < 0.7) at(flowerKind(tx + 7, ty), tx, ty, 3);
        if (h < 0.3) at(flowerKind(tx, ty + 7), tx, ty, 4);
      } else if (ground === 'tall') {
        for (let k = 0; k < 6; k++) at(1, tx, ty, k);
        at(0, tx, ty, 6);
        if (h < 0.2) at(flowerKind(tx, ty), tx, ty, 7);
      } else if (ground === 'lawn') {
        if (nearWater(tx, ty)) {
          if (h < 0.75) at(2, tx, ty, 0);
          if (h < 0.4) at(2, tx, ty, 1);
          continue;
        }
        if (h < 0.3) at(0, tx, ty, 0);
        if (h > 0.55 && h < 0.66) at(0, tx, ty, 1);
        else if (h > 0.9) at(flowerKind(tx, ty), tx, ty, 2);
      } else if (ground === 'flowers' && h < 0.25) {
        at(flowerKind(tx, ty), tx, ty, 0);
      }
    }
  // flowers only while they're out; under snow just a few grass tips poke through (the reeds stand)
  const s = SEASON;
  return out.filter((p) => {
    const roll = hash2(p.x, p.y, 1401);
    if (isFlower(p.kind)) return roll < s.bloom * (1 - s.snow);
    if (p.kind < 2) return roll < 1 - s.snow * 0.85;
    // (ferns die back under the snow; the shrubs and brambles stand)
    if (p.kind === FERN || p.kind === BRACKEN) return roll < 1 - s.snow * 0.7;
    return true;
  });
}

/**
 * The forest floor on tile (tx, ty), if it is in the woods: patches of ferns (fewer under the pines),
 * of tall bracken, thickets of shrubs and of brambles (thickest round the clearings, walling them in).
 * Puts its plants with `at` and says whether it did.
 */
function undergrowth(tx: number, ty: number, h: number, at: (kind: number, tx: number, ty: number, k: number) => void): boolean {
  const biome = biomeAt(tx, ty);
  if (!biome) return false;
  // (none by the railway: they'd stand over the rails)
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (trackside(tx + dx, ty + dy)) return false;
  const n = (size: number, s: number) => noise(tx / size, ty / size, s);
  const wall = nearClearing(tx, ty), key = ty * MAP_W + tx;
  if (n(5, 503) > (wall ? 0.42 : 0.68) && h < (wall ? 0.85 : 0.6)) {
    // a thicket: a shrub (or, in the leafy woods, a bramble) or two
    const bramble = biome !== 'pine' && n(7, 504) > 0.55;
    at(bramble ? BRAMBLE : hash2(tx, ty, 505) < 0.3 ? BERRY_SHRUB : SHRUB, tx, ty, 10);
    if (h < 0.25) at(FERN, tx, ty, 11);
    THICKET.add(key);
    UNDER.add(key);
    return true;
  }
  if (biome !== 'pine' && n(9, 502) > 0.63) {
    at(BRACKEN, tx, ty, 12);
    if (h < 0.5) at(BRACKEN, tx, ty, 13);
    UNDER.add(key);
    return true;
  }
  if (n(6, 501) > (biome === 'pine' ? 0.62 : 0.4)) {
    at(FERN, tx, ty, 14);
    if (h < 0.55) at(FERN, tx, ty, 15);
    UNDER.add(key);
    return true;
  }
  return false;
}

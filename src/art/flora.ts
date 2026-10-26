// Swaying plants: each kind is drawn in 5 lean frames (-2..2) so the wind
// (and passing cats) can bend them.
import { Raster, hex, hash2, type RGB } from './raster.ts';
import { TILE, MAP_W, MAP_H, tileAt, furnished } from '../world/map.ts';
import { SEASON } from '../world/season.ts';
import { drabFor } from './tiles.ts';

export const LEANS = 5;

const G = { d: hex('#2c7426'), m: hex('#4ca43a'), l: hex('#86d45c'), t: hex('#b4ea84') };
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

const tall = blades('tall', 15, 15, [
  { x: 3, h: 8, tilt: -3 }, { x: 5, h: 12, tilt: -1 }, { x: 6, h: 14, tilt: 0 }, { x: 8, h: 11, tilt: 1 },
  { x: 9, h: 13, tilt: 2 }, { x: 10, h: 8, tilt: 3 }, { x: 7, h: 6, tilt: -1 },
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

export const FLORA: FloraKind[] = [tuft, tall, cattail, ...PETALS.map((_, i) => flower(i))];

/** A sheet with the 5 lean frames side by side, the green gone straw-coloured in autumn and winter. */
export function buildFloraSheet(k: FloraKind): Raster {
  const r = new Raster(k.w * LEANS, k.h);
  for (let f = 0; f < LEANS; f++) k.draw(r, f * k.w, f - 2);
  if (SEASON.hay > 0) {
    const greens = new Map([G.d, G.m, G.l, G.t, CATTAIL.s].map((c) => [c.join(), drabFor(c, SEASON.hay)]));
    for (let i = 0; i < r.data.length; i += 4) {
      const c = greens.get(`${r.data[i]},${r.data[i + 1]},${r.data[i + 2]}`);
      if (c) r.set((i / 4) % r.w, Math.floor(i / 4 / r.w), c);
    }
  }
  return r;
}

export interface Plant { kind: number; x: number; y: number }

const nearWater = (tx: number, ty: number) => {
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ('wl'.includes(tileAt(tx + dx, ty + dy))) return true;
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
      const ch = tileAt(tx, ty);
      if (furnished(tx, ty)) continue;
      const h = hash2(tx, ty, 100);
      if (ch === ',') {
        for (let k = 0; k < 4; k++) at(1, tx, ty, k);
        at(0, tx, ty, 4);
        if (h < 0.2) at(flowerKind(tx, ty), tx, ty, 5);
      } else if (ch === '.') {
        if (nearWater(tx, ty)) {
          if (h < 0.75) at(2, tx, ty, 0);
          if (h < 0.4) at(2, tx, ty, 1);
          continue;
        }
        if (h < 0.3) at(0, tx, ty, 0);
        if (h > 0.55 && h < 0.66) at(0, tx, ty, 1);
        else if (h > 0.9) at(flowerKind(tx, ty), tx, ty, 2);
      } else if (ch === 'f' && h < 0.25) {
        at(flowerKind(tx, ty), tx, ty, 0);
      }
    }
  // flowers only while they're out; under snow just a few grass tips poke through (the reeds stand)
  const s = SEASON;
  return out.filter((p) => {
    const roll = hash2(p.x, p.y, 1401);
    if (p.kind >= 3) return roll < s.bloom * (1 - s.snow);
    if (p.kind < 2) return roll < 1 - s.snow * 0.85;
    return true;
  });
}

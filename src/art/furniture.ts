// Garden furniture, drawn pixel by pixel like the rest: park benches,
// a picnic table, a bistro set and a picnic blanket with its basket. Every
// sprite gets a dark outline at the end, like the trees and critters.
import { Raster, hex, hash2, type RGB } from './raster.ts';
import { SNOW } from './tiles.ts';
import { SEASON, type Season } from '../world/season.ts';

const WOOD = { o: hex('#3b2412'), d: hex('#7a4522'), b: hex('#a8642e'), l: hex('#c07a3e'), s: hex('#e2a868') };
const IRON = { o: hex('#18141a'), d: hex('#2e2a30'), l: hex('#5a5460') };
const CREAM = hex('#f0e8d0'), CREAM_D = hex('#c8bca0');
const GLASS = { b: hex('#6aa8e0'), l: hex('#bce0f8') };
const SAGE = { o: hex('#1e3428'), d: hex('#3e6a52'), b: hex('#5e927a'), l: hex('#8cbca0') };
const WICKER = { o: hex('#4a2c12'), d: hex('#8a5a2a'), b: hex('#c08848'), l: hex('#e0b070') };
const CLOTH = { r: hex('#d84848'), rd: hex('#a83434'), c: hex('#f8ecd8'), cd: hex('#e0ccb0') };

/** A dark outline around everything drawn so far. */
function outline(r: Raster, c: RGB): void {
  const edge: [number, number][] = [];
  for (let y = 0; y < r.h; y++)
    for (let x = 0; x < r.w; x++)
      if (!r.isSet(x, y) && (r.isSet(x - 1, y) || r.isSet(x + 1, y) || r.isSet(x, y - 1) || r.isSet(x, y + 1))) edge.push([x, y]);
  for (const [x, y] of edge) r.set(x, y, c);
}

/** A park bench seen from the front: two backrest slats, the seat, iron legs. 30×18, feet on the bottom row. */
export function buildBench(): Raster {
  const r = new Raster(30, 18);
  // iron frame: back posts running down into the front legs
  for (const x of [3, 25]) r.rect(x, 1, 2, 16, IRON.d);
  for (const x of [3, 25]) r.rect(x, 1, 1, 16, IRON.l);
  // backrest slats
  for (const y of [2, 5]) {
    r.rect(1, y, 28, 1, WOOD.l);
    r.rect(1, y + 1, 28, 1, WOOD.b);
  }
  // seat seen from above, front edge in shade
  r.rect(1, 9, 28, 1, WOOD.s);
  r.rect(1, 10, 28, 1, WOOD.l);
  r.rect(1, 11, 28, 1, WOOD.b);
  r.rect(1, 12, 28, 1, WOOD.d);
  for (let x = 1; x < 29; x++) if (hash2(x, 9, 71) < 0.15) r.set(x, 10, WOOD.b);
  outline(r, IRON.o);
  return r;
}

/** A picnic table between two benches. 42×32, feet on the bottom row. */
export function buildPicnicTable(): Raster {
  const r = new Raster(42, 32);
  // back bench: top and front edge
  r.rect(4, 4, 34, 2, WOOD.l);
  r.rect(4, 6, 34, 1, WOOD.b);
  r.rect(4, 7, 34, 1, WOOD.d);
  // the table top: planks running along, seams between them
  for (let y = 9; y < 19; y++)
    for (let x = 1; x < 41; x++) {
      const k = (y - 9) % 4;
      let c = k === 0 ? WOOD.s : k === 3 ? WOOD.d : WOOD.l;
      if (k !== 3 && hash2(x, y, 72) < 0.1) c = WOOD.b;
      r.set(x, y, c);
    }
  r.rect(1, 19, 40, 2, WOOD.d);
  // A-frame legs in the gap
  for (const x of [7, 33]) r.rect(x, 21, 2, 4, WOOD.d);
  // front bench
  r.rect(4, 24, 34, 1, WOOD.s);
  r.rect(4, 25, 34, 2, WOOD.l);
  r.rect(4, 27, 34, 1, WOOD.d);
  for (const x of [6, 34]) r.rect(x, 28, 2, 3, WOOD.d);
  outline(r, WOOD.o);
  return r;
}

/** A little round bistro table: cream top on a green stand. 14×16. */
export function buildBistroTable(): Raster {
  const r = new Raster(14, 16);
  for (let y = 1; y < 7; y++)
    for (let x = 1; x < 13; x++) {
      const dx = (x + 0.5 - 7) / 6, dy = (y + 0.5 - 4) / 3;
      const d = dx * dx + dy * dy;
      if (d > 1) continue;
      r.set(x, y, dy > 0.45 ? CREAM_D : d < 0.35 && dy < 0 ? hex('#fffaf0') : CREAM);
    }
  r.rect(6, 7, 2, 7, SAGE.d);
  r.rect(6, 7, 1, 7, SAGE.b);
  r.rect(3, 14, 8, 1, SAGE.d);
  outline(r, SAGE.o);
  return r;
}

/** A garden chair facing right (mirror it for the other side). 10×17. */
export function buildChair(): Raster {
  const r = new Raster(10, 17);
  // curved backrest with a slat pattern
  r.rect(1, 2, 2, 9, SAGE.b);
  r.rect(1, 1, 1, 1, SAGE.b);
  for (let y = 3; y < 10; y += 2) r.set(2, y, SAGE.l);
  // seat
  r.rect(1, 9, 8, 1, SAGE.l);
  r.rect(1, 10, 8, 1, SAGE.b);
  r.rect(1, 11, 8, 1, SAGE.d);
  // legs
  r.rect(1, 12, 1, 4, SAGE.d);
  r.rect(7, 12, 1, 4, SAGE.d);
  outline(r, SAGE.o);
  return r;
}

/** A wicker picnic basket with a handle and a checked cloth peeking out. 14×13. */
export function buildBasket(): Raster {
  const r = new Raster(14, 13);
  // handle
  for (let x = 3; x < 11; x++) {
    const y = 1 + Math.round(((x - 6.5) / 3.5) ** 2 * 3);
    r.set(x, y, WICKER.d);
  }
  // lid and cloth
  r.rect(1, 5, 12, 2, WICKER.l);
  r.set(9, 7, CLOTH.r); r.set(10, 7, CLOTH.c); r.set(11, 7, CLOTH.r); r.set(10, 8, CLOTH.r);
  // woven body
  for (let y = 7; y < 12; y++)
    for (let x = 1; x < 13; x++) {
      if (r.isSet(x, y)) continue;
      r.set(x, y, (x + y) % 3 === 0 ? WICKER.d : y === 11 ? WICKER.d : (x + y) % 3 === 1 ? WICKER.l : WICKER.b);
    }
  outline(r, WICKER.o);
  return r;
}

/** A red-and-white checked blanket with a plate and a couple of apples. Flat on the grass. 42×24. */
export function buildBlanket(): Raster {
  const r = new Raster(42, 24);
  for (let y = 1; y < 23; y++)
    for (let x = 1; x < 41; x++) {
      const cx = Math.floor((x - 1) / 4), cy = Math.floor((y - 1) / 4);
      const both = cx % 2 === 0 && cy % 2 === 0, none = cx % 2 === 1 && cy % 2 === 1;
      // two layers of red stripes: where they cross it's darker, where neither runs it's white
      let c = both ? CLOTH.rd : none ? CLOTH.c : CLOTH.r;
      if (y === 22) c = c === CLOTH.c ? CLOTH.cd : CLOTH.rd;
      r.set(x, y, c);
    }
  // fringe on the short sides
  for (let y = 2; y < 22; y += 2) { r.set(0, y, CLOTH.c); r.set(41, y, CLOTH.c); }
  // a plate with a sandwich
  for (let y = 5; y < 12; y++)
    for (let x = 6; x < 17; x++) {
      const dx = (x + 0.5 - 11.5) / 5.5, dy = (y + 0.5 - 8.5) / 3.5;
      const d = dx * dx + dy * dy;
      if (d <= 1) r.set(x, y, d > 0.6 ? CREAM_D : hex('#ffffff'));
    }
  r.rect(9, 7, 5, 2, hex('#e8c078'));
  r.rect(9, 7, 5, 1, hex('#78b848'));
  // apples
  for (const [x, y] of [[20, 14], [24, 16]]) {
    r.rect(x, y, 3, 3, hex('#d82830'));
    r.set(x, y, hex('#f87068'));
    r.set(x + 1, y - 1, hex('#5a3a18'));
  }
  return r;
}

/** A stone bird bath: a shallow basin of water on a pedestal. 16×20, the foot on the bottom row. */
export function buildBirdBath(): Raster {
  const r = new Raster(16, 20);
  const STONE = { o: hex('#3a3a40'), d: hex('#8a8a88'), b: hex('#b8b8b0'), l: hex('#dcdcd4') };
  // the bowl: a wide rim around the water, its underside tapering into the stem
  for (let y = 1; y < 8; y++)
    for (let x = 1; x < 15; x++) {
      const dx = (x + 0.5 - 8) / 7, dy = (y + 0.5 - 4) / 3;
      const d = dx * dx + dy * dy;
      if (y < 5 && d > 1) continue;
      if (y >= 5 && Math.abs(x + 0.5 - 8) > 7 - (y - 5) * 2) continue;
      const water = y < 5 && d <= 0.55;
      r.set(x, y, water ? (d < 0.2 && dx < 0 ? GLASS.l : hex('#4a8ce0')) : y >= 5 ? (y === 5 ? STONE.b : STONE.d) : dy < 0 ? STONE.l : STONE.b);
    }
  // the stem and the foot
  for (let y = 8; y < 17; y++) { r.rect(6, y, 4, 1, STONE.b); r.set(6, y, STONE.l); r.set(9, y, STONE.d); }
  r.rect(4, 16, 8, 1, STONE.l);
  r.rect(3, 17, 10, 1, STONE.b);
  r.rect(3, 18, 10, 1, STONE.d);
  for (let x = 1; x < 15; x++) if (hash2(x, 1, 75) < 0.2 && r.isSet(x, 5)) r.set(x, 5, STONE.d);
  outline(r, STONE.o);
  return r;
}

// ---------------------------------------------------------------- seasons

/** Snow lying on every upward-facing edge of a piece of art (in patches until the snow is deep). */
export function snowCap(r: Raster, amount: number, seed = 0): void {
  if (amount <= 0) return;
  for (let x = 0; x < r.w; x++)
    for (let y = 0; y < r.h; y++) {
      if (!r.isSet(x, y) || (y > 0 && r.isSet(x, y - 1)) || hash2(x, y, seed + 1501) >= amount) continue;
      r.set(x, y, SNOW[3]);
      if (r.isSet(x, y + 1) && hash2(x, y, seed + 1502) < 0.7) r.set(x, y + 1, SNOW[2]);
    }
}

/** Furniture in winter: snow on top, a frozen bird bath. */
export function dressForSeason(r: Raster, kind: string, s: Season = SEASON): void {
  const swap = (from: RGB[], to: (c: RGB) => RGB, p = 1) => {
    const keys = new Set(from.map((c) => c.join()));
    for (let y = 0; y < r.h; y++)
      for (let x = 0; x < r.w; x++) {
        const i = (y * r.w + x) * 4;
        const k = `${r.data[i]},${r.data[i + 1]},${r.data[i + 2]}`;
        if (r.data[i + 3] && keys.has(k) && hash2(x, y, 1503) < p) r.set(x, y, to([r.data[i], r.data[i + 1], r.data[i + 2]]));
      }
  };
  if (s.frozen && kind === 'birdbath') swap([GLASS.l, hex('#4a8ce0')], (c) => (c[0] > 150 ? hex('#f2fbff') : hex('#a6d4ec')));
  if (s.snow <= 0) return;
  snowCap(r, s.snow, kind.length);
}

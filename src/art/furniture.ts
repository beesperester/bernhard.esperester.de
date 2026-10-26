// Garden furniture, drawn pixel by pixel like the rest: a shed, park benches,
// a picnic table, a bistro set and a picnic blanket with its basket. Every
// sprite gets a dark outline at the end, like the trees and critters.
import { Raster, hex, hash2, type RGB } from './raster.ts';
import { bayer } from './tiles.ts';

const WOOD = { o: hex('#3b2412'), d: hex('#7a4522'), b: hex('#a8642e'), l: hex('#c07a3e'), s: hex('#e2a868') };
const IRON = { o: hex('#18141a'), d: hex('#2e2a30'), l: hex('#5a5460') };
const ROOF = { o: hex('#3a1410'), d: hex('#7a2a24'), b: hex('#b84838'), l: hex('#d8604a'), s: hex('#f08868') };
const WALL = { d: hex('#5a6e78'), b: hex('#7a94a0'), l: hex('#9cb4bc'), seam: hex('#3e4e58') };
const CREAM = hex('#f0e8d0'), CREAM_D = hex('#c8bca0');
const GLASS = { b: hex('#6aa8e0'), l: hex('#bce0f8') };
const SAGE = { o: hex('#1e3428'), d: hex('#3e6a52'), b: hex('#5e927a'), l: hex('#8cbca0') };
const WICKER = { o: hex('#4a2c12'), d: hex('#8a5a2a'), b: hex('#c08848'), l: hex('#e0b070') };
const CLOTH = { r: hex('#d84848'), rd: hex('#a83434'), c: hex('#f8ecd8'), cd: hex('#e0ccb0') };
const GOLD = hex('#f8d038');
const FLOWERS: RGB[] = [hex('#f04858'), hex('#f8d838'), hex('#f890c8')];

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

/**
 * A wooden garden shed: a red shingled roof over blue-grey plank walls, with
 * a door, a window and a flower box. 50×56, the front wall stands on the bottom row.
 */
export function buildShed(): Raster {
  const W = 50, H = 56;
  const r = new Raster(W, H);
  // roof: rows of staggered shingles, lighter towards the eave where the sun catches them
  for (let y = 2; y < 28; y++)
    for (let x = 1; x < W - 1; x++) {
      const row = Math.floor((y - 2) / 4), v = (y - 2) % 4;
      const u = (x + (row % 2) * 3) % 6;
      let c = v === 3 ? ROOF.d : u === 0 ? ROOF.d : v === 0 ? ROOF.l : ROOF.b;
      if (c === ROOF.b && hash2(Math.floor((x + (row % 2) * 3) / 6), row, 73) < 0.25) c = ROOF.l;
      if (c === ROOF.l && v === 0 && u === 1) c = ROOF.s;
      r.set(x, y, c);
    }
  // ridge cap along the top
  r.rect(1, 1, W - 2, 1, ROOF.s);
  r.rect(1, 2, W - 2, 1, ROOF.l);
  // eave: a dark lip with the wall in its shade below
  r.rect(0, 28, W, 2, ROOF.o);
  // walls: vertical boards
  for (let y = 30; y < H; y++)
    for (let x = 3; x < W - 3; x++) {
      const u = (x - 3) % 5;
      let c = u === 0 ? WALL.seam : u === 1 ? WALL.l : WALL.b;
      if (u > 1 && hash2(x, Math.floor(y / 2), 74) < 0.08) c = WALL.d;
      // shade under the eave, dithered
      if (y < 34 && bayer(x, y) < (34 - y) / 5) c = u === 0 ? WALL.seam : WALL.d;
      if (y === H - 1) c = WALL.seam;
      r.set(x, y, c);
    }
  // door: darker boards in a frame, a Z brace and a brass handle
  r.rect(18, 36, 14, H - 36, CREAM);
  for (let y = 37; y < H; y++)
    for (let x = 19; x < 31; x++) r.set(x, y, (x - 19) % 4 === 0 ? WOOD.d : WOOD.b);
  for (let i = 0; i < 12; i++) r.set(19 + i, H - 3 - Math.round(i * 1.4), WOOD.l);
  r.rect(19, 41, 12, 1, WOOD.l);
  r.rect(19, H - 4, 12, 1, WOOD.l);
  r.set(28, 46, GOLD);
  r.set(28, 47, WOOD.o);
  // window with a cross and a shine
  r.rect(35, 34, 10, 9, CREAM);
  r.rect(36, 35, 8, 7, GLASS.b);
  r.rect(36, 35, 3, 2, GLASS.l);
  r.rect(39, 35, 2, 7, CREAM);
  r.rect(36, 38, 8, 1, CREAM);
  // flower box
  r.rect(34, 43, 12, 3, WOOD.b);
  r.rect(34, 45, 12, 1, WOOD.d);
  for (let x = 35; x < 45; x += 2) {
    r.set(x, 42, hex('#4c9a34'));
    r.set(x + 1, 41, FLOWERS[(x >> 1) % FLOWERS.length]);
  }
  // a little lamp over the door
  r.rect(24, 32, 2, 2, GOLD);
  r.set(24, 31, IRON.d);
  r.set(25, 31, IRON.d);
  outline(r, ROOF.o);
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

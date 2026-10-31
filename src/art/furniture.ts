// Garden furniture, drawn pixel by pixel like the rest: park benches,
// a picnic table, a bistro set, a picnic blanket with its basket, a bird
// bath, a cardboard box, a Berlin street pump, pots of catnip, a raised
// vegetable bed, a wheelbarrow and an insect hotel. Every
// sprite gets a dark outline at the end, like the trees and critters.
import { Raster, hex, hash2, outline, type RGB } from './raster.ts';
import { SNOW } from './tiles.ts';
import { SEASON, type Season } from '../world/season.ts';

const WOOD = { o: hex('#2e1c18'), d: hex('#5e3a28'), b: hex('#86563a'), l: hex('#a8724a'), s: hex('#cc9864') };
const IRON = { o: hex('#18141a'), d: hex('#2e2a30'), l: hex('#5a5460') };
const CREAM = hex('#f0e8d0'), CREAM_D = hex('#c8bca0');
const GLASS = { b: hex('#6aa8e0'), l: hex('#bce0f8') };
const SAGE = { o: hex('#1e3428'), d: hex('#3e6a52'), b: hex('#5e927a'), l: hex('#8cbca0') };
const WICKER = { o: hex('#3e2618'), d: hex('#7a5232'), b: hex('#a87c4a'), l: hex('#cca46c') };
const CLOTH = { r: hex('#d84848'), rd: hex('#a83434'), c: hex('#f8ecd8'), cd: hex('#e0ccb0') };


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

const CARD = { o: hex('#4a3018'), in: hex('#3e2a16'), d: hex('#8a5e30'), b: hex('#b8844a'), l: hex('#d8a868'), s: hex('#ecc890'), tape: hex('#c89a5a') };
const GREEN_IRON = { o: hex('#10241a'), d: hex('#1e4630'), b: hex('#2e6a44'), l: hex('#4e9466'), s: hex('#7cbc8c') };
const TERRA = { o: hex('#4a2010'), d: hex('#9a4424'), b: hex('#c4643a'), l: hex('#e08a5a') };
const SOIL = { d: hex('#3a2416'), b: hex('#5a3a24'), l: hex('#7a5436') };
const LEAF = { d: hex('#3c6440'), b: hex('#5f8c4a'), l: hex('#8eb35e'), s: hex('#c2d47e') };
const PUDDLE = hex('#4a8ce0');
const NEPETA = { d: hex('#4a6a52'), b: hex('#6e9478'), l: hex('#98bca0'), f: hex('#a890d8'), fl: hex('#d0c4f0'), dry: hex('#8a7448') };

/** What's growing at this time of year: nothing (bare soil), seedlings, or the full crop. */
export function growth(s: Season = SEASON): 0 | 1 | 2 {
  if (s.snow > 0.1) return 0;
  if (s.leaves > 0.6 || (s.bloom > 0.6 && s.turn < 0.9)) return 2;
  return s.bloom > 0.1 ? 1 : 0;
}

/** The barrow has soil heaped in it in spring. */
const soiled = (s: Season) => s.day > 59 && s.day < 166 && s.snow < 0.1;

/** How the catnip looks: cut back, coming up, grown, or in flower. */
const catnipLook = (s: Season) => (growth(s) === 2 && s.bloom > 0.3 ? 3 : growth(s));

/**
 * The pieces that look different through the year, by what's in them: the tags of their files'
 * frames, which of them shows in a season, and (for drawing each from code) a season it shows in.
 */
export const VARIANTS: Record<string, { tags: string[]; at: (s: Season) => number; season: (i: number) => Season }> = {
  catnip: {
    tags: ['bare', 'young', 'grown', 'flowering'], at: catnipLook,
    season: (i) => ({ ...SEASON, snow: 0, turn: 0, leaves: i >= 2 ? 1 : 0, bloom: [0, 0.3, 0.2, 1][i] }),
  },
  bed: { tags: ['bare', 'young', 'grown'], at: (s) => growth(s), season: (i) => ({ ...SEASON, snow: 0, turn: 0, leaves: i === 2 ? 1 : 0, bloom: i === 1 ? 0.3 : 0 }) },
  barrow: { tags: ['empty', 'soil'], at: (s) => (soiled(s) ? 1 : 0), season: (i) => ({ ...SEASON, snow: 0, day: i ? 100 : 200 }) },
};

/** The seed a piece's dabs of paint are laid on with (paintOver), by its name. */
export const paintSeed = (key: string): number => key.length * 31 + key.charCodeAt(0);

/** Catnip is up (and worth a roll in) from spring to autumn. */
export const catnipUp = (s: Season = SEASON): boolean => growth(s) > 0;

/**
 * A cardboard box, open at the top, flaps up. Drawn in two parts: the inside
 * and the back (behind a cat sitting in it) and the front (over it, so just
 * the ears and the head show). 28×27, the front's foot on the bottom row.
 */
export function buildBox(part: 'back' | 'front'): Raster {
  const r = new Raster(28, 27);
  if (part === 'back') {
    // the flaps: the back one standing up, the right one folded out
    for (let y = 1; y < 6; y++) r.rect(4 + (5 - y), y, 18 - 2 * (5 - y) + 2, 1, y < 3 ? CARD.s : CARD.l);
    for (let y = 6; y < 14; y++) r.rect(25, y, 2, 1, y < 8 ? CARD.l : CARD.b);
    // the rim all round, the inside of the back wall, the dark bottom
    r.rect(1, 5, 25, 13, CARD.l);
    r.rect(2, 6, 23, 4, CARD.d);
    r.rect(2, 10, 23, 7, CARD.in);
    for (let x = 2; x < 25; x++) if (hash2(x, 6, 81) < 0.2) r.set(x, 7, CARD.b);
  } else {
    // the front face, a strip of tape down the middle, a printed arrow
    r.rect(1, 17, 25, 1, CARD.s);
    r.rect(1, 18, 25, 8, CARD.b);
    r.rect(1, 25, 25, 1, CARD.d);
    r.rect(12, 17, 3, 8, CARD.tape);
    r.set(13, 17, CARD.s);
    for (const [x, y] of [[5, 20], [4, 21], [5, 21], [6, 21], [5, 22], [5, 23]]) r.set(x, y, CARD.d);
    for (let x = 1; x < 26; x++) if (hash2(x, 19, 82) < 0.12) r.set(x, 19 + (x % 5), CARD.l);
  }
  outline(r, CARD.o);
  return r;
}

/**
 * A Berlin street pump: the green cast-iron column with its fluted shaft,
 * a cap with a knob on top, the lever on the left and the spout on the right.
 * 18×34, the foot on the bottom row; the spout's mouth is at (15, 20).
 */
export function buildPump(): Raster {
  const r = new Raster(18, 34);
  const I = GREEN_IRON;
  // the lever, from its pivot under the cap down to the handle
  for (let i = 0; i < 12; i++) r.set(4 - Math.floor(i / 4), 11 + i, I.d);
  r.rect(1, 22, 2, 3, I.b);
  // shaft: lit on the left, fluted, in the shade on the right
  for (let y = 10; y < 30; y++) {
    r.rect(5, y, 6, 1, I.b);
    r.set(5, y, I.l);
    r.set(6, y, I.s);
    r.set(8, y, I.d);
    r.set(10, y, I.d);
  }
  // collars, the cap and its knob
  for (const y of [13, 25]) { r.rect(4, y, 8, 1, I.l); r.rect(4, y + 1, 8, 1, I.d); }
  r.rect(4, 8, 8, 2, I.b);
  r.rect(5, 6, 6, 2, I.l);
  r.rect(4, 8, 8, 1, I.l);
  r.rect(7, 3, 2, 3, I.b);
  r.rect(6, 2, 4, 1, I.l);
  r.set(7, 1, I.s);
  // the spout, a little lion-less pipe bending down
  r.rect(11, 17, 4, 2, I.b);
  r.rect(11, 17, 4, 1, I.l);
  r.rect(14, 19, 2, 1, I.d);
  // the foot on its plinth
  r.rect(3, 29, 10, 2, I.b);
  r.rect(3, 29, 10, 1, I.l);
  r.rect(2, 31, 12, 2, I.d);
  outline(r, I.o);
  return r;
}

/** The puddle under the pump's spout, muddy at the edge. 18×7, flat on the ground. */
export function buildPumpPuddle(): Raster {
  const r = new Raster(18, 7);
  for (let y = 0; y < 7; y++)
    for (let x = 0; x < 18; x++) {
      const dx = (x + 0.5 - 9) / 9, dy = (y + 0.5 - 3.5) / 3.5;
      const d = dx * dx + dy * dy + (hash2(x, y, 83) - 0.5) * 0.25;
      if (d > 1) continue;
      r.set(x, y, d > 0.72 ? SOIL.b : d < 0.25 && dx < 0 && dy < 0 ? GLASS.l : PUDDLE);
    }
  return r;
}
/**
 * Three terracotta pots of catnip (grey-green, with lilac spikes in summer; cut
 * back to stalks out of season), grouped rather than lined up: a small one in
 * front on the left, the big one set back behind it, a medium one on the
 * right. Each pot has its own outline, so the front ones stand off the one
 * behind. 32×24.
 */
export function buildCatnip(s: Season = SEASON): Raster {
  const r = new Raster(32, 24);
  const up = growth(s);
  // [left, width, pot height, bottom row, plant height], back to front
  const pots: [number, number, number, number, number][] = [[9, 12, 9, 19, 10], [19, 9, 7, 21, 7], [3, 7, 5, 22, 5]];
  pots.forEach(([x0, w, ph, base, hgt], i) => {
    const p = new Raster(32, 24);
    const top = base - ph + 1, cx = x0 + w / 2;
    // the plant: a mound of small leaves, spikes of flowers poking up out of it
    if (up) {
      const ht = up === 2 ? hgt : Math.ceil(hgt / 3);
      for (let y = top - ht; y < top; y++)
        for (let x = x0 - 1; x < x0 + w + 1; x++) {
          const dx = (x + 0.5 - cx) / (w / 2 + 1), dy = (y + 0.5 - top) / ht;
          if (dx * dx + dy * dy > 1 || hash2(x, y, 84 + i) < 0.12) continue;
          const k = hash2(x, y, 85 + i);
          p.set(x, y, k < 0.3 ? NEPETA.d : k < 0.75 ? NEPETA.b : NEPETA.l);
        }
      if (up === 2 && s.bloom > 0.3)
        for (let x = x0 + 1; x < x0 + w - 1; x += 2) {
          const h = 2 + Math.floor(hash2(x, i, 86) * 3), y0 = top - ht + 1 - h + Math.round(Math.abs(x + 0.5 - cx));
          for (let y = y0; y < y0 + h; y++) p.set(x, y, y === y0 ? NEPETA.fl : NEPETA.f);
        }
    } else for (let x = x0 + 1; x < x0 + w - 1; x += 2) p.rect(x, top - 2 - (x % 3), 1, 2 + (x % 3), NEPETA.dry);
    // the pot: a rim, then tapering down
    p.rect(x0, top, w, 1, TERRA.l);
    p.rect(x0, top + 1, w, 1, TERRA.b);
    for (let y = top + 2; y <= base; y++) {
      const inset = Math.floor(((y - top - 2) * 3) / Math.max(3, ph * 2));
      p.rect(x0 + 1 + inset, y, w - 2 - 2 * inset, 1, y === base ? TERRA.d : TERRA.b);
      p.set(x0 + 1 + inset, y, TERRA.l);
      p.set(x0 + w - 2 - inset, y, TERRA.d);
    }
    outline(p, TERRA.o);
    r.blit(p, 0, 0);
  });
  return r;
}

/**
 * A raised vegetable bed from a community garden: a box of planks full of
 * soil, rows of lettuce and carrots in summer, seedlings in spring, bare in
 * winter. 48×34, the front's foot on the bottom row.
 */
export function buildRaisedBed(s: Season = SEASON): Raster {
  const r = new Raster(48, 34);
  // soil, with the rim boards around it
  for (let y = 3; y < 25; y++)
    for (let x = 3; x < 45; x++) {
      const k = hash2(x, y, 87);
      r.set(x, y, k < 0.15 ? SOIL.l : k < 0.55 ? SOIL.b : SOIL.d);
    }
  r.rect(1, 1, 46, 2, WOOD.l);
  r.rect(1, 3, 2, 22, WOOD.l);
  r.rect(45, 3, 2, 22, WOOD.b);
  r.rect(1, 25, 46, 1, WOOD.s);
  // the front: two planks and the corner posts
  for (const y of [26, 30]) {
    r.rect(1, y, 46, 3, WOOD.b);
    r.rect(1, y, 46, 1, WOOD.l);
    r.rect(1, y + 3, 46, 1, WOOD.d);
  }
  for (const x of [1, 45]) r.rect(x, 26, 2, 8, WOOD.d);
  for (let x = 4; x < 44; x++) if (hash2(x, 27, 88) < 0.1) r.set(x, 27 + (x % 2) * 4, WOOD.d);
  // the crops: three rows of lettuce at the back, two of carrots at the front
  const up = growth(s);
  if (up) {
    for (const [row, y] of [[0, 7], [1, 13]] as const)
      for (let x = 7 + row * 3; x < 42; x += 7) {
        if (up === 1) { r.rect(x, y, 2, 1, LEAF.l); r.set(x, y - 1, LEAF.b); continue; }
        for (let j = -3; j <= 2; j++)
          for (let i = -3; i <= 3; i++) {
            const d = (i * i) / 10 + (j * j) / 7;
            if (d > 1) continue;
            r.set(x + i, y + j, d < 0.25 ? LEAF.s : d < 0.6 ? LEAF.l : j > 0 ? LEAF.d : LEAF.b);
          }
      }
    for (const y of [19, 23])
      for (let x = 5; x < 44; x += 3) {
        if (up === 1) { r.set(x, y - 1, LEAF.b); continue; }
        // feathery tops, an orange shoulder showing at the soil
        r.set(x, y - 4, LEAF.b); r.set(x - 1, y - 3, LEAF.d); r.set(x + 1, y - 3, LEAF.b); r.set(x, y - 2, LEAF.d); r.set(x, y - 1, LEAF.d);
        r.set(x, y, hex('#e8782a'));
      }
  }
  outline(r, WOOD.o);
  return r;
}

/**
 * A wheelbarrow seen from the side, wheel to the left: a red steel tub on a
 * frame, handles and legs to the right. Soil heaped in it in spring (in
 * autumn the leaves are a pile of their own: Weather.ts). 34×20.
 */
export function buildBarrow(s: Season = SEASON): Raster {
  const r = new Raster(34, 20);
  const RED = { o: hex('#3a1410'), d: hex('#8a2a1e'), b: hex('#c0422e'), l: hex('#e06a4a') };
  // the frame running from the axle back to the handles, the leg
  for (let x = 5; x < 32; x++) r.set(x, 13 - Math.floor(Math.max(0, x - 26) / 2), IRON.d);
  r.rect(31, 9, 2, 2, WOOD.b);
  r.rect(24, 13, 2, 6, IRON.d);
  r.rect(23, 18, 4, 1, IRON.d);
  // the tub: its opening seen from a little above, the side tapering towards the bottom
  r.rect(8, 4, 20, 1, RED.l);
  r.rect(8, 5, 20, 3, IRON.o);
  r.rect(9, 5, 18, 3, hex('#2a1a14'));
  for (let y = 8; y < 13; y++) {
    const x0 = 8 + Math.floor((y - 8) * 0.8), x1 = 28 - Math.floor((y - 8) * 0.4);
    r.rect(x0, y, x1 - x0, 1, y === 8 ? RED.l : y > 11 ? RED.d : RED.b);
  }
  // soil heaped up in it in spring
  if (soiled(s))
    for (let y = 2; y < 8; y++)
      for (let x = 9; x < 27; x++) {
        const dx = (x + 0.5 - 18) / 9, dy = (y + 0.5 - 8) / 5.5;
        if (dx * dx + dy * dy <= 1) r.set(x, y, hash2(x, y, 89) < 0.3 ? SOIL.l : hash2(x, y, 90) < 0.5 ? SOIL.b : SOIL.d);
      }
  // the wheel
  for (let y = 10; y < 20; y++)
    for (let x = 0; x < 11; x++) {
      const q = (x + 0.5 - 5.5) ** 2 + (y + 0.5 - 14.5) ** 2;
      if (q <= 20.25) r.set(x, y, q < 2.5 ? IRON.l : q < 9 ? hex('#7a7a80') : hex('#1e1e22'));
    }
  outline(r, RED.o);
  return r;
}

/**
 * An insect hotel on its post: a little wooden house under a roof, full of
 * bamboo tubes, a drilled log, pine cones and straw. 16×30, the post's foot on
 * the bottom row.
 */
export function buildInsectHotel(): Raster {
  const r = new Raster(16, 30);
  const BAMBOO = { b: hex('#d8b868'), h: hex('#2a1a10') };
  // the post
  r.rect(7, 17, 2, 12, WOOD.d);
  r.set(7, 17, WOOD.b);
  r.rect(6, 28, 4, 1, WOOD.d);
  // the roof
  for (let y = 0; y < 5; y++) r.rect(7 - y * 2 + (y > 0 ? 1 : 0), y + 1, y === 0 ? 2 : y * 4, 1, y % 2 ? WOOD.d : WOOD.b);
  r.rect(0, 5, 16, 1, WOOD.d);
  // the box and its compartments
  r.rect(1, 6, 14, 11, WOOD.l);
  r.rect(2, 7, 12, 9, SOIL.d);
  r.rect(8, 7, 1, 9, WOOD.l);
  r.rect(2, 11, 12, 1, WOOD.l);
  // bamboo tubes, top left
  for (const [x, y] of [[3, 8], [5, 8], [4, 9], [6, 9], [3, 10], [5, 10]]) { r.set(x, y, BAMBOO.b); r.set(x + 1, y, BAMBOO.h); }
  // pine cones, top right
  for (const [x, y] of [[10, 8], [12, 9], [10, 10]]) { r.rect(x, y, 2, 1, hex('#8a5a2a')); r.set(x, y + 1, hex('#5a3a1a')); }
  // a log drilled full of holes, bottom left; straw, bottom right
  r.rect(2, 12, 6, 4, hex('#b08860'));
  for (const [x, y] of [[3, 13], [5, 12], [6, 14], [3, 15]]) r.set(x, y, BAMBOO.h);
  for (let x = 9; x < 14; x++) for (let y = 12; y < 16; y++) r.set(x, y, hash2(x, y, 91) < 0.5 ? hex('#e8d080') : hex('#c8a858'));
  outline(r, WOOD.o);
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
  // (by colour, or near it: the dabs of paint over it, or painted so)
  const swap = (from: RGB[], to: (c: RGB) => RGB, p = 1) => {
    for (let y = 0; y < r.h; y++)
      for (let x = 0; x < r.w; x++) {
        const i = (y * r.w + x) * 4, c: RGB = [r.data[i], r.data[i + 1], r.data[i + 2]];
        if (r.data[i + 3] && from.some((f) => Math.hypot(f[0] - c[0], f[1] - c[1], f[2] - c[2]) < 40) && hash2(x, y, 1503) < p) r.set(x, y, to(c));
      }
  };
  if (s.frozen && kind === 'puddle') swap([GLASS.l, PUDDLE], (c) => (c[0] > 150 ? hex('#f2fbff') : hex('#a6d4ec')));
  if (s.frozen && kind === 'birdbath') swap([GLASS.l, hex('#4a8ce0')], (c) => (c[0] > 150 ? hex('#f2fbff') : hex('#a6d4ec')));
  if (s.snow <= 0) return;
  snowCap(r, s.snow, kind.length);
}

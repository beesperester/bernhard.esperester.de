// The Ring's railway on the ground: a bed of gravel, wooden sleepers across
// it and two steel rails along it, following the track's curve (track.ts).
// Where it crosses the water it runs on its bridges (map tile 'R', drawn
// with the ground in art/tiles.ts). Drawn in square pieces, only where the line passes.

import { Raster, hash2, hex, type RGB } from './raster.ts';
import { trackPoints } from '../world/track.ts';
import { isWaterway } from '../world/legend.ts';
import { tileAt } from '../world/map.ts';
import { TILE } from '../world/size.ts';
import { SEASON, type Season } from '../world/season.ts';

/** Each piece is this many px square. */
export const RAIL_CHUNK = 256;
/** Half the width of the gravel bed, of the sleepers, and how far the rails are off the middle (px). */
const BED = 6, SLEEPER = 5.5, GAUGE = 3;
/** Sleepers this far apart along the line (px). */
const SLEEPER_EVERY = 5;

const GRAVEL: RGB[] = [hex('#8a8478'), hex('#a09a8c'), hex('#6e685e'), hex('#b4ae9e')];
const WOOD = { d: hex('#4a2e1a'), b: hex('#6e4426'), l: hex('#8a5a32') };
const STEEL = { d: hex('#4e5058'), b: hex('#8a8c96'), l: hex('#d0d4dc') };

const wet = (x: number, y: number) => isWaterway(tileAt(Math.floor(x / TILE), Math.floor(y / TILE)));

/** The pieces the line passes through, as [chunk x, chunk y]. */
export function railChunks(): [number, number][] {
  const { xs, ys } = trackPoints();
  const seen = new Set<string>(), out: [number, number][] = [];
  for (let i = 0; i < xs.length; i++)
    for (const [dx, dy] of [[-16, -16], [16, -16], [-16, 16], [16, 16]]) {
      const cx = Math.floor((xs[i] + dx) / RAIL_CHUNK), cy = Math.floor((ys[i] + dy) / RAIL_CHUNK), k = `${cx},${cy}`;
      if (!seen.has(k)) { seen.add(k); out.push([cx, cy]); }
    }
  return out;
}

/** Half the width of a bridge's deck to the outside of its girders (its deck is drawn with the ground, art/tiles.ts). */
const DECK = 7;
const GIRDER = { d: hex('#2e3a4a'), b: hex('#4a5e74'), l: hex('#7088a0') };
const STONE = { l: hex('#c8c4b8'), b: hex('#a09c90'), d: hex('#6e6a60') };
const SHADE = hex('#2c5c9c'), FOAM = hex('#d8ecff');
const bridged = (x: number, y: number) => tileAt(Math.floor(x / TILE), Math.floor(y / TILE)) === 'R';

/**
 * The railway within piece (cx, cy): on the ground its bed, sleepers and rails (over the water on
 * its bridges' decks, map tile 'R'); or, over the water and above its reflections, what of the
 * bridges stands in it: the girders' faces turned to the viewer, the deck's shade, and a stone
 * pier under each tile's middle with a ring of foam round its foot.
 */
export function buildRailway(cx: number, cy: number, part: 'ground' | 'water', s: Season = SEASON): Raster {
  const r = new Raster(RAIL_CHUNK, RAIL_CHUNK);
  const { xs, ys, step } = trackPoints();
  const ox = cx * RAIL_CHUNK, oy = cy * RAIL_CHUNK;
  const n = xs.length;
  /** Walk the line in quarter-px steps: point, direction across it, how far along. */
  const along = (f: (x: number, y: number, nx: number, ny: number, at: number) => void) => {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (Math.abs(xs[i] - ox - RAIL_CHUNK / 2) > RAIL_CHUNK / 2 + 12 || Math.abs(ys[i] - oy - RAIL_CHUNK / 2) > RAIL_CHUNK / 2 + 12) continue;
      const dx = xs[j] - xs[i], dy = ys[j] - ys[i], d = Math.hypot(dx, dy) || 1;
      for (let u = 0; u < 1; u += 0.25) f(xs[i] + dx * u, ys[i] + dy * u, -dy / d, dx / d, (i + u) * step);
    }
  };
  const put = (x: number, y: number, c: RGB) => {
    const px = Math.round(x - ox), py = Math.round(y - oy);
    if (px >= 0 && py >= 0 && px < RAIL_CHUNK && py < RAIL_CHUNK) r.set(px, py, c);
  };
  if (part === 'water') {
    // (only on the open water round the bridge, not on its deck nor on the banks)
    const inWater = (px: number, py: number, c: RGB) => { if (wet(px, py) && !bridged(px, py)) put(px, py, c); };
    along((x, y, nx, ny) => {
      if (!bridged(x, y)) return;
      // (the side down the screen, towards the viewer)
      const side = ny > 0 ? 1 : -1;
      const flat = Math.abs(ny) > 0.5;
      // a pier under the middle of each tile, along the way
      const tcx = (Math.floor(x / TILE) + 0.5) * TILE, tcy = (Math.floor(y / TILE) + 0.5) * TILE;
      const pier = Math.abs((x - tcx) * -ny + (y - tcy) * nx) <= 3;
      if (flat) {
        // the girder's face, the deck's shade on the water, the pier's face and its foot in foam
        for (let k = DECK; k <= DECK + 6; k += 0.5) {
          const px = x + nx * side * k, py = y + ny * side * k;
          const c = k <= DECK + 2 ? (k <= DECK + 0.5 ? GIRDER.l : GIRDER.d)
            : pier ? (k > DECK + 5 ? FOAM : k <= DECK + 2.5 ? STONE.l : Math.abs((x - tcx) * -ny + (y - tcy) * nx) > 2 ? STONE.d : STONE.b)
            : k <= DECK + 3 ? SHADE : null;
          if (c) inWater(px, py, c);
        }
      } else if (pier)
        // a run across the view: the piers stick out either side
        for (const sd of [-1, 1])
          for (let k = DECK; k <= DECK + 2.5; k += 0.5) {
            const px = x + nx * sd * k, py = y + ny * sd * k;
            inWater(px, py, k > DECK + 2 ? STONE.d : STONE.l);
            inWater(px, py + 1, STONE.d);
            inWater(px, py + 2, FOAM);
          }
    });
    return r;
  }
  // the gravel bed (none on the bridges' decks)
  along((x, y, nx, ny) => {
    if (wet(x, y)) return;
    for (let k = -BED; k <= BED; k += 0.5) {
      const px = x + nx * k, py = y + ny * k;
      if (!wet(px, py)) put(px, py, GRAVEL[Math.floor(hash2(Math.round(px), Math.round(py), 1901) * GRAVEL.length)]);
    }
  });
  // sleepers
  along((x, y, nx, ny, at) => {
    const m = ((at % SLEEPER_EVERY) + SLEEPER_EVERY) % SLEEPER_EVERY;
    if (m >= 2) return;
    for (let k = -SLEEPER; k <= SLEEPER; k += 0.5) put(x + nx * k, y + ny * k, m < 1 ? WOOD.b : WOOD.d);
  });
  // the rails: dark underneath, bright along the top
  along((x, y, nx, ny) => {
    for (const side of [-1, 1]) {
      put(x + nx * side * GAUGE, y + ny * side * GAUGE + 1, STEEL.d);
      put(x + nx * side * GAUGE, y + ny * side * GAUGE, STEEL.b);
    }
  });
  along((x, y, nx, ny) => {
    for (const side of [-1, 1]) put(x + nx * side * GAUGE, y + ny * side * GAUGE - 0.4, STEEL.l);
  });
  // under snow the bed and sleepers whiten, the rails stay clear (trains keep them so)
  if (s.snow > 0.3)
    for (let y = 0; y < RAIL_CHUNK; y++)
      for (let x = 0; x < RAIL_CHUNK; x++) {
        const i = (y * RAIL_CHUNK + x) * 4;
        if (!r.data[i + 3] || r.data[i] < 60 || (r.data[i] === STEEL.l[0] && r.data[i + 1] === STEEL.l[1]) || hash2(x + ox, y + oy, 1902) > s.snow) continue;
        if (r.data[i] === STEEL.b[0] && r.data[i + 1] === STEEL.b[1]) continue;
        r.set(x, y, hash2(x + ox, y + oy, 1903) < 0.5 ? hex('#eef4fa') : hex('#d8e2ee'));
      }
  return r;
}

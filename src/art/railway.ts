// The Ring's railway on the ground: a bed of gravel, wooden sleepers across
// it and two steel rails along it, following the track's curve (track.ts).
// Where it crosses the water it runs on a bridge deck of its own, with a
// girder along each side. Drawn in square pieces, only where the line passes.

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
/** Half the width of the deck over the water. */
const DECK = 7;

const GRAVEL: RGB[] = [hex('#8a8478'), hex('#a09a8c'), hex('#6e685e'), hex('#b4ae9e')];
const WOOD = { d: hex('#4a2e1a'), b: hex('#6e4426'), l: hex('#8a5a32') };
const STEEL = { d: hex('#4e5058'), b: hex('#8a8c96'), l: hex('#d0d4dc') };
const GIRDER = { d: hex('#2e3a4a'), b: hex('#4a5e74') };

const wet = (x: number, y: number) => isWaterway(tileAt(Math.floor(x / TILE), Math.floor(y / TILE)));

/** The pieces the line passes through, as [chunk x, chunk y]. */
export function railChunks(): [number, number][] {
  const { xs, ys } = trackPoints();
  const seen = new Set<string>(), out: [number, number][] = [];
  for (let i = 0; i < xs.length; i++)
    for (const [dx, dy] of [[-DECK, -DECK], [DECK, -DECK], [-DECK, DECK], [DECK, DECK]]) {
      const cx = Math.floor((xs[i] + dx) / RAIL_CHUNK), cy = Math.floor((ys[i] + dy) / RAIL_CHUNK), k = `${cx},${cy}`;
      if (!seen.has(k)) { seen.add(k); out.push([cx, cy]); }
    }
  return out;
}

/**
 * The railway within piece (cx, cy): the part on land, or the part over the water (drawn
 * above the water's reflections and ripples).
 */
export function buildRailway(cx: number, cy: number, part: 'land' | 'water', s: Season = SEASON): Raster {
  const r = new Raster(RAIL_CHUNK, RAIL_CHUNK);
  const { xs, ys, step } = trackPoints();
  const ox = cx * RAIL_CHUNK, oy = cy * RAIL_CHUNK;
  const n = xs.length;
  /** Walk the line in half-px steps: point, direction across it, how far along. */
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
    if (px >= 0 && py >= 0 && px < RAIL_CHUNK && py < RAIL_CHUNK && wet(px + ox, py + oy) === (part === 'water')) r.set(px, py, c);
  };
  // the deck over the water, girders along its sides
  along((x, y, nx, ny) => {
    if (!wet(x, y)) return;
    for (let k = -DECK; k <= DECK; k += 0.5) put(x + nx * k, y + ny * k, Math.abs(k) > DECK - 1.5 ? GIRDER.d : Math.abs(k) > DECK - 2.5 ? GIRDER.b : WOOD.d);
  });
  // the gravel bed (none on the deck)
  along((x, y, nx, ny) => {
    if (wet(x, y)) return;
    for (let k = -BED; k <= BED; k += 0.5) {
      const px = x + nx * k, py = y + ny * k;
      put(px, py, GRAVEL[Math.floor(hash2(Math.round(px), Math.round(py), 1901) * GRAVEL.length)]);
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

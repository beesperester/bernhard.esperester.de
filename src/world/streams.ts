// Streams: the narrow channels of water that run between the ponds. Every
// channel flows one way, out of the pond at one end and into the pond at the
// other: downhill on the screen, from the end higher up the map to the one
// further down (the big lake at the bottom). Nothing has to be marked on the
// map: any run of water one tile wide is a stream, and wider water is a pond.
import { MAP_H, MAP_W, TILE, tileAt } from './map.ts';
import { isWaterway } from './legend.ts';

type Pt = [number, number];

export interface Stream {
  /** The middle of the channel in world px, from the pond it leaves to the pond it runs into. */
  pts: Pt[];
  /** Distance along the stream to each point. */
  at: number[];
  /** Its whole length (px). */
  length: number;
}

/** A point `s` px along a stream, and the way the water flows there (a unit vector). */
export interface Along { x: number; y: number; dx: number; dy: number }

const SIDES: Pt[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
/** How wide a bend the water takes round a corner (px either side of it). */
const BEND = 6;

/** Find the streams on a map. `tile` gives the map character at a tile (the garden's, unless testing). */
export function findStreams(tile: (tx: number, ty: number) => string = tileAt, w = MAP_W, h = MAP_H): Stream[] {
  const wet = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && isWaterway(tile(x, y));
  // pond water belongs to a 2x2 block of water; everything else wet is a channel
  const pond = (x: number, y: number) =>
    wet(x, y) && [[0, 0], [-1, 0], [0, -1], [-1, -1]].some(([ox, oy]) => wet(x + ox, y + oy) && wet(x + ox + 1, y + oy) && wet(x + ox, y + oy + 1) && wet(x + ox + 1, y + oy + 1));
  const channel = (x: number, y: number) => wet(x, y) && !pond(x, y);
  const key = (x: number, y: number) => y * w + x;

  const seen = new Set<number>();
  const streams: Stream[] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!channel(x, y) || seen.has(key(x, y))) continue;
      // the whole channel this tile is part of
      const tiles: Pt[] = [];
      const queue: Pt[] = [[x, y]];
      seen.add(key(x, y));
      while (queue.length) {
        const [cx, cy] = queue.pop()!;
        tiles.push([cx, cy]);
        for (const [dx, dy] of SIDES)
          if (channel(cx + dx, cy + dy) && !seen.has(key(cx + dx, cy + dy))) {
            seen.add(key(cx + dx, cy + dy));
            queue.push([cx + dx, cy + dy]);
          }
      }
      if (tiles.length < 3) continue;
      // its two ends, and the pond each opens into (if any): the lower end is its mouth, the other its source
      const ends = tiles
        .filter(([tx, ty]) => SIDES.filter(([dx, dy]) => channel(tx + dx, ty + dy)).length <= 1)
        .map((tile) => {
          const p = [...SIDES, [1, 1], [-1, 1], [1, -1], [-1, -1]].map(([dx, dy]) => [tile[0] + dx, tile[1] + dy] as Pt).find(([px, py]) => pond(px, py));
          return { tile, pond: p, exit: p ?? tile };
        })
        .sort((a, b) => b.exit[1] - a.exit[1] || b.exit[0] - a.exit[0]);
      // a ring of water has no ends: it doesn't flow anywhere
      if (ends.length < 2) continue;
      const mouth = ends[0], source = ends[ends.length - 1];
      const last = mouth.tile;
      // walk up from the mouth: how far each tile is from it
      const dist = new Map<number, number>([[key(...last), 0]]);
      const order: Pt[] = [last];
      for (let i = 0; i < order.length; i++) {
        const [cx, cy] = order[i];
        for (const [dx, dy] of SIDES)
          if (channel(cx + dx, cy + dy) && !dist.has(key(cx + dx, cy + dy))) {
            dist.set(key(cx + dx, cy + dy), dist.get(key(cx, cy))! + 1);
            order.push([cx + dx, cy + dy]);
          }
      }
      // follow the water down from the source (side branches are left out)
      let at = source.tile;
      const path: Pt[] = [at];
      while (dist.get(key(...at))! > 0) {
        const d = dist.get(key(...at))!;
        at = SIDES.map(([dx, dy]) => [at[0] + dx, at[1] + dy] as Pt).find(([nx, ny]) => dist.get(key(nx, ny)) === d - 1)!;
        path.push(at);
      }
      // it comes out of a pond at the top and runs on a little way into the one at the bottom
      if (source.pond) path.unshift(source.pond);
      if (mouth.pond) path.push(mouth.pond);
      const mid = path.map(([tx, ty]) => [tx * TILE + TILE / 2, ty * TILE + TILE / 2] as Pt);
      // round the bends a little, so what floats down doesn't turn on the spot
      const pts: Pt[] = [];
      mid.forEach((p, i) => {
        const a = mid[i - 1], b = mid[i + 1];
        if (!a || !b || (p[0] - a[0] === b[0] - p[0] && p[1] - a[1] === b[1] - p[1])) return pts.push(p);
        const k = BEND / TILE;
        pts.push([p[0] + (a[0] - p[0]) * k, p[1] + (a[1] - p[1]) * k], [p[0] + (b[0] - p[0]) * k, p[1] + (b[1] - p[1]) * k]);
      });
      const along = [0];
      for (let i = 1; i < pts.length; i++) along.push(along[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      streams.push({ pts, at: along, length: along[along.length - 1] });
    }
  return streams;
}

/** The point `s` px down a stream (clamped to its ends), and which way the water runs there. */
export function along(stream: Stream, s: number): Along {
  const { pts, at } = stream;
  s = Math.max(0, Math.min(stream.length, s));
  let i = 1;
  while (i < pts.length - 1 && at[i] < s) i++;
  const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
  const len = at[i] - at[i - 1] || 1;
  const u = (s - at[i - 1]) / len;
  return { x: ax + (bx - ax) * u, y: ay + (by - ay) * u, dx: (bx - ax) / len, dy: (by - ay) / len };
}

/** The streams of the garden. */
export const STREAMS = findStreams();

// Generates the park map (src/world/garden.ts) from OpenStreetMap: Berlin
// inside the S-Bahn Ring, as a garden. The Spree and the canals, the lakes,
// the main roads and their bridges and the Ring itself keep their real
// layout, and so do the terraces, the garden ponds and the landmark follies
// placed around them. That is the fixed part of the park. Everything else
// (lawns, meadows, flower beds, trees, the maze, the tree house, the
// furniture) is laid out afresh for every new garden from its seed
// (src/world/layout.ts), thickest where the real parks and woods are: ZONES
// says where those are.
//
//   sh tools/berlin/fetch.sh          (once: downloads the OSM extract into tools/berlin/cache)
//   npx tsx tools/berlin/generate.ts  (writes src/world/garden.ts, and a preview to tools/berlin/cache)
//
// Map data © OpenStreetMap contributors, ODbL (see the credit in the footer).
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { LANDMARKS, LANDMARK_SIZE, type LandmarkKind } from '../../src/world/landmarks.ts';

const W = 120, H = 90;
/** Subsamples per tile each way, for how much of a tile an area covers. */
const SS = 4;
const here = new URL('.', import.meta.url).pathname;

type Pt = [number, number];
interface Way { type: 'way'; id: number; tags?: Record<string, string>; geometry?: { lat: number; lon: number }[] }
interface Rel { type: 'relation'; id: number; tags?: Record<string, string>; members: { type: string; role: string; geometry?: { lat: number; lon: number }[] }[] }
const osm: { elements: (Way | Rel)[] } = JSON.parse(readFileSync(`${here}cache/osm.json`, 'utf8'));
const ways = osm.elements.filter((e): e is Way => e.type === 'way' && !!e.geometry);
const rels = osm.elements.filter((e): e is Rel => e.type === 'relation');

// ---- projection: the Ring's bounding box, fitted into the map with a margin
const ringRel = rels.find((r) => r.tags?.ref === 'S41')!;
const ringWays = ringRel.members.filter((m) => m.type === 'way' && m.role === '' && m.geometry).map((m) => m.geometry!);
let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
for (const g of ringWays) for (const p of g) {
  minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat);
  minLon = Math.min(minLon, p.lon); maxLon = Math.max(maxLon, p.lon);
}
const kx = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
const MARGIN = 4;
const scale = Math.min((W - 2 * MARGIN) / ((maxLon - minLon) * kx), (H - 2 * MARGIN) / (maxLat - minLat));
const ox = (W - (maxLon - minLon) * kx * scale) / 2, oy = (H - (maxLat - minLat) * scale) / 2;
/** Map position (in tiles) of a point on Earth. */
export const project = (lat: number, lon: number): Pt => [ox + (lon - minLon) * kx * scale, oy + (maxLat - lat) * scale];
const line = (g: { lat: number; lon: number }[]): Pt[] => g.map((p) => project(p.lat, p.lon));
console.log(`one tile is ${Math.round(111200 / scale)} m`);

// ---- rasterising
const grid = <T>(v: T) => Array.from({ length: H }, () => new Array<T>(W).fill(v));
const inMap = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H;

/** Tiles a line passes through, 4-connected (a cat can walk along it). */
function supercover(pts: Pt[], visit: (x: number, y: number) => void): void {
  for (let i = 0; i + 1 < pts.length; i++) {
    let [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    let tx = Math.floor(x0), ty = Math.floor(y0);
    const ex = Math.floor(x1), ey = Math.floor(y1);
    const dx = x1 - x0, dy = y1 - y0;
    const sx = Math.sign(dx), sy = Math.sign(dy);
    const tdx = dx ? Math.abs(1 / dx) : Infinity, tdy = dy ? Math.abs(1 / dy) : Infinity;
    let mx = dx ? (sx > 0 ? tx + 1 - x0 : x0 - tx) * tdx : Infinity;
    let my = dy ? (sy > 0 ? ty + 1 - y0 : y0 - ty) * tdy : Infinity;
    visit(tx, ty);
    for (let n = 0; n < 2000 && (tx !== ex || ty !== ey); n++) {
      if (mx < my) { mx += tdx; tx += sx; } else { my += tdy; ty += sy; }
      visit(tx, ty);
    }
    x0 = x1; y0 = y1;
  }
}

/** Join a relation's outer (or inner) ways into closed rings. */
function rings(parts: Pt[][]): Pt[][] {
  const out: Pt[][] = [];
  const left = parts.map((p) => [...p]);
  const same = (a: Pt, b: Pt) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
  while (left.length) {
    const cur = left.shift()!;
    for (let guard = 0; guard < 10000 && !same(cur[0], cur[cur.length - 1]); guard++) {
      const end = cur[cur.length - 1];
      const k = left.findIndex((p) => same(p[0], end) || same(p[p.length - 1], end));
      if (k < 0) break;
      const next = left.splice(k, 1)[0];
      cur.push(...(same(next[0], end) ? next : next.reverse()).slice(1));
    }
    out.push(cur);
  }
  return out;
}

/** How much of every tile (0..1) the polygons cover (even-odd over all their rings). */
function cover(polys: Pt[][][]): number[][] {
  const hits = grid(0);
  for (const poly of polys) {
    const all = poly.flat();
    const y0 = Math.max(0, Math.floor(Math.min(...all.map((p) => p[1])) * SS)), y1 = Math.min(H * SS - 1, Math.ceil(Math.max(...all.map((p) => p[1])) * SS));
    for (let sy = y0; sy <= y1; sy++) {
      const y = (sy + 0.5) / SS;
      const xs: number[] = [];
      for (const r of poly)
        for (let i = 0; i < r.length; i++) {
          const [ax, ay] = r[i], [bx, by] = r[(i + 1) % r.length];
          if ((ay <= y) !== (by <= y)) xs.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
        }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2)
        for (let sx = Math.max(0, Math.ceil(xs[k] * SS - 0.5)); sx <= Math.min(W * SS - 1, Math.floor(xs[k + 1] * SS - 0.5)); sx++)
          hits[Math.floor(sy / SS)][Math.floor(sx / SS)]++;
    }
  }
  return hits.map((r) => r.map((v) => Math.min(1, v / (SS * SS))));
}

/** Polygons (as lists of rings) of the ways and multipolygon relations matching `test`. */
function areas(test: (t: Record<string, string>) => boolean): { poly: Pt[][]; tags: Record<string, string> }[] {
  const out: { poly: Pt[][]; tags: Record<string, string> }[] = [];
  for (const w of ways) {
    const g = w.geometry!;
    if (!w.tags || !test(w.tags) || g.length < 4 || g[0].lat !== g[g.length - 1].lat || g[0].lon !== g[g.length - 1].lon) continue;
    out.push({ poly: [line(g)], tags: w.tags });
  }
  for (const r of rels) {
    if (!r.tags || !test(r.tags)) continue;
    const parts = r.members.filter((m) => m.type === 'way' && m.geometry && (m.role === 'outer' || m.role === 'inner' || m.role === ''));
    if (!parts.length) continue;
    out.push({ poly: rings(parts.map((m) => line(m.geometry!))), tags: r.tags });
  }
  return out;
}

// ---- the Ring: a path all the way round; everything outside it is meadow and wood
const ringPath = grid(false);
for (const g of ringWays) supercover(line(g), (x, y) => { if (inMap(x, y)) ringPath[y][x] = true; });
const outside = grid(false);
{
  const q: Pt[] = [];
  for (let x = 0; x < W; x++) q.push([x, 0], [x, H - 1]);
  for (let y = 0; y < H; y++) q.push([0, y], [W - 1, y]);
  while (q.length) {
    const [x, y] = q.pop()!;
    if (!inMap(x, y) || outside[y][x] || ringPath[y][x]) continue;
    outside[y][x] = true;
    q.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
}

// ---- water: the Spree and the canals run (and never freeze); lakes and ponds are still
const RUNNING = new Set(['river', 'canal', 'lock', 'harbour', 'basin', 'oxbow', 'stream']);
const waterAreas = areas((t) => t.natural === 'water' && t.water !== 'fountain' && t.water !== 'reflecting_pool');
const waterCover = cover(waterAreas.map((a) => a.poly));
const runCover = cover(waterAreas.filter((a) => RUNNING.has(a.tags.water ?? '')).map((a) => a.poly));
const water = grid(false), running = grid(false);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  if (waterCover[y][x] >= 0.4) water[y][x] = true;
  if (runCover[y][x] >= 0.2) running[y][x] = true;
}
// the rivers' and canals' lines, so narrow ones still show (a tile wide)
// (the Spree two tiles wide: it is the river)
for (const w of ways) {
  const t = w.tags ?? {};
  if ((t.waterway !== 'river' && t.waterway !== 'canal') || t.tunnel === 'yes' || t.tunnel === 'culvert') continue;
  const wide = t.waterway === 'river' && t.name === 'Spree';
  supercover(line(w.geometry!), (x, y) => {
    for (const [dx, dy] of wide ? [[0, 0], [1, 0], [0, 1], [1, 1]] : [[0, 0]])
      if (inMap(x + dx, y + dy)) { water[y + dy][x + dx] = true; running[y + dy][x + dx] = true; }
  });
}
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!water[y][x]) running[y][x] = false;
// (a puddle of a pond, smaller than a few tiles, is left out)
{
  const seen = grid(false);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!water[y][x] || seen[y][x]) continue;
    const q: Pt[] = [[x, y]], all: Pt[] = [];
    seen[y][x] = true;
    while (q.length) {
      const [cx, cy] = q.pop()!;
      all.push([cx, cy]);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (inMap(nx, ny) && water[ny][nx] && !seen[ny][nx]) { seen[ny][nx] = true; q.push([nx, ny]); }
      }
    }
    if (all.length < 6 && !all.some(([ax, ay]) => running[ay][ax])) for (const [ax, ay] of all) water[ay][ax] = false;
  }
}

// ---- preview
const COLOURS: Record<string, [number, number, number]> = {
  '.': [120, 190, 90], ',': [90, 160, 70], f: [230, 120, 160], p: [220, 200, 150], B: [150, 100, 60], w: [70, 130, 210], '~': [40, 100, 190],
  l: [60, 170, 90], F: [60, 40, 30], T: [30, 100, 40], P: [20, 70, 50], H: [200, 120, 40], b: [50, 130, 50], r: [160, 160, 160], m: [20, 80, 30],
  '#': [40, 110, 40], o: [180, 220, 255], S: [200, 200, 200], g: [120, 80, 40], L: [240, 60, 60],
};
function png(rows: string[], elev: string[], path: string, px = 6): void {
  const w = W * px, h = H * px, raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const tx = Math.floor(x / px), ty = Math.floor(y / px);
      const c = COLOURS[rows[ty][tx]] ?? [255, 0, 255];
      const lift = Number(elev[ty][tx]) * 18;
      const i = y * (w * 4 + 1) + 1 + x * 4;
      raw[i] = Math.min(255, c[0] + lift); raw[i + 1] = Math.min(255, c[1] + lift); raw[i + 2] = Math.min(255, c[2] + lift); raw[i + 3] = 255;
    }
  }
  const crc = (buf: Buffer) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  writeFileSync(path, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

// ---- main roads become paths, and the Ring a path all round; where they cross the water, footbridges
const path = grid(false);
/** Where a road crossed the water: the middle of the crossing (the bridge is laid when the map is tidied). */
const fords: Pt[] = [];
/** Lay a road along these tiles. Where it crosses water it breaks off, and the crossing is noted; a road running along in the water (a bank) is left out there. */
function road(cells: Pt[], isBridge = false): void {
  // a bridge is a way of its own in OSM: it crosses the water wherever it is over it
  const over = cells.filter(([x, y]) => water[y][x]);
  if (isBridge && over.length) fords.push(over[over.length >> 1]);
  for (let i = 0; i < cells.length; ) {
    const [x, y] = cells[i];
    if (!water[y][x]) { path[y][x] = true; i++; continue; }
    let j = i;
    while (j < cells.length && water[cells[j][1]][cells[j][0]]) j++;
    if (i > 0 && j < cells.length && j - i <= 10) fords.push(cells[(i + j) >> 1]);
    i = j;
  }
}
const cellsOf = (pts: Pt[], keep: (x: number, y: number) => boolean) => {
  const out: Pt[] = [];
  supercover(pts, (x, y) => {
    if (!inMap(x, y) || !keep(x, y)) return;
    const last = out[out.length - 1];
    if (!last || last[0] !== x || last[1] !== y) out.push([x, y]);
  });
  return out;
};
for (const w of ways) {
  const t = w.tags ?? {};
  if (!/^(trunk|primary)$/.test(t.highway ?? '') || t.tunnel === 'yes' || Number(t.layer ?? 0) < 0) continue;
  road(cellsOf(line(w.geometry!), (x, y) => !outside[y][x]), t.bridge !== undefined && t.bridge !== 'no');
}
for (const g of ringWays) road(cellsOf(line(g), () => true));

// ---- parks and woods: where the trees grow thick
const greenCover = cover(areas((t) => t.leisure === 'park' || /^(forest|cemetery|allotments|meadow)$/.test(t.landuse ?? '') || t.natural === 'wood').map((a) => a.poly));
const green = grid(false);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) green[y][x] = greenCover[y][x] >= 0.5;

// ---- laying out the garden
const hash = (x: number, y: number, s: number) => {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const deg = (lat: number, lon: number): Pt => { const [x, y] = project(lat, lon); return [Math.floor(x), Math.floor(y)]; };

const T = grid('.');
const E = grid(0);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  if (x === 0 || y === 0 || x === W - 1 || y === H - 1) T[y][x] = 'F';
  else if (water[y][x]) T[y][x] = running[y][x] ? '~' : 'w';
  else if (path[y][x]) T[y][x] = 'p';
}
const at = (x: number, y: number) => (inMap(x, y) ? T[y][x] : 'F');
const open = (x: number, y: number) => at(x, y) === '.';
/** No water, path, bridge or fence within r tiles. */
const clear = (x: number, y: number, r: number) => {
  for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) if ('~wBpFl'.includes(at(x + i, y + j))) return false;
  return true;
};
const nearest = (from: Pt, fits: (x: number, y: number) => boolean, max = 30): Pt | null => {
  for (let r = 0; r <= max; r++)
    for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++)
      if (Math.max(Math.abs(i), Math.abs(j)) === r && fits(from[0] + i, from[1] + j)) return [from[0] + i, from[1] + j];
  return null;
};
const fillRect = (x0: number, y0: number, w: number, h: number, ch: string) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) T[y][x] = ch; };
const rectFree = (x0: number, y0: number, w: number, h: number, margin: number) => {
  for (let y = y0 - margin; y < y0 + h + margin; y++) for (let x = x0 - margin; x < x0 + w + margin; x++) if (!open(x, y)) return false;
  return true;
};

// ---- tidying up: the raw OSM layout as tiles has specks of water, slivers of
// land and bridges that zigzag or lead nowhere. Clean it before laying out the garden.
{
  const SIDES4: Pt[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const wet = (x: number, y: number) => '~wB'.includes(at(x, y));
  const edge = (x: number, y: number) => x <= 1 || y <= 1 || x >= W - 2 || y >= H - 2;
  /** The 4-connected pieces of the map where `inside` holds. */
  const pieces = (inside: (x: number, y: number) => boolean): Pt[][] => {
    const seen = grid(false), out: Pt[][] = [];
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      if (seen[y][x] || !inside(x, y)) continue;
      const all: Pt[] = [], q: Pt[] = [[x, y]];
      seen[y][x] = true;
      while (q.length) {
        const [cx, cy] = q.pop()!;
        all.push([cx, cy]);
        for (const [dx, dy] of SIDES4) {
          const nx = cx + dx, ny = cy + dy;
          if (inMap(nx, ny) && !seen[ny][nx] && inside(nx, ny)) { seen[ny][nx] = true; q.push([nx, ny]); }
        }
      }
      out.push(all);
    }
    return out;
  };
  /** What water a tile becomes when it is given back to the river. */
  /** Water flows under a bridge running along (ax, ay): on both sides of every tile of it. */
  // (a bridge one tile long is fine with land at both ends: a canal turning a corner)
  // And it crosses the water the short way: the water runs on further under it than the bridge is long.
  const across = (tiles: Pt[], ax: number, ay: number) => {
    if (tiles.length === 1) return true;
    if (!tiles.every(([x, y]) => wet(x + ay, y + ax) && wet(x - ay, y - ax))) return false;
    const [mx, my] = tiles[tiles.length >> 1];
    let run = 1;
    for (const d of [1, -1]) for (let k = 1; k <= tiles.length && wet(mx + ay * d * k, my + ax * d * k); k++) run++;
    return run > tiles.length;
  };
  const waterAt = (x: number, y: number) => (running[y][x] || SIDES4.some(([dx, dy]) => at(x + dx, y + dy) === '~') ? '~' : 'w');

  // 1. specks and notches: still water with land on three sides is land, a spit of land
  // with water on three sides is water, and a river's dead end (away from the edge) dries up
  for (let pass = 0; pass < 3; pass++)
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const n = SIDES4.filter(([dx, dy]) => wet(x + dx, y + dy)).length;
      const ch = T[y][x];
      if (ch === 'w' && n <= 1) T[y][x] = '.';
      else if (ch === '~' && n <= 1 && !edge(x, y)) T[y][x] = '.';
      else if ((ch === '.' || ch === 'p') && n >= 3 && !edge(x, y)) T[y][x] = waterAt(x, y);
    }
  // ponds smaller than a few tiles are lawn; islands smaller than a few tiles go under
  for (const p of pieces((x, y) => at(x, y) === 'w')) if (p.length < 8) for (const [x, y] of p) T[y][x] = '.';
  for (const p of pieces((x, y) => !wet(x, y) && at(x, y) !== 'F'))
    if (p.length < 10 && !p.some(([x, y]) => edge(x, y))) for (const [x, y] of p) T[y][x] = waterAt(x, y);

  // 2. bridges: the shortest straight crossing near where each road crossed, from land to land
  const laid: Pt[] = [];
  for (const [cx, cy] of fords) {
    // (two roads crossing at the same place: one bridge is enough)
    if (laid.some(([lx, ly]) => Math.abs(lx - cx) + Math.abs(ly - cy) < 4)) continue;
    let best: { tiles: Pt[]; ends: [Pt, Pt]; score: number } | null = null;
    for (const [ax, ay] of [[0, 1], [1, 0]] as Pt[])
      for (let off = -3; off <= 3; off++) {
        // the line across, through the old bridge's middle shifted sideways
        const ox = cx + ay * off, oy = cy + ax * off;
        if (!wet(ox, oy)) continue;
        let s = 0, e = 0;
        while (s < 7 && wet(ox - ax * (s + 1), oy - ay * (s + 1))) s++;
        while (e < 7 && wet(ox + ax * (e + 1), oy + ay * (e + 1))) e++;
        const len = s + e + 1;
        const a: Pt = [ox - ax * (s + 1), oy - ay * (s + 1)], z: Pt = [ox + ax * (e + 1), oy + ay * (e + 1)];
        if (len > 5 || at(...a) === 'F' || at(...z) === 'F' || wet(...a) || wet(...z)) continue;
        const span: Pt[] = [];
        for (let i = -s; i <= e; i++) span.push([ox + ax * i, oy + ay * i]);
        if (!across(span, ax, ay)) continue;
        // land on both ends, and the banks either side of the bridge too (no bridge along a river)
        const score = len + Math.abs(off) * 0.7 + (at(...a) === 'p' ? 0 : 0.5) + (at(...z) === 'p' ? 0 : 0.5);
        if (!best || score < best.score) {
          const tiles: Pt[] = [];
          for (let i = -s; i <= e; i++) tiles.push([ox + ax * i, oy + ay * i]);
          best = { tiles, ends: [a, z], score };
        }
      }
    if (!best) continue;
    for (const [x, y] of best.tiles) T[y][x] = 'B';
    laid.push([cx, cy]);
    // each end joins the nearest path on its bank (walking on land, a few tiles at most)
    for (const end of best.ends) {
      const from = new Map<number, number>([[end[1] * W + end[0], -1]]);
      const q: Pt[] = [end];
      let found = -1;
      for (let i = 0; i < q.length && found < 0; i++) {
        const [x, y] = q[i];
        if (at(x, y) === 'p' && i > 0) { found = y * W + x; break; }
        for (const [dx, dy] of SIDES4) {
          const nx = x + dx, ny = y + dy, k = ny * W + nx;
          if (from.has(k) || wet(nx, ny) || at(nx, ny) === 'F' || Math.abs(nx - end[0]) + Math.abs(ny - end[1]) > 8) continue;
          from.set(k, y * W + x);
          q.push([nx, ny]);
        }
      }
      T[end[1]][end[0]] = 'p';
      for (let k = found; k >= 0; k = from.get(k)!) T[Math.floor(k / W)][k % W] = 'p';
    }
  }

  // a road that stops dead at the water carries on over it, if the other bank is close
  for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
    if (at(x, y) !== 'p' || SIDES4.filter(([dx, dy]) => 'pB'.includes(at(x + dx, y + dy))).length !== 1) continue;
    if (laid.some(([lx, ly]) => Math.abs(lx - x) + Math.abs(ly - y) < 4)) continue;
    for (const [dx, dy] of SIDES4) {
      let k = 1;
      while (k <= 5 && '~w'.includes(at(x + dx * k, y + dy * k))) k++;
      const ex = x + dx * k, ey = y + dy * k;
      if (k === 1 || k > 5 || wet(ex, ey) || at(ex, ey) === 'F') continue;
      if (!across(Array.from({ length: k - 1 }, (_, i) => [x + dx * (i + 1), y + dy * (i + 1)] as Pt), Math.abs(dx), Math.abs(dy))) continue;
      for (let i = 1; i < k; i++) T[y + dy * i][x + dx * i] = 'B';
      T[ey][ex] = 'p';
      laid.push([x, y]);
      break;
    }
  }

  // 3. path crumbs: bits of path cut off on their own, a few tiles long, are lawn
  for (const p of pieces((x, y) => at(x, y) === 'p' || at(x, y) === 'B'))
    if (p.length < 5) for (const [x, y] of p) T[y][x] = at(x, y) === 'B' ? waterAt(x, y) : '.';
  console.log(`${laid.length} bridges for ${fords.length} crossings`);
}

// garden ponds (with lily pads) in the parks: Viktoriapark, Weinbergspark, Görlitzer Park
for (const [lat, lon, w, h] of [[52.4875, 13.381, 5, 3], [52.5329, 13.4, 4, 3], [52.4965, 13.4375, 5, 4]] as const) {
  const spot = nearest(deg(lat, lon), (x, y) => rectFree(x, y, w, h, 2));
  if (!spot) continue;
  const [px, py] = spot;
  for (let y = py; y < py + h; y++) for (let x = px; x < px + w; x++) {
    const corner = (x === px || x === px + w - 1) && (y === py || y === py + h - 1);
    if (!corner || h < 4) T[y][x] = hash(x, y, 31) < 0.18 ? 'l' : 'w';
  }
}
// lily pads on the lakes too
for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++)
  if (T[y][x] === 'w' && T[y - 1][x] === 'w' && T[y + 1][x] === 'w' && T[y][x - 1] === 'w' && T[y][x + 1] === 'w' && hash(x, y, 32) < 0.12) T[y][x] = 'l';

// the landmarks: each at the nearest free spot to where it really is
const spots: { kind: LandmarkKind; tx: number; ty: number }[] = [];
for (const kind of Object.keys(LANDMARKS) as LandmarkKind[]) {
  const { lat, lon } = LANDMARKS[kind];
  const [w, h] = LANDMARK_SIZE[kind];
  const [cx, cy] = deg(lat, lon);
  // the Brandenburger Tor stands across Unter den Linden: the path runs on through its arches
  const across = kind === 'gate';
  const fits = across
    ? (x: number, y: number) => [0, 1, 2, 3].every((i) => at(x + i, y) === 'p') && [-1, 4].every((i) => at(x + i, y) === 'p')
    : (x: number, y: number) => rectFree(x, y, w, h, 0);
  const spot = nearest([cx - Math.floor(w / 2), cy - Math.floor(h / 2)], fits, 12);
  if (!spot) { console.warn(`no room for ${kind}`); continue; }
  spots.push({ kind, tx: spot[0], ty: spot[1] });
  if (!across) fillRect(spot[0], spot[1], w, h, 'L');
}

// the terraces: raised ground away from the roads and the water, with stairs up from the south
const terraces: { x: number; y: number; rx: number; ry: number }[] = [];
for (let k = 0; k < 400 && terraces.length < 7; k++) {
  const x = 6 + Math.floor(hash(k, 1, 51) * (W - 12)), y = 6 + Math.floor(hash(k, 2, 51) * (H - 12));
  let d = 0;
  while (d < 9 && clear(x, y, d + 1) && ![...'mLHo'].some(() => false)) d++;
  if (d < 5 || terraces.some((t) => Math.abs(t.x - x) < t.rx + 10 && Math.abs(t.y - y) < t.ry + 8)) continue;
  const rx = Math.min(d - 1, 4 + Math.floor(hash(k, 3, 51) * 4)), ry = Math.max(3, Math.round(rx * 0.7));
  // nothing placed there already (maze, landmarks, the tree house, ponds)
  let free = true;
  for (let j = -ry - 1; j <= ry + 1; j++) for (let i = -rx - 1; i <= rx + 1; i++) if ('mLHofwl'.includes(at(x + i, y + j))) free = false;
  if (!free) continue;
  terraces.push({ x, y, rx, ry });
  for (let j = -ry; j <= ry; j++) for (let i = -rx; i <= rx; i++) {
    const e = (i / (rx + 0.5)) ** 2 + (j / (ry + 0.5)) ** 2;
    if (e <= 1) E[y + j][x + i] = rx >= 6 && e <= 0.35 ? 2 : 1;
  }
}
/** Stairs up onto every rise: below its south edge, a couple per terrace. */
for (const t of terraces) {
  for (const level of [1, 2]) {
    const cols: number[] = [];
    for (let x = t.x - t.rx; x <= t.x + t.rx; x++) {
      let y = t.y + t.ry + 1;
      while (y > t.y && E[y - 1][x] < level) y--;
      if (y <= t.y || E[y - 1][x] !== level || E[y][x] !== level - 1 || E[y][x] !== E[y][x - 1] || E[y][x] !== E[y][x + 1]) continue;
      cols.push(x);
    }
    if (!cols.length) continue;
    const picks = level === 1 && cols.length > 4 ? [cols[Math.floor(cols.length * 0.25)], cols[Math.floor(cols.length * 0.75)]] : [cols[Math.floor(cols.length / 2)]];
    for (const x of picks) {
      let y = t.y + t.ry + 1;
      while (y > t.y && E[y - 1][x] < level) y--;
      T[y][x] = 'S';
      // a clear way to the foot of the stairs
      if (!'.,f'.includes(at(x, y + 1)) && at(x, y + 1) !== 'p') T[y + 1][x] = '.';
    }
  }
}

// every bit of ground reachable: an island with no bridge gets one across the narrowest water
for (let pass = 0; pass < 40; pass++) {
  const walk = (x: number, y: number) => inMap(x, y) && !'~wlFmTPHbrLo'.includes(T[y][x]);
  const comp = grid(-1);
  let n = 0;
  const sizes: number[] = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (comp[y][x] >= 0 || !walk(x, y)) continue;
    const q: Pt[] = [[x, y]];
    comp[y][x] = n;
    let size = 0;
    while (q.length) {
      const [cx, cy] = q.pop()!;
      size++;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (walk(nx, ny) && comp[ny][nx] < 0 && Math.abs(E[ny][nx] - E[cy][cx]) <= 1) { comp[ny][nx] = n; q.push([nx, ny]); }
      }
    }
    sizes.push(size);
    n++;
  }
  if (n <= 1) break;
  const main = sizes.indexOf(Math.max(...sizes));
  // the smallest other piece: bridge it to any other piece across 1-3 tiles of water, or give up on it (make it meadow-free lawn)
  const small = sizes.map((s, i) => [s, i]).filter(([, i]) => i !== main).sort((a, b) => a[0] - b[0])[0][1];
  let done = false;
  for (let y = 1; y < H - 1 && !done; y++) for (let x = 1; x < W - 1 && !done; x++) {
    if (comp[y][x] !== small) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      let k = 1;
      while (k <= 3 && '~wl'.includes(at(x + dx * k, y + dy * k))) k++;
      const ex = x + dx * k, ey = y + dy * k;
      if (k > 1 && inMap(ex, ey) && comp[ey][ex] >= 0 && comp[ey][ex] !== small && E[ey][ex] === E[y][x]) {
        for (let i = 1; i < k; i++) T[y + dy * i][x + dx * i] = 'B';
        done = true;
        break;
      }
    }
  }
  if (!done) {
    // no water to bridge: it is walled in by something; open it up by clearing trees and bushes around it
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++)
      if (comp[y][x] === small) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if ('TPbr'.includes(at(x + dx, y + dy))) T[y + dy][x + dx] = '.';
  }
}

// landmark footprints are lawn underneath
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (T[y][x] === 'L') T[y][x] = '.';

// ---- which way the rivers run: OSM draws a waterway in the direction it flows,
// so chain the pieces of each one end to end and keep the stretches over open water
const RIVERS: Pt[][] = [];
{
  const k = (p: { lat: number; lon: number }) => `${p.lat},${p.lon}`;
  const pieces = ways.filter((w) => {
    const t = w.tags ?? {};
    return (t.waterway === 'river' || t.waterway === 'canal') && t.tunnel !== 'yes' && t.tunnel !== 'culvert';
  }).map((w) => w.geometry!);
  const starting = new Map<string, number[]>();
  pieces.forEach((g, i) => starting.set(k(g[0]), [...(starting.get(k(g[0])) ?? []), i]));
  const ends = new Set(pieces.map((g) => k(g[g.length - 1])));
  const used = new Set<number>();
  // start from pieces nothing flows into, then whatever is left (loops)
  const order = [...pieces.keys()].sort((a, b) => Number(ends.has(k(pieces[a][0]))) - Number(ends.has(k(pieces[b][0]))));
  for (const first of order) {
    if (used.has(first)) continue;
    const chain = [...pieces[first]];
    used.add(first);
    for (;;) {
      const next = (starting.get(k(chain[chain.length - 1])) ?? []).find((i) => !used.has(i));
      if (next === undefined) break;
      used.add(next);
      chain.push(...pieces[next].slice(1));
    }
    // in tiles, a point every half tile, split where the water ends
    const pts = line(chain);
    let run: Pt[] = [];
    const flush = () => { if (run.length >= 6) RIVERS.push(run); run = []; };
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * 2));
      for (let j = 0; j < n; j++) {
        const x = ax + ((bx - ax) * j) / n, y = ay + ((by - ay) * j) / n;
        if ('~B'.includes(at(Math.floor(x), Math.floor(y)))) run.push([x, y]);
        else flush();
      }
    }
    flush();
  }
}
/** True if the straight line between two world px points stays on the water. */
function wet(a: Pt, b: Pt): boolean {
  const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2);
  for (let j = 0; j <= n; j++)
    if (!'~B'.includes(at(Math.floor((a[0] + ((b[0] - a[0]) * j) / n) / 16), Math.floor((a[1] + ((b[1] - a[1]) * j) / n) / 16)))) return false;
  return true;
}
/** A river as world px, thinned to a point where it turns (or every few tiles). */
function riverPx(run: Pt[]): number[] {
  const px = run.map(([x, y]) => [Math.round(x * 16), Math.round(y * 16)] as Pt);
  const keep: Pt[] = [px[0]];
  for (let i = 1; i < px.length - 1; i++) {
    const a = keep[keep.length - 1], b = px[i + 1];
    // drop a point that lies (nearly) on the line from the last kept one to the next
    const far = Math.abs((b[0] - a[0]) * (px[i][1] - a[1]) - (b[1] - a[1]) * (px[i][0] - a[0])) / (Math.hypot(b[0] - a[0], b[1] - a[1]) || 1);
    if (far > 1.5 || Math.hypot(px[i][0] - a[0], px[i][1] - a[1]) > 64 || !wet(a, b)) keep.push(px[i]);
  }
  keep.push(px[px.length - 1]);
  return keep.flat();
}

const ROWS = T.map((r) => r.join(''));
const ELEV = E.map((r) => r.join(''));
const ZONES = T.map((r, y) => r.map((_, x) => (outside[y][x] ? 'o' : green[y][x] ? 'g' : '.')).join(''));
png(ROWS, ELEV, `${here}cache/garden.png`);

// where cats arrive: along the paths round the Brandenburger Tor
const [sx, sy] = deg(52.5163, 13.3777);
const SPAWN = { x0: sx - 8, y0: sy - 6, x1: sx + 8, y1: sy + 6 };

const out = `// The fixed part of the park: Berlin inside the S-Bahn Ring, as a garden.
// GENERATED by tools/berlin/generate.ts from OpenStreetMap (map data ©
// OpenStreetMap contributors, ODbL): edit the generator and run it again
// rather than this file.
//
//  - BASE is the park seen from above, one character per 16x16 tile (about
//    ${Math.round(111200 / scale)} m of the real city): the water, the paths and bridges, the
//    stairs and the fence. What each character means is in legend.ts. Its open
//    ground ('.') is filled in for each garden from the garden's seed
//    (layout.ts): grass, flower beds, trees, hedges, the maze, the furniture.
//  - ZONES says what the real city is like there: 'g' parks and woods, 'o'
//    outside the Ring, '.' the town (trees grow thickest in the first two).
//  - ELEV gives every tile its terrain level (0 = lawn, each level is 16px up).
//  - LANDMARK_SPOTS places the follies of famous places (world/landmarks.ts).
//  - RIVERS are the lines the running water ('~') flows along.
//  - SPAWN is where cats arrive: the paths in this box.
// \`npm test\` checks the result for a good few seeds: everything walkable
// reachable from the spawn, furniture on lawn, lanterns apart, and so on.

import type { LandmarkKind } from './landmarks.ts';

export const BASE = [
${ROWS.map((r) => `  '${r}',`).join('\n')}
];

/** Terrain level per tile (0 = lawn). Stairs sit on the lower level and climb to the next. */
export const ELEV = [
${ELEV.map((r) => `  '${r}',`).join('\n')}
];

/** What the real city is like on each tile: 'g' parks and woods, 'o' outside the Ring, '.' the town. */
export const ZONES = [
${ZONES.map((r) => `  '${r}',`).join('\n')}
];

/** The landmark follies, by their top-left tile. */
export const LANDMARK_SPOTS: { kind: LandmarkKind; tx: number; ty: number }[] = [
${spots.map((f) => `  { kind: '${f.kind}', tx: ${f.tx}, ty: ${f.ty} },`).join('\n')}
];

/** The Spree and the canals, the way they flow: world px, x, y, x, y, ... */
export const RIVERS: number[][] = [
${RIVERS.map((r) => `  [${riverPx(r).join(', ')}],`).join('\n')}
];

/** Cats arrive on the paths in this box of tiles. */
export const SPAWN = { x0: ${SPAWN.x0}, y0: ${SPAWN.y0}, x1: ${SPAWN.x1}, y1: ${SPAWN.y1} };
`;
writeFileSync(`${here}../../src/world/garden.ts`, out);

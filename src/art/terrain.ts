// Raised ground. Each row of a plateau is cut out of the ground raster and
// drawn shifted up by its height, with an earthy cliff face hanging below
// wherever the ground in front is lower. Stairs bridge one level on south faces.
import { Raster, hex, hash2, type RGB } from './raster.ts';
import { LAWN, applySeason, buildGroundRegion } from './tiles.ts';
import { dab } from './paint.ts';
import { LEVEL, MAP_H, MAP_W, TILE, levelAt, tileAt } from '../world/map.ts';
import { isStairs } from '../world/legend.ts';

const K = { lip: LAWN[0], lip2: LAWN[2], k0: hex('#d4b48a'), k1: hex('#b08a64'), k2: hex('#86644c'), k3: hex('#55403a'), k4: hex('#33242a') };
const S = { s0: hex('#e0dcd0'), s1: hex('#bcb6ac'), s2: hex('#8e8884'), s3: hex('#504a50'), moss: hex('#6a9448') };
const RIM = LAWN[6], EDGE = LAWN[0];

export interface TerrainPiece {
  raster: Raster;
  x: number;
  y: number;
  /** Depth for sorting against cats and props (ground-plane y of the row). */
  depth: number;
  /** Terrain level of its top (stairs count as the level they lead up to). */
  level: number;
  /** Stairs rather than a plateau row. */
  stairs: boolean;
}

const isStair = (tx: number, ty: number) => isStairs(tileAt(tx, ty));

/** A ground colour up on level e: higher ground catches a little more sun. */
export function raised(c: RGB, e: number): RGB {
  const lift = 1 + 0.07 * e;
  return [c[0] * lift + 4 * e, c[1] * lift, c[2] * (1 + 0.02 * e)];
}
/** The level a tile shows its top at (stairs reach the next level). */
const topLevel = (tx: number, ty: number) => levelAt(tx, ty) + (isStair(tx, ty) ? 1 : 0);

/** A dry-stone retaining wall, `h` px tall, for the column of tile tx. World coords keep the courses continuous. */
function face(r: Raster, ox: number, oy: number, h: number, tx: number, ty: number, leftOpen: boolean, rightOpen: boolean): void {
  const CW = 8, CH = 6;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < TILE; x++) {
      const wx = tx * TILE + x;
      // staggered courses of blocks, each lit from the top-left
      const row = Math.floor((y + 2) / CH);
      const sx = wx + (row % 2) * 4 + Math.floor(hash2(row, ty, 36) * 3);
      const u = ((sx % CW) + CW) % CW, v = (y + 2) % CH;
      const cell = hash2(Math.floor(sx / CW), row * 97 + ty, 37);
      let c = cell < 0.3 ? K.k0 : K.k1;
      if (u === 0 || v === 0) c = K.k3;
      else if (u === 1 || v === 1) c = cell < 0.3 ? S.s0 : K.k0;
      else if (u === CW - 1 || v === CH - 1) c = K.k2;
      // (weathered in dabs)
      const w = dab(wx, ty * 1000 + y, 38);
      if (c !== K.k3 && w < -0.3) c = K.k2;
      else if (c === K.k1 && w > 0.32) c = K.k0;
      // deeper shade towards the foot, dithered
      const down = y / h;
      if (down > 0.6 && dab(wx, y, 41) + 0.5 < (down - 0.6) * 1.5 && c !== K.k3) c = c === K.k0 || c === S.s0 ? K.k1 : K.k2;
      if (y === h - 1) c = K.k4;
      // corners where the wall turns
      if (leftOpen && x === 0) c = K.k4;
      if (rightOpen && x === TILE - 1) c = K.k4;
      else if (rightOpen && x === TILE - 2 && c !== K.k3) c = K.k2;
      r.set(ox + x, oy + y, c);
    }
  // grass tumbling over the top, a little moss in the joints
  for (let x = 0; x < TILE; x++) {
    const drop = 1 + Math.floor(hash2(tx * TILE + x, ty, 33) * 3);
    for (let k = 0; k < drop; k++) r.set(ox + x, oy + k, k === drop - 1 ? K.lip : K.lip2);
    if (hash2(tx * TILE + x, ty, 39) < 0.12) r.set(ox + x, oy + drop + 2 + Math.floor(hash2(x, ty, 40) * (h - 6)), S.moss);
  }
}

/** Stone stairs, one tile wide and two tall: from the top of a level down to the ground in front. */
function stairs(r: Raster, tx: number, ty: number): void {
  const h = TILE * 2;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < TILE; x++) {
      const step = y % 8;
      let c = step < 3 ? S.s0 : step === 7 ? S.s3 : step > 4 ? S.s2 : S.s1;
      if (step === 0) c = S.s1;
      if (hash2(tx * TILE + x, ty * 64 + y, 34) < 0.08 && step >= 3) c = S.s2;
      const stairL = !isStair(tx - 1, ty), stairR = !isStair(tx + 1, ty);
      if (stairL && x < 2) c = x === 0 ? S.s3 : S.s2;
      if (stairR && x > TILE - 3) c = x === TILE - 1 ? S.s3 : S.s2;
      if ((stairL && x === 2) || (stairR && x === TILE - 3)) if (hash2(x, ty * 64 + y, 35) < 0.3) c = S.moss;
      r.set(x, y, c);
    }
}

export function buildTerrain(): TerrainPiece[] {
  const out: TerrainPiece[] = [];
  for (let ty = 0; ty < MAP_H; ty++) {
    const levels = new Set<number>();
    for (let tx = 0; tx < MAP_W; tx++) if (levelAt(tx, ty) > 0 && !isStair(tx, ty)) levels.add(levelAt(tx, ty));
    for (const e of levels) {
      const cols: number[] = [];
      for (let tx = 0; tx < MAP_W; tx++) if (levelAt(tx, ty) === e && !isStair(tx, ty)) cols.push(tx);
      const x0 = cols[0], x1 = cols[cols.length - 1];
      const faceH = (tx: number) => Math.max(0, e - topLevel(tx, ty + 1) + (isStair(tx, ty + 1) ? 1 : 0)) * LEVEL;
      const maxFace = Math.max(...cols.map(faceH));
      const r = new Raster((x1 - x0 + 1) * TILE, TILE + maxFace);
      const on = new Set(cols);
      // the ground of the row under the plateau, to lift up
      const ground = buildGroundRegion(x0, ty, x1 - x0 + 1, 1, 0);
      for (const tx of cols) {
        const ox = (tx - x0) * TILE;
        // the top: this tile's ground art, lifted up
        for (let y = 0; y < TILE; y++)
          for (let x = 0; x < TILE; x++) {
            const i = (y * ground.w + (tx - x0) * TILE + x) * 4;
            r.set(ox + x, y, raised([ground.data[i], ground.data[i + 1], ground.data[i + 2]], e));
          }
        // rims: a sunlit lip on the far edge, darker grass where it drops to the sides
        if (levelAt(tx, ty - 1) < e) for (let x = 0; x < TILE; x++) r.set(ox + x, 0, RIM);
        if (topLevel(tx - 1, ty) < e) for (let y = 0; y < TILE; y++) { r.set(ox, y, EDGE); if (hash2(tx, y, 42) < 0.5) r.set(ox + 1, y, EDGE); }
        if (topLevel(tx + 1, ty) < e) for (let y = 0; y < TILE; y++) { r.set(ox + TILE - 1, y, EDGE); r.set(ox + TILE - 2, y, EDGE); }
        const fh = faceH(tx);
        if (fh) {
          const openL = !on.has(tx - 1) || faceH(tx - 1) < fh, openR = !on.has(tx + 1) || faceH(tx + 1) < fh;
          face(r, ox, TILE, fh, tx, ty, openL, openR);
        }
      }
      // the grass lips and moss on the walls follow the season (the tops already do, from the ground)
      applySeason(r, x0 * TILE, ty * TILE - e * LEVEL);
      out.push({ raster: r, x: x0 * TILE, y: ty * TILE - e * LEVEL, depth: ty * TILE, level: e, stairs: false });
    }
    for (let tx = 0; tx < MAP_W; tx++)
      if (isStair(tx, ty)) {
        const L = levelAt(tx, ty);
        const r = new Raster(TILE, TILE * 2);
        stairs(r, tx, ty);
        out.push({ raster: r, x: tx * TILE, y: (ty - 1 - L) * TILE, depth: ty * TILE - 0.5, level: L + 1, stairs: true });
      }
  }
  return out;
}

import Phaser from 'phaser';
import { SUNLIT_TILES, groundTile } from '../art/tiles.ts';
import { relightProp } from '../art/trees.ts';
import { raised, type TerrainPiece } from '../art/terrain.ts';
import { screenLight, sunLight, type ScreenLight } from '../art/lighting.ts';
import { LEVEL, MAP_H, MAP_W, TILE, levelAt, tileAt } from '../world/map.ts';
import type { Light } from '../world/sky.ts';
import type { Trees } from './Trees.ts';
import type { Ground } from './Ground.ts';

// Keeps the garden's modelled things lit from where the sun actually is: the
// tree crowns and trunks, and the bushes and rocks drawn into the ground (and
// into the raised terrain on the plateaus). They are re-shaded from their
// normals (art/lighting.ts) whenever the light has moved on a step, which
// happens a few times an hour.

/** Steps the light moves in before everything is re-shaded: degrees round the screen, and contrast. */
const TURN_STEP = 12, CONTRAST_STEP = 0.1;

export class Lighting {
  private readonly scene: Phaser.Scene;
  private readonly trees: Trees;
  private readonly terrain: TerrainPiece[];
  private readonly ground: Ground;
  /** The bushes and rocks. */
  private readonly tiles: [number, number][] = [];
  /** Those up on the plateaus, as the terrain pieces show them now (by y * MAP_W + x). */
  private readonly shown = new Map<number, Uint8ClampedArray>();
  private key = '';

  constructor(scene: Phaser.Scene, trees: Trees, terrain: TerrainPiece[], ground: Ground) {
    this.scene = scene;
    this.trees = trees;
    this.terrain = terrain;
    this.ground = ground;
    for (let ty = 0; ty < MAP_H; ty++)
      for (let tx = 0; tx < MAP_W; tx++) {
        if (!SUNLIT_TILES.has(tileAt(tx, ty))) continue;
        this.tiles.push([tx, ty]);
        if (levelAt(tx, ty)) this.shown.set(ty * MAP_W + tx, groundTile(tx, ty, 0).data);
      }
  }

  update(light: Light): void {
    const L = screenLight(light.sunDir, light.elevation, light.day);
    const turn = Math.round((Math.atan2(L.y, L.x) * 180) / Math.PI / TURN_STEP);
    const contrast = Math.round(L.k / CONTRAST_STEP);
    const key = `${turn},${contrast}`;
    if (key === this.key) return;
    this.key = key;
    const a = (turn * TURN_STEP * Math.PI) / 180;
    Object.assign(sunLight, { x: Math.cos(a), y: Math.sin(a), k: contrast * CONTRAST_STEP } satisfies ScreenLight);
    this.relightTrees();
    this.relightGround();
  }

  private relightTrees(): void {
    // (only those drawn now: the others are drawn in the light as it is when they come into view)
    this.trees.each((i, p) => {
      if (!p.lit) return;
      relightProp(p, sunLight);
      this.trees.relight(i);
    });
  }

  /** Redraw the bushes and rocks into the ground and the raised terrain. */
  private relightGround(): void {
    this.ground.redrawTiles(this.tiles);
    const pieces = new Set<number>();
    for (const [tx, ty] of this.tiles) {
      // up on a plateau the tile is shown from the terrain piece of its row: change the pixels that changed
      const e = levelAt(tx, ty);
      const before = this.shown.get(ty * MAP_W + tx);
      if (!e || !before) continue;
      const k = this.terrain.findIndex((t) => !t.stairs && t.level === e && t.y === ty * TILE - e * LEVEL && tx * TILE >= t.x && tx * TILE < t.x + t.raster.w);
      if (k < 0) continue;
      const piece = this.terrain[k].raster, ox = tx * TILE - this.terrain[k].x;
      const now = groundTile(tx, ty, 0).data, clamp = new Uint8ClampedArray(3);
      for (let y = 0; y < TILE; y++)
        for (let x = 0; x < TILE; x++) {
          const i = (y * TILE + x) * 4, j = (y * piece.w + ox + x) * 4;
          if (now[i] === before[i] && now[i + 1] === before[i + 1] && now[i + 2] === before[i + 2]) continue;
          // only where the piece still shows the ground as it was (not a rim drawn over it)
          clamp.set(raised([before[i], before[i + 1], before[i + 2]], e));
          if (piece.data[j] !== clamp[0] || piece.data[j + 1] !== clamp[1] || piece.data[j + 2] !== clamp[2]) continue;
          piece.set(ox + x, y, raised([now[i], now[i + 1], now[i + 2]], e));
        }
      this.shown.set(ty * MAP_W + tx, now);
      pieces.add(k);
    }
    for (const k of pieces) {
      const tex = this.scene.textures.get(`terrain-${k}`) as Phaser.Textures.CanvasTexture;
      const { raster } = this.terrain[k];
      tex.getContext().putImageData(new ImageData(raster.data, raster.w, raster.h), 0, 0);
      tex.refresh();
    }
  }
}

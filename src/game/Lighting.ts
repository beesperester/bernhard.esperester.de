import Phaser from 'phaser';
import { SUNLIT_TILES, groundTile } from '../art/tiles.ts';
import { relightProp, type Prop } from '../art/trees.ts';
import { raised, type TerrainPiece } from '../art/terrain.ts';
import { screenLight, sunLight, type ScreenLight } from '../art/lighting.ts';
import { LEVEL, MAP_H, MAP_W, TILE, levelAt, tileAt } from '../world/map.ts';
import type { Light } from '../world/sky.ts';
import type { Trees } from './Trees.ts';

// Keeps the garden's modelled things lit from where the sun actually is: the
// tree crowns and trunks, and the bushes and rocks drawn into the ground (and
// into the raised terrain on the plateaus). They are re-shaded from their
// normals (art/lighting.ts) whenever the light has moved on a step, which
// happens a few times an hour.

/** Steps the light moves in before everything is re-shaded: degrees round the screen, and contrast. */
const TURN_STEP = 12, CONTRAST_STEP = 0.1;

export class Lighting {
  private readonly scene: Phaser.Scene;
  private readonly props: { p: Prop; canvas: HTMLCanvasElement }[];
  private readonly trees: Trees;
  private readonly terrain: TerrainPiece[];
  /** The bushes and rocks. */
  private readonly tiles: [number, number][] = [];
  private key = '';

  constructor(scene: Phaser.Scene, props: { p: Prop; canvas: HTMLCanvasElement }[], trees: Trees, terrain: TerrainPiece[]) {
    this.scene = scene;
    this.props = props;
    this.trees = trees;
    this.terrain = terrain;
    for (let ty = 0; ty < MAP_H; ty++) for (let tx = 0; tx < MAP_W; tx++) if (SUNLIT_TILES.has(tileAt(tx, ty))) this.tiles.push([tx, ty]);
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
    this.props.forEach(({ p, canvas }, i) => {
      if (!p.lit) return;
      relightProp(p, sunLight);
      const img = new ImageData(p.raster.data, p.raster.w, p.raster.h);
      canvas.getContext('2d')!.putImageData(img, 0, 0);
      this.trees.relight(i, img);
    });
  }

  /** Redraw the bushes and rocks into the ground (both ripple phases) and the raised terrain. */
  private relightGround(): void {
    const ground = [0, 1].map((phase) => this.scene.textures.get(`ground-${phase}`) as Phaser.Textures.CanvasTexture);
    const pieces = new Set<number>();
    for (const [tx, ty] of this.tiles) {
      const ctx0 = ground[0].getContext();
      const before = ctx0.getImageData(tx * TILE, ty * TILE, TILE, TILE).data;
      const tiles = [0, 1].map((phase) => groundTile(tx, ty, phase));
      tiles.forEach((t, phase) => ground[phase].getContext().putImageData(new ImageData(t.data, TILE, TILE), tx * TILE, ty * TILE));
      // up on a plateau the tile is shown from the terrain piece of its row: change the pixels that changed
      const e = levelAt(tx, ty);
      if (!e) continue;
      const k = this.terrain.findIndex((t) => !t.stairs && t.level === e && t.y === ty * TILE - e * LEVEL && tx * TILE >= t.x && tx * TILE < t.x + t.raster.w);
      if (k < 0) continue;
      const piece = this.terrain[k].raster, ox = tx * TILE - this.terrain[k].x;
      const now = tiles[0].data, clamp = new Uint8ClampedArray(3);
      for (let y = 0; y < TILE; y++)
        for (let x = 0; x < TILE; x++) {
          const i = (y * TILE + x) * 4, j = (y * piece.w + ox + x) * 4;
          if (now[i] === before[i] && now[i + 1] === before[i + 1] && now[i + 2] === before[i + 2]) continue;
          // only where the piece still shows the ground as it was (not a rim drawn over it)
          clamp.set(raised([before[i], before[i + 1], before[i + 2]], e));
          if (piece.data[j] !== clamp[0] || piece.data[j + 1] !== clamp[1] || piece.data[j + 2] !== clamp[2]) continue;
          piece.set(ox + x, y, raised([now[i], now[i + 1], now[i + 2]], e));
        }
      pieces.add(k);
    }
    for (const g of ground) g.refresh();
    for (const k of pieces) {
      const tex = this.scene.textures.get(`terrain-${k}`) as Phaser.Textures.CanvasTexture;
      const { raster } = this.terrain[k];
      tex.getContext().putImageData(new ImageData(raster.data, raster.w, raster.h), 0, 0);
      tex.refresh();
    }
  }
}

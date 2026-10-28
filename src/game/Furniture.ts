import Phaser from 'phaser';
import type { Raster } from '../art/raster.ts';
import { buildBasket, buildBench, buildBirdBath, buildBistroTable, buildBlanket, buildChair, buildPicnicTable, dressForSeason } from '../art/furniture.ts';
import { FURNITURE, TILE } from '../world/map.ts';
import { cullerFor } from './Culler.ts';

/** Blankets lie flat on the grass, under everything that stands. */
const FLAT = -99994;

/**
 * The garden furniture. Each piece is sorted by the back edge of what it
 * stands on, so a cat that jumps up onto a bench or table is drawn on top of
 * it.
 */
export class Furniture {
  /** Every upright piece, for sunlit rims and shadows. */
  readonly pieces: { p: { x: number; y: number; depthY: number }; canvas: HTMLCanvasElement }[] = [];

  constructor(scene: Phaser.Scene, toCanvas: (r: Raster) => HTMLCanvasElement) {
    const art = new Map<string, HTMLCanvasElement>();
    const sprite = (key: string, build: () => Raster, x: number, y: number, depth: number, flip = false) => {
      let canvas = art.get(key);
      if (!canvas) {
        const r = build();
        dressForSeason(r, key);
        art.set(key, (canvas = toCanvas(r)));
        scene.textures.addCanvas(`furniture-${key}`, canvas);
      }
      cullerFor(scene).add(scene.add.image(x, y, `furniture-${key}`).setOrigin(0).setDepth(depth).setFlipX(flip));
      if (depth !== FLAT) this.pieces.push({ p: { x, y, depthY: depth }, canvas: flip ? mirrored(canvas) : canvas });
    };
    for (const f of FURNITURE) {
      const ox = f.tx * TILE, oy = f.ty * TILE;
      switch (f.kind) {
        case 'bench': sprite('bench', buildBench, ox + 1, oy - 3, oy + 8); break;
        case 'picnic': sprite('picnic', buildPicnicTable, ox + 11, oy + 9, oy + 16); break;
        case 'bistro':
          sprite('bistro', buildBistroTable, ox + 17, oy + 7, oy + 14);
          sprite('chair', buildChair, ox + 5, oy + 6, oy + 15);
          sprite('chair', buildChair, ox + 33, oy + 6, oy + 15, true);
          break;
        case 'birdbath': sprite('birdbath', buildBirdBath, ox, oy - 5, oy + 7); break;
        case 'blanket':
          sprite('blanket', buildBlanket, ox + 11, oy + 12, FLAT);
          sprite('basket', buildBasket, ox + 38, oy + 19, oy + 26);
          break;
      }
    }
  }
}

function mirrored(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const g = c.getContext('2d')!;
  g.translate(src.width, 0);
  g.scale(-1, 1);
  g.drawImage(src, 0, 0);
  return c;
}

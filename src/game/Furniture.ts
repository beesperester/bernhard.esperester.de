import Phaser from 'phaser';
import type { Raster } from '../art/raster.ts';
import {
  buildBarrow, buildBasket, buildBench, buildBirdBath, buildBistroTable, buildBlanket, buildBox, buildCatnip, buildChair, buildInsectHotel,
  buildPicnicTable, buildPump, buildPumpPuddle, buildRaisedBed, dressForSeason,
} from '../art/furniture.ts';
import { FURNITURE, TILE } from '../world/map.ts';
import { SEASON } from '../world/season.ts';
import { Act } from './state.ts';
import type { CatView } from './CatView.ts';
import type { Effects } from './fauna/Effects.ts';
import { cullerFor } from './Culler.ts';

/** Blankets lie flat on the grass, under everything that stands. */
const FLAT = -99994;
/** The pump drips about this often (ms). */
const DRIP_MS = 1700;
/** Where the spout drips from, relative to the pump's top-left tile, and how high it is. */
export const SPOUT = { x: 15, y: 13, z: 13 };
/** The middle of the puddle under it, relative to the same. */
export const PUDDLE = { x: 17, y: 13 };

/**
 * The garden furniture. Each piece is sorted by the back edge of what it
 * stands on, so a cat that jumps up onto a bench or table is drawn on top of
 * it.
 */
export class Furniture {
  /** Every upright piece, for sunlit rims and shadows. */
  readonly pieces: { p: { x: number; y: number; depthY: number }; canvas: HTMLCanvasElement }[] = [];
  /** The pumps' spouts, in world px. */
  private readonly spouts: { x: number; y: number; next: number }[] = [];
  /** The last paw swipe each cat was seen to make (by when it started). */
  private readonly swiped = new WeakMap<CatView, number>();

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
        // the box's inside behind a cat sitting in it, its front over the cat
        case 'box':
          sprite('box-back', () => buildBox('back'), ox + 3, oy - 10, oy + 3);
          sprite('box-front', () => buildBox('front'), ox + 3, oy - 10, oy + 13.5);
          break;
        case 'pump':
          sprite('puddle', buildPumpPuddle, ox + PUDDLE.x - 9, oy + PUDDLE.y - 3, FLAT);
          sprite('pump', buildPump, ox, oy - 20, oy + 13);
          this.spouts.push({ x: ox + SPOUT.x, y: oy + SPOUT.y, next: 0 });
          break;
        case 'catnip': sprite('catnip', buildCatnip, ox, oy - 8, oy + 12); break;
        case 'bed': sprite('bed', buildRaisedBed, ox, oy - 4, oy + 6); break;
        case 'barrow': sprite('barrow', buildBarrow, ox - 1, oy - 5, oy + 5); break;
        case 'hotel': sprite('hotel', buildInsectHotel, ox, oy - 16, oy + 13); break;
      }
    }
  }

  /** The pumps drip into their puddles (not while it's freezing), and splash when a cat paws at one. */
  update(now: number, cats: CatView[], fx: Effects, view: Phaser.Geom.Rectangle): void {
    for (const s of this.spouts) {
      if (s.x < view.x - 16 || s.x > view.right + 16 || s.y < view.y - 16 || s.y > view.bottom + 32) continue;
      if (!SEASON.frozen && now >= s.next) {
        s.next = now + DRIP_MS * (0.7 + Math.random() * 0.6);
        fx.drip(s.x, s.y, SPOUT.z);
      }
      for (const c of cats) {
        if (c.act !== Act.Catch || this.swiped.get(c) === c.actStart || Math.hypot(c.x - s.x, c.y - s.y) > 18) continue;
        this.swiped.set(c, c.actStart);
        // (a frozen puddle only gets a tap)
        if (SEASON.frozen) continue;
        fx.splash(s.x + 2, s.y + 1, Math.sign(s.x - c.x) || 1);
        fx.splashSound(s.x, s.y, 0.5, 1.4);
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

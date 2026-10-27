import Phaser from 'phaser';
import type { Raster } from '../art/raster.ts';
import { buildLandmark } from '../art/landmarks.ts';
import { LANDMARK_SPOTS, LEVEL, TILE, levelAt } from '../world/map.ts';
import { LANDMARKS, LANDMARK_DEPTH, LANDMARK_SIZE, LANDMARK_SPRITE } from '../world/landmarks.ts';
import { PIXEL_FONT } from '../ui/pixel.ts';
import { cullerFor } from './Culler.ts';

/** A cat this close to a folly's foot (px) reads its plaque. */
const READ_AT = 44;
const PLAQUE_PX = 12, PLAQUE_FADE_MS = 300;

/**
 * The follies of Berlin's landmarks, each standing on its tiles like the
 * shed: sorted by its front, so a cat behind it is hidden. Walk up to one
 * and a plaque with its name appears over it.
 */
export class Landmarks {
  /** Every folly, for sunlit rims, lantern light and shadows. */
  readonly pieces: { p: { x: number; y: number; depthY: number }; canvas: HTMLCanvasElement; depth: number | 'round' }[] = [];
  private readonly plaques: { text: Phaser.GameObjects.Text; x: number; half: number; foot: number; alpha: number }[] = [];
  private last = -1;

  constructor(scene: Phaser.Scene, toCanvas: (r: Raster) => HTMLCanvasElement) {
    for (const l of LANDMARK_SPOTS) {
      const s = LANDMARK_SPRITE[l.kind], [, h] = LANDMARK_SIZE[l.kind];
      const lift = levelAt(l.tx, l.ty + h - 1) * LEVEL;
      const x = l.tx * TILE + s.ox, y = l.ty * TILE + s.oy - lift;
      const front = (l.ty + h) * TILE - 2;
      const canvas = toCanvas(buildLandmark(l.kind));
      scene.textures.addCanvas(`landmark-${l.kind}`, canvas);
      cullerFor(scene).add(scene.add.image(x, y, `landmark-${l.kind}`).setOrigin(0).setDepth(front));
      this.pieces.push({ p: { x, y, depthY: front }, canvas, depth: LANDMARK_DEPTH[l.kind] });
      // drawn at screen resolution and shrunk by the zoom, like the cats' names
      const text = scene.add.text(x + s.w / 2, y - 4, LANDMARKS[l.kind].name, {
        fontFamily: PIXEL_FONT,
        fontSize: `${PLAQUE_PX}px`,
        fontStyle: 'bold',
        color: '#fff4dc',
        backgroundColor: '#5a3a1e',
        padding: { x: 5, y: 2 },
        resolution: Math.max(1, window.devicePixelRatio || 1),
      }).setOrigin(0.5, 1).setDepth(99999.5).setAlpha(0).setVisible(false);
      this.plaques.push({ text, x: x + s.w / 2, half: s.w / 2, foot: front, alpha: 0 });
    }
  }

  /** Show the plaque of a folly the cat at (x, y) stands near. */
  update(x: number, y: number, now: number, zoom: number): void {
    const step = this.last < 0 ? 1 : (now - this.last) / PLAQUE_FADE_MS;
    this.last = now;
    for (const p of this.plaques) {
      const near = Math.abs(x - p.x) < p.half + READ_AT / 2 && y > p.foot - 40 && y < p.foot + READ_AT;
      p.alpha = Math.max(0, Math.min(1, p.alpha + (near ? step : -step)));
      p.text.setVisible(p.alpha > 0).setAlpha(p.alpha).setScale(1 / zoom);
    }
  }
}

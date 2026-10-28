import Phaser from 'phaser';
import type { Raster } from '../art/raster.ts';
import { buildLandmark } from '../art/landmarks.ts';
import { LANDMARK_SPOTS, LEVEL, TILE, levelAt } from '../world/map.ts';
import { LANDMARKS, LANDMARK_DEPTH, LANDMARK_SIZE, LANDMARK_SPRITE } from '../world/landmarks.ts';
import { PIXEL_FONT } from '../ui/pixel.ts';
import { cullerFor } from './Culler.ts';

/** A cat this close to a folly (px beyond its edges) can paw at it. */
const READ_AT = 14;
const PLAQUE_PX = 12, PLAQUE_FADE_MS = 300;
/** How long a plaque stays up after a paw at its folly (ms). */
const PLAQUE_MS = 4000;

/**
 * The follies of Berlin's landmarks, each standing on its tiles: sorted by
 * its front, so a cat behind it is hidden (a cat up on one is drawn in front
 * of it). Paw at one and a plaque with its name
 * appears over it for a while.
 */
export class Landmarks {
  /** Every folly, for sunlit rims, lantern light and shadows. */
  readonly pieces: { p: { x: number; y: number; depthY: number }; canvas: HTMLCanvasElement; depth: number | 'round' }[] = [];
  private readonly plaques: { text: Phaser.GameObjects.Text; x0: number; y0: number; x1: number; y1: number; alpha: number; until: number }[] = [];
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
      const [tw, th] = LANDMARK_SIZE[l.kind];
      this.plaques.push({ text, x0: l.tx * TILE, y0: l.ty * TILE, x1: (l.tx + tw) * TILE, y1: (l.ty + th) * TILE, alpha: 0, until: -1 });
    }
  }

  /** Is the cat at (x, y) next to a folly (close enough to paw at it)? */
  near(x: number, y: number): boolean {
    return this.plaques.some((p) => x > p.x0 - READ_AT && x < p.x1 + READ_AT && y > p.y0 - READ_AT && y < p.y1 + READ_AT);
  }

  /** A paw at whatever folly the cat at (x, y) is next to: its plaque comes up. True if there was one. */
  touch(x: number, y: number, now: number): boolean {
    const p = this.plaques.find((p) => x > p.x0 - READ_AT && x < p.x1 + READ_AT && y > p.y0 - READ_AT && y < p.y1 + READ_AT);
    if (p) p.until = now + PLAQUE_MS;
    return !!p;
  }

  /** Fade the plaques in and out. */
  update(now: number, zoom: number): void {
    const step = this.last < 0 ? 1 : (now - this.last) / PLAQUE_FADE_MS;
    this.last = now;
    for (const p of this.plaques) {
      p.alpha = Math.max(0, Math.min(1, p.alpha + (now < p.until ? step : -step)));
      p.text.setVisible(p.alpha > 0).setAlpha(p.alpha).setScale(1 / zoom);
    }
  }
}

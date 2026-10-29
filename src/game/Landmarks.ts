import Phaser from 'phaser';
import type { Raster } from '../art/raster.ts';
import { buildLandmark, hasRoof } from '../art/landmarks.ts';
import { LANDMARK_SPOTS, LEVEL, TILE, levelAt } from '../world/map.ts';
import { LANDMARKS, LANDMARK_DEPTH, LANDMARK_SHAPES, LANDMARK_SIZE, LANDMARK_SPRITE, type LandmarkKind } from '../world/landmarks.ts';
import { PIXEL_FONT } from '../ui/pixel.ts';
import { cullerFor } from './Culler.ts';

/** A cat this close to a folly (px beyond its edges) can paw at it. */
const READ_AT = 14;
const PLAQUE_PX = 12, PLAQUE_FADE_MS = 300;
/** How long a plaque stays up after a paw at its folly (ms). */
const PLAQUE_MS = 4000;
/** Under a roof, your cat sees through it: this much of it stays, eased over ROOF_FADE_MS. */
const ROOF_SEEN = 0.35, ROOF_FADE_MS = 250;

/**
 * The follies, each standing on its tiles: sorted by its front, so a cat
 * behind it is hidden (a cat up on one is drawn in front of it, and under
 * its roof, if it has one). Paw at one and a plaque with its name
 * appears over it for a while.
 */
export class Landmarks {
  /** Every folly, for sunlit rims, lantern light and shadows. */
  readonly pieces: { p: { x: number; y: number; depthY: number }; canvas: HTMLCanvasElement; depth: number | 'round' }[] = [];
  private readonly plaques: { text: Phaser.GameObjects.Text; x0: number; y0: number; x1: number; y1: number; alpha: number; until: number }[] = [];
  /** The roofs, and the ground under them (world px). */
  private readonly roofs: { img: Phaser.GameObjects.Image; x0: number; y0: number; x1: number; y1: number }[] = [];
  private last = -1;

  constructor(scene: Phaser.Scene, toCanvas: (r: Raster) => HTMLCanvasElement) {
    for (const l of LANDMARK_SPOTS) {
      const s = LANDMARK_SPRITE[l.kind], [, h] = LANDMARK_SIZE[l.kind];
      const lift = levelAt(l.tx, l.ty + h - 1) * LEVEL;
      const x = l.tx * TILE + s.ox, y = l.ty * TILE + s.oy - lift;
      const front = (l.ty + h) * TILE - 2;
      const canvas = toCanvas(buildLandmark(l.kind));
      if (!scene.textures.exists(`landmark-${l.kind}`)) scene.textures.addCanvas(`landmark-${l.kind}`, canvas);
      cullerFor(scene).add(scene.add.image(x, y, `landmark-${l.kind}`).setOrigin(0).setDepth(front));
      // (its roof just over a cat up on it: CatView puts that at the front + 0.6)
      let whole = canvas;
      if (hasRoof(l.kind)) {
        const roof = toCanvas(buildLandmark(l.kind, undefined, true));
        if (!scene.textures.exists(`landmark-${l.kind}-roof`)) scene.textures.addCanvas(`landmark-${l.kind}-roof`, roof);
        const img = cullerFor(scene).add(scene.add.image(x, y, `landmark-${l.kind}-roof`).setOrigin(0).setDepth(front + 0.8));
        const [rx0, ry0, rx1, ry1] = roofOf(l.kind);
        this.roofs.push({ img, x0: l.tx * TILE + rx0, y0: l.ty * TILE + ry0, x1: l.tx * TILE + rx1, y1: l.ty * TILE + ry1 });
        // (its shadow and lit rims are of the whole of it)
        whole = document.createElement('canvas');
        whole.width = canvas.width;
        whole.height = canvas.height;
        const g = whole.getContext('2d')!;
        g.drawImage(canvas, 0, 0);
        g.drawImage(roof, 0, 0);
      }
      this.pieces.push({ p: { x, y, depthY: front }, canvas: whole, depth: LANDMARK_DEPTH[l.kind] });
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

  /** Fade the plaques in and out, and the roof your cat (at x, y) is under. */
  update(now: number, zoom: number, x: number, y: number): void {
    const dt = this.last < 0 ? 1e9 : now - this.last, step = dt / PLAQUE_FADE_MS;
    this.last = now;
    for (const r of this.roofs) {
      const want = x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1 ? ROOF_SEEN : 1;
      const a = r.img.alpha, d = dt / ROOF_FADE_MS;
      if (a !== want) r.img.setAlpha(want < a ? Math.max(want, a - d) : Math.min(want, a + d));
    }
    for (const p of this.plaques) {
      p.alpha = Math.max(0, Math.min(1, p.alpha + (now < p.until ? step : -step)));
      p.text.setVisible(p.alpha > 0).setAlpha(p.alpha).setScale(1 / zoom);
    }
  }
}

/** The ground under a folly's roof, from the top-left of its tiles (px). */
function roofOf(kind: LandmarkKind): [number, number, number, number] {
  for (const s of LANDMARK_SHAPES[kind]) if ('roof' in s) return s.roof;
  return [0, 0, 0, 0];
}

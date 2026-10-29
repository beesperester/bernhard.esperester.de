import Phaser from 'phaser';
import { buildGroundRegion, ripplesIn } from '../art/tiles.ts';
import { MAP_H, MAP_W, TILE } from '../world/map.ts';
import { toCanvas } from './textures.ts';

// The ground of the park: the lawns, paths, water, flower beds and all that is
// drawn into them. The park is far too big to keep as one picture, so it is
// drawn in square pieces, only round where the camera is: the pieces in view
// straight away, those just beyond it a few at a time while nothing else is
// going on, and the ones far away are forgotten again. Where a piece has water
// in it, it is drawn twice, its ripples in two phases that take turns.

/** A piece is this many tiles square. */
const CHUNK = 16;
const PX = CHUNK * TILE;
/** Pieces this far (px) beyond the view are drawn ahead of the camera... */
const AHEAD = 160;
/** ...and those further off than this are let go. */
const KEEP = PX * 1.6;
/** The ripples change this often (ms). */
const RIPPLE_MS = 700;
/** At most this long (ms) a frame spends drawing pieces that aren't in view yet. */
const BUDGET_MS = 8;

interface Piece { cx: number; cy: number; imgs: Phaser.GameObjects.Image[]; keys: string[] }

export class Ground {
  private readonly scene: Phaser.Scene;
  private readonly pieces = new Map<number, Piece>();
  private phase = 0;
  private next = 0;
  private gen = 0;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  /** Draw what's in `view` now and what's near it bit by bit, let go of what's far, and ripple the water. */
  update(view: Phaser.Geom.Rectangle, time: number): void {
    if (time >= this.next) {
      this.next = time + RIPPLE_MS;
      this.phase ^= 1;
      for (const p of this.pieces.values()) if (p.imgs.length > 1) p.imgs.forEach((img, i) => img.setVisible(i === this.phase));
    }
    // in view: drawn now, whatever it costs
    for (const [cx, cy] of this.around(view, 0)) this.make(cx, cy);
    // nearby: a few at a time
    const start = performance.now();
    for (const [cx, cy] of this.around(view, AHEAD)) {
      if (performance.now() - start > BUDGET_MS) break;
      this.make(cx, cy);
    }
    // far away: let go
    const mx = view.centerX, my = view.centerY;
    for (const [k, p] of this.pieces) {
      const dx = Math.max(0, Math.abs(mx - (p.cx + 0.5) * PX) - PX / 2 - view.width / 2), dy = Math.max(0, Math.abs(my - (p.cy + 0.5) * PX) - PX / 2 - view.height / 2);
      if (Math.max(dx, dy) > KEEP) this.drop(k, p);
    }
  }

  /** Redraw the given tiles where their piece is drawn (the sun has moved: bushes and rocks are lit anew). Pieces drawn later get the new light anyway. */
  redrawTiles(tiles: [number, number][]): void {
    for (const p of this.pieces.values()) {
      const x0 = p.cx * CHUNK, y0 = p.cy * CHUNK;
      const mine = tiles.filter(([tx, ty]) => tx >= x0 && tx < x0 + CHUNK && ty >= y0 && ty < y0 + CHUNK);
      if (!mine.length) continue;
      p.keys.forEach((key, phase) => {
        const tex = this.scene.textures.get(key) as Phaser.Textures.CanvasTexture;
        const g = tex.getContext();
        for (const [tx, ty] of mine) {
          const t = buildGroundRegion(tx, ty, 1, 1, phase);
          g.putImageData(new ImageData(t.data, TILE, TILE), (tx - x0) * TILE, (ty - y0) * TILE);
        }
        tex.refresh();
      });
    }
  }

  /** The pieces touching `view` grown by `margin` px, nearest the middle first. */
  private around(view: Phaser.Geom.Rectangle, margin: number): [number, number][] {
    const cx0 = Math.max(0, Math.floor((view.x - margin) / PX)), cy0 = Math.max(0, Math.floor((view.y - margin) / PX));
    const cx1 = Math.min(Math.ceil(MAP_W / CHUNK) - 1, Math.floor((view.right + margin) / PX)), cy1 = Math.min(Math.ceil(MAP_H / CHUNK) - 1, Math.floor((view.bottom + margin) / PX));
    const out: [number, number][] = [];
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) if (!this.pieces.has(cy * 1000 + cx)) out.push([cx, cy]);
    const mx = view.centerX / PX - 0.5, my = view.centerY / PX - 0.5;
    return out.sort((a, b) => Math.hypot(a[0] - mx, a[1] - my) - Math.hypot(b[0] - mx, b[1] - my));
  }

  private make(cx: number, cy: number): void {
    const k = cy * 1000 + cx;
    if (this.pieces.has(k)) return;
    const tx0 = cx * CHUNK, ty0 = cy * CHUNK, tw = Math.min(CHUNK, MAP_W - tx0), th = Math.min(CHUNK, MAP_H - ty0);
    const phases = ripplesIn(tx0, ty0, tw, th) ? [0, 1] : [0];
    const id = this.gen++;
    const keys = phases.map((phase) => {
      const key = `ground-${id}-${phase}`;
      this.scene.textures.addCanvas(key, toCanvas(buildGroundRegion(tx0, ty0, tw, th, phase)));
      return key;
    });
    const imgs = keys.map((key, i) => this.scene.add.image(tx0 * TILE, ty0 * TILE, key).setOrigin(0).setDepth(-100000).setVisible(keys.length === 1 || i === this.phase));
    this.pieces.set(k, { cx, cy, imgs, keys });
  }

  private drop(k: number, p: Piece): void {
    p.imgs.forEach((img) => img.destroy());
    p.keys.forEach((key) => this.scene.textures.remove(key));
    this.pieces.delete(k);
  }
}

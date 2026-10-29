import Phaser from 'phaser';
import { ripplesIn } from '../art/tiles.ts';
import { adoptRamps } from '../art/painted.ts';
import { MAP_H, MAP_W, TILE } from '../world/map.ts';
import type { GroundMaps, Painter } from './Painter.ts';
import { addPainted, paint } from './Painted.ts';

// The ground of the park: the lawns, paths, water, flower beds and all that is
// drawn into them. The park is far too big to keep as one picture, so it is
// drawn in square pieces, only round where the camera is, nearest first, by
// the painter off the main thread (Painter.ts); the ones far away are
// forgotten again. Where a piece has water in it, it is drawn twice, its
// ripples in two phases that take turns. The bushes and rocks in it are
// shaded on the GPU (Painted.ts), in the light as it is each frame.

/** A piece is this many tiles square. */
const CHUNK = 16;
const PX = CHUNK * TILE;
/** Pieces this far (px) beyond the view are drawn ahead of the camera... */
const AHEAD = 160;
/** ...and those further off than this are let go. */
const KEEP = PX * 1.6;
/** The ripples change this often (ms). */
const RIPPLE_MS = 700;

interface Piece { cx: number; cy: number; imgs: Phaser.GameObjects.Image[]; keys: string[] }

export class Ground {
  private readonly scene: Phaser.Scene;
  private readonly pieces = new Map<number, Piece>();
  private readonly painter: Painter;
  /** Pieces asked of the painter and not back yet. */
  private readonly asked = new Set<number>();
  private view = new Phaser.Geom.Rectangle();
  private phase = 0;
  private next = 0;
  private gen = 0;

  constructor(scene: Phaser.Scene, painter: Painter) {
    this.scene = scene;
    this.painter = painter;
  }

  /** Draw what's in `view` now and what's near it bit by bit, let go of what's far, and ripple the water. */
  update(view: Phaser.Geom.Rectangle, time: number): void {
    if (time >= this.next) {
      this.next = time + RIPPLE_MS;
      this.phase ^= 1;
      for (const p of this.pieces.values()) if (p.imgs.length > 1) p.imgs.forEach((img, i) => img.setVisible(i === this.phase));
    }
    this.view = view;
    // in view and nearby, nearest first
    for (const [cx, cy] of this.around(view, AHEAD)) {
      if (!this.painter.free) break;
      this.ask(cx, cy);
    }
    // far away: let go
    const mx = view.centerX, my = view.centerY;
    for (const [k, p] of this.pieces) {
      const dx = Math.max(0, Math.abs(mx - (p.cx + 0.5) * PX) - PX / 2 - view.width / 2), dy = Math.max(0, Math.abs(my - (p.cy + 0.5) * PX) - PX / 2 - view.height / 2);
      if (Math.max(dx, dy) > KEEP) this.drop(k, p);
    }
  }

  /** Whether every piece in `view` is drawn. */
  ready(view: Phaser.Geom.Rectangle): boolean {
    // (around() leaves out the drawn pieces and those asked for: the view is drawn once nothing's left but none are waiting)
    return this.around(view, 0).length === 0 && [...this.asked].every((k) => !this.inView(k, view));
  }

  private inView(k: number, view: Phaser.Geom.Rectangle): boolean {
    const cx = k % 1000, cy = Math.floor(k / 1000);
    return (cx + 1) * PX > view.x && cx * PX < view.right && (cy + 1) * PX > view.y && cy * PX < view.bottom;
  }

  /** The pieces touching `view` grown by `margin` px, nearest the middle first. */
  private around(view: Phaser.Geom.Rectangle, margin: number): [number, number][] {
    const cx0 = Math.max(0, Math.floor((view.x - margin) / PX)), cy0 = Math.max(0, Math.floor((view.y - margin) / PX));
    const cx1 = Math.min(Math.ceil(MAP_W / CHUNK) - 1, Math.floor((view.right + margin) / PX)), cy1 = Math.min(Math.ceil(MAP_H / CHUNK) - 1, Math.floor((view.bottom + margin) / PX));
    const out: [number, number][] = [];
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) if (!this.pieces.has(cy * 1000 + cx) && !this.asked.has(cy * 1000 + cx)) out.push([cx, cy]);
    const mx = view.centerX / PX - 0.5, my = view.centerY / PX - 0.5;
    return out.sort((a, b) => Math.hypot(a[0] - mx, a[1] - my) - Math.hypot(b[0] - mx, b[1] - my));
  }

  private ask(cx: number, cy: number): void {
    const k = cy * 1000 + cx;
    const tx0 = cx * CHUNK, ty0 = cy * CHUNK, tw = Math.min(CHUNK, MAP_W - tx0), th = Math.min(CHUNK, MAP_H - ty0);
    this.asked.add(k);
    void this.painter.ground(tx0, ty0, tw, th, ripplesIn(tx0, ty0, tw, th) ? [0, 1] : [0]).then((maps) => {
      this.asked.delete(k);
      // (unless the camera has gone on, far enough that it would be let go)
      const v = this.view, dx = Math.max(0, Math.abs(v.centerX - (cx + 0.5) * PX) - PX / 2 - v.width / 2), dy = Math.max(0, Math.abs(v.centerY - (cy + 0.5) * PX) - PX / 2 - v.height / 2);
      if (Math.max(dx, dy) > KEEP) return;
      this.make(cx, cy, maps);
    });
  }

  private make(cx: number, cy: number, { layers, normal, ramps }: GroundMaps): void {
    const k = cy * 1000 + cx, tx0 = cx * CHUNK, ty0 = cy * CHUNK;
    const id = this.gen++;
    adoptRamps(layers.map((l) => l.data), normal, ramps);
    const keys = layers.map((l, phase) => {
      const key = `ground-${id}-${phase}`;
      addPainted(this.scene, key, l.data, normal, l.w, l.h);
      return key;
    });
    const imgs = keys.map((key, i) => paint(this.scene.add.image(tx0 * TILE, ty0 * TILE, key)).setOrigin(0).setDepth(-100000).setVisible(keys.length === 1 || i === this.phase));
    this.pieces.set(k, { cx, cy, imgs, keys });
  }

  private drop(k: number, p: Piece): void {
    p.imgs.forEach((img) => img.destroy());
    p.keys.forEach((key) => this.scene.textures.remove(key));
    this.pieces.delete(k);
  }
}

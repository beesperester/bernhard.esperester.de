import Phaser from 'phaser';
import { Raster, hex } from '../art/raster.ts';
import { toCanvas } from './textures.ts';
import { Act, Facing } from './state.ts';
import type { CatView } from './CatView.ts';
import { DASH_SPEED, type Effects } from './fauna/Effects.ts';
import { MAP_H, MAP_W, TILE, furnished, levelAt, tileAt } from '../world/map.ts';
import { rainfall, wetness } from '../world/season.ts';
import { isLawnOrTall, isPath } from '../world/legend.ts';
import { Pool, hash2 } from './fauna/kit.ts';

// Puddles: when it rains, water collects in the dips of the paths (and here
// and there on the lawn). They fill while it pours, rings spread on them as
// the drops land, and they shrink away for an hour or so after the rain stops.
// How full they are follows the shared clock (season.ts: wetness), so everyone
// sees the same puddles. A cat walking through splashes; dashing through, or
// landing in one from a jump, sends the water flying.

/** Shapes of puddle: [half width, half height] when full. Each is drawn in three sizes, filling up. */
const SHAPES: [number, number][] = [[8, 3], [11, 4], [6, 3], [9, 4]];
const SIZES = [0.45, 0.72, 1];
/** Share of path tiles (and lawn tiles) with a dip where a puddle forms. */
const ON_PATH = 0.14, ON_LAWN = 0.025;
/** Just above the ground, under the shadows cast on it. */
const ON_GROUND = -99994;
/** Raindrop rings per puddle per second in a downpour. */
const RINGS = 2.5;

interface Puddle { x: number; y: number; shape: number; flip: boolean; from: number }

export class Puddles {
  private readonly puddles: Puddle[] = [];
  private readonly pool: Pool;
  private readonly fx: Effects;
  /** How full puddles are right now (0..1), and the size each one shows at. */
  private wet = 0;
  private readonly perCat = new WeakMap<CatView, { next: number; z: number }>();

  constructor(scene: Phaser.Scene, fx: Effects) {
    this.fx = fx;
    SHAPES.forEach((s, i) => scene.textures.addCanvas(`puddle-${i}`, toCanvas(drawPuddle(s))));
    SHAPES.forEach((s, i) => {
      const t = scene.textures.get(`puddle-${i}`);
      const w = s[0] * 2 + 2, h = s[1] * 2 + 2;
      SIZES.forEach((_, f) => t.add(f, 0, f * w, 0, w, h));
    });
    this.pool = new Pool(scene, 'puddle-0');
    for (let ty = 1; ty < MAP_H - 1; ty++)
      for (let tx = 1; tx < MAP_W - 1; tx++) {
        const ch = tileAt(tx, ty);
        // on the ground level, where nothing stands
        if (levelAt(tx, ty) !== 0 || furnished(tx, ty)) continue;
        const odds = isPath(ch) ? ON_PATH : isLawnOrTall(ch) ? ON_LAWN : 0;
        if (hash2(tx, ty, 1901) >= odds) continue;
        this.puddles.push({
          x: tx * TILE + 8 + Math.round((hash2(tx, ty, 1902) - 0.5) * 6),
          y: ty * TILE + 8 + Math.round((hash2(tx, ty, 1903) - 0.5) * 6),
          shape: Math.floor(hash2(tx, ty, 1904) * SHAPES.length),
          flip: hash2(tx, ty, 1905) < 0.5,
          // the deeper dips fill first, after only a little rain
          from: hash2(tx, ty, 1906) * 0.6,
        });
      }
  }

  update(gt: number, now: number, dt: number, cats: CatView[], view: Phaser.Geom.Rectangle): void {
    this.wet = wetness(gt);
    const rain = rainfall(gt);
    this.pool.begin();
    if (this.wet > 0.01)
      for (const p of this.puddles) {
        const size = this.sizeOf(p);
        if (size < 0) continue;
        const [rx] = SHAPES[p.shape];
        if (p.x + rx < view.x || p.x - rx > view.right || p.y < view.y - 6 || p.y > view.bottom + 6) continue;
        this.pool.get(`puddle-${p.shape}`, size).setPosition(p.x, p.y).setFlipX(p.flip).setDepth(ON_GROUND);
        // drops landing in it
        if (rain > 0.05 && Math.random() < RINGS * rain * dt) {
          const s = SIZES[size];
          this.fx.ripple(p.x + (Math.random() - 0.5) * rx * s, p.y + (Math.random() - 0.5) * SHAPES[p.shape][1] * s, 0, 0.35);
        }
      }
    this.pool.end();
    if (this.wet > 0.01) this.splashCats(now, cats);
  }

  /** Which of the three sizes a puddle shows at now, or -1 while it's dry. */
  private sizeOf(p: Puddle): number {
    const u = (this.wet - p.from) / 0.35;
    return u <= 0.05 ? -1 : u < 0.4 ? 0 : u < 0.75 ? 1 : 2;
  }

  /** The puddle a cat standing at (x, y) has its paws in, if any. */
  private puddleAt(x: number, y: number): Puddle | null {
    for (const p of this.puddles) {
      if (Math.abs(p.x - x) > 12 || Math.abs(p.y - y) > 6) continue;
      const size = this.sizeOf(p);
      if (size < 0) continue;
      const [rx, ry] = SHAPES[p.shape], s = SIZES[size];
      const dx = (x - p.x) / (rx * s + 2), dy = (y - p.y) / (ry * s + 2);
      if (dx * dx + dy * dy < 1) return p;
    }
    return null;
  }

  private splashCats(now: number, cats: CatView[]): void {
    for (const c of cats) {
      let s = this.perCat.get(c);
      if (!s) this.perCat.set(c, (s = { next: 0, z: c.z }));
      const landed = s.z >= 2 && c.z < 1;
      s.z = c.z;
      if (c.z >= 1 || now < s.next || !this.puddleAt(c.x, c.y)) continue;
      const dashing = c.speed > DASH_SPEED && c.act !== Act.Jump;
      const dir = c.facing === Facing.Left ? -1 : c.facing === Facing.Right ? 1 : 0;
      if (dashing || landed) {
        // water flying everywhere
        this.fx.splash(c.x, c.y, dir);
        this.fx.splash(c.x - dir * 4, c.y, dir * 2);
        this.fx.ripple(c.x, c.y, 0, 0.6);
        this.fx.splashSound(c.x, c.y, landed ? 0.5 : 0.4, 1.35);
        s.next = now + 160;
      } else if (c.speed > 12) {
        // paddling through
        this.fx.drops(c.x, c.y, c.y + 1);
        this.fx.ripple(c.x, c.y, 0, 0.45);
        if (Math.random() < 0.5) this.fx.splashSound(c.x, c.y, 0.14, 1.7);
        s.next = now + 300;
      }
    }
  }
}

/** One puddle shape in three sizes side by side: muddy water, a darker edge, a glint of sky. */
function drawPuddle([rx, ry]: [number, number]): Raster {
  const w = rx * 2 + 2, h = ry * 2 + 2;
  const r = new Raster(w * SIZES.length, h);
  const body = hex('#7d98b4'), edge = hex('#5c7590'), sky = hex('#cfe0f0');
  SIZES.forEach((s, f) => {
    const ax = Math.max(1.5, rx * s), ay = Math.max(1, ry * s);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const dx = (x + 0.5 - w / 2) / ax, dy = (y + 0.5 - h / 2) / ay;
        // a little lumpy round the edge
        const d = dx * dx + dy * dy - (hash2(x, y, 1907 + f) - 0.5) * 0.35;
        if (d >= 1) continue;
        const rim = d > 0.6 && dy < 0;
        const glint = dy < -0.1 && dy > -0.6 && dx > -0.55 && dx < 0.05 && d < 0.5;
        r.set(f * w + x, y, rim ? edge : glint ? sky : body, rim ? 230 : 200);
      }
  });
  return r;
}


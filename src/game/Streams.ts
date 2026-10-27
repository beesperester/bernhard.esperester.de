import Phaser from 'phaser';
import { Raster, type RGB } from '../art/raster.ts';
import { toCanvas } from './textures.ts';
import { STREAMS, along, type Stream } from '../world/streams.ts';
import { seasonAt } from '../world/season.ts';
import { Pool, clamp01, hash2, remember, seedRng } from './fauna/kit.ts';
import { LEAF_COLOURS } from './Weather.ts';

// The streams flow: glints of light run down them, and whatever falls in
// (leaves in autumn, cherry petals in spring) floats along with the current
// from the pond at the top into the one at the bottom. Like the fauna, it all
// follows the shared garden clock, so a leaf goes by every visitor's cat at
// the same moment. Frozen over in winter, nothing moves.

/** How fast the water runs (px/s). */
const FLOW = 14;
/** One glint every so many px along a stream. */
const GLINT_GAP = 10;
/** Something may fall into the top of each stream every DRIFT_SLOT ms. */
const DRIFT_SLOT = 2500;
/** How far past the mouth it floats on into the pond, fading (px). */
const RUN_ON = 18;
/** Drawn just above the water (where the ripples are). */
const ON_WATER = -99979;

interface Drifter { id: number; t0: number; speed: number; side: number; texture: string; phase: number }

export class Streams {
  private readonly glints: Pool;
  private readonly drifting: Pool;
  private readonly water: Raster;
  private readonly slots = new Map<string, Drifter | null>();
  /** Each stream's glints: where along it they start, which side of the channel, and how they twinkle and drift. */
  private readonly glintsOf: { start: number; side: number; phase: number; rate: number }[][];

  constructor(scene: Phaser.Scene, water: Raster) {
    this.water = water;
    const glint = (w: number, h: number) => {
      const r = new Raster(w, h);
      const c: RGB = [225, 242, 255];
      for (let i = 0; i < Math.max(w, h); i++) r.set(w > 1 ? i : 0, h > 1 ? i : 0, c, i === 0 ? 120 : 220);
      return r;
    };
    // a glint lies along the current: long across the screen, short going down it (seen from above at a slant)
    scene.textures.addCanvas('glint-h', toCanvas(glint(4, 1)));
    scene.textures.addCanvas('glint-v', toCanvas(glint(1, 3)));
    this.glints = new Pool(scene, 'glint-h');
    this.glintsOf = STREAMS.map((s, si) =>
      Array.from({ length: Math.floor(s.length / GLINT_GAP) }, (_, i) => {
        const r = seedRng(si, i, 41);
        return { start: (i + r() * 0.6) * GLINT_GAP, side: r(), phase: r() * 6.3, rate: 0.9 + r() * 0.3 };
      }));
    this.drifting = new Pool(scene, 'petal');
  }

  /** `night` is how dark it is (0..1): the glints are sunlight, and fade after dusk. */
  update(gt: number, night: number, view: Phaser.Geom.Rectangle): void {
    this.glints.begin();
    this.drifting.begin();
    STREAMS.forEach((s, i) => {
      const { box } = s;
      if (box.x1 < view.x - 16 || box.x0 > view.right + 16 || box.y1 < view.y - 16 || box.y0 > view.bottom + 16) return;
      this.updateGlints(s, i, gt, night, view);
      this.updateDrifters(s, i, gt, view);
    });
    this.glints.end();
    this.drifting.end();
  }

  private updateGlints(s: Stream, si: number, gt: number, night: number, view: Phaser.Geom.Rectangle): void {
    const bright = 0.85 * (1 - night * 0.75);
    for (const { start, side, phase, rate } of this.glintsOf[si]) {
      const d = ((start + (gt / 1000) * FLOW * rate) % s.length + s.length) % s.length;
      const p = along(s, d);
      const wide = s.river ? 14 : 8;
      const x = Math.round(p.x - p.dy * (side - 0.5) * wide), y = Math.round(p.y + p.dx * (side - 0.5) * wide * 0.75);
      if (x < view.x - 4 || x > view.right + 4 || y < view.y - 4 || y > view.bottom + 4 || !this.water.isSet(x, y)) continue;
      // each one catches the light for a moment, then is gone
      const shine = Math.max(0, Math.sin((gt / 1000) * 1.4 + phase));
      if (shine < 0.05) continue;
      const across = Math.abs(p.dx) > Math.abs(p.dy);
      this.glints.get(across ? 'glint-h' : 'glint-v').setPosition(x, y).setDepth(ON_WATER).setAlpha(bright * shine * edgeFade(d, s.length));
    }
  }

  /** Whatever fell into stream `si` in slot k, if anything. */
  private drifterAt(si: number, k: number): Drifter | null {
    const key = `${si}:${k}`;
    const known = this.slots.get(key);
    if (known !== undefined) return known;
    const t0 = k * DRIFT_SLOT;
    const season = seasonAt(t0);
    const leaves = Math.max(season.falling, season.litter * 0.5) * 0.55, petals = season.petals * 0.5;
    const roll = hash2(si, k, 42);
    let d: Drifter | null = null;
    if (roll < leaves + petals) {
      const r = seedRng(si, k, 43);
      const petal = roll >= leaves;
      d = {
        id: k, t0: t0 + r() * DRIFT_SLOT, speed: FLOW * (0.8 + r() * 0.35), side: r() * 2 - 1, phase: r() * 6.3,
        texture: petal ? 'petal' : `leaf-${Math.floor(r() * LEAF_COLOURS.length)}`,
      };
    }
    return remember(this.slots, key, d, 200);
  }

  private updateDrifters(s: Stream, si: number, gt: number, view: Phaser.Geom.Rectangle): void {
    const longest = (s.length + RUN_ON) / (FLOW * 0.8) * 1000;
    for (let k = Math.floor((gt - longest - DRIFT_SLOT) / DRIFT_SLOT); k <= Math.floor(gt / DRIFT_SLOT); k++) {
      const f = this.drifterAt(si, k);
      if (!f || gt < f.t0) continue;
      const t = (gt - f.t0) / 1000;
      const d = t * f.speed;
      if (d > s.length + RUN_ON) continue;
      const p = along(s, d);
      // past the mouth it carries on the way it was going, slowing as the pond takes it
      const over = Math.max(0, d - s.length), on = over * (1 - over / (RUN_ON * 2));
      // turning lazily and wandering from side to side of the channel
      const wander = f.side * (s.river ? 6 : 3) + Math.sin(t * 0.7 + f.phase) * 1.5;
      const x = Math.round(p.x + p.dx * on - p.dy * wander), y = Math.round(p.y + p.dy * on + p.dx * wander * 0.7);
      if (x < view.x - 4 || x > view.right + 4 || y < view.y - 4 || y > view.bottom + 4) continue;
      // out of sight under a bridge
      if (!this.water.isSet(x, y)) continue;
      this.drifting.get(f.texture, 0).setPosition(x, y).setDepth(ON_WATER).setFlipX(Math.sin(t * 0.4 + f.phase) > 0)
        .setAlpha(clamp01(d / 10) * clamp01((s.length + RUN_ON - d) / RUN_ON));
    }
  }
}

/** Glints fade in where the stream leaves its pond and out where it joins the next. */
const edgeFade = (d: number, length: number) => clamp01(d / 16) * clamp01((length - d) / 16);

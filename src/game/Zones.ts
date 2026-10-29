// The themed zones in the scene (world/themes.ts lays them out, and their
// tents, booths and poles stand among the furniture): the bunting strung
// between a funfair's poles, its fairy lights after dark, and the music. A
// zone with a playlist of its own (audio/music.ts) takes over from the
// background music while our cat is in it.

import Phaser from 'phaser';
import { music } from '../audio/music.ts';
import type { Pos } from '../audio/sound.ts';
import { POLE_TOP, buildBunting, buntingLights } from '../art/funfair.ts';
import { buildGlow } from '../art/critters.ts';
import type { Raster } from '../art/raster.ts';
import { FURNITURE, TILE, THEMED_ZONES, elevAt } from '../world/map.ts';
import { buntingStrings, type ThemedZone } from '../world/themes.ts';
import { lampsOn, type Light } from '../world/sky.ts';
import { cullerFor } from './Culler.ts';
import type { Glow, Glows } from './Glows.ts';
import { LAMPLIGHT, type LightMap } from './LightMap.ts';

/** How far a booth's lanterns light round it (px). */
const BOOTH_LIGHT = 64;

/** Once in a zone, a cat is still in it until this far out (px): no flicking back and forth at its edge. */
const LEAVE = 2.5 * TILE;
/** The fairy lights' colours, by turns. */
const BULBS: [number, number, number][] = [[255, 214, 120], [255, 140, 110], [140, 200, 255], [170, 255, 150]];

export class Zones {
  /** The zone our cat is in. */
  private here: ThemedZone | null = null;
  /** The fairy lights along the bunting, and how far they've come on. */
  private readonly bulbs: Glow[] = [];
  /** The lanterns on the booths' posts. */
  private readonly lanterns: Glow[] = [];
  private lit = -1;

  constructor(scene: Phaser.Scene, toCanvas: (r: Raster) => HTMLCanvasElement, glows: Glows, lights: LightMap) {
    BULBS.forEach((c, i) => scene.textures.addCanvas(`fairy-${i}`, toCanvas(buildGlow(3, 3, c, 2))));
    let n = 0;
    for (const z of THEMED_ZONES) {
      if (z.theme !== 'funfair') continue;
      const has = new Set(z.tiles.map(([x, y]) => `${x},${y}`));
      const poles = FURNITURE.filter((f) => f.kind === 'pole' && has.has(`${f.tx},${f.ty}`));
      // where each pole's string is tied (on screen), and the ground y of its foot
      const tops = poles.map((p) => {
        const x = p.tx * TILE + 7, foot = p.ty * TILE + 12;
        return { x, y: foot - elevAt(x, foot) - POLE_TOP, foot };
      });
      // a lantern on each of a booth's two posts (art/funfair.ts: the booth is drawn 2 px in, 21 up)
      for (const b of FURNITURE.filter((f) => f.kind === 'booth' && has.has(`${f.tx},${f.ty}`))) {
        const x = b.tx * TILE + 2, y = b.ty * TILE - 21, feet = b.ty * TILE + 26, lift = elevAt(x, feet);
        // (the flames, and the light they cast round the booth)
        for (const px of [3, 41]) this.lanterns.push(glows.point('glow-core', x + px, y + 28 - lift, 1, feet));
        this.lanterns.push(lights.add(x + 22, b.ty * TILE + 30 - lift, BOOTH_LIGHT, LAMPLIGHT));
      }
      const strings = buntingStrings(poles.map((p) => [p.tx, p.ty]), (x, y) => has.has(`${x},${y}`));
      for (const [i, j] of strings) {
        const a = tops[i], b = tops[j], key = `bunting-${n}`;
        const { r, ox, oy } = buildBunting(b.x - a.x, b.y - a.y, n);
        scene.textures.addCanvas(key, toCanvas(r));
        // (sorted by the nearer pole: a cat in front of both passes in front of it)
        const depth = Math.max(a.foot, b.foot) + 0.5;
        cullerFor(scene).add(scene.add.image(a.x - ox, a.y - oy, key).setOrigin(0).setDepth(depth));
        buntingLights(b.x - a.x, b.y - a.y).forEach((p, k) => {
          this.bulbs.push(glows.point(`fairy-${(k + n) % BULBS.length}`, a.x + p.x, a.y + p.y + 1, 1, depth));
        });
        n++;
      }
    }
  }

  /** The fairy lights come on after dark, like the lanterns along the paths, and twinkle a little. */
  light(light: Light, now: number): void {
    const on = lampsOn(light);
    if (on <= 0 && this.lit <= 0) return;
    this.lit = on;
    this.bulbs.forEach((b, i) => b.set(on * (0.75 + 0.25 * Math.sin(now / 600 + i * 1.7))));
    // (a candle's flicker)
    this.lanterns.forEach((l, i) => l.set(on * (0.85 + 0.15 * Math.sin(now / 170 + i * 2.3) * Math.sin(now / 410 + i))));
  }

  /** Which zone our cat (at `p`) is in now: its music plays while it's there. */
  update(p: Pos): void {
    const tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE);
    const stay = this.here && nearest(this.here, p) <= LEAVE ? this.here : null;
    const here = stay ?? THEMED_ZONES.find((z) => z.tiles.some(([x, y]) => x === tx && y === ty)) ?? null;
    if (here === this.here) return;
    this.here = here;
    music.setZone(here?.theme ?? null);
  }
}

/** How far `p` is from the middle of the zone's nearest tile (px). */
function nearest(zone: ThemedZone, p: Pos): number {
  let bd = Infinity;
  for (const [x, y] of zone.tiles) bd = Math.min(bd, Math.hypot((x + 0.5) * TILE - p.x, (y + 0.5) * TILE - p.y));
  return bd;
}

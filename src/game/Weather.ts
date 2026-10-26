import Phaser from 'phaser';
import { Raster, hex, hash2, type RGB } from '../art/raster.ts';
import { SNOW, TREE_W, type Prop } from '../art/tiles.ts';
import { Act } from './state.ts';
import type { CatView } from './CatView.ts';
import { TILE, elevAt, furnished, iceAt, levelAt, tileAt } from '../world/map.ts';
import { SEASON, rainfall, snowfall } from '../world/season.ts';
import { sound, type Playing } from '../audio/sound.ts';

// What the weather and the season bring down from the sky and out of the
// trees: showers of rain any time of year (splashing on the ground, ringing
// the water, dimming the garden), snow falling on and off through the winter, leaves coming down in autumn (and
// lying in piles under the trees that cats can scatter), cherry petals in
// spring, and paw prints in the snow behind every cat. The snowfall follows
// the shared clock; the rest is decoration, worked out on each screen.

type Img = Phaser.GameObjects.Image;

const LEAF_COLOURS: RGB[] = ['#e8b030', '#e07828', '#c84828', '#a85a28', '#f0d058'].map(hex);
const PETAL = hex('#f9c0d8');

/** Flakes in view when it snows hardest; raindrops when it pours. */
const FLAKES = 320, DROPS = 280;
/** How much a downpour dims the garden. */
const OVERCAST = 0.3;
/** Leaves (or petals) let go per tree per second at the height of the fall. */
const LEAF_RATE = 0.5;
/** Fallen leaves lie this long (s) before they fade. */
const LEAF_LIE = 8;
/** A scattered pile takes this long (ms) to be swept back together. */
const PILE_BACK = 40000;
/** Paw prints: one every so many px, gone after so many ms, at most so many. */
const STRIDE = 5, PRINT_MS = 45000, PRINTS = 600;

export function addWeatherTextures(scene: Phaser.Scene, toCanvas: (r: Raster) => HTMLCanvasElement): void {
  const tex = scene.textures;
  const add = (key: string, r: Raster, frames = 1) => {
    const t = tex.addCanvas(key, toCanvas(r))!;
    const w = r.w / frames;
    for (let f = 0; f < frames; f++) t.add(f, 0, f * w, 0, w, r.h);
  };
  const flake = (big: boolean) => {
    const r = new Raster(big ? 3 : 1, big ? 3 : 1);
    if (big) { r.set(1, 0, SNOW[3]); r.set(0, 1, SNOW[3]); r.set(1, 1, [255, 255, 255]); r.set(2, 1, SNOW[3]); r.set(1, 2, SNOW[3]); }
    else r.set(0, 0, [255, 255, 255]);
    return r;
  };
  // a raindrop streak, and its splash on the ground (3 frames)
  const drop = new Raster(1, 4);
  drop.set(0, 0, [200, 220, 245], 120); drop.set(0, 1, [215, 230, 250], 180); drop.set(0, 2, [230, 240, 255], 220); drop.set(0, 3, [240, 248, 255], 255);
  add('raindrop', drop);
  const splash = new Raster(15, 3);
  const sp = [230, 240, 255] as RGB;
  splash.set(2, 2, sp); splash.set(1, 1, sp); splash.set(3, 1, sp);
  splash.set(5, 1, sp); splash.set(9, 1, sp); splash.set(6, 0, sp); splash.set(8, 0, sp);
  splash.set(10, 2, sp); splash.set(14, 2, sp);
  add('rainsplash', splash, 3);
  add('flake-0', flake(false));
  add('flake-1', flake(true));
  // a leaf flat (3x2) and edge-on (1x2) as it tumbles
  LEAF_COLOURS.forEach((c, i) => {
    const r = new Raster(6, 2);
    r.set(0, 0, c); r.set(1, 0, c); r.set(1, 1, c); r.set(2, 1, c);
    r.set(4, 0, c); r.set(4, 1, c);
    add(`leaf-${i}`, r, 2);
  });
  const petal = new Raster(4, 1);
  petal.set(0, 0, PETAL); petal.set(1, 0, PETAL); petal.set(3, 0, PETAL);
  add('petal', petal, 2);
  // a pile of leaves, 18x8
  const pile = new Raster(18, 8);
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 18; x++) {
      const dx = (x - 8.5) / 9, dy = (y - 7) / 7;
      if (dx * dx + dy * dy > 1 || hash2(x, y, 1701) < 0.08) continue;
      const shade = y > 5 ? 3 : 0;
      pilePixel(pile, x, y, LEAF_COLOURS[(Math.floor(hash2(x >> 1, y, 1702) * 4) + shade) % LEAF_COLOURS.length], y < 3 || dx * dx + dy * dy > 0.7);
    }
  add('leafpile', pile);
  // a paw pressed into the snow: a pad and two toes, darker at the bottom where it's deepest
  const paw = new Raster(3, 3);
  const deep = hex('#6a7896');
  paw.set(0, 0, SNOW[0]); paw.set(2, 0, SNOW[0]); paw.set(0, 1, SNOW[0]); paw.set(1, 1, deep); paw.set(2, 1, SNOW[0]); paw.set(1, 2, deep);
  add('paw', paw);
}

/** Set a pile pixel, a little darker at the rim. */
function pilePixel(p: Raster, x: number, y: number, c: RGB, rim: boolean): void {
  p.set(x, y, rim ? [c[0] * 0.8, c[1] * 0.75, c[2] * 0.7] : c);
}

interface Flake { img: Img; x: number; y: number; h: number; vx: number; vy: number; phase: number }
interface Hit { img: Img; t: number; ring: boolean }
interface Leaf { img: Img; x: number; y: number; h: number; vx: number; vh: number; t: number; lie: number; phase: number; petal: boolean }
interface Pile { x: number; y: number; img: Img; scattered: number }
interface Print { img: Img; t: number }

export class Weather {
  private readonly scene: Phaser.Scene;
  private readonly trees: Prop[];
  private flakes: Flake[] = [];
  private drops: Flake[] = [];
  private hits: Hit[] = [];
  private readonly water: Raster;
  private readonly overcast: Phaser.GameObjects.Rectangle;
  private leaves: Leaf[] = [];
  private readonly piles: Pile[] = [];
  private readonly prints: Print[] = [];
  private nextPrint = 0;
  private readonly lastPrint = new WeakMap<CatView, { x: number; y: number; side: number }>();
  private wind = 0;
  /** The patter of the rain, while it rains; and when to try starting it again (the audio may not be unlocked yet). */
  private rainSound: Playing | null = null;
  private rainSoundStarting = false;
  private nextRainTry = 0;

  constructor(scene: Phaser.Scene, trees: Prop[], water: Raster) {
    this.scene = scene;
    this.trees = trees;
    this.water = water;
    // grey rain clouds over everything (under the lights of the night, which shine through them)
    this.overcast = scene.add.rectangle(0, 0, 1, 1, 0xffffff).setDepth(99995).setBlendMode(Phaser.BlendModes.MULTIPLY).setVisible(false);
    // leaf piles on the grass beside the trees, while there are leaves about and no snow
    if (SEASON.litter > 0.35 && SEASON.snow < 0.3)
      trees.forEach((t, i) => {
        const bx = t.x + TREE_W / 2, by = t.depthY;
        for (let k = 0; k < 2; k++) {
          if (hash2(i, k, 1703) > 0.75) continue;
          const side = hash2(i, k, 1704) < 0.5 ? -1 : 1;
          const x = Math.round(bx + side * (14 + hash2(i, k, 1705) * 16)), y = Math.round(by + 4 + hash2(i, k, 1706) * 12);
          const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
          if (!'.,'.includes(tileAt(tx, ty)) || furnished(tx, ty) || levelAt(tx, ty) !== levelAt(Math.floor(bx / TILE), Math.floor(by / TILE))) continue;
          const img = scene.add.image(x, y - elevAt(x, y), 'leafpile').setOrigin(0.5, 1).setDepth(y - 2);
          this.piles.push({ x, y, img, scattered: -Infinity });
        }
      });
  }

  update(gt: number, now: number, dt: number, cats: CatView[], view: Phaser.Geom.Rectangle): void {
    this.wind = Math.sin(gt / 9000) * 8 + Math.sin(gt / 2300) * 4;
    this.updateSnow(gt, dt, view);
    this.updateRain(gt, dt, view);
    this.dropLeaves(dt, view);
    this.updateLeaves(dt);
    this.updatePiles(now, cats);
    this.updatePrints(now, cats);
  }

  // ---------------------------------------------------------------- snow

  private updateSnow(gt: number, dt: number, view: Phaser.Geom.Rectangle): void {
    const want = Math.round(snowfall(gt) * FLAKES * Math.min(2, (view.width * view.height) / (320 * 240)));
    while (this.flakes.length < want) this.flakes.push(this.flake(view, true));
    for (let i = this.flakes.length - 1; i >= 0; i--) {
      const f = this.flakes[i];
      f.h -= f.vy * dt;
      f.x += (f.vx + this.wind + Math.sin(gt / 700 + f.phase) * 4) * dt;
      // landed, or blown out of view: start again up top, unless the snow is easing off
      const out = f.x < view.x - 20 || f.x > view.right + 20 || f.y < view.y - 20 || f.y > view.bottom + 40;
      if (f.h <= 0 || out) {
        if (this.flakes.length > want) { f.img.destroy(); this.flakes.splice(i, 1); continue; }
        Object.assign(f, this.flake(view, false, f.img));
      }
      f.img.setPosition(Math.round(f.x), Math.round(f.y - f.h)).setDepth(99500 + f.y);
    }
  }

  // ---------------------------------------------------------------- rain

  private updateRain(gt: number, dt: number, view: Phaser.Geom.Rectangle): void {
    const rain = rainfall(gt);
    this.rainAudio(rain);
    // the sky clouds over a little ahead of the drops
    const dim = Math.min(1, rain * 1.4) * OVERCAST;
    const grey = Math.round(255 * (1 - dim));
    this.overcast.setVisible(dim > 0.005).setFillStyle((grey << 16) | (grey << 8) | Math.min(255, grey + 12))
      .setPosition(view.centerX, view.centerY).setSize(view.width + 64, view.height + 64);
    const want = Math.round(rain * DROPS * Math.min(2, (view.width * view.height) / (320 * 240)));
    while (this.drops.length < want) this.drops.push(this.drop(view, true));
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.h -= d.vy * dt;
      d.x += (d.vx + this.wind * 3) * dt;
      if (d.h <= elevAt(d.x, d.y)) {
        this.hit(d.x, d.y);
        if (this.drops.length > want) { d.img.destroy(); this.drops.splice(i, 1); continue; }
        Object.assign(d, this.drop(view, false, d.img));
      }
      d.img.setPosition(Math.round(d.x), Math.round(d.y - d.h)).setDepth(99500 + d.y);
    }
    this.hits = this.hits.filter((h) => {
      h.t += dt;
      const life = h.ring ? 0.5 : 0.18;
      if (h.t >= life) { h.img.destroy(); return false; }
      const u = h.t / life;
      if (h.ring) h.img.setFrame(Math.min(2, Math.floor(u * 3))).setAlpha(0.7 * (1 - u));
      else h.img.setFrame(Math.min(2, Math.floor(u * 3)));
      return true;
    });
  }

  /** The rain loop: in when it rains, louder the harder it pours, out when it stops. */
  private rainAudio(rain: number): void {
    if (rain > 0.02) {
      if (this.rainSound) this.rainSound.setVolume(0.2 + rain * 0.6);
      else if (!this.rainSoundStarting && performance.now() >= this.nextRainTry) {
        this.rainSoundStarting = true;
        this.nextRainTry = performance.now() + 2000;
        void sound.play('rain', { loop: true, volume: 0.2 + rain * 0.6, fade: 3 }).then((p) => {
          this.rainSound = p;
          this.rainSoundStarting = false;
        });
      }
    } else if (this.rainSound) {
      this.rainSound.stop(4);
      this.rainSound = null;
    }
  }

  private drop(view: Phaser.Geom.Rectangle, anywhere: boolean, img?: Img): Flake {
    const x = view.x - 30 + Math.random() * (view.width + 40);
    const y = view.y + Math.random() * (view.height + 30);
    const h = anywhere ? Math.random() * 160 : 140 + Math.random() * 40;
    return { img: (img ?? this.scene.add.image(0, 0, 'raindrop')).setOrigin(0.5, 1), x, y, h, vx: 6, vy: 230 + Math.random() * 50, phase: 0 };
  }

  /** A drop landing: a ring on open water, a tiny splash anywhere else. */
  private hit(x: number, y: number): void {
    if (this.hits.length > 200) return;
    const ring = this.water.isSet(Math.round(x), Math.round(y));
    const img = ring
      ? this.scene.add.image(Math.round(x), Math.round(y), 'ripple', 0).setScale(0.5).setDepth(-99980)
      : this.scene.add.image(Math.round(x), Math.round(y - elevAt(x, y)), 'rainsplash', 0).setOrigin(0.5, 1).setDepth(y + 0.5);
    this.hits.push({ img, t: 0, ring });
  }

  private flake(view: Phaser.Geom.Rectangle, anywhere: boolean, img?: Img): Flake {
    const big = Math.random() < 0.3;
    const x = view.x - 10 + Math.random() * (view.width + 20);
    const y = view.y + Math.random() * (view.height + 40);
    const h = anywhere ? Math.random() * 120 : 80 + Math.random() * 60;
    const im = (img ?? this.scene.add.image(0, 0, 'flake-0')).setTexture(big ? 'flake-1' : 'flake-0').setAlpha(big ? 0.9 : 0.75);
    return { img: im, x, y, h, vx: Math.random() * 4 - 2, vy: big ? 16 + Math.random() * 6 : 10 + Math.random() * 6, phase: Math.random() * 6.3 };
  }

  // ---------------------------------------------------------------- leaves and petals

  private dropLeaves(dt: number, view: Phaser.Geom.Rectangle): void {
    const leafy = SEASON.falling, petals = SEASON.petals;
    if (leafy <= 0.02 && petals <= 0.02) return;
    for (const t of this.trees) {
      if (t.x + TREE_W < view.x || t.x > view.right || t.y > view.bottom || t.depthY < view.y) continue;
      const petal = t.kind === 2 && petals > leafy;
      const rate = LEAF_RATE * (petal ? petals * 2 : leafy);
      if (Math.random() > rate * dt) continue;
      // from somewhere in the crown, to the ground around the trunk
      const x = t.x + 12 + Math.random() * (TREE_W - 24), cy = t.y + 12 + Math.random() * 36;
      const y = t.depthY - 10 + Math.random() * 26;
      const img = this.scene.add.image(0, 0, petal ? 'petal' : `leaf-${Math.floor(Math.random() * LEAF_COLOURS.length)}`, 0).setOrigin(0.5, 1);
      this.leaves.push({ img, x, y, h: y - cy + elevAt(x, y), vx: Math.random() * 6 - 3, vh: petal ? 9 : 12 + Math.random() * 6, t: 0, lie: 0, phase: Math.random() * 6.3, petal });
    }
  }

  /** A puff of leaves from a pile. */
  private burst(x: number, y: number): void {
    for (let i = 0; i < 14; i++) {
      const img = this.scene.add.image(0, 0, `leaf-${Math.floor(Math.random() * LEAF_COLOURS.length)}`, 0).setOrigin(0.5, 1);
      this.leaves.push({ img, x: x + Math.random() * 12 - 6, y: y + Math.random() * 4 - 2, h: elevAt(x, y) + 1, vx: Math.random() * 50 - 25, vh: -(30 + Math.random() * 30), t: 0, lie: 0, phase: Math.random() * 6.3, petal: false });
    }
  }

  private updateLeaves(dt: number): void {
    this.leaves = this.leaves.filter((l) => {
      const ground = elevAt(l.x, l.y);
      if (l.lie) {
        l.lie += dt;
        l.img.setAlpha(Math.min(1, (LEAF_LIE - l.lie) / 2));
        if (l.lie < LEAF_LIE) return true;
        l.img.destroy();
        return false;
      }
      l.t += dt;
      // thrown up out of a pile, they slow and drift down like the rest
      if (l.vh < 0) l.vh = Math.min(l.petal ? 9 : 14, l.vh + 90 * dt);
      l.h -= l.vh * dt;
      l.vx *= 1 - Math.min(1, 1.5 * dt);
      l.x += (l.vx + this.wind * 0.6 + Math.sin(l.t * 2.4 + l.phase) * 10) * dt;
      if (l.h <= ground) {
        l.h = ground;
        l.lie = 0.001;
        l.img.setFrame(0).setDepth(l.y - 3);
      } else l.img.setFrame(Math.sin(l.t * 7 + l.phase) > 0 ? 0 : 1).setDepth(l.y + 1);
      l.img.setPosition(Math.round(l.x), Math.round(l.y - l.h));
      return true;
    });
  }

  private updatePiles(now: number, cats: CatView[]): void {
    for (const p of this.piles) {
      const since = now - p.scattered;
      p.img.setAlpha(since < PILE_BACK ? Math.max(0, (since - PILE_BACK + 4000) / 4000) : 1);
      if (since < PILE_BACK) continue;
      for (const c of cats) {
        const dx = (c.x - p.x) / 10, dy = (c.y - p.y) / 6;
        // running, pouncing or landing in it
        if (dx * dx + dy * dy < 1 && Math.abs(c.z - elevAt(p.x, p.y)) < 3 && (c.speed > 30 || c.act === Act.Catch)) {
          p.scattered = now;
          this.burst(p.x, p.y);
          void sound.play('rustle', { at: { x: p.x, y: p.y }, volume: 0.5, rate: 0.9 + Math.random() * 0.2 });
          break;
        }
      }
    }
  }

  // ---------------------------------------------------------------- paw prints

  private updatePrints(now: number, cats: CatView[]): void {
    if (SEASON.snow >= 0.4)
      for (const c of cats) {
        const ground = elevAt(c.x, c.y);
        let last = this.lastPrint.get(c);
        if (!last) this.lastPrint.set(c, (last = { x: c.x, y: c.y, side: 1 }));
        const dx = c.x - last.x, dy = c.y - last.y, d = Math.hypot(dx, dy);
        if (d < STRIDE) continue;
        last.x = c.x;
        last.y = c.y;
        // on the snow, on its feet: not mid-jump, on the ice or on the bridges
        if (c.act === Act.Jump || Math.abs(c.z - ground) > 1 || iceAt(c.x, c.y) || tileAt(Math.floor(c.x / TILE), Math.floor(c.y / TILE)) === 'B' || d > 30) continue;
        last.side = -last.side;
        const px = c.x - (dy / d) * 2 * last.side, py = c.y + (dx / d) * 1.2 * last.side;
        let pr = this.prints[this.nextPrint];
        if (!pr) this.prints.push((pr = { img: this.scene.add.image(0, 0, 'paw'), t: 0 }));
        this.nextPrint = (this.nextPrint + 1) % PRINTS;
        // on the lawn just above the ground; up on a plateau just above its row of terrain
        pr.t = now;
        pr.img.setPosition(Math.round(px), Math.round(py - ground)).setDepth(ground > 0 ? Math.floor(py / TILE) * TILE + 0.002 : -99996).setVisible(true);
      }
    for (const p of this.prints) {
      if (!p.img.visible) continue;
      const age = (now - p.t) / PRINT_MS;
      if (age >= 1) p.img.setVisible(false);
      else p.img.setAlpha(0.9 * (1 - age * age));
    }
  }
}

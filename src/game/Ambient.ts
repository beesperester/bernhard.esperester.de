import Phaser from 'phaser';
import type { Raster } from '../art/raster.ts';
import { BUTTERFLY_COLOURS, RIPPLE_FRAMES, Z_SIZES } from '../art/critters.ts';
import { Act, Facing } from './state.ts';
import type { CatView } from './CatView.ts';

type Img = Phaser.GameObjects.Image;
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)];

const MAX_RESTING_BUTTERFLIES = 6;
const BEES = 6;
/** Faster than walking means dashing: kick up dust. */
const DUST_SPEED = 110;

interface Butterfly {
  img: Img; shadow: Img;
  state: 'land' | 'rest' | 'fly';
  x: number; y: number; h: number;
  vx: number; vy: number; vh: number;
  t: number; flapAt: number;
}

interface Bee {
  img: Img;
  home: [number, number];
  x: number; y: number;
  a: number; r: number; spin: number;
  t: number; life: number; retarget: number;
}

interface Particle {
  img: Img;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  t: number; life: number;
  kind: 'ripple' | 'drop' | 'z' | 'dust';
  delay: number;
}

/** Butterflies, bees, jumping koi, sleepy Zs and dash dust. Purely local eye candy. */
export class Ambient {
  private readonly scene: Phaser.Scene;
  private readonly flowers: [number, number][];
  private readonly water: Raster;
  private readonly pond: { x: number; y: number; w: number; h: number };
  private butterflies: Butterfly[] = [];
  private bees: Bee[] = [];
  private particles: Particle[] = [];
  private fish: { img: Img; x0: number; y: number; dir: number; t: number } | null = null;
  private nextFish = rand(3000, 7000);
  private nextButterfly = 500;
  private perCat = new WeakMap<CatView, { nextZ: number; nextDust: number }>();

  constructor(
    scene: Phaser.Scene,
    opts: { flowers: [number, number][]; water: Raster; pond: { x: number; y: number; w: number; h: number } },
  ) {
    this.scene = scene;
    this.flowers = opts.flowers;
    this.water = opts.water;
    this.pond = opts.pond;
    for (let i = 0; i < 4; i++) this.spawnButterfly(true);
    for (let i = 0; i < BEES; i++) this.spawnBee(rand(0, 20000));
  }

  update(time: number, dt: number, cats: CatView[]): void {
    this.updateButterflies(time, dt, cats);
    this.updateBees(time, dt);
    this.updateFish(dt);
    this.updateCats(time, cats);
    this.updateParticles(dt);
  }

  // ---- butterflies ----

  private spawnButterfly(resting: boolean): void {
    const [x, y] = pick(this.flowers);
    const img = this.scene.add.image(x, y, `butterfly-${Math.floor(Math.random() * BUTTERFLY_COLOURS.length)}`, 0).setOrigin(0.5, 1);
    const shadow = this.scene.add.image(x, y, 'shadow').setScale(0.4, 0.5).setAlpha(0.15).setDepth(y - 1);
    this.butterflies.push({
      img, shadow, state: resting ? 'rest' : 'land',
      x, y, h: resting ? 3 : 40, vx: rand(-6, 6), vy: 0, vh: -28,
      t: 0, flapAt: rand(500, 2000),
    });
  }

  private updateButterflies(time: number, dt: number, cats: CatView[]): void {
    const resting = this.butterflies.filter((b) => b.state !== 'fly').length;
    this.nextButterfly -= dt * 1000;
    if (this.nextButterfly <= 0) {
      if (resting < MAX_RESTING_BUTTERFLIES) this.spawnButterfly(false);
      this.nextButterfly = rand(3000, 8000);
    }

    for (const b of [...this.butterflies]) {
      b.t += dt;
      if (b.state === 'land') {
        // flutter down onto a flower
        b.h = Math.max(3, b.h + b.vh * dt);
        b.x += Math.sin(b.t * 5) * 8 * dt + b.vx * dt * (b.h / 40);
        b.img.setFrame(Math.floor(time / 90) % 2).setAlpha(Math.min(1, b.t * 2));
        if (b.h <= 3) { b.state = 'rest'; b.t = 0; }
      } else if (b.state === 'rest') {
        // slowly open and close the wings
        b.flapAt -= dt * 1000;
        if (b.flapAt <= 0) {
          b.img.setFrame(b.img.frame.name === '0' ? 1 : 0);
          b.flapAt = rand(400, 2200);
        }
        const near = cats.some((c) => Math.hypot(c.x - b.x, c.y - b.y) < 24);
        if (near || Math.random() < dt * 0.03) {
          const c = cats.reduce((a, c2) => (Math.hypot(c2.x - b.x, c2.y - b.y) < Math.hypot(a.x - b.x, a.y - b.y) ? c2 : a), cats[0]);
          const away = Math.sign(b.x - c.x) || pick([-1, 1]);
          b.state = 'fly';
          b.t = 0;
          b.vx = away * rand(14, 26);
          b.vy = rand(-12, 6);
          b.vh = rand(20, 30);
        }
      } else {
        // fly up and away in a wobbly path, then fade out
        b.x += (b.vx + Math.sin(b.t * 6) * 10) * dt;
        b.y += b.vy * dt;
        b.h += b.vh * dt * Math.max(0.15, 1 - b.t / 3) + Math.sin(b.t * 9) * 0.3;
        b.img.setFrame(Math.floor(time / 70) % 2).setAlpha(Math.min(1, Math.max(0, (7 - b.t) / 1.5)));
        if (b.t > 7) {
          b.img.destroy();
          b.shadow.destroy();
          this.butterflies.splice(this.butterflies.indexOf(b), 1);
          continue;
        }
      }
      b.img.setPosition(Math.round(b.x), Math.round(b.y - b.h)).setDepth(b.h > 14 ? 99000 + b.y : b.y);
      b.shadow.setPosition(Math.round(b.x), Math.round(b.y)).setAlpha(Math.max(0, 0.18 - b.h * 0.004));
    }
  }

  // ---- bees ----

  private spawnBee(delay: number): void {
    const home = pick(this.flowers);
    const img = this.scene.add.image(home[0], home[1], 'bee', 0).setOrigin(0.5, 1).setVisible(false);
    this.bees.push({
      img, home, x: home[0] + rand(-30, 30), y: home[1] + rand(-20, 10),
      a: rand(0, 6.28), r: rand(4, 9), spin: pick([-1, 1]) * rand(2.5, 4.5),
      t: -delay / 1000, life: rand(25, 50), retarget: rand(2, 6),
    });
  }

  private updateBees(time: number, dt: number): void {
    for (const b of [...this.bees]) {
      b.t += dt;
      if (b.t < 0) continue;
      b.img.setVisible(true);
      b.retarget -= dt;
      if (b.retarget <= 0) {
        // hop to a nearby flower
        const near = this.flowers.filter(([x, y]) => Math.hypot(x - b.home[0], y - b.home[1]) < 72);
        b.home = pick(near.length ? near : this.flowers);
        b.retarget = rand(2.5, 7);
      }
      b.a += b.spin * dt;
      const tx = b.home[0] + Math.cos(b.a) * b.r + Math.sin(time / 97) * 1.2;
      const ty = b.home[1] + Math.sin(b.a) * b.r * 0.5;
      const k = Math.min(1, dt * 3);
      b.x += (tx - b.x) * k;
      b.y += (ty - b.y) * k;
      const h = 7 + Math.sin(b.t * 4) * 2;
      const fade = Math.min(1, b.t, b.life - b.t);
      b.img
        .setFrame(Math.floor(time / 40) % 2)
        .setPosition(Math.round(b.x), Math.round(b.y - h))
        .setDepth(b.y)
        .setAlpha(Math.max(0, fade));
      if (b.t > b.life) {
        b.img.destroy();
        this.bees.splice(this.bees.indexOf(b), 1);
        this.spawnBee(rand(3000, 15000));
      }
    }
  }

  // ---- fish ----

  /** A random spot of open water with some room around it. */
  private waterSpot(): [number, number] | null {
    const m = this.water, p = this.pond;
    const open = (x: number, y: number) => m.isSet(Math.round(x), Math.round(y));
    for (let i = 0; i < 40; i++) {
      const x = p.x + rand(10, p.w - 10), y = p.y + rand(8, p.h - 6);
      if ([[0, 0], [-12, 0], [12, 0], [0, -5], [0, 5], [-24, 0], [24, 0]].every(([dx, dy]) => open(x + dx, y + dy))) return [x, y];
    }
    return null;
  }

  private updateFish(dt: number): void {
    if (!this.fish) {
      this.nextFish -= dt * 1000;
      if (this.nextFish > 0) return;
      this.nextFish = rand(4000, 11000);
      const spot = this.waterSpot();
      if (!spot) return;
      const [x, y] = spot;
      const dir = pick([-1, 1]);
      // the fish breaks the surface a moment before it leaps
      this.ripple(x, y, 0);
      this.fish = { img: this.scene.add.image(x, y, 'fish').setFlipX(dir < 0).setVisible(false), x0: x, y, dir, t: -0.35 };
      return;
    }
    const f = this.fish;
    const wasUnder = f.t < 0;
    f.t += dt / 0.75;
    if (f.t < 0) return;
    if (wasUnder) this.splash(f.x0, f.y, f.dir);
    if (f.t >= 1) {
      const x = f.x0 + f.dir * 20;
      this.ripple(x, f.y, 0);
      this.ripple(x, f.y, 0.3);
      this.splash(x, f.y, f.dir);
      f.img.destroy();
      this.fish = null;
      return;
    }
    const h = 14 * 4 * f.t * (1 - f.t);
    // nose up, level, nose down, in 45° steps to stay pixel-crisp
    const tilt = Math.round((1 - 2 * f.t) * 1.4) * (Math.PI / 4);
    f.img
      .setVisible(true)
      .setPosition(Math.round(f.x0 + f.dir * 20 * f.t), Math.round(f.y - h))
      .setRotation(-tilt * f.dir)
      .setDepth(f.y);
  }

  private ripple(x: number, y: number, delay: number): void {
    const img = this.scene.add.image(Math.round(x), Math.round(y), 'ripple', 0).setDepth(-99980).setVisible(false);
    this.particles.push({ img, x, y, z: 0, vx: 0, vy: 0, vz: 0, t: 0, life: 1.2, kind: 'ripple', delay });
  }

  private splash(x: number, y: number, dir: number): void {
    for (let i = 0; i < 7; i++) {
      const img = this.scene.add.image(x, y, 'drop');
      this.particles.push({
        img, x: x + rand(-3, 3), y: y + rand(-1, 1), z: 1,
        vx: rand(-18, 18) + dir * 8, vy: rand(-4, 4), vz: rand(25, 55),
        t: 0, life: 2, kind: 'drop', delay: 0,
      });
    }
  }

  // ---- cats: sleepy Zs and dash dust ----

  private updateCats(time: number, cats: CatView[]): void {
    for (const c of cats) {
      let s = this.perCat.get(c);
      if (!s) this.perCat.set(c, (s = { nextZ: 0, nextDust: 0 }));
      if (c.act === Act.Sleep && time >= s.nextZ) {
        s.nextZ = time + 850;
        const head = c.facing === Facing.Right ? 4 : -4;
        const img = this.scene.add.image(0, 0, 'z-0').setDepth(100000);
        this.particles.push({
          img, x: c.x + head, y: c.y - 8 - c.z, z: 0,
          vx: rand(4, 8), vy: -9, vz: 0, t: 0, life: 2.4, kind: 'z', delay: 0,
        });
      }
      if (c.speed > DUST_SPEED && c.act !== Act.Jump && time >= s.nextDust) {
        s.nextDust = time + 70;
        const back = c.facing === Facing.Left ? 5 : c.facing === Facing.Right ? -5 : 0;
        const img = this.scene.add.image(0, 0, 'dust', 0).setDepth(c.y - 1);
        this.particles.push({
          img, x: c.x + back + rand(-1, 1), y: c.y - 1 - c.z, z: 0,
          vx: back * 2, vy: -4, vz: 0, t: 0, life: 0.36, kind: 'dust', delay: 0,
        });
      }
    }
  }

  private updateParticles(dt: number): void {
    for (const p of [...this.particles]) {
      if (p.delay > 0) { p.delay -= dt; continue; }
      p.t += dt;
      const u = p.t / p.life;
      let dead = u >= 1;
      switch (p.kind) {
        case 'ripple':
          p.img.setVisible(true).setFrame(Math.min(RIPPLE_FRAMES - 1, Math.floor(u * RIPPLE_FRAMES))).setAlpha(1 - u);
          break;
        case 'drop':
          p.vz -= 220 * dt;
          p.z += p.vz * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          if (p.z <= 0) dead = true;
          p.img.setPosition(Math.round(p.x), Math.round(p.y - p.z)).setDepth(p.y + 1);
          break;
        case 'z': {
          // drifts up from the cat, growing as it goes, then fades
          p.x += (p.vx + Math.sin(p.t * 3) * 6) * dt;
          p.y += p.vy * dt;
          const size = Math.min(Z_SIZES.length - 1, Math.floor(u * Z_SIZES.length));
          p.img.setTexture(`z-${size}`).setPosition(Math.round(p.x), Math.round(p.y)).setAlpha(u > 0.75 ? (1 - u) / 0.25 : 1);
          break;
        }
        case 'dust':
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.img.setFrame(Math.min(2, Math.floor(u * 3))).setPosition(Math.round(p.x), Math.round(p.y)).setAlpha(1 - u * 0.5);
          break;
      }
      if (dead) {
        p.img.destroy();
        this.particles.splice(this.particles.indexOf(p), 1);
      }
    }
  }
}

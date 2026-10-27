import Phaser from 'phaser';
import { PUFF_FRAMES, RIPPLE_FRAMES, Z_SIZES } from '../../art/critters.ts';
import { sound } from '../../audio/sound.ts';
import { Act, Facing } from '../state.ts';
import type { CatView } from '../CatView.ts';
import { DEPTH } from '../Daylight.ts';
import { wetAt } from '../../world/map.ts';
import { clamp01, lerp } from './kit.ts';

// Short-lived effects: ripples and splashes on the water, feathers, a caught
// firefly's last glow, sleep Zs, dash dust and clouds, and prey flying into a
// cat's mouth. They are cosmetic and local (random, not synced), and their
// images are recycled rather than made and destroyed for every one.

type Img = Phaser.GameObjects.Image;

/** Above everything in the world, below the UI. */
const ON_TOP = 100000;
/** A cat faster than this is dashing (and kicks up dust). */
export const DASH_SPEED = 110;
/** Drops fall this fast (px/s²). */
const DROP_GRAVITY = 220;

type Kind = 'ripple' | 'drop' | 'z' | 'dust' | 'leap' | 'feather' | 'puff' | 'cloud';

interface Particle {
  img: Img; kind: Kind;
  /** Position on the ground (x, y), height z above it, and their velocities (px/s). */
  x: number; y: number; z: number; vx: number; vy: number; vz: number;
  /** Seconds since it started, how long it lasts, and how long before it starts. */
  t: number; life: number; delay: number;
  /** The cat a 'leap' flies to. */
  cat?: CatView;
  /** Draw order, if not by its own ground position. */
  depth?: number;
  /** A 'z' over someone else's cat: small and faint, so a sleeper can hide. */
  small?: boolean;
}

type Spawn = Omit<Particle, 'img' | 't' | 'z' | 'vx' | 'vy' | 'vz' | 'delay'> & Partial<Pick<Particle, 'z' | 'vx' | 'vy' | 'vz' | 'delay'>>;

export class Effects {
  private readonly scene: Phaser.Scene;
  private particles: Particle[] = [];
  /** Images of finished particles, ready to be reused. */
  private readonly spare: Img[] = [];
  private readonly perCat = new WeakMap<CatView, { nextZ: number; nextDust: number; wet: boolean; dashing: boolean; dashEnd: number }>();

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  // ---------------------------------------------------------------- water

  /** A ring spreading on the water, starting after `delay` seconds (`scale` < 1 for a little one, as in a puddle). */
  ripple(x: number, y: number, delay = 0, scale = 1): void {
    const img = this.image('ripple', 0).setPosition(Math.round(x), Math.round(y)).setDepth(-99980).setScale(scale).setVisible(false);
    this.add(img, { kind: 'ripple', x, y, life: 1.2, delay });
  }

  /** Drops thrown up out of the water, a little towards `dir` (-1 left, 1 right). */
  splash(x: number, y: number, dir: number): void {
    for (let i = 0; i < 7; i++)
      this.add(this.image('drop'), {
        kind: 'drop', x: x + Math.random() * 6 - 3, y: y + Math.random() * 2 - 1, z: 1,
        vx: Math.random() * 36 - 18 + dir * 8, vy: Math.random() * 8 - 4, vz: 25 + Math.random() * 30, life: 2,
      });
  }

  /** A few small drops (a bird bathing), drawn at `depth`. */
  drops(x: number, y: number, depth: number): void {
    for (let i = 0; i < 3; i++)
      this.add(this.image('drop'), {
        kind: 'drop', x: x + Math.random() * 4 - 2, y, z: 1, vx: Math.random() * 30 - 15, vz: 20 + Math.random() * 20, life: 1, depth,
      });
  }

  splashSound(x: number, y: number, volume: number, rate: number): void {
    void sound.play('splash', { at: { x, y }, volume, rate: rate * (0.92 + Math.random() * 0.16) });
  }

  /** The full splash of something landing in the water. */
  plunge(x: number, y: number, volume: number, rate: number): void {
    this.splashSound(x, y, volume, rate);
    this.splash(x, y, 0);
    this.ripple(x, y, 0);
    this.ripple(x, y, 0.25);
  }

  // ---------------------------------------------------------------- catches

  /** Feathers bursting from a caught bird at (x, y). */
  feathers(x: number, y: number, colour: number): void {
    for (let i = 0; i < 6; i++)
      this.add(this.image(`feather-${colour}`).setDepth(ON_TOP), {
        kind: 'feather', x: x + Math.random() * 6 - 3, y, vx: Math.random() * 30 - 15, vy: -10 - Math.random() * 14, life: 1.4 + Math.random() * 0.8,
      });
  }

  /** A caught firefly's light swelling and going out. */
  glowPuff(x: number, y: number): void {
    const img = this.image('glow-puff').setPosition(x, y).setDepth(DEPTH.glow).setBlendMode(Phaser.BlendModes.ADD);
    this.add(img, { kind: 'puff', x, y, life: 0.7 });
  }

  /** `img` (a picture of the prey) flies in an arc from where it is into the cat's mouth. */
  leap(img: Img, cat: CatView, seconds: number): void {
    this.add(img.setDepth(ON_TOP), { kind: 'leap', x: img.x, y: img.y, life: seconds, cat });
  }

  /** An image to give to `leap`, with the same look as a pooled one. */
  image(texture: string, frame: string | number = 0): Img {
    const img = this.spare.pop() ?? this.scene.add.image(0, 0, texture, frame);
    return img.setActive(true).setVisible(true).setTexture(texture, frame).setAlpha(1).setRotation(0).setFlipX(false).setOrigin(0.5)
      .setScale(1).setBlendMode(Phaser.BlendModes.NORMAL).setDepth(0);
  }

  // ---------------------------------------------------------------- cats

  /** Splashes, sleep Zs, dash clouds and dust that follow what the cats do. */
  followCats(cats: CatView[], now: number): void {
    for (const c of cats) {
      let s = this.perCat.get(c);
      if (!s) this.perCat.set(c, (s = { nextZ: 0, nextDust: 0, wet: false, dashing: false, dashEnd: 0 }));

      // splash whenever a cat touches down in the pond
      const wet = c.z < 4 && wetAt(c.x, c.y);
      if (wet && !s.wet) {
        this.plunge(c.x, c.y, 0.75, 1);
        this.splash(c.x, c.y, 0);
      }
      s.wet = wet;

      if (c.act === Act.Sleep && now >= s.nextZ) {
        const head = c.facing === Facing.Right ? 4 : -4;
        // our own cat's Zs float over everything; another cat's are few and tiny, and stay
        // behind whatever it is curled up in (a bush, a crown), so a sleeper is easy to miss
        if (c.local) {
          s.nextZ = now + 850;
          this.add(this.image('z-0').setDepth(ON_TOP), { kind: 'z', x: c.x + head, y: c.y - 8 - c.z, vx: 4 + Math.random() * 4, vy: -9, life: 2.4 });
        } else {
          s.nextZ = now + 1700;
          this.add(this.image('z-0').setDepth(c.depth + 0.4), { kind: 'z', x: c.x + head, y: c.y - 6 - c.z, vx: 2 + Math.random() * 2, vy: -5, life: 1.6, small: true });
        }
      }

      const dashing = c.speed > DASH_SPEED && c.act !== Act.Jump;
      // a cartoon cloud left hanging where the cat shot off
      if (dashing && !s.dashing && now - s.dashEnd > 350) {
        const back = c.facing === Facing.Left ? 4 : c.facing === Facing.Right ? -4 : 0;
        const backY = c.facing === Facing.Up ? 3 : c.facing === Facing.Down ? -3 : 0;
        this.add(this.image('dash-puff', 0).setOrigin(0.5, 1), {
          kind: 'cloud', x: c.x + back, y: c.y + 1 + backY - c.z, vx: back * 1.5, vy: -3, life: 0.5, depth: c.y + backY,
        });
      }
      if (s.dashing && !dashing) s.dashEnd = now;
      s.dashing = dashing;
      if (dashing && now >= s.nextDust) {
        s.nextDust = now + 70;
        const back = c.facing === Facing.Left ? 5 : c.facing === Facing.Right ? -5 : 0;
        this.add(this.image('dust', 0).setDepth(c.y - 1), {
          kind: 'dust', x: c.x + back + Math.random() * 2 - 1, y: c.y - 1 - c.z, vx: back * 2, vy: -4, life: 0.36,
        });
      }
    }
  }

  // ---------------------------------------------------------------- update

  /** Move everything on by `dt` seconds. */
  update(dt: number): void {
    const keep: Particle[] = [];
    for (const p of this.particles) {
      if (p.delay > 0) { p.delay -= dt; keep.push(p); continue; }
      p.t += dt;
      const u = p.t / p.life;
      let dead = u >= 1;
      switch (p.kind) {
        case 'ripple':
          p.img.setVisible(true).setFrame(Math.min(RIPPLE_FRAMES - 1, Math.floor(u * RIPPLE_FRAMES))).setAlpha(1 - u);
          break;
        case 'drop':
          p.vz -= DROP_GRAVITY * dt;
          p.z += p.vz * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          if (p.z <= 0) dead = true;
          p.img.setPosition(Math.round(p.x), Math.round(p.y - p.z)).setDepth(p.depth ?? p.y + 1);
          break;
        case 'z': {
          // drifts up from the cat, growing as it goes, then fades
          p.x += (p.vx + Math.sin(p.t * 3) * (p.small ? 2 : 6)) * dt;
          p.y += p.vy * dt;
          const sizes = p.small ? 2 : Z_SIZES.length;
          const size = Math.min(sizes - 1, Math.floor(u * sizes));
          p.img.setTexture(`z-${size}`).setPosition(Math.round(p.x), Math.round(p.y)).setAlpha((u > 0.75 ? (1 - u) / 0.25 : 1) * (p.small ? 0.6 : 1));
          break;
        }
        case 'dust':
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.img.setFrame(Math.min(2, Math.floor(u * 3))).setPosition(Math.round(p.x), Math.round(p.y)).setAlpha(1 - u * 0.5);
          break;
        case 'cloud':
          // drifts off a little, slowing, while it swells and breaks up
          p.x += p.vx * dt * (1 - u);
          p.y += p.vy * dt;
          p.img.setFrame(Math.min(PUFF_FRAMES - 1, Math.floor(u * PUFF_FRAMES))).setPosition(Math.round(p.x), Math.round(p.y)).setDepth(p.depth!);
          break;
        case 'puff':
          p.img.setScale(1 + u * 1.5).setAlpha(1 - u);
          break;
        case 'feather':
          // burst up, then sway down slowly
          p.vy = Math.min(p.vy + 40 * dt, 9);
          p.vx *= 1 - 2 * dt;
          p.x += (p.vx + Math.sin(p.t * 7 + p.life * 10) * 8) * dt;
          p.y += p.vy * dt;
          p.img.setPosition(Math.round(p.x), Math.round(p.y)).setAlpha(u > 0.6 ? (1 - u) / 0.4 : 1);
          break;
        case 'leap': {
          // an arc from where it was caught into the cat's mouth
          const c = p.cat!;
          const mx = c.x + (c.facing === Facing.Right ? 6 : c.facing === Facing.Left ? -6 : 0), my = c.y - 7 - c.z;
          const e = clamp01(u);
          p.img.setFlipX(mx > p.x).setPosition(Math.round(lerp(p.x, mx, e)), Math.round(lerp(p.y, my, e) - 12 * 4 * e * (1 - e)));
          break;
        }
      }
      if (dead) {
        p.img.setVisible(false).setActive(false);
        this.spare.push(p.img);
      } else keep.push(p);
    }
    this.particles = keep;
  }

  private add(img: Img, spawn: Spawn): void {
    this.particles.push({ img, z: 0, vx: 0, vy: 0, vz: 0, delay: 0, ...spawn, t: 0 });
  }
}

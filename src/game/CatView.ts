import Phaser from 'phaser';
import { Act, Facing, frameFor, type CatMsg } from './state.ts';
import { COATS } from '../art/cat.ts';
import { WORLD_W, WORLD_H, groundAt } from '../world/map.ts';

/** Draws one cat (local or remote): shadow, sprite and emote bubble. */
export class CatView {
  x: number;
  y: number;
  facing: Facing = Facing.Down;
  act: Act = Act.Idle;
  seq = 0;
  actStart = 0;
  coat: number;
  /** Height above the ground plane (standing on a hedge, mid-jump, …). */
  z = 0;
  /** Last rendered sheet frame, for reflections. */
  frame = 0;

  readonly shadow: Phaser.GameObjects.Image;
  private readonly sprite: Phaser.GameObjects.Sprite;
  private readonly bubble: Phaser.GameObjects.Image;

  constructor(scene: Phaser.Scene, x: number, y: number, coat: number) {
    this.x = x;
    this.y = y;
    this.coat = ((coat % COATS.length) + COATS.length) % COATS.length;
    this.shadow = scene.add.image(x, y, 'shadow').setOrigin(0.5, 0.5).setAlpha(0.22);
    this.sprite = scene.add.sprite(x, y, `cat-${this.coat}`, 0).setOrigin(0.5, 1);
    this.bubble = scene.add.image(x, y, 'bubble-hiss').setOrigin(0.5, 1).setVisible(false);
  }

  setAct(act: Act, now: number): void {
    this.act = act;
    this.actStart = now;
  }

  render(now: number): void {
    const ms = now - this.actStart;
    const z = this.z;
    const x = Math.round(this.x), y = Math.round(this.y);
    // the shadow lies on whatever surface is below the cat
    this.shadow.setPosition(x, y - 1 - groundAt(this.x, this.y)).setDepth(y - 0.5);
    this.sprite.setPosition(x, y - Math.round(z)).setDepth(y);
    this.frame = frameFor(this.act, this.facing, ms, now);
    this.sprite.setFrame(this.frame);

    const emote = this.act === Act.Hiss ? 'bubble-hiss' : this.act === Act.Roll ? 'bubble-roll' : null;
    this.bubble.setVisible(!!emote);
    if (emote) {
      const bob = Math.floor(ms / 250) % 2;
      const top = (this.act === Act.Roll ? y - 12 : y - 17) - Math.round(z);
      this.bubble.setTexture(emote).setPosition(x + 4, top - bob).setDepth(100000);
    }
  }

  destroy(): void {
    this.shadow.destroy();
    this.sprite.destroy();
    this.bubble.destroy();
  }
}

/** Another visitor's cat, smoothly following the states they send. */
export class RemoteCat extends CatView {
  tx: number;
  ty: number;
  tz: number;
  lastSeen = 0;

  constructor(scene: Phaser.Scene, msg: CatMsg, now: number) {
    super(scene, msg[0], msg[1], msg[6]);
    this.tx = msg[0];
    this.ty = msg[1];
    this.z = this.tz = msg[2];
    this.apply(msg, now);
  }

  apply(msg: CatMsg, now: number): void {
    const [x, y, z, facing, act, seq] = msg;
    this.tx = Phaser.Math.Clamp(x, 0, WORLD_W);
    this.ty = Phaser.Math.Clamp(y, 0, WORLD_H);
    this.tz = Phaser.Math.Clamp(z, 0, 40);
    this.facing = Phaser.Math.Clamp(facing, 0, 3) as Facing;
    const a = Phaser.Math.Clamp(act, 0, 6) as Act;
    if (a !== this.act || seq !== this.seq) this.setAct(a, now);
    this.seq = seq;
    this.lastSeen = now;
  }

  step(dt: number): void {
    this.z += (this.tz - this.z) * Math.min(1, dt * 20);
    const dx = this.tx - this.x, dy = this.ty - this.y;
    if (Math.hypot(dx, dy) > 64) {
      this.x = this.tx;
      this.y = this.ty;
      return;
    }
    const k = Math.min(1, dt * 12);
    this.x += dx * k;
    this.y += dy * k;
  }
}

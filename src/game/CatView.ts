import Phaser from 'phaser';
import { Act, ACT_MAX, EAT_MS, MUNCH_MS, Facing, frameFor, type CatMsg } from './state.ts';
import { CAT, COATS } from '../art/cat.ts';
import { WORLD_W, WORLD_H, groundAt, terrainCover } from '../world/map.ts';
import { DEPTH } from './Daylight.ts';

/** Colour of a cat hidden behind a hill. */
const SILHOUETTE = 0x5ee86a;

/** Names float over everything but the emotes, the same size at any zoom. */
const LABEL_DEPTH = 99999.6, LABEL_PX = 10;

/** Light shared by all cats, set by the scene every frame. */
export const catLight = {
  /** Sunlit rim strength (0 = none) and colour. */
  rim: 0,
  rimColour: 0xffffff,
  /** 0 by day, 1 at night: how much eyes glow. */
  night: 0,
  /** True if something stands in front of world point (x, y) for a cat whose feet are at feetY. */
  occluded: (_x: number, _y: number, _feetY: number): boolean => false,
};

/** Draws one cat (local or remote): shadow, sprite and emote bubble. */
export class CatView {
  x: number;
  y: number;
  facing: Facing = Facing.Down;
  act: Act = Act.Idle;
  seq = 0;
  actStart = 0;
  coat: number;
  /** Peer id (or our own id), used to seed effects identically for everyone. */
  id = '';
  /** Height above the ground plane (standing on a hedge, mid-jump, …). */
  z = 0;
  /** Last rendered sheet frame, for reflections. */
  frame = 0;
  /** Smoothed ground speed in px/s (dashing cats kick up dust). */
  speed = 0;
  private last = { x: 0, y: 0, t: -1 };
  /** Our own cat: shown through trees and hills. Others hide behind them like anything else. */
  readonly local: boolean;
  /** What is in its mouth while eating (fish, bird or frog). */
  heldKey = 'held-fish';
  /** Shown under the cat. */
  name = '';

  readonly shadow: Phaser.GameObjects.Image;
  private readonly sprite: Phaser.GameObjects.Sprite;
  private readonly bubble: Phaser.GameObjects.Image;
  private readonly held: Phaser.GameObjects.Image;
  /** A solid green silhouette, drawn over the hill where it hides the cat. */
  private readonly ghost: Phaser.GameObjects.Sprite;
  private readonly rim: Phaser.GameObjects.Sprite;
  private readonly eyes: Phaser.GameObjects.Sprite;
  private readonly label: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene, x: number, y: number, coat: number, local = false) {
    this.x = x;
    this.y = y;
    this.local = local;
    this.coat = ((coat % COATS.length) + COATS.length) % COATS.length;
    this.shadow = scene.add.image(x, y, 'shadow').setOrigin(0.5, 0.5).setAlpha(0.22);
    this.sprite = scene.add.sprite(x, y, `cat-${this.coat}`, 0).setOrigin(0.5, 1);
    this.bubble = scene.add.image(x, y, 'bubble-hiss').setOrigin(0.5, 1).setVisible(false);
    this.held = scene.add.image(x, y, 'held-fish', 0).setVisible(false);
    this.ghost = scene.add.sprite(x, y, `cat-${this.coat}`, 0).setOrigin(0.5, 1).setDepth(98000).setVisible(false)
      .setTint(SILHOUETTE).setTintMode(Phaser.TintModes.FILL);
    this.rim = scene.add.sprite(x, y, 'cat-rim', 0).setOrigin(0.5, 1).setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
    this.eyes = scene.add.sprite(x, y, `cat-eyes-${this.coat}`, 0).setOrigin(0.5, 1).setDepth(DEPTH.glow)
      .setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
    // drawn at screen resolution and shrunk by the zoom, so the letters stay sharp
    this.label = scene.add.text(x, y, '', {
      fontFamily: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
      fontSize: `${LABEL_PX}px`,
      fontStyle: 'bold',
      color: local ? '#ffe890' : '#fff4dc',
      stroke: '#183018',
      strokeThickness: 3,
      resolution: Math.max(1, window.devicePixelRatio || 1),
    }).setOrigin(0.5, 0).setDepth(LABEL_DEPTH);
  }

  setAct(act: Act, now: number): void {
    this.act = act;
    this.actStart = now;
  }

  render(now: number): void {
    const ms = now - this.actStart;
    const z = this.z;
    const x = Math.round(this.x), y = Math.round(this.y);
    const dtm = now - this.last.t;
    if (this.last.t >= 0 && dtm > 0) {
      const inst = Math.hypot(this.x - this.last.x, this.y - this.last.y) / (dtm / 1000);
      this.speed += (inst - this.speed) * Math.min(1, dtm / 150);
    }
    this.last = { x: this.x, y: this.y, t: now };
    // the shadow lies on whatever surface is below the cat
    this.shadow.setPosition(x, y - 1 - groundAt(this.x, this.y)).setDepth(y - 0.5);
    this.sprite.setPosition(x, y - Math.round(z)).setDepth(y);
    this.frame = frameFor(this.act, this.facing, ms, now, this.speed > 110);
    this.sprite.setFrame(this.frame);
    const top = y - Math.round(z);
    this.rim.setVisible(catLight.rim > 0);
    if (catLight.rim > 0) this.rim.setPosition(x, top).setDepth(y + 0.002).setFrame(this.frame).setAlpha(catLight.rim).setTint(catLight.rimColour);
    // eyes shine in the dark, unless something stands in front of this cat
    const glow = catLight.night > 0.05 && (this.local || !catLight.occluded(x, top - 9, y));
    this.eyes.setVisible(glow);
    if (glow) this.eyes.setPosition(x, top).setFrame(this.frame).setAlpha(catLight.night * (this.act === Act.Sleep ? 0 : 0.9));
    // our own cat, where a hill hides it: the covered part shows as a silhouette
    const cover = this.local ? terrainCover(x, y, Math.round(z), CAT, CAT) : null;
    this.ghost.setVisible(!!cover);
    if (cover) {
      const left = x - CAT / 2, top = y - Math.round(z) - CAT;
      this.ghost.setPosition(x, y - Math.round(z)).setFrame(this.frame)
        .setCrop(cover.x0 - left, cover.y0 - top, cover.x1 - cover.x0, cover.y1 - cover.y0);
    }

    // a fish or a bird in the mouth while eating: whole, half, bones (or a last tuft)
    const eating = (this.act === Act.Eat || this.act === Act.Feast) && ms < EAT_MS - 400;
    this.held.setVisible(eating);
    if (eating) {
      const right = this.facing === Facing.Right;
      // the art faces left with the head at x=0; the head goes in the mouth, tail sticking out
      this.held
        .setTexture(this.act === Act.Feast ? this.heldKey : 'held-fish', ms < 900 ? 0 : ms < 1700 ? 1 : 2)
        .setFlipX(!right)
        .setOrigin(right ? 0 : 1, 0.5)
        .setPosition(x + (right ? 5 : -5), y - 6 - Math.round(z))
        .setDepth(y + 0.5);
    }

    // the name, just under the cat's feet (and under its shadow on a ledge)
    if (this.label.text !== this.name) this.label.setText(this.name);
    const zoom = this.label.scene.cameras.main.zoom;
    this.label.setVisible(!!this.name).setScale(1 / zoom).setPosition(x, y + 1 - Math.round(groundAt(this.x, this.y)));

    const content = ((this.act === Act.Eat || this.act === Act.Feast) && ms > EAT_MS - 700) || (this.act === Act.Munch && ms > MUNCH_MS - 500);
    const emote = this.act === Act.Hiss ? 'bubble-hiss' : this.act === Act.Roll || content ? 'bubble-roll' : null;
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
    this.held.destroy();
    this.ghost.destroy();
    this.rim.destroy();
    this.eyes.destroy();
    this.label.destroy();
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
    const a = Phaser.Math.Clamp(act, 0, ACT_MAX) as Act;
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

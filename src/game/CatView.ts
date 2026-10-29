import Phaser from 'phaser';
import { PIXEL_FONT } from '../ui/pixel.ts';
import { Act, ACT_MAX, EAT_MS, MEW_MS, MUNCH_MS, Facing, frameFor, type CatMsg } from './state.ts';
import { CAT, COATS, stageRow } from '../art/cat.ts';
import { WORLD_W, WORLD_H, terrainCover, upOnFolly } from '../world/map.ts';
import { TREES, surfaceAt, treeHolding } from '../world/trees.ts';
import { DEPTH } from './Daylight.ts';
import { STAGE_SIZE, Stage } from './growth.ts';

/** Growing up: it flickers between its old size and its new one, quicker and quicker, for this long (ms). */
const GROW_MS = 1600;

/** Colour of a cat hidden behind a hill. */
const SILHOUETTE = 0x5ee86a;

/** Names float over everything but the emotes, the same size at any zoom. */
const LABEL_DEPTH = 99999.6, LABEL_PX = 12;
/** How long the name takes to fade out when a cat crouches or falls asleep (and back in). */
const LABEL_FADE_MS = 400;

/** Light shared by all cats, set by the scene every frame. */
export const catLight = {
  /** Sunlit rim strength (0 = none) and colour. */
  rim: 0,
  rimColour: 0xffffff,
  /** 0 by day, 1 at night: how much eyes glow. */
  night: 0,
  /** How strong soft round shadows are (the night's, and faint by day under the cast ones). */
  soft: 0.22,
  /** How shaded the ground at (x, y) is, 0..1. */
  shade: (_x: number, _y: number): number => 0,
  /** True if something stands in front of world point (x, y) for a cat whose feet are at feetY. */
  occluded: (_x: number, _y: number, _feetY: number): boolean => false,
  /** Whether a cat at (x, y, z) is down among the forest floor's plants, out of our cat's sight (its name hidden). */
  lostIn: (_x: number, _y: number, _z: number): boolean => false,
  /** How much shows (0..1) of something at world (x, y) drawn at `depth` (up a tree with a hole cut round our cat, less). */
  seeThrough: (_x: number, _y: number, _depth: number): number => 1,
};

/** Walking into shade, a cat takes this long to darken fully. */
const SHADE_IN_MS = 700;
/** Riding the train, the part of a cat drawn over the car's walls: all of it this high over its feet and up (px, grown). */
const HEAD_FROM = 7;

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
  /** Where it is drawn among things standing in the garden (its feet, or in front of the tree it is up). */
  depth = 0;
  /** Riding the train: drawn at its car's depth (between its back and front halves), not by its own feet. */
  ride: number | null = null;
  /** Drawn this much higher than it is (px): the engine driver up on its seat, head and all over the cab's side. */
  perch = 0;
  private last = { x: 0, y: 0, t: -1 };
  /** Our own cat: shown through trees and hills. Others hide behind them like anything else. */
  readonly local: boolean;
  /** What is in its mouth while eating (fish, bird or frog). */
  heldKey = 'held-fish';
  /** Shown under the cat. */
  name = '';
  /** How grown up it is (growth.ts); the size it is drawn at lags behind for a moment while it grows. */
  stage: Stage = Stage.Grown;
  /** How big it is drawn, for things placed on it (what's in its mouth, its emotes): 1 for a grown cat. */
  size = 1;
  private shown: Stage | null = null;
  private growing: { from: Stage; t: number } | null = null;
  /** How many times it has mewed, and when the last one began (it can mew walking, running or mid-jump). */
  mews = 0;
  mewAt = -Infinity;

  readonly shadow: Phaser.GameObjects.Image;
  /** How shaded the cat looks now (0..1), catching up with the ground under it. */
  private shaded = 0;
  private readonly sprite: Phaser.GameObjects.Sprite;
  private readonly bubble: Phaser.GameObjects.Image;
  private readonly held: Phaser.GameObjects.Image;
  /** A solid green silhouette, drawn over the hill where it hides the cat. */
  private readonly ghost: Phaser.GameObjects.Sprite;
  private readonly rim: Phaser.GameObjects.Sprite;
  /** Riding the train: its head again, on top of the car, so it always shows over the walls. */
  private readonly head: Phaser.GameObjects.Sprite;
  private readonly eyes: Phaser.GameObjects.Sprite;
  private readonly label: Phaser.GameObjects.Text;
  private labelAlpha = 1;
  private labelT = -1;

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
    this.head = scene.add.sprite(x, y, `cat-${this.coat}`, 0).setOrigin(0.5, 1).setVisible(false);
    this.rim = scene.add.sprite(x, y, 'cat-rim', 0).setOrigin(0.5, 1).setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
    this.eyes = scene.add.sprite(x, y, 'cat-eyes', 0).setOrigin(0.5, 1).setDepth(DEPTH.glow)
      .setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
    // drawn at screen resolution and shrunk by the zoom, so the letters stay sharp
    this.label = scene.add.text(x, y, '', {
      fontFamily: PIXEL_FONT,
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
    // growing up: flickering between the sizes, quicker and quicker (a cat seen for the first time just is its size)
    if (this.shown !== null && this.shown !== this.stage && !this.growing) this.growing = { from: this.shown, t: now };
    this.shown = this.stage;
    let stage = this.stage;
    if (this.growing) {
      const u = (now - this.growing.t) / GROW_MS;
      if (u >= 1 || this.growing.from === this.stage) this.growing = null;
      else if (Math.floor(u * u * 14) % 2 === 0) stage = this.growing.from;
    }
    const k = STAGE_SIZE[stage];
    this.size = k;
    const z = this.z;
    const x = Math.round(this.x), y = Math.round(this.y);
    const lift = Math.round(z) + this.perch;
    const dtm = now - this.last.t;
    if (this.last.t >= 0 && dtm > 0) {
      const inst = Math.hypot(this.x - this.last.x, this.y - this.last.y) / (dtm / 1000);
      this.speed += (inst - this.speed) * Math.min(1, dtm / 150);
    }
    this.last = { x: this.x, y: this.y, t: now };
    // up a tree, it is drawn in front of the tree (and of the branches it walks on); up on a folly, in front of that
    const tree = treeHolding(this.x, this.y, z);
    const folly = tree < 0 ? upOnFolly(this.x, this.y, z) : null;
    // (sorted by where it really is, not the rounded pixel it's drawn at: pressed up against a
    // cliff from behind, it stands a hair short of the cliff's row and must stay behind it)
    const d = this.ride ?? (tree >= 0 ? TREES[tree].y + 0.6 : folly !== null ? folly + 0.6 : this.y);
    this.depth = d;
    // (up a tree in front of our cat, where the hole round it is cut, it is cut away with the tree)
    const seen = tree >= 0 && !this.local ? catLight.seeThrough(this.x, this.y - z - 8, d) : 1;
    // the shadow lies on whatever surface is below the cat (riding, the floor of its car)
    const below = Math.round(this.ride !== null ? z : surfaceAt(this.x, this.y, z));
    this.shadow.setPosition(x, y - 1 - below).setDepth(d - 0.5).setAlpha(catLight.soft * seen).setScale(Math.min(1, k + 0.15));
    // standing in the shade of something: it darkens step by step (a sliver of shadow crossed
    // on the way barely shows, so the cat doesn't flicker) and brightens at once in the sun
    // (riding in a car it is lit like the car: the shadows on the ground below don't reach it)
    const dark = this.ride !== null ? 0 : catLight.shade(this.x, this.y);
    this.shaded = dark < this.shaded ? dark : Math.min(dark, this.shaded + (dtm > 0 ? dtm / SHADE_IN_MS : 0));
    const shade = this.shaded;
    this.sprite.setPosition(x, y - lift).setDepth(d).setAlpha(seen).setVisible(seen > 0);
    this.frame = stageRow(stage) + frameFor(this.act, this.facing, ms, now, this.speed > 110);
    this.sprite.setFrame(this.frame);
    if (shade > 0) this.sprite.setTint(Phaser.Display.Color.GetColor(255 - 90 * shade, 255 - 80 * shade, 255 - 50 * shade));
    else this.sprite.clearTint();
    // (just above the car's near half: everything of the cat higher than HEAD_FROM over its feet)
    this.head.setVisible(this.ride !== null);
    if (this.ride !== null)
      this.head.setPosition(x, y - lift).setDepth(this.ride + 0.7).setFrame(this.frame).setTint(this.sprite.tintTopLeft)
        .setCrop(0, 0, CAT, CAT - Math.round(HEAD_FROM * k));
    const top = y - lift;
    const rim = catLight.rim * (1 - shade) * seen;
    this.rim.setVisible(rim > 0);
    if (rim > 0) this.rim.setPosition(x, top).setDepth(d + 0.002).setFrame(this.frame).setAlpha(rim).setTint(catLight.rimColour);
    // eyes shine in the dark, unless something stands in front of this cat
    const glow = catLight.night > 0.05 && seen > 0 && (this.local || !catLight.occluded(x, top - 9 * k, y));
    this.eyes.setVisible(glow);
    if (glow) this.eyes.setPosition(x, top).setFrame(this.frame).setAlpha(catLight.night * seen * (this.act === Act.Sleep ? 0 : 0.9));
    // our own cat, where a hill hides it: the covered part shows as a silhouette
    const cover = this.local ? terrainCover(x, this.y, lift, CAT, CAT) : null;
    this.ghost.setVisible(!!cover);
    if (cover) {
      const left = x - CAT / 2, top = y - lift - CAT;
      this.ghost.setPosition(x, y - lift).setFrame(this.frame)
        .setCrop(cover.x0 - left, cover.y0 - top, cover.x1 - cover.x0, cover.y1 - cover.y0);
    }

    // a fish or a bird in the mouth while eating: whole, half, bones (or a last tuft)
    const eating = (this.act === Act.Eat || this.act === Act.Feast) && ms < EAT_MS - 400;
    this.held.setVisible(eating && seen > 0).setAlpha(seen);
    if (eating) {
      const right = this.facing === Facing.Right;
      const sideways = right || this.facing === Facing.Left;
      this.held.setTexture(this.act === Act.Feast ? this.heldKey : 'held-fish', ms < 900 ? 0 : ms < 1700 ? 1 : 2).setDepth(d + 0.5);
      // side on, the art faces left with the head at x=0: the head goes in the mouth, tail sticking out;
      // facing us, it is held crosswise in the mouth
      if (sideways) this.held.setFlipX(!right).setOrigin(right ? 0 : 1, 0.5).setPosition(x + (right ? 5 : -5) * k, y - 6 * k - lift);
      else this.held.setFlipX(false).setOrigin(0.3, 0.5).setPosition(x, y - 5 * k - lift);
    }

    // the name, just under the cat's feet (and under its shadow on a ledge)
    if (this.label.text !== this.name) this.label.setText(this.name);
    const zoom = this.label.scene.cameras.main.zoom;
    // a crouching or sleeping cat is lying low: its name fades away (the act is synced, so for everyone)
    // (and another cat down in the undergrowth, unless it's close by)
    const hiding = this.act === Act.Crouch || this.act === Act.Sneak || this.act === Act.Sleep || (!this.local && catLight.lostIn(this.x, this.y, z));
    const step = this.labelT < 0 ? 1 : (now - this.labelT) / LABEL_FADE_MS;
    this.labelT = now;
    this.labelAlpha = Math.max(0, Math.min(1, this.labelAlpha + (hiding ? -step : step)));
    this.label.setVisible(!!this.name && this.labelAlpha * seen > 0).setAlpha(this.labelAlpha * seen)
      .setScale(1 / zoom).setPosition(x, y + 1 - below);

    const content = ((this.act === Act.Eat || this.act === Act.Feast) && ms > EAT_MS - 700) || (this.act === Act.Munch && ms > MUNCH_MS - 500);
    const mewing = now - this.mewAt < MEW_MS;
    const emote = this.act === Act.Hiss ? 'bubble-hiss' : mewing ? 'bubble-mew' : this.act === Act.Roll || content ? 'bubble-roll' : null;
    this.bubble.setVisible(!!emote);
    if (emote) {
      const bob = Math.floor((mewing ? now - this.mewAt : ms) / 250) % 2;
      const top = Math.round(y - (this.act === Act.Roll ? 12 : 17) * k) - lift;
      this.bubble.setTexture(emote).setPosition(x + Math.round(4 * k), top - bob).setDepth(100000);
    }
  }

  destroy(): void {
    this.shadow.destroy();
    this.sprite.destroy();
    this.bubble.destroy();
    this.held.destroy();
    this.ghost.destroy();
    this.rim.destroy();
    this.head.destroy();
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
  /** Where in the train it rides, as we see it (the car's index, along it, across it), or null. */
  seat: { i: number; u: number; v: number } | null = null;

  constructor(scene: Phaser.Scene, msg: CatMsg, now: number) {
    super(scene, msg[0], msg[1], msg[6]);
    this.tx = msg[0];
    this.ty = msg[1];
    this.z = this.tz = msg[2];
    // mews from before we arrived aren't heard
    this.mews = msg[7];
    this.apply(msg, now);
  }

  apply(msg: CatMsg, now: number): void {
    const [x, y, z, facing, act, seq, , mews, stage] = msg;
    this.stage = stage as Stage;
    if (mews !== this.mews) {
      this.mews = mews;
      this.mewAt = now;
    }
    this.tx = Phaser.Math.Clamp(x, 0, WORLD_W);
    this.ty = Phaser.Math.Clamp(y, 0, WORLD_H);
    this.tz = Phaser.Math.Clamp(z, 0, 200);
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

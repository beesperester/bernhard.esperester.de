import Phaser from 'phaser';
import type { Raster } from '../art/raster.ts';
import { HEADINGS, buildBeam, buildCar, buildDriverCap } from '../art/train.ts';
import { buildGlow } from '../art/critters.ts';
import type { Light } from '../world/sky.ts';
import { DEPTH } from './Daylight.ts';
import { world } from './train.ts';
import { moving } from '../world/map.ts';
import { TRACK_LENGTH } from '../world/track.ts';
import type { TrainMsg } from '../net/protocol.ts';
import { advance, poses, trainUnder, type CarPose, type TrainState } from './train.ts';

/** The driver says where the train is this often (ms). */
const SAY_MS = 200;
/** Not a word from the driver for this long (ms): it's gone, and the train rolls to a stop. */
const DRIVER_GONE_MS = 3000;
/** Off by more than this (px) the train jumps to where it is said to be; less, it catches up smoothly. */
const SNAP_PX = 60;
/** A driver we haven't heard name themselves yet (from a newcomer's account of the garden). */
const SOMEONE = '?';

/**
 * The Ring's train in the scene: drawn car by car (each in front of and
 * behind its riders), kept where its driver says it is, and driven by us
 * when our cat sits in the lok's cab.
 */
export class TrainView {
  private readonly scene: Phaser.Scene;
  private readonly toCanvas: (r: Raster) => HTMLCanvasElement;
  private readonly self: string;
  private readonly say: (msg: TrainMsg) => void;
  /** Where it is (as we know it), and where it is drawn (catching up with that). */
  private state: TrainState;
  private shown: number;
  private heard = 0;
  private lastSaid = -Infinity;
  /** The cars as drawn now. */
  cars: CarPose[];
  private readonly images: { back: Phaser.GameObjects.Image; front: Phaser.GameObjects.Image }[] = [];
  private readonly made = new Set<string>();
  readonly cap: Phaser.GameObjects.Image;
  /** After dark: the lok's headlamp and its beam ahead, the lamp in its cab, the last waggon's red tail lamp. */
  private readonly lamps: { lamp: Phaser.GameObjects.Image; beam: Phaser.GameObjects.Image; cab: Phaser.GameObjects.Image; tail: Phaser.GameObjects.Image };
  private lit = 0;

  constructor(scene: Phaser.Scene, toCanvas: (r: Raster) => HTMLCanvasElement, self: string, start: TrainState, say: (msg: TrainMsg) => void) {
    this.scene = scene;
    this.toCanvas = toCanvas;
    this.self = self;
    this.say = say;
    this.state = start;
    this.shown = start.s;
    this.cars = poses(start.s);
    for (let i = 0; i < this.cars.length; i++)
      this.images.push({ back: scene.add.image(0, 0, '__DEFAULT').setOrigin(0), front: scene.add.image(0, 0, '__DEFAULT').setOrigin(0) });
    scene.textures.addCanvas('driver-cap', toCanvas(buildDriverCap()));
    this.cap = scene.add.image(0, 0, 'driver-cap').setOrigin(0.5, 1).setVisible(false);
    moving.under = (x, y) => trainUnder(this.cars, x, y);
    scene.textures.addCanvas('train-beam', toCanvas(buildBeam()));
    scene.textures.addCanvas('train-tail', toCanvas(buildGlow(9, 9, [255, 70, 50])));
    const glow = (key: string) => scene.add.image(0, 0, key).setDepth(DEPTH.glow).setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
    this.lamps = { lamp: glow('glow-lamp'), beam: glow('train-beam').setOrigin(0, 0.5), cab: glow('glow-lantern').setScale(0.6), tail: glow('train-tail') };
  }

  /** The lamps come on after dark, like the lanterns along the paths. */
  light(light: Light): void {
    this.lit = Math.max(0, Math.min(1, (-2 - light.elevation) / 4));
  }

  get driver(): string | null {
    return this.state.driver === SOMEONE ? null : this.state.driver;
  }

  get driving(): boolean {
    return this.state.driver === this.self;
  }

  /** How fast it goes (px/s, backwards below 0). */
  get speed(): number {
    return this.state.v;
  }

  get notch(): number {
    return this.state.notch;
  }

  /** Which way the lok faces (unit vector). */
  get heading(): { x: number; y: number } {
    return { x: this.cars[0].dx, y: this.cars[0].dy };
  }

  /** Can a cat take the driver's seat now (nobody's driving, or it's us)? */
  free(): boolean {
    return this.state.driver === null || this.state.driver === this.self;
  }

  /** Our cat sat down in the cab: we drive. */
  claim(gt: number): void {
    if (this.driving) return;
    this.state = { ...this.state, driver: this.self };
    this.tell(gt, true);
  }

  /**
   * Our cat left the cab: the throttle closes, the train rolls to a stop. `halt`: it stops dead where
   * it was last drawn (our tab has gone to the background, and our cat with it, sitting in the cab there).
   */
  release(gt: number, halt = false): void {
    if (!this.driving) return;
    this.state = halt ? { ...this.state, driver: null, notch: 0, v: 0, t: Math.max(gt, this.state.t) } : { ...this.state, driver: null, notch: 0 };
    this.tell(gt, true);
  }

  /** The driver moves the throttle a notch (+1 forwards, -1 back). */
  throttle(by: number, gt: number): void {
    if (!this.driving) return;
    const notch = Math.max(-3, Math.min(3, this.state.notch + by));
    if (notch === this.state.notch) return;
    this.state = { ...advance(this.state, gt), notch };
    this.tell(gt, true);
  }

  /** What we know of the train, for a cat arriving (who drives it they'll hear from the driver). */
  account(gt: number): TrainMsg {
    const s = advance(this.state, gt);
    return [s.s, s.v, s.notch, 0, Math.round(gt)];
  }

  /**
   * Word of the train from another cat: its driver (or one taking over: nobody else drives, the one
   * before has gone quiet, or it outranks them), or one letting go. `mayDrive`: that cat is old enough
   * and sits in the cab as far as we can see. Returns whether it took the driver's seat from us.
   */
  receive(peer: string, [s, v, notch, driving, t]: TrainMsg, gt: number, now: number, mayDrive: boolean): boolean {
    const d = this.state.driver;
    const current = d === peer;
    if (driving) {
      const open = d === null || d === SOMEONE || (d !== this.self && now - this.heard > DRIVER_GONE_MS);
      // (two taking the seat at once: the lower id keeps it)
      if (!mayDrive || !(current || open || peer < d!)) return false;
      const bumped = d === this.self;
      this.state = advance({ s, v, notch, driver: peer, t }, gt);
      this.heard = now;
      return bumped;
    }
    if (current || d === null || d === SOMEONE) {
      this.state = advance({ s, v, notch, driver: null, t }, gt);
      this.heard = now;
    }
    return false;
  }

  /** A newcomer's account of the garden: the train as the others know it (if we know nothing better yet). */
  recall([s, v, notch, , t]: TrainMsg, gt: number, now: number): void {
    if (this.heard) return;
    this.state = advance({ s, v, notch, driver: notch ? SOMEONE : null, t }, gt);
    this.shown = this.state.s;
    this.heard = now;
  }

  update(gt: number, now: number, dt: number): void {
    // the driver gone quiet: the train rolls to a stop where it is
    const d = this.state.driver;
    if (d !== null && d !== this.self && now - this.heard > DRIVER_GONE_MS) this.state = { ...this.state, driver: null, notch: 0 };
    this.state = advance(this.state, gt);
    if (this.driving && now - this.lastSaid >= SAY_MS) this.tell(gt, false);
    // (drawn catching up with where it is: no jolts from messages arriving in bunches)
    let diff = this.state.s - this.shown;
    if (diff > TRACK_LENGTH / 2) diff -= TRACK_LENGTH;
    if (diff < -TRACK_LENGTH / 2) diff += TRACK_LENGTH;
    this.shown = Math.abs(diff) > SNAP_PX || this.driving ? this.state.s : this.shown + diff * Math.min(1, dt * 6);
    this.cars = poses(this.shown);
  }

  /** Put the cars where they are, each picture turned the way the car points (only those on screen). */
  render(view: Phaser.Geom.Rectangle): void {
    this.renderLamps();
    this.cars.forEach((c, i) => {
      const { back, front } = this.images[i];
      const on = c.x > view.x - 40 && c.x < view.right + 40 && c.y > view.y - 40 && c.y < view.bottom + 60;
      back.setVisible(on);
      front.setVisible(on);
      if (!on) return;
      const h = ((Math.round((Math.atan2(c.dy, c.dx) / (Math.PI * 2)) * HEADINGS) % HEADINGS) + HEADINGS) % HEADINGS;
      const key = `car-${c.kind}-${h}`;
      if (!this.made.has(key)) {
        const art = buildCar(c.kind, h);
        this.scene.textures.addCanvas(`${key}-back`, this.toCanvas(art.back));
        this.scene.textures.addCanvas(`${key}-front`, this.toCanvas(art.front));
        this.made.add(key);
      }
      const [ox, oy] = [20, 39];
      const x = Math.round(c.x) - ox, y = Math.round(c.y) - oy;
      // (riders are drawn at the car's middle: between the two)
      back.setTexture(`${key}-back`).setPosition(x, y).setDepth(c.y - 0.6);
      front.setTexture(`${key}-front`).setPosition(x, y).setDepth(c.y + 0.6);
    });
  }

  private renderLamps(): void {
    const { lamp, beam, cab, tail } = this.lamps, on = this.lit;
    for (const l of [lamp, beam, cab, tail]) l.setVisible(on > 0);
    if (!on) return;
    const lok = this.cars[0], last = this.cars[this.cars.length - 1];
    // (the lamp sits on the lok's nose, 9 px up; the beam lies on the ground ahead of it)
    const nose = world(lok, lok.len / 2 + 1, 0), seat = world(lok, -lok.len / 2 + 5, 0), back = world(last, -last.len / 2 - 1, 0);
    lamp.setPosition(nose.x, nose.y - 9).setAlpha(on);
    beam.setPosition(nose.x, nose.y).setRotation(Math.atan2(lok.dy, lok.dx)).setAlpha(on * 0.9);
    cab.setPosition(seat.x, seat.y - 8).setAlpha(on * 0.45);
    tail.setPosition(back.x, back.y - 6).setAlpha(on * 0.9);
  }

  private tell(gt: number, now: boolean): void {
    if (!now && !this.driving) return;
    const s = this.state;
    this.say([s.s, s.v, s.notch, this.driving ? 1 : 0, Math.round(gt)]);
    this.lastSaid = performance.now();
  }
}

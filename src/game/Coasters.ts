// The funfairs' rollercoasters in the scene (world/coaster.ts lays out the
// track and works out the ride; rides.ts keeps who rides when; the station
// platform stands among the furniture): the track on its trestles, drawn a
// short stretch at a time so each is sorted by where it stands on the ground,
// and the car going round it, in front of and behind its riders like the
// train's cars. The chain clanks up the lift; the car rumbles down the drop.

import Phaser from 'phaser';
import { sound } from '../audio/sound.ts';
import { buildTrack } from '../art/funfair.ts';
import type { Raster } from '../art/raster.ts';
import { HEADINGS, buildCar } from '../art/train.ts';
import { CAR_FLOOR, LOOP, SEATS, carAt, deckAt, falling, onLift, trackAt } from '../world/coaster.ts';
import { COASTERS } from '../world/map.ts';
import { cullerFor } from './Culler.ts';
import type { Rides } from './rides.ts';

/** The track is drawn in stretches this long (px along it). */
const STRETCH = 8;
/** The car's pictures: the middle of its footprint is here in them (art/train.ts). */
const CAR_OX = 20, CAR_OY = 39;

/** A coaster's car where it is: on the ground (world px), which way it points, how high its floor is (world px, ground and all). */
export interface CoasterCar { x: number; y: number; dx: number; dy: number; floor: number; s: number }

export class Coasters {
  private readonly scene: Phaser.Scene;
  private readonly toCanvas: (r: Raster) => HTMLCanvasElement;
  private readonly rides: Rides;
  private readonly cars: { back: Phaser.GameObjects.Image; front: Phaser.GameObjects.Image }[] = [];
  private readonly made = new Set<string>();
  /** Where each car was last frame (px round), for the clanks and rumbles. */
  private readonly was: number[] = [];
  private rumbleIn = 0;

  constructor(scene: Phaser.Scene, toCanvas: (r: Raster) => HTMLCanvasElement, rides: Rides) {
    this.scene = scene;
    this.toCanvas = toCanvas;
    this.rides = rides;
    // the track's stretches (the same for every coaster: made once)
    const stretches: { key: string; ox: number; oy: number; depth: number }[] = [];
    for (let a = 0, n = 0; a < LOOP; a += STRETCH, n++) {
      const bits = [];
      for (let s = a; s <= a + STRETCH + 0.01; s += 0.5) bits.push({ ...trackAt(s), z: deckAt(s), s });
      const { r, ox, oy } = buildTrack(bits, onLift);
      const key = `coaster-track-${n}`;
      scene.textures.addCanvas(key, toCanvas(r));
      // (just behind whatever is on its stretch: the car, and its riders)
      stretches.push({ key, ox, oy, depth: Math.min(...bits.map((b) => b.y)) - 1 });
    }
    for (const c of COASTERS) {
      for (const t of stretches)
        cullerFor(scene).add(scene.add.image(c.x - t.ox, c.y - c.ground - t.oy, t.key).setOrigin(0).setDepth(c.y + t.depth));
      this.cars.push({ back: scene.add.image(0, 0, '__DEFAULT').setOrigin(0), front: scene.add.image(0, 0, '__DEFAULT').setOrigin(0) });
      this.was.push(0);
    }
  }

  /** Coaster `i`'s car at garden time `gt`. */
  car(i: number, gt: number): CoasterCar {
    const c = COASTERS[i], p = carAt(this.rides.into(i, gt));
    return { x: c.x + p.x, y: c.y + p.y, dx: p.dx, dy: p.dy, floor: c.ground + p.z + CAR_FLOOR, s: p.s };
  }

  /** Where a cat sits in seat `seat` of coaster `i`'s car (its feet, world px, and how high). */
  seat(i: number, seat: number, gt: number): { x: number; y: number; z: number; car: CoasterCar } {
    // (on the bit of track it is over: up the lift, the front seat is higher than the back one)
    const car = this.car(i, gt), c = COASTERS[i], s = car.s + SEATS[seat], p = trackAt(s);
    return { x: c.x + p.x, y: c.y + p.y + 2, z: c.ground + deckAt(s) + CAR_FLOOR, car };
  }

  /** The coaster whose waiting car our cat at (x, y, z) is beside, at its platform, and which seat it would get (null: none). */
  near(x: number, y: number, z: number, gt: number): { i: number; seat: number } | null {
    for (let i = 0; i < COASTERS.length; i++) {
      const car = this.car(i, gt);
      // (on the platform, or on the ground in front of it: a hop gets it up into the car either way)
      if (Math.abs(x - car.x) > 18 || y < car.y - 4 || y > car.y + 22 || z > car.floor + 2) continue;
      const seat = this.rides.free(i, gt);
      if (seat !== null) return { i, seat };
    }
    return null;
  }

  update(gt: number, dt: number): void {
    this.rumbleIn -= dt;
    COASTERS.forEach((_, i) => {
      const car = this.car(i, gt), ds = ((car.s - this.was[i]) % LOOP + LOOP) % LOOP;
      const at = { x: car.x, y: car.y };
      // the chain's dogs clacking into its links, every few px up the lift
      if (onLift(car.s) && Math.floor(car.s / 5) !== Math.floor(this.was[i] / 5))
        sound.burst({ at, volume: 0.16, freq: 2400, q: 7, attack: 0.002, decay: 0.03 });
      // down the drop and round: a rumble of wheels on the rails, louder the faster it goes
      const v = ds / Math.max(dt, 1e-3);
      if (falling(car.s) && this.rides.away(i, gt) && v > 20 && this.rumbleIn <= 0) {
        this.rumbleIn = 0.07;
        sound.burst({ at, volume: Math.min(0.3, v / 320), freq: 160 + v * 2, q: 0.9, attack: 0.01, decay: 0.12 });
      }
      this.was[i] = car.s;
    });
  }

  /** Put the cars where they are, each picture turned the way the car points (only those on screen). */
  render(gt: number, view: Phaser.Geom.Rectangle): void {
    COASTERS.forEach((_, i) => {
      const { back, front } = this.cars[i];
      const car = this.car(i, gt);
      const on = car.x > view.x - 40 && car.x < view.right + 40 && car.y - car.floor > view.y - 60 && car.y > view.y - 40 && car.y - car.floor < view.bottom + 60;
      back.setVisible(on);
      front.setVisible(on);
      if (!on) return;
      const h = ((Math.round((Math.atan2(car.dy, car.dx) / (Math.PI * 2)) * HEADINGS) % HEADINGS) + HEADINGS) % HEADINGS;
      const key = `car-coaster-${h}`;
      if (!this.made.has(key)) {
        const art = buildCar('coaster', h);
        this.scene.textures.addCanvas(`${key}-back`, this.toCanvas(art.back));
        this.scene.textures.addCanvas(`${key}-front`, this.toCanvas(art.front));
        this.made.add(key);
      }
      // (standing on its deck: the floor is CAR_FLOOR up from where it stands)
      const x = Math.round(car.x) - CAR_OX, y = Math.round(car.y - car.floor + CAR_FLOOR) - CAR_OY;
      back.setTexture(`${key}-back`).setPosition(x, y).setDepth(car.y - 0.6);
      front.setTexture(`${key}-front`).setPosition(x, y).setDepth(car.y + 0.6);
    });
  }
}

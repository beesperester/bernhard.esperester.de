import { Prey } from '../state.ts';
import { elevAt } from '../../world/map.ts';
import { lightAt } from '../../world/sky.ts';
import { inSeason } from '../../world/season.ts';
import { Wary, type Senses } from './Wary.ts';
import { Pool, clamp01, hash2, lerp, remember, smooth, type Fauna, type FaunaContext, type FaunaFrame, type PreyRef } from './kit.ts';

// Bees buzzing from flower to flower by day. A cat creeping up can swat one,
// but it stings (points off) and the bee zooms off in a huff.

type Pt = [number, number];

/** BEES bees, each out for part of every BEE_EPOCH ms, moving on to a nearby flower every BEE_HOP ms. */
const BEES = 5, BEE_EPOCH = 45000, BEE_HOP = 4000;
/** Flowers this close (px) are a bee's hop apart. */
const HOP_RANGE = 72;
/** A stung-and-swatted (or startled) bee zooms off for this long. */
const FLEE_MS = 1600;
/** Buzzing bees: sneak up, then pounce. */
const SENSES: Senses = { walking: 30, jumping: 36, hissing: 48, dashing: 56, notice: 26, react: 750, swipe: 26 };

interface Flee { t: number; x: number; y: number; h: number; dir: number }

export class Bees implements Fauna {
  readonly catches = [Prey.Bee] as const;
  private readonly flowers: Pt[];
  /** For each flower, the other flowers within a short bee hop. */
  private readonly neighbours: number[][];
  private readonly routes = new Map<string, number[]>();
  /** Bees that took fright (not caught, just gone). */
  private readonly shooed = new Set<number>();
  private readonly fleeing = new Map<number, Flee>();
  private readonly isCaught: (id: number) => boolean;
  private readonly wary: Wary;
  private readonly bees: Pool;

  constructor(ctx: FaunaContext) {
    this.flowers = ctx.flowers;
    this.isCaught = (id) => ctx.isCaught(Prey.Bee, id);
    this.wary = new Wary(ctx.scene);
    this.bees = new Pool(ctx.scene, 'bee');
    this.neighbours = this.flowers.map(([x, y], i) =>
      this.flowers.flatMap(([x2, y2], j) => (j !== i && Math.hypot(x2 - x, y2 - y) < HOP_RANGE ? [j] : [])),
    );
  }

  update({ gt, now, cats, prey }: FaunaFrame): void {
    this.bees.begin();
    this.wary.begin();
    if (this.flowers.length) this.updateBees(gt, now, cats, prey);
    this.updateFleeing(gt);
    this.bees.end();
    this.wary.end();
  }

  onCatch(p: PreyRef, cat: { x: number }, gt: number): void {
    this.fleeing.set(p.id, { t: gt, x: p.x, y: p.y, h: p.h, dir: Math.sign(p.x - cat.x) || 1 });
  }

  /** Flower indices bee `b` visits during epoch `e`, hopping between nearby flowers. */
  private route(b: number, e: number, hops: number): number[] {
    const key = `${b}:${e}`;
    const route = this.routes.get(key) ?? remember(this.routes, key, [Math.floor(hash2(b, e, 903) * this.flowers.length)], 20);
    while (route.length <= hops) {
      const near = this.neighbours[route[route.length - 1]];
      const pick = hash2(b, e, route.length, 3);
      route.push(near.length ? near[Math.floor(pick * near.length)] : Math.floor(pick * this.flowers.length));
    }
    return route;
  }

  private updateBees(gt: number, now: number, cats: FaunaFrame['cats'], prey: PreyRef[]): void {
    for (let b = 0; b < BEES; b++)
      for (let e = Math.floor(gt / BEE_EPOCH) - 1; e <= Math.floor(gt / BEE_EPOCH); e++) {
        const start = e * BEE_EPOCH + hash2(b, e, 904) * 15000;
        const dur = 22000 + hash2(b, e, 905) * 10000;
        const tau = gt - start;
        const id = e * BEES + b;
        if (tau < 0 || tau > dur || this.isCaught(id) || this.shooed.has(id) || lightAt(start).day < 0.5 || !inSeason('bee', start, hash2(b, e, 1602))) continue;
        const hop = Math.floor(tau / BEE_HOP), flying = (tau - hop * BEE_HOP) / 1000;
        const route = this.route(b, e, hop + 1);
        const [ax, ay] = this.flowers[route[hop]], [bx, by] = this.flowers[route[hop + 1]];
        const m = smooth(clamp01(flying));
        // buzzing round in little circles on the way
        const spin = (hash2(b, e, 906) < 0.5 ? -1 : 1) * (2.5 + hash2(b, e, 907) * 2);
        const ang = (gt / 1000) * spin + b;
        const x = lerp(ax, bx, m) + Math.cos(ang) * 6;
        const y = lerp(ay, by, m) + Math.sin(ang) * 3;
        const h = 7 + Math.sin(gt / 250 + b) * 2 + lerp(elevAt(ax, ay), elevAt(bx, by), m);
        const alpha = Math.min(1, tau / 1000, (dur - tau) / 1000);
        if (alpha > 0.5) {
          const v = this.wary.watch(Prey.Bee * 1e10 + id, x, y, h, cats, gt, now, SENSES);
          if (!v.calm && !v.alert) {
            // buzzes off in a huff
            this.shooed.add(id);
            if (this.shooed.size > 64) this.shooed.delete(this.shooed.values().next().value!);
            this.fleeing.set(id, { t: gt, x, y, h, dir: Math.sign(x - v.cat.x) || 1 });
            continue;
          }
          if (!v.calm) this.wary.mark(x, y - h - 5);
        }
        this.bees.get('bee', Math.floor(gt / 40) % 2).setPosition(Math.round(x), Math.round(y - h)).setDepth(y).setAlpha(alpha);
        if (alpha > 0.5) prey.push({ kind: Prey.Bee, id, x, y, h, colour: 0 });
      }
  }

  /** Swatted and startled bees zoom off in an angry zigzag. */
  private updateFleeing(gt: number): void {
    for (const [id, f] of this.fleeing) {
      const tau = gt - f.t;
      if (tau > FLEE_MS || tau < 0) { this.fleeing.delete(id); continue; }
      const s = tau / 1000;
      const x = f.x + f.dir * (40 * s + 50 * s * s) + Math.sin(s * 30) * 3;
      const y = f.y - 12 * s;
      const h = f.h + 30 * s;
      this.bees.get('bee', Math.floor(gt / 25) % 2)
        .setPosition(Math.round(x), Math.round(y - h)).setDepth(99000 + y)
        .setAlpha(clamp01((FLEE_MS - tau) / 500));
    }
  }
}

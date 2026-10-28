import type Phaser from 'phaser';
import { Act, SWIPE_AT_MS } from '../state.ts';
import type { CatView } from '../CatView.ts';
import { Pool } from './kit.ts';
import { inBox } from '../../world/map.ts';

// How prey keeps an eye on the cats. Walking, jumping, hissing or dashing up
// to it scares it off from a distance. A crouching cat can creep closer, but
// it gets noticed in the end: the prey looks up ("!") and is gone after a
// moment, so the last stretch takes a pounce (a dash). Creeping on once
// spotted, or a swipe that misses, scares it off at once. A cat keeping still
// in a cardboard box isn't seen at all.

const DASH_SPEED = 110;

export interface Senses {
  /** Scare distances for each way of approaching. */
  walking: number; jumping: number; hissing: number; dashing: number;
  /** Even a crouching cat gets noticed this close... */
  notice: number;
  /** ...and the prey is off this long after. */
  react: number;
  /** A missed swipe this close scares it. */
  swipe: number;
}

/** Time to freeze once spotted; creeping on after that scares it off. */
const FREEZE_MS = 300;

export type Verdict =
  | { calm: true }
  | { calm: false; alert: true; cat: { x: number; y: number } }
  | { calm: false; alert: false; cat: { x: number; y: number } };

export class Wary {
  private readonly alerts = new Map<number, { t: number; x: number; y: number }>();
  private readonly marks: Pool;

  constructor(scene: Phaser.Scene) {
    this.marks = new Pool(scene, 'alert');
  }

  begin(): void { this.marks.begin(); }
  end(): void { this.marks.end(); }

  forget(id: number): void { this.alerts.delete(id); }

  /**
   * Prey `id` at ground point (x, y), height h: is it calm, watching a cat
   * ("alert"), or off (alert false) because of `cat`?
   */
  watch(id: number, x: number, y: number, h: number, cats: CatView[], gt: number, now: number, s: Senses): Verdict {
    let alert = this.alerts.get(id);
    for (const c of cats) {
      if (Math.abs(c.z - h) > 24) continue; // a cat up on a ledge is out of the way
      // nor is one keeping still in a cardboard box (until it pounces out)
      if (c.act !== Act.Catch && c.act !== Act.Jump && c.speed <= 5 && inBox(c.x, c.y, c.z)) continue;
      const d = Math.hypot(c.x - x, c.y - y);
      if (c.act === Act.Catch && now - c.actStart > SWIPE_AT_MS + 80 && d < s.swipe) return { calm: false, alert: false, cat: c };
      if (c.act === Act.Crouch || c.act === Act.Sneak) {
        if (d < s.notice && !alert) this.alerts.set(id, (alert = { t: gt, x: c.x, y: c.y }));
        else if (alert && d < s.notice && c.speed > 5 && gt - alert.t > FREEZE_MS) return { calm: false, alert: false, cat: c };
        continue;
      }
      // once it has spotted a cat it is about to go anyway; the pounce has to beat that
      if (alert || c.act === Act.Catch) continue;
      const r = c.act === Act.Hiss ? s.hissing
        : c.act === Act.Jump ? s.jumping
        : c.speed > DASH_SPEED ? s.dashing
        : c.speed > 5 ? s.walking : 0;
      if (d < r) return { calm: false, alert: false, cat: c };
    }
    if (!alert) return { calm: true };
    if (gt - alert.t >= s.react) return { calm: false, alert: false, cat: alert };
    return { calm: false, alert: true, cat: alert };
  }

  /** The "!" over prey that spotted a cat. */
  mark(x: number, y: number): void {
    this.marks.get().setOrigin(0.5, 1).setPosition(Math.round(x), Math.round(y)).setDepth(100000);
  }
}

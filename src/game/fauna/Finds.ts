import { Prey } from '../state.ts';
import { FIND_SLOTS, findIn, type Find, type FindSlot } from '../../world/finds.ts';
import { TREES } from '../../world/trees.ts';
import { GLINT } from '../../art/finds.ts';
import { Pool, hash2, type Fauna, type FaunaContext, type FaunaFrame } from './kit.ts';

// The garden's finds (world/finds.ts) on screen, and on offer to a pawing cat
// like prey: a picnic basket with lunch peeking out, a snack on the path, an
// angler's bucket with a tail sticking out of it. A nest is hidden: it shows
// only to a cat right by it, and a cat a little further off sees a glint now
// and then where it is. Once found and eaten, it's gone until that slot's
// next time round (the basket and the bucket stay, empty).

/** A hidden nest shows to a cat this close (screen px), and glints for one this close. */
const SHOW = 26, GLINT_NEAR = 80;
/** A glint every so often: how long one lasts, and the chance of one in each slot. */
const GLINT_MS = 420, GLINT_SLOT = 1500, GLINT_P = 0.55;

export class Finds implements Fauna {
  readonly catches = [Prey.Find] as const;
  private readonly pool: Pool;
  private readonly isCaught: (id: number) => boolean;

  constructor({ scene, isCaught }: FaunaContext) {
    this.pool = new Pool(scene, 'food');
    this.isCaught = (id) => isCaught(Prey.Find, id);
  }

  update({ gt, cats, prey, view }: FaunaFrame): void {
    this.pool.begin();
    const me = cats.find((c) => c.local);
    const inView = (x: number, y: number) => x > view.x - 64 && x < view.right + 64 && y > view.y - 64 && y < view.bottom + 96;
    FIND_SLOTS.forEach((s, n) => {
      if (!s.spots.some((p) => inView(p.x, p.y))) return;
      // the basket on the table and the bucket stand there, full or not
      this.props(s);
      const f = findIn(FIND_SLOTS, n, gt);
      if (!f || !inView(f.x, f.y) || this.isCaught(f.id)) return;
      prey.push({ kind: Prey.Find, id: f.id, x: f.x, y: f.y, h: f.h, colour: f.food });
      this.draw(f, gt, me ? Math.hypot(f.x - me.x, f.y - f.h - (me.y - me.z)) : Infinity);
    });
    this.pool.end();
  }

  /** What stays when the food is gone: the basket on a picnic table, the angler's bucket (empty, unless its fish is there to be drawn over it). */
  private props(s: FindSlot): void {
    const [p] = s.spots;
    // on the table top (it is drawn at depth y - 10)
    if (s.table) this.pool.get('find-basket').setOrigin(0.5, 1).setPosition(p.x, p.y - 2).setDepth(p.y - 9.9);
    if (s.kind === 'bucket') this.pool.get('bucket', 1).setOrigin(0.5, 1).setPosition(p.x, p.y - p.h).setDepth(p.y);
  }

  private draw(f: Find, gt: number, near: number): void {
    const food = (x: number, y: number, depth: number) => this.pool.get('food', f.food).setOrigin(0.5, 1).setPosition(x, y).setDepth(depth);
    switch (f.kind) {
      case 'basket':
        // lunch peeking out from under the lid
        if (f.table) food(f.x + 2, f.y - 9, f.y - 9.8);
        else food(f.x + 1, f.y - 4, f.y - 2.9);
        break;
      case 'snack':
        food(f.x, f.y - f.h + 1, f.y - 0.5);
        break;
      case 'bucket':
        // (the catch's tail sticking out, over the empty one)
        this.pool.get('bucket', 0).setOrigin(0.5, 1).setPosition(f.x, f.y - f.h).setDepth(f.y + 0.01);
        break;
      case 'nest': {
        const depth = f.tree !== undefined ? TREES[f.tree].y + 0.55 : f.y + 0.2;
        if (near < SHOW) food(f.x, f.y - f.h + 2, depth);
        else if (near < GLINT_NEAR) {
          const slot = Math.floor(gt / GLINT_SLOT), t = gt - slot * GLINT_SLOT;
          if (t >= GLINT_MS || hash2(f.id, slot, 1201) > GLINT_P) break;
          const frame = [0, 1, 2, 1, 0][Math.floor((t / GLINT_MS) * 5)];
          const dx = Math.round((hash2(f.id, slot, 1202) - 0.5) * 6);
          this.pool.get('glint', frame).setPosition(f.x + dx, f.y - f.h - GLINT / 2).setDepth(depth + 0.01);
        }
        break;
      }
    }
  }
}

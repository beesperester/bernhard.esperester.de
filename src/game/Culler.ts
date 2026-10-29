import type Phaser from 'phaser';

// The park is much bigger than the screen, and it is full of things that
// never move: terrain, shadows, rims, water, lamps. Phaser would still sort
// every one of them by depth and push it through the renderer each frame.
// The culler sorts such static objects into a coarse grid and takes those in
// cells off screen out of the display list altogether.
//
// It works through the display list rather than `visible`, so whatever else
// switches an object on and off (lanterns at night, say) keeps working.

type Obj = Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.GetBounds;

/** Size of a grid cell in world px. */
const CELL = 64;
/** Objects this close beyond the view stay in, so nothing pops in at the edge. */
const MARGIN = 24;

export class Culler {
  private readonly list: Phaser.GameObjects.DisplayList;
  private readonly cells = new Map<string, Obj[]>();
  /** For each object, its cells, and how many of them are in view. */
  private readonly inView = new Map<Obj, { keys: string[]; n: number }>();
  private shownCells = new Set<string>();
  /** The cell range last brought into view. */
  private range = '';

  constructor(list: Phaser.GameObjects.DisplayList) {
    this.list = list;
  }

  /** Cull `obj` from now on; it must not move after this. */
  add<T extends Obj>(obj: T): T {
    const b = obj.getBounds();
    // out of the list until its cell comes into view
    obj.removeFromDisplayList();
    const keys = [...cellsOver(b.x, b.y, b.right, b.bottom)];
    this.inView.set(obj, { keys, n: 0 });
    for (const key of keys) {
      let list = this.cells.get(key);
      if (!list) this.cells.set(key, (list = []));
      list.push(obj);
    }
    // a cell already in view shows it straight away
    for (const key of keys) if (this.shownCells.has(key)) this.reveal(obj);
    return obj;
  }

  /** Bring the cells around `view` in and send the rest out. Cheap when the view stays within the same cells. */
  update(view: Phaser.Geom.Rectangle): void {
    const x0 = view.x - MARGIN, y0 = view.y - MARGIN, x1 = view.right + MARGIN, y1 = view.bottom + MARGIN;
    const range = `${Math.floor(x0 / CELL)},${Math.floor(y0 / CELL)},${Math.floor(x1 / CELL)},${Math.floor(y1 / CELL)}`;
    if (range === this.range) return;
    this.range = range;
    const now = new Set(cellsOver(x0, y0, x1, y1));
    // (over copies: a destroyed object is struck from its cells on the way)
    for (const key of this.shownCells) if (!now.has(key)) for (const obj of [...(this.cells.get(key) ?? [])]) this.conceal(obj);
    for (const key of now) if (!this.shownCells.has(key)) for (const obj of [...(this.cells.get(key) ?? [])]) this.reveal(obj);
    this.shownCells = now;
  }

  /** Whether obj has been destroyed (it went with its tree, say): it is forgotten. */
  private gone(obj: Obj): boolean {
    if (obj.scene) return false;
    for (const key of this.inView.get(obj)?.keys ?? []) {
      const list = this.cells.get(key)!, i = list.indexOf(obj);
      if (i >= 0) list.splice(i, 1);
    }
    this.inView.delete(obj);
    return true;
  }

  private reveal(obj: Obj): void {
    if (this.gone(obj)) return;
    const o = this.inView.get(obj)!;
    if (++o.n === 1) obj.addToDisplayList(this.list);
  }

  private conceal(obj: Obj): void {
    if (this.gone(obj)) return;
    const o = this.inView.get(obj)!;
    if (--o.n === 0) obj.removeFromDisplayList();
  }
}

/** Keys of the grid cells a world box touches. */
function* cellsOver(x0: number, y0: number, x1: number, y1: number): Generator<string> {
  for (let cy = Math.floor(y0 / CELL); cy <= Math.floor(y1 / CELL); cy++)
    for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) yield `${cx},${cy}`;
}

const cullers = new WeakMap<Phaser.Scene, Culler>();

/** The scene's culler (made on first use). */
export function cullerFor(scene: Phaser.Scene): Culler {
  let c = cullers.get(scene);
  if (!c) cullers.set(scene, (c = new Culler(scene.children)));
  return c;
}

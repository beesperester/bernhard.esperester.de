import type Phaser from 'phaser';

// The park is much bigger than the screen, and it is full of things that
// never move: thousands of grass tufts and flowers, trees, terrain, shadows.
// Phaser would still push every one of them through the renderer each frame.
// The culler sorts such static objects into a coarse grid and keeps the
// renderer from even looking at the ones in cells off screen.
//
// It works through the camera filter rather than `visible`, so whatever else
// switches an object on and off (lanterns at night, say) keeps working.

type Obj = Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.GetBounds;

/** Size of a grid cell in world px. */
const CELL = 64;
/** Objects this close beyond the view stay in, so nothing pops in at the edge. */
const MARGIN = 24;

export class Culler {
  private readonly camera: Phaser.Cameras.Scene2D.Camera;
  private readonly cells = new Map<string, Obj[]>();
  /** For each object, how many of its cells are in view. */
  private readonly inView = new Map<Obj, number>();
  private shownCells = new Set<string>();
  /** The cell range last brought into view. */
  private range = '';

  constructor(camera: Phaser.Cameras.Scene2D.Camera) {
    this.camera = camera;
  }

  /** Cull `obj` from now on; it must not move after this. */
  add<T extends Obj>(obj: T): T {
    const b = obj.getBounds();
    // hidden until its cell comes into view
    obj.cameraFilter |= this.camera.id;
    this.inView.set(obj, 0);
    for (const key of cellsOver(b.x, b.y, b.right, b.bottom)) {
      let list = this.cells.get(key);
      if (!list) this.cells.set(key, (list = []));
      list.push(obj);
    }
    // a cell already in view shows it straight away
    for (const key of cellsOver(b.x, b.y, b.right, b.bottom)) if (this.shownCells.has(key)) this.reveal(obj);
    return obj;
  }

  /** Bring the cells around `view` in and send the rest out. Cheap when the view stays within the same cells. */
  update(view: Phaser.Geom.Rectangle): void {
    const x0 = view.x - MARGIN, y0 = view.y - MARGIN, x1 = view.right + MARGIN, y1 = view.bottom + MARGIN;
    const range = `${Math.floor(x0 / CELL)},${Math.floor(y0 / CELL)},${Math.floor(x1 / CELL)},${Math.floor(y1 / CELL)}`;
    if (range === this.range) return;
    this.range = range;
    const now = new Set(cellsOver(x0, y0, x1, y1));
    for (const key of this.shownCells) if (!now.has(key)) for (const obj of this.cells.get(key) ?? []) this.conceal(obj);
    for (const key of now) if (!this.shownCells.has(key)) for (const obj of this.cells.get(key) ?? []) this.reveal(obj);
    this.shownCells = now;
  }

  private reveal(obj: Obj): void {
    const n = this.inView.get(obj)! + 1;
    this.inView.set(obj, n);
    if (n === 1) obj.cameraFilter &= ~this.camera.id;
  }

  private conceal(obj: Obj): void {
    const n = this.inView.get(obj)! - 1;
    this.inView.set(obj, n);
    if (n === 0) obj.cameraFilter |= this.camera.id;
  }
}

/** Keys of the grid cells a world box touches. */
function* cellsOver(x0: number, y0: number, x1: number, y1: number): Generator<string> {
  for (let cy = Math.floor(y0 / CELL); cy <= Math.floor(y1 / CELL); cy++)
    for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) yield `${cx},${cy}`;
}

const cullers = new WeakMap<Phaser.Scene, Culler>();

/** The scene's culler (made on first use, for its main camera). */
export function cullerFor(scene: Phaser.Scene): Culler {
  let c = cullers.get(scene);
  if (!c) cullers.set(scene, (c = new Culler(scene.cameras.main)));
  return c;
}

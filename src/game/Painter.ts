import { propFrom, type Prop, type PropParts } from '../art/trees.ts';
import { sunLight } from '../art/lighting.ts';
import { worldSeed } from '../world/seed.ts';
import type { PaintRequest } from './painter.worker.ts';

// Asks the painter (painter.worker.ts) for trees and pieces of ground, a few
// at a time, and hands them over as they come back.

type Pixels = { w: number; h: number; data: Uint8ClampedArray<ArrayBuffer> };

/** At most this many asked for and not back yet: the nearest are asked for first, and the view moves on. */
const IN_FLIGHT = 3;

export class Painter {
  private readonly worker = new Worker(new URL('./painter.worker.ts', import.meta.url), { type: 'module', name: location.search });
  private readonly waiting = new Map<number, (data: { parts?: PropParts; layers?: Pixels[] }) => void>();
  private next = 0;

  constructor() {
    this.send({ kind: 'init', seed: worldSeed() });
    this.worker.onmessage = (e) => {
      const done = this.waiting.get(e.data.id);
      this.waiting.delete(e.data.id);
      done?.(e.data);
    };
  }

  /** Whether there's room to ask for more now. */
  get free(): boolean {
    return this.waiting.size < IN_FLIGHT;
  }

  /** Tree i, drawn in the light as it is now. */
  tree(i: number): Promise<Prop> {
    const id = this.next++;
    return new Promise((done) => {
      this.waiting.set(id, (d) => done(propFrom(d.parts!)));
      this.send({ kind: 'tree', id, i, sun: { ...sunLight } });
    });
  }

  /** The ground of tiles (tx0, ty0) to (tx0 + tw, ty0 + th), once for each ripple phase. */
  ground(tx0: number, ty0: number, tw: number, th: number, phases: number[]): Promise<Pixels[]> {
    const id = this.next++;
    return new Promise((done) => {
      this.waiting.set(id, (d) => done(d.layers!));
      this.send({ kind: 'ground', id, tx0, ty0, tw, th, phases, sun: { ...sunLight } });
    });
  }

  private send(m: PaintRequest): void {
    this.worker.postMessage(m);
  }
}

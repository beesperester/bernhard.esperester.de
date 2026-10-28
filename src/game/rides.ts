// Rides on the funfairs' rollercoasters, as every cat agrees on them: when
// each coaster's car sets off (world/coaster.ts says where it is from that
// alone), and who sits in which of its two seats. A cat getting into a
// waiting car sets it off BOARDING_MS later; one getting in beside it goes
// along. Two getting in at once, each setting it off, both take the earlier
// time when they hear of the other. Kept free of Phaser: the scene draws the
// rides and puts the cats in them.

import type { CoasterMsg } from '../net/protocol.ts';
import { BOARDING_MS, RIDE_MS } from '../world/coaster.ts';

/** Heard of a ride that set off longer ago than this before it ended, or that sets off further ahead than a car boards (ms): not believed. */
const LATE_MS = 2000, EARLY_MS = BOARDING_MS + 1500;
/** Two rides setting off this close together are the same one, heard of from two of its riders (ms). */
const SAME_MS = BOARDING_MS + 500;

interface Rider { i: number; seat: number; depart: number }

export class Rides {
  /** When each coaster's car sets off (garden ms), or -Infinity: it hasn't, it waits at its station. */
  readonly depart: number[];
  /** Who rides which coaster, in which seat, on the ride setting off when. */
  private readonly riders = new Map<string, Rider>();

  constructor(coasters: number) {
    this.depart = new Array<number>(coasters).fill(-Infinity);
  }

  /** How far into its ride coaster `i`'s car is (ms; 0 or less: at its station). */
  into(i: number, gt: number): number {
    const d = this.depart[i];
    return gt >= d && gt < d + RIDE_MS ? gt - d : 0;
  }

  /** Is coaster `i`'s car at its station, cats getting in, about to set off? */
  boarding(i: number, gt: number): boolean {
    return this.depart[i] > gt;
  }

  /** Is it off on a ride now? */
  away(i: number, gt: number): boolean {
    const d = this.depart[i];
    return gt >= d && gt < d + RIDE_MS;
  }

  /** Who sits in which seat of coaster `i` (on the ride boarding or under way). */
  seats(i: number, gt: number): (string | null)[] {
    const out: (string | null)[] = [null, null];
    if (!this.boarding(i, gt) && !this.away(i, gt)) return out;
    for (const [peer, r] of this.riders) if (r.i === i && this.same(r, gt)) out[r.seat] = peer;
    return out;
  }

  /** A seat in coaster `i`'s car a cat can get into now: it waits at its station and isn't full (null if not). */
  free(i: number, gt: number): number | null {
    if (this.away(i, gt)) return null;
    const seats = this.seats(i, gt);
    const k = seats.indexOf(null);
    return k < 0 ? null : k;
  }

  /** `peer` gets into (or moves to) seat `seat` of coaster `i`: a waiting car sets off a moment from now. What to tell the others. */
  board(peer: string, i: number, seat: number, gt: number): CoasterMsg {
    if (!this.boarding(i, gt) && !this.away(i, gt)) this.depart[i] = Math.round(gt + BOARDING_MS);
    this.riders.set(peer, { i, seat, depart: this.depart[i] });
    return [i, this.depart[i], seat];
  }

  /** `peer` got out again before the car set off (or the ride is over): with nobody left in it, the car stays. What to tell the others. */
  leave(peer: string, gt: number): CoasterMsg | null {
    const r = this.riders.get(peer);
    if (!r) return null;
    this.riders.delete(peer);
    if (this.boarding(r.i, gt) && this.seats(r.i, gt).every((s) => s === null)) this.depart[r.i] = -Infinity;
    return [r.i, r.depart, -1];
  }

  /** Word from another cat of a ride it takes (or got out of). Returns whether it was believed. */
  receive(peer: string, [i, t, seat]: CoasterMsg, gt: number): boolean {
    if (i >= this.depart.length || t < gt - RIDE_MS - LATE_MS || t > gt + EARLY_MS) return false;
    if (seat < 0) {
      this.leave(peer, gt);
      return true;
    }
    const d = this.depart[i];
    // a car waiting at its station sets off when it's told; one boarding, at the earlier of the two times
    if (!this.boarding(i, gt) && !this.away(i, gt)) this.depart[i] = t;
    else if (t < d && t >= d - SAME_MS) this.depart[i] = t;
    this.riders.set(peer, { i, seat, depart: t });
    return true;
  }

  /** What `peer` (riding) tells the others, again: for anyone who didn't hear it the first time, or has just come. */
  told(peer: string): CoasterMsg | null {
    const r = this.riders.get(peer);
    return r ? [r.i, this.depart[r.i], r.seat] : null;
  }

  /** Where `peer` rides now (the coaster, the seat), if it does. */
  seatOf(peer: string, gt: number): { i: number; seat: number } | null {
    const r = this.riders.get(peer);
    if (!r) return null;
    if (gt >= this.depart[r.i] + RIDE_MS) {
      this.riders.delete(peer);
      return null;
    }
    return this.same(r, gt) ? { i: r.i, seat: r.seat } : null;
  }

  /** A cat gone from the garden: out of its seat. */
  forget(peer: string, gt: number): void {
    this.leave(peer, gt);
  }

  /** Is `r` on the ride coaster `r.i` is boarding or under way on (as far as we know)? */
  private same(r: Rider, gt: number): boolean {
    const d = this.depart[r.i];
    return Math.abs(r.depart - d) <= SAME_MS && gt < d + RIDE_MS;
  }
}

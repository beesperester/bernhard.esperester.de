// Deciding together what is true. There is no server to referee the garden,
// so the cats in it do: every visitor checks every claim another cat makes
// (a catch, how it moves) against what it saw itself, and tells everyone
// its verdict. A claim stands when most of the witnesses back it.
//
// - A catch counts (for the scoreboard) when a strict majority of the votes
//   cast confirm it: the cats that saw the prey there, within that cat's reach.
// - A cat is ignored for the rest of the visit once a strict majority of the
//   witnesses accuse it (each accuses after repeated strikes, see witness.ts).
//
// The cat making a claim never votes on it. Everyone gets the same votes, so
// everyone comes to the same verdicts.

/** How long to wait for every witness's vote on a catch before going with the votes in. */
export const VOTE_MS = 2500;

/** A decided catch; `ok` is null when nobody could vote on it (no one was looking). */
export interface Settled { catcher: string; kind: number; id: number; ok: boolean | null; points: number }

interface Pending {
  catcher: string; kind: number; id: number;
  /** When we first heard of it (the claim or a vote, whichever came first). */
  t: number;
  /** The catcher's own claim has arrived (votes can overtake it). */
  claimed: boolean;
  /** What it's worth, as far as we could tell. */
  points: number;
  votes: Map<string, boolean>;
  /** Witnesses that couldn't tell (our tab was in the background, say). */
  abstained: Set<string>;
}

export class Consensus {
  private readonly self: string;
  /** Other cats in the garden now. */
  private readonly present = new Set<string>();
  private readonly pending = new Map<string, Pending>();
  /** Who accuses whom. */
  private readonly accusations = new Map<string, Set<string>>();
  /** Cats the garden decided to ignore (for good: they don't come back by behaving for a bit). */
  private readonly banned = new Set<string>();

  constructor(self: string) {
    this.self = self;
  }

  join(peer: string): void {
    this.present.add(peer);
  }

  leave(peer: string): void {
    this.present.delete(peer);
    this.accusations.delete(peer);
    for (const set of this.accusations.values()) set.delete(peer);
  }

  ignored(peer: string): boolean {
    return this.banned.has(peer);
  }

  /** Cats whose word counts on a question about `subject`: everyone here but the subject and the ignored, and us. */
  private witnesses(subject: string): string[] {
    return [this.self, ...this.present].filter((p) => p !== subject && !this.banned.has(p));
  }

  // ---------------------------------------------------------------- catches

  /** `catcher` says it caught (kind, id); we judged it `ok` (null: we couldn't tell) and think it's worth `points`. */
  claim(catcher: string, kind: number, id: number, ok: boolean | null, points: number, now: number): void {
    const p = this.pendingFor(catcher, kind, id, now);
    p.claimed = true;
    p.points = points;
    if (ok === null) p.abstained.add(this.self);
    else p.votes.set(this.self, ok);
  }

  /** Another witness's verdict on a catch. */
  vote(from: string, catcher: string, kind: number, id: number, ok: boolean, now: number): void {
    if (from === catcher || from === this.self || this.banned.has(from)) return;
    this.pendingFor(catcher, kind, id, now).votes.set(from, ok);
  }

  /** Catches decided by now: everyone has voted, or time is up. */
  settle(now: number): Settled[] {
    const out: Settled[] = [];
    for (const [key, p] of this.pending) {
      const late = now - p.t >= VOTE_MS;
      if (!p.claimed) {
        // votes on a claim that never reached us: nothing to decide
        if (now - p.t >= 2 * VOTE_MS) this.pending.delete(key);
        continue;
      }
      const witnesses = this.witnesses(p.catcher);
      if (!late && !witnesses.every((w) => p.votes.has(w) || p.abstained.has(w))) continue;
      let yes = 0, no = 0;
      for (const w of witnesses) {
        const v = p.votes.get(w);
        if (v === true) yes++;
        else if (v === false) no++;
      }
      this.pending.delete(key);
      out.push({ catcher: p.catcher, kind: p.kind, id: p.id, ok: yes + no === 0 ? null : yes > no, points: p.points });
    }
    return out;
  }

  private pendingFor(catcher: string, kind: number, id: number, now: number): Pending {
    const key = `${catcher}:${kind}:${id}`;
    let p = this.pending.get(key);
    if (!p) this.pending.set(key, (p = { catcher, kind, id, t: now, claimed: false, points: 0, votes: new Map(), abstained: new Set() }));
    // a flood of made-up catches mustn't eat memory
    if (this.pending.size > 512) this.pending.delete(this.pending.keys().next().value!);
    return p;
  }

  // ---------------------------------------------------------------- accusations

  /** `from` accuses `suspect` (or takes it back). Returns true if that got the suspect ignored. */
  accuse(from: string, suspect: string, guilty: boolean): boolean {
    if (from === suspect || this.banned.has(from) || this.banned.has(suspect)) return false;
    let set = this.accusations.get(suspect);
    if (!set) this.accusations.set(suspect, (set = new Set()));
    if (guilty) set.add(from);
    else set.delete(from);
    const witnesses = this.witnesses(suspect);
    const against = witnesses.filter((w) => set.has(w)).length;
    if (against * 2 <= witnesses.length) return false;
    this.banned.add(suspect);
    this.accusations.delete(suspect);
    return true;
  }
}

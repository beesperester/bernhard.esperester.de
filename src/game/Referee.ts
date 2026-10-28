import type { CatMsg } from './state.ts';
import type { Prey } from './state.ts';
import { Consensus } from '../net/consensus.ts';
import { MoveWitness, Strikes } from '../net/witness.ts';
import type { VoteMsg } from '../net/protocol.ts';

// Our part in keeping the garden fair: we watch the other cats (witness.ts),
// judge their catches, vote, and go along with what the majority decides
// (consensus.ts). A catch the garden turns down doesn't count on the
// scoreboard; a cat the garden decides to ignore disappears for us.

/** A cat can't catch things quicker than this (a catch and the shortest snack take longer). */
const CATCH_EVERY_MS = 1000;

export interface RefereeDeps {
  /** Send a vote to everyone. */
  vote(msg: VoteMsg): void;
  /** Did we see that prey within that cat's reach just now? Its points if so; null if we can't tell. */
  judgeCatch(peer: string, kind: Prey, id: number): { ok: boolean; points: number } | null;
  /** The garden turned down a catch. */
  refused(peer: string, kind: Prey, id: number): void;
  /** The garden decided to ignore this cat. */
  ignore(peer: string): void;
}

export class Referee {
  private readonly self: string;
  private readonly deps: RefereeDeps;
  private readonly consensus: Consensus;
  private readonly witnesses = new Map<string, MoveWitness>();
  private readonly strikes = new Strikes();
  /** Cats we currently accuse. */
  private readonly accusing = new Set<string>();
  private readonly lastCatch = new Map<string, number>();

  constructor(self: string, deps: RefereeDeps) {
    this.self = self;
    this.deps = deps;
    this.consensus = new Consensus(self);
  }

  ignored(peer: string): boolean {
    return this.consensus.ignored(peer);
  }

  join(peer: string): void {
    this.consensus.join(peer);
    // a newcomer gets to hear what we hold against whom
    for (const suspect of this.accusing) this.deps.vote(['a', suspect, true]);
  }

  leave(peer: string): void {
    this.consensus.leave(peer);
    this.witnesses.delete(peer);
    this.strikes.forget(peer);
    this.accusing.delete(peer);
    this.lastCatch.delete(peer);
  }

  /** A state from another cat. False if that cat is ignored (drop it). */
  observe(peer: string, msg: CatMsg, now: number): boolean {
    if (this.ignored(peer)) return false;
    let w = this.witnesses.get(peer);
    if (!w) this.witnesses.set(peer, (w = new MoveWitness()));
    const [x, y, z, , act] = msg;
    if (w.observe(x, y, z, act, now)) this.strike(peer, now);
    return !this.ignored(peer);
  }

  /** Another cat says it caught (kind, id). True if we believe it (show the catch). */
  claim(peer: string, kind: Prey, id: number, now: number): boolean {
    if (this.ignored(peer)) return false;
    const judged = this.deps.judgeCatch(peer, kind, id);
    const quick = now - (this.lastCatch.get(peer) ?? -Infinity) < CATCH_EVERY_MS;
    this.lastCatch.set(peer, now);
    // can't tell (not looking): abstain, and show it, as nobody else will vouch for us seeing it either way
    if (!judged) {
      this.consensus.claim(peer, kind, id, null, 0, now);
      return true;
    }
    const ok = judged.ok && !quick;
    this.consensus.claim(peer, kind, id, ok, judged.points, now);
    this.deps.vote(['c', peer, kind, id, ok]);
    return ok;
  }

  receiveVote(from: string, msg: VoteMsg, now: number): void {
    if (this.ignored(from)) return;
    if (msg[0] === 'c') {
      const [, catcher, kind, id, ok] = msg;
      // (votes on our own catches: we know what we caught)
      if (catcher !== this.self) this.consensus.vote(from, catcher, kind, id, ok, now);
    } else {
      const [, suspect, guilty] = msg;
      if (suspect !== this.self && this.consensus.accuse(from, suspect, guilty)) this.deps.ignore(suspect);
    }
  }

  /** Settle catches whose votes are in; take back accusations whose strikes have been forgotten. */
  update(now: number): void {
    for (const s of this.consensus.settle(now)) {
      if (this.ignored(s.catcher)) continue;
      if (s.ok === false) {
        this.deps.refused(s.catcher, s.kind as Prey, s.id);
        this.strike(s.catcher, now);
      }
    }
    for (const suspect of this.accusing)
      if (!this.strikes.accused(suspect, now)) {
        this.accusing.delete(suspect);
        this.consensus.accuse(this.self, suspect, false);
        this.deps.vote(['a', suspect, false]);
      }
  }

  private strike(peer: string, now: number): void {
    this.strikes.add(peer, now);
    if (this.accusing.has(peer) || !this.strikes.accused(peer, now)) return;
    this.accusing.add(peer);
    this.deps.vote(['a', peer, true]);
    if (this.consensus.accuse(this.self, peer, true)) this.deps.ignore(peer);
  }
}

// Every cat's catches, kept in a chain it signs: the record its score (and how
// grown up it is) stands on, kept in its own browser so it outlasts any garden.
//
// It works much like a cryptocurrency's ledger, one chain per cat (as in Nano's
// block-lattice, where every account has its own):
//
// - Each catch is a block: what was caught (the garden's seed, the kind of
//   prey, its id), what it was worth, and when, plus the hash of the block
//   before. The cat signs it with its key (identity.ts). Change any block and
//   its hash changes, and the next block no longer fits: the past can only be
//   added to.
// - A prey (seed, kind, id) can be claimed once, like a coin spent once.
// - Other cats check a chain block by block (`extend`): the signatures, the
//   links, that every catch is something that exists and is worth what it
//   says, and that they don't come quicker than a cat can eat. What checks
//   out is that cat's score for them.
// - Cats that have watched another cat play for a while co-sign the head of
//   its chain (a `Check`, like a multisig). Enough of those, weighed by how
//   much the co-signers have themselves eaten (their "stake": a brand-new cat
//   from a second browser vouches for little), make a checkpoint: the chain up
//   to there no longer needs checking, so newcomers are sent only what comes
//   after it.
//
// - Every block carries the drand beacon of its moment (beacon.ts): it can't
//   have been made before then. Every so often the cat stamps its chain's
//   head with OpenTimestamps, which pins it in Bitcoin (stamp.ts): it was made
//   by then. A block over a day old counts only once a stamp made within a day
//   of it is proven: a history can't be made up after the fact. (Until then
//   its points are held back, not lost.)
//
// What it can't tell yet is whether a catch nobody else saw really happened;
// that's next (replaying the cat's moves).

import { b64, canonical, type Signed } from './identity.ts';
import { Prey } from '../game/state.ts';
import { PREY } from '../game/fauna/prey.ts';
import { GROWN_AT } from '../game/growth.ts';
import { beacons, roundTime, type Beacon } from './beacon.ts';
import type { Stamp } from './stamp.ts';

/**
 * One catch: cat `c`'s block number `n`, after the block with hash `v` ('' for the first); seed `w`,
 * prey kind `k` and id `i`, worth `p` points, at `t` (ms since epoch), with drand's beacon round `r`
 * and its signature `b` (base64url).
 */
export type Link = { c: string; n: number; v: string; w: number; k: number; i: number; p: number; t: number; r: number; b: string };
export type Block = Signed<Link>;

/** Cat `a` vouches that cat `c`'s first `n` blocks end in hash `h` and add up to `s`, at `t` (its clock). */
export type Check = { c: string; n: number; h: string; s: number; a: string; t: number };

/** Where a chain stands: how many blocks, the last one's hash, and the score. */
export type Head = { n: number; h: string; s: number };

/**
 * How far a cat's chain checks out for us: the first `n` blocks, ending in
 * `h`, adding up to score `s` (`top`: the most it ever had, which is how grown
 * it is: a bee sting takes a point, not a size). `key` is its public key, `last`
 * the time of its last block, `recent` the last blocks' [receipt, time, points].
 */
export type Tally = {
  c: string; key: string; n: number; h: string; s: number; top: number; last: number; recent: [string, number, number][];
  /** Points held back: blocks over a day old when checked, waiting for a stamp ([number, receipt, points, beacon time]). */
  held: [number, string, number, number][];
  /** When its chain was last proven to exist, by a stamp anchored in Bitcoin (ms; 0: never). */
  anchor: number;
};

/** No game before this (ms since epoch): no blocks dated earlier. */
export const EPOCH = Date.UTC(2026, 0, 1);
/** Blocks dated further ahead of our clock than this are not believed. */
export const AHEAD_MS = 5 * 60 * 1000;
/** A cat can't catch things quicker than this (a catch and the quickest snack take longer). */
export const CATCH_EVERY_MS = 1000;
/** No more than RATE_MAX points in any RATE_WINDOW_MS. */
export const RATE_MAX = 400, RATE_WINDOW_MS = 10 * 60 * 1000;
/** How many of a chain's last blocks a tally remembers (for the two rules above). */
export const RECENT = 128;
/** A block is made within this long of its beacon (the beacon comes first; the clock may be behind drand's by a little). */
export const BEACON_LAG = 60 * 1000, BEACON_EARLY = 10 * 1000;
/** A block older than this must be covered by a stamp proven made within this long of it. */
export const STAMP_WITHIN = 24 * 60 * 60 * 1000;
/** Blocks per message. */
export const PAGE = 100;

/** What each kind of prey can be worth (all its varieties). */
const WORTH: Map<number, Set<number>> = new Map(
  Object.values(Prey).map((k) => [k, new Set(Array.from({ length: 16 }, (_, c) => PREY[k].points(c)))]),
);

export const receipt = (d: Pick<Link, 'w' | 'k' | 'i'>): string => `${d.w}.${d.k}.${d.i}`;

/** A block's hash: SHA-256 over what was signed and the signature, 128 bits in base64url. */
export async function hashOf(b: Block): Promise<string> {
  const d = canonical(b.d), s = new TextEncoder().encode(`.${b.s}`);
  const all = new Uint8Array(d.length + s.length);
  all.set(d);
  all.set(s, d.length);
  return b64(await crypto.subtle.digest('SHA-256', all)).slice(0, 22);
}

/** A chain we know nothing of yet. */
export const blank = (c: string): Tally => ({ c, key: '', n: 0, h: '', s: 0, top: 0, last: 0, recent: [], held: [], anchor: 0 });

export type SigCheck = (s: Signed<object>, id: string) => Promise<boolean>;

/** Why a block doesn't fit, or null if it does (signature aside). */
export function fault(t: Tally, b: Block, now: number): string | null {
  const d = b.d;
  if (d.c !== t.c) return 'not its chain';
  if (d.n !== t.n || d.v !== t.h) return 'not the next block';
  if (t.key && b.k !== t.key) return 'another key';
  if (!Number.isInteger(d.w) || d.w < 0 || d.w > 0xffffffff || !Number.isSafeInteger(d.i) || d.i < 0) return 'no such prey';
  const worth = WORTH.get(d.k);
  if (!worth?.has(d.p)) return 'not worth that';
  if (!Number.isSafeInteger(d.t) || d.t < EPOCH || d.t > now + AHEAD_MS) return 'out of time';
  const beaconAt = roundTime(d.r);
  if (d.t < beaconAt - BEACON_EARLY || d.t > beaconAt + BEACON_LAG) return 'not at its beacon';
  if (t.n > 0 && d.t - t.last < CATCH_EVERY_MS) return 'too quick';
  const key = receipt(d);
  if (t.recent.some(([r]) => r === key)) return 'caught twice';
  let eaten = Math.max(0, d.p);
  for (const [, at, p] of t.recent) if (at > d.t - RATE_WINDOW_MS) eaten += Math.max(0, p);
  if (eaten > RATE_MAX) return 'too much too quickly';
  return null;
}

/**
 * The tally with block `b` added. `refused`: points we know the garden refused, which count for nothing;
 * `held`: points held back until a stamp shows the block was made when it says.
 */
export function add(t: Tally, b: Block, h: string, refused = false, held = false): Tally {
  const p = refused ? 0 : b.d.p, s = Math.max(0, t.s + (held ? 0 : p));
  return {
    c: t.c, key: b.k, n: t.n + 1, h, s, top: Math.max(t.top, s), last: b.d.t,
    recent: [...t.recent, [receipt(b.d), b.d.t, p] as [string, number, number]].slice(-RECENT),
    held: held && p ? [...t.held, [b.d.n, receipt(b.d), p, roundTime(b.d.r)] as [number, string, number, number]] : t.held,
    anchor: t.anchor,
  };
}

export type ExtendOptions = {
  /** The garden refused this catch. */
  refused?: boolean;
  /** Our own chain, read back: no need to check the beacons we fetched ourselves, or for stamps. */
  own?: boolean;
};

/** Check block `b` and add it to the tally; a string says why it was refused. */
export async function extend(t: Tally, b: Block, now: number, check: SigCheck, opts: ExtendOptions = {}): Promise<Tally | string> {
  const why = fault(t, b, now);
  if (why) return why;
  if (!(await check(b, t.c))) return 'not signed by that cat';
  if (!opts.own && !(await beacons.verify({ r: b.d.r, b: b.d.b }))) return 'no such beacon';
  // (an old block: its points wait for a stamp)
  const old = !opts.own && now - roundTime(b.d.r) > STAMP_WITHIN;
  return add(t, b, await hashOf(b), opts.refused, old);
}

/**
 * A stamp of this chain's first `n` blocks proven made by `at`: the held-back points of blocks before
 * it that it was made within a day of count now; the others never will.
 */
export function settle(t: Tally, n: number, at: number): Tally {
  let s = t.s;
  const held = t.held.filter(([bn, , p, beaconAt]) => {
    if (bn >= n) return true;
    if (at <= beaconAt + STAMP_WITHIN) s += p;
    return false;
  });
  return { ...t, s, top: Math.max(t.top, s), held, anchor: Math.max(t.anchor, at) };
}

/** The garden decided after all that this catch didn't happen: take its points back off. */
export function refuse(t: Tally, key: string): Tally {
  if (t.held.some(([, r]) => r === key)) return { ...t, held: t.held.filter(([, r]) => r !== key) };
  const i = t.recent.findIndex(([r, , p]) => r === key && p > 0);
  if (i < 0) return t;
  const recent = t.recent.map((e, j): [string, number, number] => (j === i ? [e[0], e[1], 0] : e));
  return { ...t, s: Math.max(0, t.s - t.recent[i][2]), recent };
}

// ---- checkpoints ----

/** How much a co-signer's word weighs, by how much it has eaten itself: a quarter for a newcomer, a whole for a grown cat. */
export const weight = (stake: number): number => 0.25 + 0.75 * Math.min(1, Math.max(0, stake) / GROWN_AT);

/** How much a set of co-signatures (of one head) weighs, counting each co-signer once. */
export function weighOf(proof: Signed<Check>[], stakeOf: (id: string) => number): number {
  const by = new Set<string>();
  let sum = 0;
  for (const p of proof)
    if (!by.has(p.d.a) && p.d.a !== p.d.c) {
      by.add(p.d.a);
      sum += weight(stakeOf(p.d.a));
    }
  return sum;
}

/**
 * Start a cat's tally from a checkpoint: co-signatures of one head of its chain
 * that weigh at least a whole, each really from whom it says. Null if it isn't one.
 */
export async function fromCheck(c: string, proof: Signed<Check>[], stakeOf: (id: string) => number, check: SigCheck): Promise<Tally | null> {
  const first = proof[0]?.d;
  if (!first || first.c !== c || proof.some((p) => p.d.c !== c || p.d.n !== first.n || p.d.h !== first.h || p.d.s !== first.s)) return null;
  if (weighOf(proof, stakeOf) < 1) return null;
  for (const p of proof) if (!(await check(p, p.d.a))) return null;
  // (what comes after can't be dated before the co-signers saw this head, give or take their clocks)
  const seen = Math.min(...proof.map((p) => p.d.t)) - AHEAD_MS;
  return { c, key: '', n: first.n, h: first.h, s: first.s, top: first.s, last: seen, recent: [], held: [], anchor: 0 };
}

// ---- our own chain ----

/** Where our chain is kept (IndexedDB in the game, a Map in tests). */
export interface ChainStore {
  load(): Promise<{ blocks: Block[]; checks: Signed<Check>[]; stamps: Stamp[] }>;
  put(b: Block): Promise<void>;
  putChecks(checks: Signed<Check>[]): Promise<void>;
  putStamps(stamps: Stamp[]): Promise<void>;
}

/** Stamps we keep of our chain at most (dropping those the next one covers nearly as well). */
const KEEP_STAMPS = 24;
/** A stamp can go if the next one was made within this long of the one before it. */
const STAMP_SPAN_MS = 12 * 60 * 60 * 1000;

/** Co-signatures we keep: of this many of our heads. */
const KEEP_HEADS = 8;

/** Our own chain: what we have eaten, block by block, and the co-signatures others gave it. */
export class Chain {
  readonly id: string;
  private readonly sign: (l: Link) => Promise<Block>;
  private readonly store: ChainStore;
  private blocks: Block[] = [];
  private hashes: string[] = [];
  private tally: Tally;
  private checks: Signed<Check>[] = [];
  private stampList: Stamp[] = [];
  /** When our chain was last proven to exist by a stamp anchored in Bitcoin (ms; 0: not yet). */
  anchor = 0;
  /** Appends wait their turn (each needs the hash of the one before). */
  private queue: Promise<unknown> = Promise.resolve();
  private readonly beacon: () => Promise<Beacon>;

  /** `beacon`: the latest drand beacon (beacon.ts), waited for if need be. */
  constructor(id: string, sign: (l: Link) => Promise<Block>, store: ChainStore, beacon: () => Promise<Beacon>) {
    this.id = id;
    this.sign = sign;
    this.store = store;
    this.beacon = beacon;
    this.tally = blank(id);
  }

  /** Read the chain back from where it is kept (only blocks that still check out, in order: anything after a gap is dropped). */
  async load(check: SigCheck): Promise<void> {
    const { blocks, checks, stamps } = await this.store.load();
    blocks.sort((a, b) => a.d.n - b.d.n);
    for (const b of blocks) {
      // (our own blocks: the clock rules were met when we made them; but not one from before blocks had beacons)
      const next = sanitizeBlock(b) ? await extend(this.tally, b, Infinity, check, { own: true }) : 'not a block';
      if (typeof next === 'string') break;
      this.blocks.push(b);
      this.hashes.push(next.h);
      this.tally = next;
    }
    this.checks = checks.filter((c) => c.d.c === this.id && c.d.n <= this.tally.n && this.hashes[c.d.n - 1] === c.d.h);
    this.stampList = stamps.filter((s) => s.n <= this.tally.n && this.hashes[s.n - 1] === s.h).sort((a, b) => a.n - b.n);
  }

  get head(): Head {
    return { n: this.tally.n, h: this.tally.h, s: this.tally.s };
  }

  /** The score: what our blocks add up to. */
  get score(): number {
    return this.tally.s;
  }

  /** The most we ever had: how grown up our cat is. */
  get top(): number {
    return this.tally.top;
  }

  /** A catch: a new block on the chain (null if it can't go on it: caught already, say). */
  append(w: number, k: Prey, i: number, p: number): Promise<Block | null> {
    const next = this.queue.then(async () => {
      // (waiting for drand, if need be: the catch goes on the chain once there's a beacon to put on it)
      const beacon = await this.beacon();
      const t = this.tally;
      const at = Math.max(Date.now(), t.n ? t.last + CATCH_EVERY_MS : 0, roundTime(beacon.r) - BEACON_EARLY);
      const b = await this.sign({ c: this.id, n: t.n, v: t.h, w, k, i, p, t: at, r: beacon.r, b: beacon.b });
      if (fault(t, b, Infinity)) return null;
      const h = await hashOf(b);
      this.blocks.push(b);
      this.hashes.push(h);
      this.tally = add(t, b, h);
      await this.store.put(b);
      return b;
    });
    this.queue = next.catch(() => {});
    return next;
  }

  /** Would this catch go on the chain (not one we've had already, not too soon)? */
  fits(w: number, k: Prey, i: number): boolean {
    return !this.tally.recent.some(([r]) => r === receipt({ w, k, i }));
  }

  /** Our blocks from number `from` on (a page of them). */
  from(from: number, max = PAGE): Block[] {
    return this.blocks.slice(Math.max(0, from), Math.max(0, from) + max);
  }

  /** The hash of our block number `n - 1` (what `n` blocks end in). */
  hashAt(n: number): string {
    return n > 0 ? this.hashes[n - 1] ?? '' : '';
  }

  /** A co-signature of our chain from another cat: kept if it is of a head of ours. */
  async cosigned(c: Signed<Check>, check: SigCheck): Promise<boolean> {
    const d = c.d;
    if (d.c !== this.id || d.a === this.id || d.n < 1 || d.n > this.tally.n || this.hashAt(d.n) !== d.h) return false;
    if (!(await check(c, d.a))) return false;
    const rest = this.checks.filter((o) => !(o.d.a === d.a && o.d.n === d.n));
    // the newest heads' co-signatures
    const heads = [...new Set([...rest, c].map((o) => o.d.n))].sort((a, b) => b - a).slice(0, KEEP_HEADS);
    this.checks = [...rest, c].filter((o) => heads.includes(o.d.n));
    await this.store.putChecks(this.checks);
    return true;
  }

  /** Our latest checkpoint as `stakeOf` weighs the co-signers: co-signatures of one head (and score) weighing a whole. */
  checkpoint(stakeOf: (id: string) => number): Signed<Check>[] | null {
    const groups = new Map<string, Signed<Check>[]>();
    for (const c of this.checks) {
      const key = `${c.d.n}.${c.d.h}.${c.d.s}`;
      groups.set(key, [...(groups.get(key) ?? []), c]);
    }
    let best: Signed<Check>[] | null = null;
    for (const g of groups.values()) if (weighOf(g, stakeOf) >= 1 && (!best || g[0].d.n > best[0].d.n)) best = g;
    return best;
  }

  /** Our stamps (oldest first). */
  get stamps(): Stamp[] {
    return [...this.stampList];
  }

  /** Our stamps of heads from block `n` on (what someone checking our blocks from there needs). */
  stampsFrom(n: number): Stamp[] {
    return this.stampList.filter((s) => s.n >= n);
  }

  /** Whether our head has been stamped. */
  get stamped(): boolean {
    const last = this.stampList[this.stampList.length - 1];
    return this.tally.n === 0 || (last?.n === this.tally.n && last.h === this.tally.h);
  }

  /** Keep a stamp of our chain (a new one, or an old one upgraded). */
  async keepStamp(s: Stamp): Promise<void> {
    if (s.n < 1 || s.n > this.tally.n || this.hashAt(s.n) !== s.h) return;
    const list = [...this.stampList.filter((o) => o.n !== s.n), s].sort((a, b) => a.n - b.n);
    // too many: drop the one the next covers best (the blocks between were made in the shortest span)
    while (list.length > KEEP_STAMPS) {
      let best = -1, span = STAMP_SPAN_MS;
      for (let j = 1; j < list.length - 1; j++) {
        const from = this.blocks[list[j - 1].n - 1].d.t, to = this.blocks[list[j + 1].n - 1].d.t;
        if (to - from <= span) { span = to - from; best = j; }
      }
      list.splice(best < 0 ? 0 : best, 1);
    }
    this.stampList = list;
    await this.store.putStamps(list);
  }

  /** Everything, for a collar tag. */
  all(): { blocks: Block[]; checks: Signed<Check>[]; stamps: Stamp[] } {
    return { blocks: [...this.blocks], checks: [...this.checks], stamps: [...this.stampList] };
  }
}

// ---- checking what comes in ----

const CAT_ID = /^[a-z2-7]{20}$/;
const HASH = /^[A-Za-z0-9_-]{22}$/;
const B64 = (v: unknown) => typeof v === 'string' && v.length > 0 && v.length <= 200 && /^[A-Za-z0-9_-]+$/.test(v);
const int = (v: unknown): v is number => Number.isSafeInteger(v);
/** A beacon's signature: 48 bytes. */
const BEACON = /^[A-Za-z0-9_-]{64}$/;

/** Exactly the fields of a block (anything more would not have been signed). */
function link(d: unknown): Link | null {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
  const { c, n, v, w, k, i, p, t, r, b } = d as Record<string, unknown>;
  if (Object.keys(d).length !== 10 || typeof c !== 'string' || !CAT_ID.test(c) || typeof v !== 'string' || (v !== '' && !HASH.test(v))) return null;
  if (![n, w, k, i, p, t, r].every(int) || (n as number) < 0 || (r as number) < 1 || typeof b !== 'string' || !BEACON.test(b)) return null;
  return { c, n: n as number, v, w: w as number, k: k as number, i: i as number, p: p as number, t: t as number, r: r as number, b };
}

function check(d: unknown): Check | null {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
  const { c, n, h, s, a, t } = d as Record<string, unknown>;
  if (Object.keys(d).length !== 6 || typeof c !== 'string' || !CAT_ID.test(c) || typeof a !== 'string' || !CAT_ID.test(a)) return null;
  if (typeof h !== 'string' || !HASH.test(h) || ![n, s, t].every(int) || (n as number) < 1 || (s as number) < 0) return null;
  return { c, n: n as number, h, s: s as number, a, t: t as number };
}

function signed<T>(x: unknown, data: (d: unknown) => T | null): Signed<T> | null {
  if (!x || typeof x !== 'object') return null;
  const { d, k, s } = x as Record<string, unknown>;
  const inner = data(d);
  return inner && B64(k) && B64(s) && Object.keys(x).length === 3 ? { d: inner, k: k as string, s: s as string } : null;
}

export const sanitizeBlock = (x: unknown): Block | null => signed(x, link);
export const sanitizeCheck = (x: unknown): Signed<Check> | null => signed(x, check);

/** A list of blocks (or co-signatures) from a peer: all well-formed, or none. */
export function sanitizeList<T>(x: unknown, one: (v: unknown) => T | null, max: number): T[] | null {
  if (!Array.isArray(x) || x.length > max) return null;
  const out = x.map(one);
  return out.every((v) => v) ? (out as T[]) : null;
}

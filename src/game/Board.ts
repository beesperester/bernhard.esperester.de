
// The scoreboard: how much every cat has eaten, ever. There is no server, so
// every cat keeps its own record: a chain of its catches, signed and kept in
// its browser (net/ledger.ts), which is what its score and how grown it is
// stand on, in any garden, whoever else is there.
//
// The cats tell each other their name and the head of their chain (a signed
// entry, bound to the connection it came on), and whoever doesn't know that
// chain yet asks for the blocks it hasn't seen and checks them one by one. So
// for other cats a cat's score is only ever what its chain checks out at.
// Cats that have watched another play for a while co-sign the head of its
// chain; enough of that makes a checkpoint, and later newcomers are sent only
// what came after it.
//
// The board also remembers the cats we have met (in this browser), with the
// score their chain last checked out at, so it shows them after they've gone.

import type { Signed } from '../net/identity.ts';
import { PAGE, blank, extend, fromCheck, receipt, refuse, sanitizeBlock, sanitizeCheck, sanitizeList, type Block, type Chain, type Check, type SigCheck, type Tally } from '../net/ledger.ts';
import type { Prey } from './state.ts';

// (type aliases rather than interfaces, so they count as plain JSON for sending)
export type Entry = {
  /** A cat's id: the hash of its public key. */
  id: string;
  name: string;
  /** Its coat, for the face on the board. */
  coat: number;
  /** Chosen by its owner (rather than given at random). */
  custom: boolean;
  /** When the owner signed it (garden clock, ms): the latest wins. */
  t: number;
  /** The connection it was signed for, so no other connection can pass it off as its own. */
  p: string;
  /** The head of its chain: how many blocks, the last one's hash, and the score they add up to. */
  n: number;
  h: string;
  s: number;
};

/** A cat on the board: its entry, its score as far as it checks out, and whether it's in the garden now. */
export type Row = { id: string; name: string; coat: number; score: number; here: boolean };

export type BoardMsg = {
  /** The sender's own entry. */
  me?: Signed<Entry>;
  /** Asks for the receiver's blocks from number [0] on (the asker has them up to there, ending in hash [1]); -1: all of them, no checkpoint. */
  want?: [number, string];
  /** Blocks of the sender's own chain, in order. */
  blocks?: Block[];
  /** A checkpoint of the sender's own chain (the blocks follow on from it). */
  proof?: Signed<Check>[];
  /** The sender co-signs the receiver's chain. */
  cosign?: Signed<Check>;
};

/** What the board needs: our chain, to sign things in our cat's name, to tell the time, and to check signatures. */
export interface Signer {
  id: string;
  /** This visit's connection id. */
  peer: string;
  sign: <T extends object>(d: T) => Promise<Signed<T>>;
  now: () => number;
  chain: Chain;
  check: SigCheck;
  /** The garden's seed (a prey's id is only unique within it). */
  seed: number;
}

/** Snacks needed to earn a name of your own choosing. */
export const NAME_AT = 100;
export const NAME_MAX = 16;

/** How many cats we remember, and how often we write them down. */
const REMEMBER = 60, SAVE_MS = 2000;
/** An unanswered request for blocks is asked again after this. */
const ASK_AGAIN_MS = 5000;
/** We co-sign a cat's chain once we've played alongside it this long, and again at most this often. */
const COSIGN_AFTER_MS = 60_000, COSIGN_EVERY_MS = 60_000;

import { COATS } from '../art/cat.ts';

const ADJ = [
  'Sleepy', 'Fluffy', 'Sneaky', 'Tiny', 'Grumpy', 'Velvet', 'Dusty', 'Misty', 'Lucky', 'Fuzzy', 'Ginger', 'Pepper',
  'Sunny', 'Purring', 'Prowling', 'Pouncing', 'Curious', 'Cozy', 'Sly', 'Bouncy', 'Speckled', 'Stripy', 'Silky',
  'Snuggly', 'Mighty', 'Little', 'Sir', 'Lady', 'Captain', 'Professor',
];
const NOUN = [
  'Whiskers', 'Mittens', 'Paws', 'Beans', 'Biscuit', 'Noodle', 'Muffin', 'Pudding', 'Tabby', 'Kitten', 'Mouser', 'Purr',
  'Socks', 'Pickles', 'Nibbles', 'Pounce', 'Furball', 'Tuna', 'Sardine', 'Catnip', 'Toebeans', 'Kneader', 'Pebble',
  'Marmalade', 'Butterscotch',
];

const pick = (words: string[]) => words[Math.floor(Math.random() * words.length)];
/** A name made up of two words (short enough to be a name: the others wouldn't take a longer one). */
function randomName(): string {
  for (;;) {
    const name = `${pick(ADJ)} ${pick(NOUN)}`;
    if (name.length <= NAME_MAX) return name;
  }
}
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** A cat we have met: its name and coat when we last saw it, and how far its chain checked out. */
type Known = { name: string; coat: number; seen: number; tally: Tally };

export class Board {
  readonly id: string;
  private readonly signer: Signer;
  private readonly chain: Chain;
  /** Our own entry as it stands (signed a moment later). */
  private mine: Entry;
  /** Our entry as last signed (what we send). */
  private signed: Promise<Signed<Entry>>;
  /** The entries of the cats here, as they signed them, by cat id. */
  private entries = new Map<string, Signed<Entry>>();
  /** Which peer is which cat. */
  private readonly peers = new Map<string, string>();
  /** The cats we have met, by id (written down in this browser). */
  private readonly known: Map<string, Known>;
  private saving: ReturnType<typeof setTimeout> | 0 = 0;
  /** Asked a peer for blocks, at (page clock). */
  private readonly asking = new Map<string, number>();
  /** Checking a cat's blocks: one batch at a time. */
  private readonly checking = new Map<string, Promise<void>>();
  /** Cats whose chain didn't check out this visit: we stop asking. */
  private readonly bad = new Set<string>();
  /** When each peer arrived (page clock), and when we last co-signed each cat's chain, and how far. */
  private readonly met = new Map<string, number>();
  private readonly cosigned = new Map<string, { n: number; at: number }>();
  /** Catches the garden turned down, by cat: they count for nothing. */
  private readonly refused = new Map<string, Set<string>>();
  private readonly send: (msg: BoardMsg, target?: string) => void;
  private readonly changed: () => void;

  constructor(coat: number, signer: Signer, send: (msg: BoardMsg, target?: string) => void, changed: () => void) {
    this.signer = signer;
    this.chain = signer.chain;
    this.id = signer.id;
    this.send = send;
    this.changed = changed;
    this.known = loadKnown();
    // the name given on the first visit (or chosen since) comes back on later ones
    const saved = loadName();
    this.mine = { id: this.id, name: saved?.name ?? randomName(), coat, custom: saved?.custom ?? false, t: 0, p: signer.peer, ...this.chain.head };
    this.signed = signer.sign(this.mine);
    saveName(this.me);
  }

  get me(): Entry {
    return this.mine;
  }

  /** Still checking blocks some cat sent. */
  get busy(): boolean {
    return this.checking.size > 0;
  }

  /** Everyone on the board, best first: the cats here, and the ones we've met before. */
  ranking(): Row[] {
    const rows: Row[] = [{ id: this.id, name: this.mine.name, coat: this.mine.coat, score: this.chain.score, here: true }];
    const here = new Set<string>();
    for (const { d } of this.entries.values()) {
      here.add(d.id);
      rows.push({ id: d.id, name: d.name, coat: d.coat, score: this.scoreOf(d.id), here: true });
    }
    for (const [id, k] of this.known) if (!here.has(id) && id !== this.id) rows.push({ id, name: k.name, coat: k.coat, score: k.tally.s, here: false });
    return rows.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  }

  /** The name of the cat behind a peer, once it has told us. */
  nameOf(peerId: string): string {
    const id = this.peers.get(peerId);
    return (id && this.entries.get(id)?.d.name) || '';
  }

  /** A cat's score as far as its chain checks out for us. */
  scoreOf(id: string): number {
    return id === this.id ? this.chain.score : this.tallyOf(id).s;
  }

  /** How much a cat has eaten as far as we know (its stake, when it co-signs). */
  private stakeOf = (id: string): number => (id === this.id ? this.chain.top : (this.known.get(id)?.tally.top ?? 0));

  private tallyOf(id: string): Tally {
    return this.known.get(id)?.tally ?? blank(id);
  }

  /** A new garden: the cats here are someone else (we keep everything we know). */
  reset(): void {
    this.entries.clear();
    this.peers.clear();
    this.asking.clear();
    this.met.clear();
    this.changed();
  }

  /** Say hello to a newcomer. */
  greet(peerId: string, now: number): void {
    this.met.set(peerId, now);
    void this.signed.then((me) => this.send({ me }, peerId));
  }

  /** A peer left. */
  leave(peerId: string): void {
    const id = this.peers.get(peerId);
    this.peers.delete(peerId);
    this.asking.delete(peerId);
    this.met.delete(peerId);
    if (id) this.entries.delete(id);
    this.changed();
  }

  /** The garden decided to ignore this peer: off the board, and forgotten. */
  drop(peerId: string): void {
    const id = this.peers.get(peerId);
    this.leave(peerId);
    if (id && id !== this.id) {
      this.bad.add(id);
      this.known.delete(id);
      this.save();
    }
  }

  /** The garden turned down a catch by this peer's cat: it counts for nothing (now, or when its block comes). */
  refuse(peerId: string, kind: Prey, preyId: number): void {
    const id = this.peers.get(peerId);
    if (!id) return;
    const key = receipt({ w: this.signer.seed, k: kind, i: preyId });
    let set = this.refused.get(id);
    if (!set) this.refused.set(id, (set = new Set()));
    set.add(key);
    const k = this.known.get(id);
    if (k) {
      k.tally = refuse(k.tally, key);
      this.save();
      this.changed();
    }
  }

  /** Our cat caught something: a block on our chain, and the news to everyone. False if it can't count (had it already). */
  async ate(kind: Prey, preyId: number, points: number): Promise<boolean> {
    const b = await this.chain.append(this.signer.seed, kind, preyId, points);
    if (!b) return false;
    this.restate({}, [b]);
    return true;
  }

  /** Is this name free for us to take? */
  available(name: string): boolean {
    return ![...this.entries.values()].some((s) => same(s.d.name, name));
  }

  rename(name: string): void {
    this.restate({ name: name.trim().slice(0, NAME_MAX), custom: true });
  }

  /**
   * A message from another cat (its own entry already checked: signed by that
   * cat, for this very connection): its entry, a request for our blocks, its
   * blocks, or its co-signature of our chain.
   */
  receive(peerId: string, msg: BoardMsg, now: number): void {
    const sender = msg.me?.d;
    if (sender) {
      if (sender.id === this.id) return; // that's us, it can't be them
      // a cat can't swap identities mid-visit to shake off what the garden knows about it
      const known = this.peers.get(peerId);
      if (known && known !== sender.id) return;
      this.peers.set(peerId, sender.id);
      if (!this.met.has(peerId)) this.met.set(peerId, now);
      const old = this.entries.get(sender.id);
      if (!old || sender.t > old.d.t) this.entries.set(sender.id, msg.me!);
      this.resolveClash();
    }
    const id = this.peers.get(peerId);
    if (!id) return;
    if (msg.want) this.serve(peerId, msg.want);
    if (msg.cosign && msg.cosign.d.a === id) void this.chain.cosigned(msg.cosign, this.signer.check);
    if (msg.blocks || msg.proof) this.take(peerId, id, msg.proof, msg.blocks ?? [], now);
    else this.sync(peerId, now);
    this.changed();
  }

  /** Ask a peer for what we haven't checked of its chain yet (unless we're waiting for an answer). */
  private sync(peerId: string, now: number): void {
    const id = this.peers.get(peerId), e = id && this.entries.get(id)?.d;
    if (!id || !e || this.bad.has(id) || this.checking.has(id)) return;
    let t = this.tallyOf(id);
    if (t.n === e.n && t.h === e.h) {
      this.asking.delete(peerId);
      return;
    }
    // a chain other than the one we know (from another browser, say): check it afresh
    if (t.n > e.n || (t.n === e.n && t.h !== e.h)) t = this.remember(id, e, blank(id));
    if (now - (this.asking.get(peerId) ?? -Infinity) < ASK_AGAIN_MS) return;
    this.asking.set(peerId, now);
    this.send({ want: [t.n, t.h] }, peerId);
  }

  /** A peer wants our blocks from number n on: from our latest checkpoint, if it starts from scratch. */
  private serve(peerId: string, [n, h]: [number, string]): void {
    if (n > 0 && this.chain.hashAt(n) !== h) n = 0;
    const proof = n === 0 ? this.chain.checkpoint(this.stakeOf) : null;
    if (proof) this.send({ proof, blocks: this.chain.from(proof[0].d.n) }, peerId);
    else this.send({ blocks: this.chain.from(Math.max(0, n)) }, peerId);
  }

  /** Blocks of a cat's chain (from a checkpoint, maybe): check them one by one, as far as they go. */
  private take(peerId: string, id: string, proof: Signed<Check>[] | undefined, blocks: Block[], now: number): void {
    if (this.bad.has(id)) return;
    const prev = this.checking.get(id) ?? Promise.resolve();
    const next = prev.then(async () => {
      const e = this.entries.get(id)?.d;
      if (!e) return;
      let t = this.tallyOf(id);
      if (proof && t.n < proof[0].d.n) {
        const from = await fromCheck(id, proof, this.stakeOf, this.signer.check);
        // not a checkpoint we can go by: ask for the whole chain
        if (!from) {
          this.asking.set(peerId, now);
          return this.send({ want: [-1, ''] }, peerId);
        }
        t = from;
      }
      for (const b of blocks) {
        if (b.d.n < t.n) continue;
        // (news of a catch further on than we've got to: we'll ask for what's in between)
        if (b.d.n > t.n) break;
        const refused = this.refused.get(id)?.has(receipt(b.d)) ?? false;
        const r = await extend(t, b, Date.now(), this.signer.check, refused);
        if (r === 'not the next block' && t.n > 0) {
          // another chain than the one we knew of this cat: start over with it
          t = blank(id);
          break;
        }
        if (typeof r === 'string') {
          console.warn(`cat ${id}'s chain doesn't check out at block ${b.d.n}: ${r}`);
          this.bad.add(id);
          break;
        }
        t = r;
      }
      this.remember(id, e, t);
      this.asking.delete(peerId);
      this.changed();
    });
    this.checking.set(id, next);
    void next.finally(() => {
      if (this.checking.get(id) === next) this.checking.delete(id);
      // more to come?
      if (this.peers.get(peerId) === id) this.sync(peerId, performance.now());
    });
  }

  private remember(id: string, e: Entry, tally: Tally): Tally {
    this.known.delete(id);
    this.known.set(id, { name: e.name, coat: e.coat, seen: Date.now(), tally });
    this.save();
    return tally;
  }

  /** Co-sign the chains of the cats we've been playing alongside (`now`: page clock). */
  update(now: number): void {
    for (const [peerId, id] of this.peers) {
      const e = this.entries.get(id)?.d, t = this.known.get(id)?.tally, last = this.cosigned.get(id);
      if (!e || !t || t.n === 0 || t.n !== e.n || t.h !== e.h || this.bad.has(id)) continue;
      if (now - (this.met.get(peerId) ?? now) < COSIGN_AFTER_MS || (last && (last.n >= t.n || now - last.at < COSIGN_EVERY_MS))) continue;
      this.cosigned.set(id, { n: t.n, at: now });
      void this.signer.sign<Check>({ c: id, n: t.n, h: t.h, s: t.s, a: this.id, t: Date.now() }).then((cosign) => this.send({ cosign }, peerId));
    }
  }

  /** Two cats with one name: the one that came up with it later (or at random) picks another. */
  private resolveClash(): void {
    const me = this.me;
    const rival = [...this.entries.values()].map((s) => s.d).find((e) => same(e.name, me.name));
    if (!rival || (me.custom && !rival.custom) || (me.custom === rival.custom && this.id < rival.id)) return;
    let name = randomName();
    for (let i = 0; i < 50 && !this.available(name); i++) name = randomName();
    this.restate({ name, custom: false });
  }

  private restate(change: Partial<Entry>, blocks?: Block[]): void {
    this.mine = { ...this.mine, ...change, ...this.chain.head, t: Math.max(this.mine.t + 1, Math.round(this.signer.now())) };
    saveName(this.mine);
    this.signed = this.signer.sign(this.mine);
    void this.signed.then((me) => this.send({ me, ...(blocks ? { blocks } : {}) }));
    this.changed();
  }

  /** Write down the cats we know (a moment later, once for many changes). */
  private save(): void {
    if (this.saving) return;
    this.saving = setTimeout(() => {
      this.saving = 0;
      const all = [...this.known.entries()].sort((a, b) => b[1].seen - a[1].seen).slice(0, REMEMBER);
      try { localStorage.setItem('cats-known', JSON.stringify(Object.fromEntries(all))); } catch { /* storage unavailable */ }
    }, SAVE_MS);
  }
}

function loadName(): { name: string; custom: boolean } | null {
  try {
    const v = JSON.parse(localStorage.getItem('cat-name') ?? 'null');
    return v && typeof v.name === 'string' && v.name.trim() && v.name.length <= NAME_MAX ? { name: v.name, custom: !!v.custom } : null;
  } catch {
    return null;
  }
}
export function saveName(e: { name: string; custom: boolean }): void {
  try { localStorage.setItem('cat-name', JSON.stringify({ name: e.name, custom: e.custom })); } catch { /* storage unavailable */ }
}

/** The cats this browser has met (written by us, but storage is storage: only what still makes sense). */
function loadKnown(): Map<string, Known> {
  const out = new Map<string, Known>();
  try {
    const all = JSON.parse(localStorage.getItem('cats-known') ?? '{}') as Record<string, Known>;
    for (const [id, k] of Object.entries(all))
      if (CAT_ID.test(id) && k && typeof k.name === 'string' && Number.isInteger(k.coat) && k.tally?.c === id && Number.isInteger(k.tally.s) && Array.isArray(k.tally.recent))
        out.set(id, k);
  } catch { /* nothing usable */ }
  // oldest first (the order `remember` keeps)
  return new Map([...out].sort((a, b) => a[1].seen - b[1].seen));
}

// ---- checking what comes in ----

const CAT_ID = /^[a-z2-7]{20}$/;
const PEER_ID = /^[A-Za-z0-9_-]{1,64}$/;
const HASH = /^[A-Za-z0-9_-]{22}$/;
/** Statements signed further ahead of our clock than this are not believed (they would win over everything). */
const AHEAD_MS = 5 * 60 * 1000;

/** A cat's entry, exactly the fields it signs. */
function entry(e: unknown): Entry | null {
  if (!e || typeof e !== 'object') return null;
  const { id, name, coat, custom, t, p, n, h, s } = e as Record<string, unknown>;
  if (typeof id !== 'string' || !CAT_ID.test(id) || typeof p !== 'string' || !PEER_ID.test(p)) return null;
  if (typeof name !== 'string' || !name.trim() || name.length > NAME_MAX || name !== name.trim()) return null;
  if (!Number.isInteger(coat) || (coat as number) < 0 || (coat as number) >= COATS.length) return null;
  if (!Number.isInteger(t) || (t as number) < 0 || typeof custom !== 'boolean') return null;
  if (!Number.isSafeInteger(n) || (n as number) < 0 || !Number.isSafeInteger(s) || (s as number) < 0 || typeof h !== 'string' || (h !== '' && !HASH.test(h))) return null;
  return { id, name, coat: coat as number, custom, t: t as number, p, n: n as number, h, s: s as number };
}

/** Peers are untrusted: accept only a well-formed message (the entry's signature is checked next, by `verifyBoard`; blocks and co-signatures as they are used). */
export function sanitizeBoard(d: unknown): BoardMsg | null {
  if (!d || typeof d !== 'object') return null;
  const { me, want, blocks, proof, cosign } = d as Record<string, unknown>;
  const out: BoardMsg = {};
  if (me !== undefined) {
    const { d: inner, k, s } = (me ?? {}) as Record<string, unknown>;
    const m = entry(inner);
    const ok = (v: unknown) => typeof v === 'string' && v.length > 0 && v.length <= 200 && /^[A-Za-z0-9_-]+$/.test(v);
    // (exactly the signed fields, nothing added: anything else would not have been signed)
    if (!m || !ok(k) || !ok(s) || Object.keys(inner as object).length !== Object.keys(m).length) return null;
    out.me = { d: m, k: k as string, s: s as string };
  }
  if (want !== undefined) {
    if (!Array.isArray(want) || want.length !== 2 || !Number.isSafeInteger(want[0]) || want[0] < -1 || typeof want[1] !== 'string' || (want[1] !== '' && !HASH.test(want[1]))) return null;
    out.want = [want[0], want[1]];
  }
  if (blocks !== undefined) {
    const list = sanitizeList(blocks, sanitizeBlock, PAGE);
    if (!list) return null;
    out.blocks = list;
  }
  if (proof !== undefined) {
    const list = sanitizeList(proof, sanitizeCheck, 32);
    if (!list?.length) return null;
    out.proof = list;
  }
  if (cosign !== undefined) {
    const c = sanitizeCheck(cosign);
    if (!c) return null;
    out.cosign = c;
  }
  return Object.keys(out).length ? out : null;
}

/** The sender's own entry must be signed by that cat, for this very connection, and not far ahead of our clock (else the message is dropped). */
export async function verifyBoard(peerId: string, msg: BoardMsg, now: number, check: SigCheck): Promise<BoardMsg | null> {
  if (msg.me && (msg.me.d.p !== peerId || msg.me.d.t > now + AHEAD_MS || !(await check(msg.me, msg.me.d.id)))) return null;
  return msg;
}

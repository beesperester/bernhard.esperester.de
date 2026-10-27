
// The garden's scoreboard: how much every cat has eaten. There is no server,
// so the board lives in the visitors' browsers: every cat owns its own entry
// (name, score) and announces changes; newcomers get the whole board from
// everyone already there. It lasts as long as somebody stays in the garden.
//
// Every entry is signed by the cat it belongs to (net/identity.ts) and passed
// on exactly as signed, so no cat can change another's name or score on the
// way; of two versions of an entry, the one signed later (by the garden clock)
// wins.
//
// A cat could still claim any score it likes for itself, so for other cats
// the board shows no more than what checks out: the median of what the others
// vouch it had when it arrived (each cat vouching in its own name), plus the
// catches the garden has confirmed since (see net/consensus.ts).
//
// Every cat also signs where it is, every second or so while it moves. The
// cats keep the latest of those for everyone, and pass on the ones of cats
// that left to cats arriving later. Should a cat come back (a reload, a
// dropped connection) while any of them is still around, even one that never
// met it, it is told, and carries on from there instead of somewhere at random.

import type { Signed } from '../net/identity.ts';

// (type aliases rather than interfaces, so they count as plain JSON for sending)
export type Entry = {
  /** A cat's id: the hash of its public key. */
  id: string;
  name: string;
  /** Its coat, for the face on the board. */
  coat: number;
  score: number;
  /** Chosen by its owner (rather than given at random). */
  custom: boolean;
  /** When the owner signed it (garden clock, ms): the latest wins. */
  t: number;
  /** The connection it was signed for, so no other connection can pass it off as its own. */
  p: string;
};

/** Where a cat is (or was when it left): position, height, facing, and when (garden clock). */
export type Where = { id: string; x: number; y: number; z: number; f: number; t: number };

/** Where to put a cat back: x, y, height, facing. */
export type Pose = [number, number, number, number];

export type BoardMsg = {
  /** The sender's own entry (when it says anything about itself or the others). */
  me?: Signed<Entry>;
  /** Everyone else's entries, as they signed them. */
  all?: Signed<Entry>[];
  /** What the sender (and only the sender) says the others' scores checked out at. */
  vouch?: [string, number][];
  /** Where cats are, or were when they left, as they signed it. */
  where?: Signed<Where>[];
};

/** What the board needs to sign things in our cat's name, and to tell the time. */
export interface Signer {
  id: string;
  /** This visit's connection id. */
  peer: string;
  sign: <T extends object>(d: T) => Promise<Signed<T>>;
  now: () => number;
}

/** How many cats that left we remember the whereabouts of. */
const REMEMBER_LEFT = 64;
/** Our whereabouts are signed and sent at most this often while moving. */
const WHERE_EVERY_MS = 1000;

/** Snacks needed to earn a name of your own choosing. */
export const NAME_AT = 100;
export const NAME_MAX = 16;

import { COATS } from '../art/cat.ts';
import { WORLD_H, WORLD_W } from '../world/size.ts';

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

const randomName = () => `${ADJ[Math.floor(Math.random() * ADJ.length)]} ${NOUN[Math.floor(Math.random() * NOUN.length)]}`;
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export class Board {
  readonly id: string;
  private readonly signer: Signer;
  /** Our own entry as it stands (signed a moment later). */
  private mine: Entry;
  /** Our entry as last signed (what we send). */
  private signed: Promise<Signed<Entry>>;
  /** Not yet changed this visit: our entry from before a reload, should a cat pass it back, still counts. */
  private fresh = true;
  /** Everyone else's entries as they signed them, by cat id. */
  private entries = new Map<string, Signed<Entry>>();
  /** Which peer is which cat, to know who is here right now. */
  private readonly peers = new Map<string, string>();
  private readonly send: (msg: BoardMsg, target?: string) => void;
  private readonly changed: () => void;
  /** What each cat (by cat id) vouches another cat's score is: subject -> voucher -> score. */
  private reports = new Map<string, Map<string, number>>();
  /** Points from confirmed catches since we've been watching, by cat id. */
  private earned = new Map<string, number>();
  /** Confirmed points for peers we don't know the cat id of yet. */
  private unclaimed = new Map<string, number>();
  /** The latest signed whereabouts of every cat we know of, by cat id. */
  private wheres = new Map<string, Signed<Where>>();
  private lastWhere: { x: number; y: number; z: number; f: number; at: number } | null = null;
  /** Told where our own cat was before we left (by any cat that knew). */
  onBack: ((pose: Pose) => void) | null = null;

  constructor(coat: number, signer: Signer, send: (msg: BoardMsg, target?: string) => void, changed: () => void) {
    this.signer = signer;
    this.id = signer.id;
    this.send = send;
    this.changed = changed;
    // the name given on the first visit (or chosen since) comes back on later ones
    const saved = loadName();
    this.mine = { id: this.id, name: saved?.name ?? randomName(), coat, score: 0, custom: saved?.custom ?? false, t: 0, p: signer.peer };
    this.signed = signer.sign(this.mine);
    saveName(this.me);
  }

  get me(): Entry {
    return this.mine;
  }

  private entry(id: string): Entry | undefined {
    return id === this.id ? this.mine : this.entries.get(id)?.d;
  }

  /** Everyone on the board, best first, and whether they are in the garden now. */
  ranking(): (Entry & { here: boolean })[] {
    const here = new Set([this.id, ...this.peers.values()]);
    return [this.mine, ...[...this.entries.values()].map((s) => s.d)]
      .map((e) => ({ ...e, score: this.scoreOf(e), here: here.has(e.id) }))
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  }

  /** The name of the cat behind a peer, once it has told us. */
  nameOf(peerId: string): string {
    const id = this.peers.get(peerId);
    return (id && this.entry(id)?.name) || '';
  }

  /** A cat's score as far as it checks out: its own claim, but no more than vouched for plus confirmed since. */
  scoreOf(e: Entry): number {
    if (e.id === this.id) return e.score;
    const vouched = median([...(this.reports.get(e.id)?.values() ?? [])]);
    return Math.min(e.score, Math.max(0, vouched + (this.earned.get(e.id) ?? 0)));
  }

  /** The garden confirmed a catch by this peer's cat, worth `points`. */
  credit(peerId: string, points: number): void {
    const id = this.peers.get(peerId);
    if (!id) {
      this.unclaimed.set(peerId, (this.unclaimed.get(peerId) ?? 0) + points);
      return;
    }
    // (scores never go below zero: a bee sting at zero costs nothing)
    const e = this.entry(id);
    const shown = e ? this.scoreOf(e) : Infinity;
    this.earned.set(id, (this.earned.get(id) ?? 0) + Math.max(points, -shown));
    this.changed();
  }

  /** A new garden starts with a fresh board (we keep our name). */
  reset(): void {
    this.entries.clear();
    this.peers.clear();
    this.reports.clear();
    this.earned.clear();
    this.unclaimed.clear();
    this.wheres.clear();
    this.update({ score: 0 });
  }

  /** Tell a newcomer everything we know: the board as signed, what we vouch for, where the absent cats were. */
  greet(peerId: string): void {
    const here = new Set(this.peers.values());
    const all = [...this.entries.values()];
    const vouch = all.map((s): [string, number] => [s.d.id, this.scoreOf(s.d)]);
    const where = [...this.wheres.values()].filter((w) => !here.has(w.d.id));
    void this.signed.then((me) => this.send({ me, all, vouch, ...(where.length ? { where } : {}) }, peerId));
  }

  /** A peer left. */
  leave(peerId: string): void {
    const id = this.peers.get(peerId);
    this.peers.delete(peerId);
    this.unclaimed.delete(peerId);
    const e = id && this.entry(id);
    if (id && e) {
      // we vouch for what it had when it left, should it come back (its last signed whereabouts we keep anyway)
      this.report(id, this.id, this.scoreOf(e));
      this.earned.delete(id);
    }
    this.changed();
  }

  /** The garden decided to ignore this peer: off the board. */
  drop(peerId: string): void {
    const id = this.peers.get(peerId);
    this.peers.delete(peerId);
    this.unclaimed.delete(peerId);
    if (id && id !== this.id) {
      this.entries.delete(id);
      this.reports.delete(id);
      this.earned.delete(id);
      this.wheres.delete(id);
    }
    this.changed();
  }

  private report(subject: string, reporter: string, score: number): void {
    let r = this.reports.get(subject);
    if (!r) this.reports.set(subject, (r = new Map()));
    r.set(reporter, score);
  }

  /** Our cat caught something worth `points` (bigger prey more, a bee sting costs one). */
  ate(points: number): void {
    this.update({ score: Math.max(0, this.me.score + points) });
  }

  /** Is this name free for us to take? */
  available(name: string): boolean {
    return ![...this.entries.values()].some((s) => same(s.d.name, name));
  }

  rename(name: string): void {
    this.update({ name: name.trim().slice(0, NAME_MAX), custom: true });
  }

  /** Where our cat is now: signed and sent now and then while it moves (and once still). */
  moved(x: number, y: number, z: number, f: number, now: number): void {
    const [rx, ry, rz] = [Math.round(x), Math.round(y), Math.round(z)];
    const last = this.lastWhere;
    if (last && ((last.x === rx && last.y === ry && last.z === rz && last.f === f) || now - last.at < WHERE_EVERY_MS)) return;
    this.lastWhere = { x: rx, y: ry, z: rz, f, at: now };
    void this.signer.sign<Where>({ id: this.id, x: rx, y: ry, z: rz, f, t: Math.round(this.signer.now()) }).then((w) => {
      this.wheres.set(this.id, w);
      this.send({ where: [w] });
    });
  }

  /**
   * A message from another cat, its signatures already checked (and its own
   * entry bound to the connection it came on): its own entry, and when
   * greeting us, the whole board, what it vouches for, and where cats were.
   */
  receive(peerId: string, msg: BoardMsg): void {
    const sender = msg.me?.d;
    if (sender) {
      if (sender.id === this.id) return; // that's us, it can't be them
      // a cat can't swap identities mid-visit to shake off what the garden knows about it
      const known = this.peers.get(peerId);
      if (known && known !== sender.id) return;
      this.peers.set(peerId, sender.id);
      // a cat that left is back: tell it where it was
      const was = this.wheres.get(sender.id);
      if (!known && was) this.send({ where: [was] }, peerId);
      const unclaimed = this.unclaimed.get(peerId);
      if (unclaimed !== undefined) {
        this.unclaimed.delete(peerId);
        this.earned.set(sender.id, (this.earned.get(sender.id) ?? 0) + unclaimed);
      }
      // what it vouches for the others (never for itself)
      for (const [id, score] of msg.vouch ?? []) if (id !== sender.id) this.report(id, sender.id, score);
    }
    for (const s of [...(msg.me ? [msg.me] : []), ...(msg.all ?? [])]) this.take(s);
    for (const w of msg.where ?? []) {
      // news of where we were: carry on from there
      if (w.d.id === this.id) this.onBack?.([w.d.x, w.d.y, w.d.z, w.d.f]);
      const old = this.wheres.get(w.d.id);
      if (!old || w.d.t > old.d.t) {
        this.wheres.delete(w.d.id);
        this.wheres.set(w.d.id, w);
        if (this.wheres.size > REMEMBER_LEFT + 64) this.wheres.delete(this.wheres.keys().next().value!);
      }
    }
    this.resolveClash();
    this.changed();
  }

  /** Someone's signed entry: kept if it is the latest we've seen of that cat. */
  private take(s: Signed<Entry>): void {
    const e = s.d;
    if (e.id === this.id) {
      // our own entry from before a reload: carry on with that name and score (if we haven't moved on since)
      if (this.fresh && e.t > this.mine.t) {
        this.mine = { ...this.mine, name: e.name, custom: e.custom, score: e.score, t: e.t };
        saveName(this.mine);
        this.signed = this.signer.sign({ ...this.mine, t: Math.max(e.t + 1, Math.round(this.signer.now())) });
      }
      return;
    }
    const old = this.entries.get(e.id);
    if (!old || e.t > old.d.t) this.entries.set(e.id, s);
  }

  /** Two cats with one name: the one that came up with it later (or at random) picks another. */
  private resolveClash(): void {
    const me = this.me;
    const rival = [...this.entries.values()].map((s) => s.d).find((e) => same(e.name, me.name));
    if (!rival || (me.custom && !rival.custom) || (me.custom === rival.custom && this.id < rival.id)) return;
    let name = randomName();
    for (let i = 0; i < 50 && !this.available(name); i++) name = randomName();
    this.update({ name, custom: false });
  }

  private update(change: Partial<Entry>): void {
    this.fresh = false;
    this.mine = { ...this.mine, ...change, t: Math.max(this.mine.t + 1, Math.round(this.signer.now())) };
    saveName(this.mine);
    this.signed = this.signer.sign(this.mine);
    void this.signed.then((me) => this.send({ me }));
    this.changed();
  }
}

/** The middle value (0 for none): one or two liars among the reporters can't move it far. */
function median(values: number[]): number {
  if (!values.length) return 0;
  const v = [...values].sort((a, b) => a - b);
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : Math.min(v[mid - 1], v[mid]);
}

function loadName(): { name: string; custom: boolean } | null {
  try {
    const v = JSON.parse(localStorage.getItem('cat-name') ?? 'null');
    return v && typeof v.name === 'string' && v.name.trim() && v.name.length <= NAME_MAX ? { name: v.name, custom: !!v.custom } : null;
  } catch {
    return null;
  }
}
function saveName(e: Entry): void {
  try { localStorage.setItem('cat-name', JSON.stringify({ name: e.name, custom: e.custom })); } catch { /* storage unavailable */ }
}

// ---- checking what comes in ----

const CAT_ID = /^[a-z2-7]{20}$/;
const PEER_ID = /^[A-Za-z0-9_-]{1,64}$/;
/** Statements signed further ahead of our clock than this are not believed (they would win over everything). */
const AHEAD_MS = 5 * 60 * 1000;

/** A cat's entry, exactly the fields it signs. */
function entry(e: unknown): Entry | null {
  if (!e || typeof e !== 'object') return null;
  const { id, name, coat, score, custom, t, p } = e as Record<string, unknown>;
  if (typeof id !== 'string' || !CAT_ID.test(id) || typeof p !== 'string' || !PEER_ID.test(p)) return null;
  if (typeof name !== 'string' || !name.trim() || name.length > NAME_MAX || name !== name.trim()) return null;
  if (!Number.isInteger(coat) || (coat as number) < 0 || (coat as number) >= COATS.length) return null;
  if (!Number.isInteger(score) || (score as number) < 0 || !Number.isInteger(t) || (t as number) < 0 || typeof custom !== 'boolean') return null;
  return { id, name, coat: coat as number, score: score as number, custom, t: t as number, p };
}

/** Whereabouts, exactly the fields a cat signs: somewhere inside the garden. */
function where(w: unknown): Where | null {
  if (!w || typeof w !== 'object') return null;
  const { id, x, y, z, f, t } = w as Record<string, unknown>;
  if (typeof id !== 'string' || !CAT_ID.test(id)) return null;
  if (![x, y, z, f, t].every((n) => Number.isInteger(n))) return null;
  const [nx, ny, nz, nf, nt] = [x, y, z, f, t] as number[];
  if (nx < 0 || ny < 0 || nx > WORLD_W || ny > WORLD_H || nz < 0 || nz > 200 || nf < 0 || nf > 3 || nt < 0) return null;
  return { id, x: nx, y: ny, z: nz, f: nf, t: nt };
}

function signed<T>(x: unknown, data: (d: unknown) => T | null): Signed<T> | null {
  if (!x || typeof x !== 'object') return null;
  const { d, k, s } = x as Record<string, unknown>;
  const ok = (v: unknown) => typeof v === 'string' && v.length > 0 && v.length <= 200 && /^[A-Za-z0-9_-]+$/.test(v);
  const inner = data(d);
  // (exactly the signed fields, nothing added: anything else would not have been signed)
  return inner && ok(k) && ok(s) && Object.keys(d as object).length === Object.keys(inner).length ? { d: inner, k: k as string, s: s as string } : null;
}

/** Peers are untrusted: accept only a well-formed message (signatures are checked next, by `verifyBoard`). */
export function sanitizeBoard(d: unknown): BoardMsg | null {
  if (!d || typeof d !== 'object') return null;
  const { me, all, vouch, where: wheres } = d as Record<string, unknown>;
  const out: BoardMsg = {};
  if (me !== undefined) {
    const m = signed(me, entry);
    if (!m) return null;
    out.me = m;
  }
  if (all !== undefined) {
    if (!Array.isArray(all) || all.length > 256) return null;
    const list = all.map((e) => signed(e, entry));
    if (!list.every((e) => e)) return null;
    out.all = list as Signed<Entry>[];
  }
  if (vouch !== undefined) {
    if (!Array.isArray(vouch) || vouch.length > 256) return null;
    if (!vouch.every((v) => Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && CAT_ID.test(v[0]) && Number.isInteger(v[1]) && v[1] >= 0)) return null;
    out.vouch = vouch as [string, number][];
  }
  if (wheres !== undefined) {
    if (!Array.isArray(wheres) || wheres.length > REMEMBER_LEFT + 64) return null;
    const list = wheres.map((w) => signed(w, where));
    if (!list.every((w) => w)) return null;
    out.where = list as Signed<Where>[];
  }
  return out.me || out.where ? out : null;
}

/**
 * Keep only what really comes from whom it says: the sender's own entry must
 * be signed by that cat and for this very connection (else the message is
 * dropped), and anything it passes on must carry its owner's signature (else
 * that piece is left out). Nothing signed far ahead of our clock counts.
 */
export async function verifyBoard(
  peerId: string,
  msg: BoardMsg,
  now: number,
  check: (s: Signed<object>, id: string) => Promise<boolean>,
): Promise<BoardMsg | null> {
  const fine = async (s: Signed<Entry | Where>) => s.d.t <= now + AHEAD_MS && (await check(s, s.d.id));
  if (msg.me && (msg.me.d.p !== peerId || !(await fine(msg.me)))) return null;
  const all = msg.all && (await Promise.all(msg.all.map(async (s) => ((await fine(s)) ? s : null)))).filter((s): s is Signed<Entry> => !!s);
  const where = msg.where && (await Promise.all(msg.where.map(async (s) => ((await fine(s)) ? s : null)))).filter((s): s is Signed<Where> => !!s);
  return { ...msg, ...(all ? { all } : {}), ...(where ? { where } : {}) };
}

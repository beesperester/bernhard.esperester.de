
// The garden's scoreboard: how much every cat has eaten. There is no server,
// so the board lives in the visitors' browsers: every cat owns its own entry
// (name, score) and announces changes; newcomers get the whole board from
// everyone already there. It lasts as long as somebody stays in the garden.
//
// A cat could claim any score it likes, so for other cats the board shows no
// more than what checks out: the score the other cats vouched for when it
// arrived (the median of what they report), plus the catches the garden has
// confirmed since (see net/consensus.ts).

// (type aliases rather than interfaces, so they count as plain JSON for sending)
export type Entry = {
  /** A cat's id, kept in its browser so a reload doesn't lose its score. */
  id: string;
  name: string;
  /** Its coat, for the face on the board. */
  coat: number;
  score: number;
  /** Chosen by its owner (rather than given at random). */
  custom: boolean;
  /** Bumped by the owner on every change; the highest version wins. */
  v: number;
};

/** Snacks needed to earn a name of your own choosing. */
export const NAME_AT = 100;
export const NAME_MAX = 16;

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

const randomName = () => `${ADJ[Math.floor(Math.random() * ADJ.length)]} ${NOUN[Math.floor(Math.random() * NOUN.length)]}`;
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

function myId(): string {
  try {
    let id = localStorage.getItem('cat-id');
    if (!id || !/^[a-z0-9]{8,24}$/.test(id)) {
      id = Math.random().toString(36).slice(2, 12).padEnd(10, '0');
      localStorage.setItem('cat-id', id);
    }
    return id;
  } catch {
    return Math.random().toString(36).slice(2, 12).padEnd(10, '0');
  }
}

export class Board {
  readonly id = myId();
  private entries = new Map<string, Entry>();
  /** Which peer is which cat, to know who is here right now. */
  private readonly peers = new Map<string, string>();
  private readonly send: (msg: BoardMsg, target?: string) => void;
  private readonly changed: () => void;
  /** What each cat (by cat id) reports another cat's score to be: subject -> reporter -> score. */
  private reports = new Map<string, Map<string, number>>();
  /** Points from confirmed catches since we've been watching, by cat id. */
  private earned = new Map<string, number>();
  /** Confirmed points for peers we don't know the cat id of yet. */
  private unclaimed = new Map<string, number>();

  constructor(coat: number, send: (msg: BoardMsg, target?: string) => void, changed: () => void) {
    this.send = send;
    this.changed = changed;
    // the name given on the first visit (or chosen since) comes back on later ones
    const saved = loadName();
    this.entries.set(this.id, { id: this.id, name: saved?.name ?? randomName(), coat, score: 0, custom: saved?.custom ?? false, v: 0 });
    saveName(this.me);
  }

  get me(): Entry {
    return this.entries.get(this.id)!;
  }

  /** Everyone on the board, best first, and whether they are in the garden now. */
  ranking(): (Entry & { here: boolean })[] {
    const here = new Set([this.id, ...this.peers.values()]);
    return [...this.entries.values()]
      .map((e) => ({ ...e, score: this.scoreOf(e), here: here.has(e.id) }))
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  }

  /** The name of the cat behind a peer, once it has told us. */
  nameOf(peerId: string): string {
    const id = this.peers.get(peerId);
    return (id && this.entries.get(id)?.name) || '';
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
    const shown = this.scoreOf(this.entries.get(id) ?? { id, name: '', coat: 0, score: Infinity, custom: false, v: 0 });
    this.earned.set(id, (this.earned.get(id) ?? 0) + Math.max(points, -shown));
    this.changed();
  }

  /** A new garden starts with a fresh board (we keep our name). */
  reset(): void {
    const me = { ...this.me, score: 0 };
    this.entries = new Map([[this.id, me]]);
    this.peers.clear();
    this.reports.clear();
    this.earned.clear();
    this.unclaimed.clear();
    this.changed();
  }

  /** Tell a newcomer everything we know (other cats' scores as far as they check out). */
  greet(peerId: string): void {
    this.send({ me: this.me, all: [...this.entries.values()].map((e) => ({ ...e, score: this.scoreOf(e) })) }, peerId);
  }

  leave(peerId: string): void {
    const id = this.peers.get(peerId);
    this.peers.delete(peerId);
    this.unclaimed.delete(peerId);
    if (id && this.entries.has(id)) {
      // we vouch for what it had when it left, should it come back
      this.report(id, this.id, this.scoreOf(this.entries.get(id)!));
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
    return ![...this.entries.values()].some((e) => e.id !== this.id && same(e.name, name));
  }

  rename(name: string): void {
    this.update({ name: name.trim().slice(0, NAME_MAX), custom: true });
  }

  /** A message from another cat: its own entry, and when greeting us, the whole board. */
  receive(peerId: string, msg: BoardMsg): void {
    if (msg.me.id === this.id) return; // that's us, it can't be them
    const reporter = msg.me.id;
    // a cat can't swap identities mid-visit to shake off what the garden knows about it
    const known = this.peers.get(peerId);
    if (known && known !== reporter) return;
    this.peers.set(peerId, reporter);
    const unclaimed = this.unclaimed.get(peerId);
    if (unclaimed !== undefined) {
      this.unclaimed.delete(peerId);
      this.earned.set(reporter, (this.earned.get(reporter) ?? 0) + unclaimed);
    }
    // what it says about the others vouches for them (never for itself)
    for (const e of msg.all ?? []) if (e.id !== reporter) this.report(e.id, reporter, e.score);
    for (const e of [msg.me, ...(msg.all ?? [])]) {
      const old = this.entries.get(e.id);
      // (our own entry from before a reload counts too: carry on with that name and score)
      if (!old || e.v > old.v) this.entries.set(e.id, e);
      if (e.id === this.id && (!old || e.v > old.v)) saveName(e);
    }
    this.resolveClash();
    this.changed();
  }

  /** Two cats with one name: the one that came up with it later (or at random) picks another. */
  private resolveClash(): void {
    const me = this.me;
    const rival = [...this.entries.values()].find((e) => e.id !== this.id && same(e.name, me.name));
    if (!rival || (me.custom && !rival.custom) || (me.custom === rival.custom && this.id < rival.id)) return;
    let name = randomName();
    for (let i = 0; i < 50 && !this.available(name); i++) name = randomName();
    this.update({ name, custom: false });
  }

  private update(change: Partial<Entry>): void {
    const me = { ...this.me, ...change, v: this.me.v + 1 };
    this.entries.set(this.id, me);
    saveName(me);
    this.send({ me });
    this.changed();
  }
}

export type BoardMsg = { me: Entry; all?: Entry[] };

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

/** Peers are untrusted: accept only a well-formed message. */
export function sanitizeBoard(d: unknown): BoardMsg | null {
  if (!d || typeof d !== 'object') return null;
  const { me, all } = d as Record<string, unknown>;
  const entry = (e: unknown): Entry | null => {
    if (!e || typeof e !== 'object') return null;
    const { id, name, coat, score, custom, v } = e as Record<string, unknown>;
    if (typeof id !== 'string' || !/^[a-z0-9]{8,24}$/.test(id)) return null;
    if (typeof name !== 'string' || !name.trim() || name.length > NAME_MAX) return null;
    if (!Number.isInteger(coat) || (coat as number) < 0 || (coat as number) >= COATS.length) return null;
    if (!Number.isInteger(score) || (score as number) < 0 || !Number.isInteger(v) || typeof custom !== 'boolean') return null;
    return { id, name: name.trim(), coat: coat as number, score: score as number, custom, v: v as number };
  };
  const mine = entry(me);
  if (!mine) return null;
  if (all === undefined) return { me: mine };
  if (!Array.isArray(all) || all.length > 256) return null;
  const list = all.map(entry);
  return list.every((e) => e) ? { me: mine, all: list as Entry[] } : null;
}

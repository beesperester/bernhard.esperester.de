// Stamps: proof that a cat's chain had got this far by a certain time, from
// OpenTimestamps. The beacon on every block (beacon.ts) shows it wasn't made
// before then; a stamp shows it was made by then. Together a block's time is
// pinned from both sides, so a whole history can't be made up after the fact.
//
// Every so often a cat sends a hash of its chain's head to a few OpenTimestamps
// calendars (free public servers). Each answers at once with a receipt: how it
// will fold the hash into its own tree of hashes, then "pending". Within a few
// hours the calendar writes its tree's root into a Bitcoin transaction; the
// receipt can then be completed ("upgraded") all the way to a Bitcoin block,
// whose time is fixed for good. Whoever checks a stamp folds the hash up to that
// block's merkle root and compares it with the real block's (from a block
// explorer): no need to trust the calendar, or the cat.
//
// The receipt is OpenTimestamps' own binary format (a tree of hash operations
// with attestations at the leaves), kept as it is, base64url.
//
// https://opentimestamps.org

import { b64, unb64 } from './identity.ts';
import { fromHex, toHex } from './beacon.ts';

/** A stamp of cat `c`'s chain head: its first `n` blocks, ending in hash `h`; `o` the receipt (OpenTimestamps, base64url). */
export type Stamp = { n: number; h: string; o: string };

/** The calendars a head goes to (each gives its own receipt; one is enough). */
const CALENDARS = ['https://a.pool.opentimestamps.org', 'https://b.pool.opentimestamps.org', 'https://a.pool.eternitywall.com'];
const SEND_TO = 2;
/** Where a pending receipt may send us to complete it. */
const trusted = (uri: string) => CALENDARS.includes(uri) || /^https:\/\/[a-z0-9-]+\.(btc\.)?calendar\.(opentimestamps\.org|catallaxy\.com|eternitywall\.com)$/.test(uri);
/** Where Bitcoin block headers come from (either will do). */
const EXPLORERS = ['https://mempool.space/api', 'https://blockstream.info/api'];

// ---- the receipt: a tree of operations ----

type Att = { kind: 'bitcoin'; height: number } | { kind: 'pending'; uri: string } | { kind: 'other'; tag: Uint8Array; payload: Uint8Array };
type Op = { tag: number; arg?: Uint8Array };
/** What message `msg` turns into: attestations of it, and what each operation on it leads to. */
export type Tree = { msg: Uint8Array; atts: Att[]; ops: [Op, Tree][] };

const BITCOIN = fromHex('0588960d73d71901'), PENDING = fromHex('83dfe30d2ef90c8e');
const APPEND = 0xf0, PREPEND = 0xf1, REVERSE = 0xf2, HEXLIFY = 0xf3, SHA1 = 0x02, RIPEMD160 = 0x03, SHA256 = 0x08, KECCAK256 = 0x67;
const BINARY = new Set([APPEND, PREPEND]);
/** Not just anything: no endless trees, no huge messages. */
const MAX_DEPTH = 256, MAX_MSG = 4096, MAX_RECEIPT = 8192;

const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
const cat = (a: Uint8Array, b: Uint8Array) => {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
};

let hashes: Promise<{ sha256: (m: Uint8Array) => Uint8Array; sha1: (m: Uint8Array) => Uint8Array; ripemd160: (m: Uint8Array) => Uint8Array; keccak: (m: Uint8Array) => Uint8Array }> | null = null;
function hashing() {
  hashes ??= Promise.all([import('@noble/hashes/sha2.js'), import('@noble/hashes/legacy.js'), import('@noble/hashes/sha3.js')]).then(([s2, legacy, s3]) => ({
    sha256: s2.sha256,
    sha1: legacy.sha1,
    ripemd160: legacy.ripemd160,
    keccak: s3.keccak_256,
  }));
  return hashes;
}

async function apply(op: Op, msg: Uint8Array): Promise<Uint8Array> {
  const h = await hashing();
  switch (op.tag) {
    case APPEND: return cat(msg, op.arg!);
    case PREPEND: return cat(op.arg!, msg);
    case REVERSE: return msg.slice().reverse();
    case HEXLIFY: return new TextEncoder().encode(toHex(msg));
    case SHA1: return h.sha1(msg);
    case RIPEMD160: return h.ripemd160(msg);
    case SHA256: return h.sha256(msg);
    case KECCAK256: return h.keccak(msg);
  }
  throw new Error(`unknown operation ${op.tag}`);
}

class Reader {
  i = 0;
  readonly u: Uint8Array;
  constructor(u: Uint8Array) {
    this.u = u;
  }
  byte(): number {
    if (this.i >= this.u.length) throw new Error('receipt ends early');
    return this.u[this.i++];
  }
  bytes(n: number): Uint8Array {
    if (n > MAX_MSG || this.i + n > this.u.length) throw new Error('receipt ends early');
    return this.u.slice(this.i, (this.i += n));
  }
  uint(): number {
    let v = 0, shift = 0;
    for (;;) {
      const b = this.byte();
      v += (b & 0x7f) * 2 ** shift;
      if (!(b & 0x80)) return v;
      shift += 7;
      if (shift > 49) throw new Error('number too big');
    }
  }
  varbytes(): Uint8Array {
    return this.bytes(this.uint());
  }
}

class Writer {
  private parts: number[] = [];
  byte(b: number) { this.parts.push(b); }
  bytes(u: Uint8Array) { for (const b of u) this.parts.push(b); }
  uint(v: number) {
    do {
      let b = v % 128;
      v = Math.floor(v / 128);
      if (v) b |= 0x80;
      this.parts.push(b);
    } while (v);
  }
  varbytes(u: Uint8Array) { this.uint(u.length); this.bytes(u); }
  done(): Uint8Array { return Uint8Array.from(this.parts); }
}

function readAtt(r: Reader): Att {
  const tag = r.bytes(8), payload = r.varbytes();
  const p = new Reader(payload);
  if (same(tag, BITCOIN)) return { kind: 'bitcoin', height: p.uint() };
  if (same(tag, PENDING)) return { kind: 'pending', uri: new TextDecoder().decode(p.varbytes()) };
  return { kind: 'other', tag, payload };
}

function writeAtt(w: Writer, a: Att): void {
  const p = new Writer();
  if (a.kind === 'bitcoin') p.uint(a.height);
  else if (a.kind === 'pending') p.varbytes(new TextEncoder().encode(a.uri));
  else p.bytes(a.payload);
  w.bytes(a.kind === 'bitcoin' ? BITCOIN : a.kind === 'pending' ? PENDING : a.tag);
  w.varbytes(p.done());
}

/** Read a receipt for message `msg` (OpenTimestamps' serialised timestamp). */
export async function readTree(bytes: Uint8Array, msg: Uint8Array): Promise<Tree> {
  const r = new Reader(bytes);
  const tree = await readNode(r, msg, 0);
  if (r.i !== bytes.length) throw new Error('more after the receipt');
  return tree;
}

async function readNode(r: Reader, msg: Uint8Array, depth: number): Promise<Tree> {
  if (depth > MAX_DEPTH) throw new Error('receipt too deep');
  const t: Tree = { msg, atts: [], ops: [] };
  const one = async (tag: number) => {
    if (tag === 0x00) return void t.atts.push(readAtt(r));
    const op: Op = BINARY.has(tag) ? { tag, arg: r.varbytes() } : { tag };
    const next = await apply(op, msg);
    if (next.length > MAX_MSG) throw new Error('message too long');
    t.ops.push([op, await readNode(r, next, depth + 1)]);
  };
  let tag = r.byte();
  while (tag === 0xff) {
    await one(r.byte());
    tag = r.byte();
  }
  await one(tag);
  return t;
}

/** A tree back to bytes (every branch but the last marked with 0xff, as OpenTimestamps does). */
export function writeTree(t: Tree): Uint8Array {
  const w = new Writer();
  const write = (n: Tree) => {
    const items: (() => void)[] = [
      ...n.atts.map((a) => () => { w.byte(0x00); writeAtt(w, a); }),
      ...n.ops.map(([op, sub]) => () => { w.byte(op.tag); if (op.arg) w.varbytes(op.arg); write(sub); }),
    ];
    items.forEach((f, i) => { if (i < items.length - 1) w.byte(0xff); f(); });
  };
  write(t);
  return w.done();
}

function* leaves(t: Tree): Generator<[Tree, Att]> {
  for (const a of t.atts) yield [t, a];
  for (const [, sub] of t.ops) yield* leaves(sub);
}

// ---- what a stamp is of ----

/** The hash a stamp is of: cat `c`'s chain, first `n` blocks, ending in `h`. */
export async function stampDigest(c: string, n: number, h: string): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`cat-garden stamp ${c} ${n} ${h}`)));
}

// ---- making one ----

/** Send a head off to the calendars: a stamp (pending, for now), or null if none could be reached. */
export async function makeStamp(c: string, n: number, h: string): Promise<Stamp | null> {
  const digest = await stampDigest(c, n, h);
  const root: Tree = { msg: digest, atts: [], ops: [] };
  for (const cal of CALENDARS) {
    if (root.ops.length >= SEND_TO) break;
    try {
      const res = await fetch(`${cal}/digest`, { method: 'POST', body: digest, headers: { Accept: 'application/vnd.opentimestamps.v1' } });
      if (!res.ok) continue;
      const tree = await readTree(new Uint8Array(await res.arrayBuffer()), digest);
      // (each calendar's receipt is a branch of ours: a no-op of appending nothing keeps them apart)
      root.ops.push([{ tag: APPEND, arg: new Uint8Array(0) }, tree]);
    } catch {
      // next calendar
    }
  }
  return root.ops.length ? { n, h, o: b64(writeTree(root)) } : null;
}

/** Complete what we can of a stamp's pending receipts (a few hours after it was made): the stamp, maybe upgraded. */
export async function upgradeStamp(c: string, s: Stamp): Promise<Stamp> {
  let tree: Tree;
  try {
    tree = await readTree(unb64(s.o), await stampDigest(c, s.n, s.h));
  } catch {
    return s;
  }
  let changed = false;
  for (const [node, att] of [...leaves(tree)]) {
    // (only calendars we know: a receipt from a peer could point anywhere)
    if (att.kind !== 'pending' || !trusted(att.uri)) continue;
    try {
      const res = await fetch(`${att.uri}/timestamp/${toHex(node.msg)}`, { headers: { Accept: 'application/vnd.opentimestamps.v1' } });
      if (!res.ok) continue;
      const more = await readTree(new Uint8Array(await res.arrayBuffer()), node.msg);
      // the pending note makes way for the path on to Bitcoin
      node.atts = node.atts.filter((a) => a !== att).concat(more.atts);
      node.ops.push(...more.ops);
      changed = true;
    } catch {
      // still pending, or the calendar is away: next time
    }
  }
  return changed ? { ...s, o: b64(writeTree(tree)) } : s;
}

/** Whether a stamp has got as far as Bitcoin (it may not check out, but there's nothing more to upgrade). */
export async function anchored(c: string, s: Stamp): Promise<boolean> {
  try {
    const tree = await readTree(unb64(s.o), await stampDigest(c, s.n, s.h));
    return [...leaves(tree)].some(([, a]) => a.kind === 'bitcoin');
  } catch {
    return false;
  }
}

// ---- checking one ----

const blocks = new Map<number, Promise<{ root: string; time: number } | null>>();

/** A Bitcoin block's merkle root (as stored: little-endian hex) and time (ms), from an explorer. */
function bitcoinBlock(height: number): Promise<{ root: string; time: number } | null> {
  let p = blocks.get(height);
  if (!p) {
    p = (async () => {
      for (const ex of EXPLORERS) {
        try {
          const hash = (await (await fetch(`${ex}/block-height/${height}`)).text()).trim();
          if (!/^[0-9a-f]{64}$/.test(hash)) continue;
          const b = (await (await fetch(`${ex}/block/${hash}`)).json()) as { merkle_root?: string; timestamp?: number; height?: number };
          if (typeof b.merkle_root !== 'string' || !/^[0-9a-f]{64}$/.test(b.merkle_root) || !Number.isSafeInteger(b.timestamp) || b.height !== height) continue;
          return { root: toHex(fromHex(b.merkle_root).reverse()), time: b.timestamp! * 1000 };
        } catch {
          // next explorer
        }
      }
      return null;
    })();
    blocks.set(height, p);
    // (an explorer that couldn't be reached: ask again next time)
    void p.then((v) => { if (!v) blocks.delete(height); });
  }
  return p;
}

/** The time of the earliest Bitcoin block a receipt folds up to (null if none does). */
export async function bitcoinTime(tree: Tree): Promise<number | null> {
  let best: number | null = null;
  for (const [node, att] of leaves(tree)) {
    if (att.kind !== 'bitcoin' || node.msg.length !== 32) continue;
    const block = await bitcoinBlock(att.height);
    if (block && block.root === toHex(node.msg) && (best === null || block.time < best)) best = block.time;
  }
  return best;
}

/** What a receipt is waiting on, and where it got to (for looking into one). */
export const attestations = (t: Tree): Att[] => [...leaves(t)].map(([, a]) => a);

/** How stamps are checked (tests put in a stand-in). */
export const stamps = { proven: provenTime };

const proven = new Map<string, Promise<number | null>>();

/**
 * When this stamp of cat `c`'s chain is proven to have been made by: the time
 * of the earliest Bitcoin block it reaches whose merkle root it folds up to.
 * Null if it reaches none (yet), or doesn't check out. Pending receipts are
 * completed on the way, if they can be.
 */
export function provenTime(c: string, s: Stamp): Promise<number | null> {
  const key = `${c}.${s.n}.${s.h}.${s.o}`;
  let p = proven.get(key);
  if (!p) {
    p = (async () => {
      const done = (await anchored(c, s)) ? s : await upgradeStamp(c, s);
      let tree: Tree;
      try {
        tree = await readTree(unb64(done.o), await stampDigest(c, s.n, s.h));
      } catch {
        return null;
      }
      return bitcoinTime(tree);
    })();
    proven.set(key, p);
    // (not proven yet: it may be, later)
    void p.then((v) => { if (v === null) proven.delete(key); });
    if (proven.size > 1024) proven.delete(proven.keys().next().value!);
  }
  return p;
}

// ---- from peers ----

const HASH = /^[A-Za-z0-9_-]{22}$/;

export function sanitizeStamp(x: unknown): Stamp | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const { n, h, o } = x as Record<string, unknown>;
  if (Object.keys(x).length !== 3 || !Number.isSafeInteger(n) || (n as number) < 1 || typeof h !== 'string' || !HASH.test(h)) return null;
  if (typeof o !== 'string' || o.length > MAX_RECEIPT || !/^[A-Za-z0-9_-]+$/.test(o)) return null;
  return { n: n as number, h, o };
}

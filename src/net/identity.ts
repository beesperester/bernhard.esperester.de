// Who a cat is, provably. Every browser has a key pair of its own (ECDSA P-256,
// from the browser's built-in crypto): the private key never leaves it (it is
// kept non-extractable in IndexedDB), and the cat's id is a hash of the public
// key, so no one else can speak for that cat. What a cat says about itself
// (its scoreboard entry, where it is) it signs, and the other cats pass it on
// exactly as signed: change a byte and the signature no longer fits, and the
// next cat throws it away. Each signed statement carries the garden clock, so
// of two versions the newer one wins.
//
// It can't stop a cat lying about itself; that's what the witnesses and votes
// are for (witness.ts, consensus.ts). It stops the others putting words in
// its mouth.

/** Something a cat said about itself: the data `d`, its public key `k`, and its signature `s` (both base64url). */
export type Signed<T> = { d: T; k: string; s: string };

const ALGO = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const SIGN = { name: 'ECDSA', hash: 'SHA-256' } as const;
const DB = 'cat-garden', STORE = 'keys', KEY = 'me';

const b64 = (bytes: ArrayBuffer | Uint8Array): string => {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64 = (s: string): Uint8Array<ArrayBuffer> => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

/** The same bytes for the same (flat) data, whoever serialises it: keys in order. */
export const canonical = (d: object): Uint8Array<ArrayBuffer> => new TextEncoder().encode(JSON.stringify(d, Object.keys(d).sort()));

/** A cat's id: the first 100 bits of the SHA-256 of its public key, in lowercase base32 (20 characters). */
async function idOf(rawKey: Uint8Array<ArrayBuffer>): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', rawKey));
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
  let id = '', bits = 0, acc = 0;
  for (const b of hash) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5 && id.length < 20) {
      id += alphabet[(acc >> (bits - 5)) & 31];
      bits -= 5;
    }
    if (id.length === 20) break;
  }
  return id;
}

export class Identity {
  readonly id: string;
  readonly pub: string;
  private readonly key: CryptoKey;

  private constructor(id: string, pub: string, key: CryptoKey) {
    this.id = id;
    this.pub = pub;
    this.key = key;
  }

  /** Our key pair: the one this browser has always had, or a new one (kept for next time, where it can be). */
  static async load(): Promise<Identity> {
    let pair = await readPair();
    if (!pair) {
      pair = await crypto.subtle.generateKey(ALGO, false, ['sign', 'verify']);
      await writePair(pair);
    }
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
    return new Identity(await idOf(raw), b64(raw), pair.privateKey);
  }

  async sign<T extends object>(d: T): Promise<Signed<T>> {
    return { d, k: this.pub, s: b64(await crypto.subtle.sign(SIGN, this.key, canonical(d))) };
  }
}

/** Public keys already imported, and what they hash to. */
const keys = new Map<string, Promise<{ key: CryptoKey; id: string } | null>>();

function keyFor(k: string): Promise<{ key: CryptoKey; id: string } | null> {
  let p = keys.get(k);
  if (!p) {
    p = (async () => {
      try {
        const raw = unb64(k);
        return { key: await crypto.subtle.importKey('raw', raw, ALGO, false, ['verify']), id: await idOf(raw) };
      } catch {
        return null;
      }
    })();
    keys.set(k, p);
    if (keys.size > 512) keys.delete(keys.keys().next().value!);
  }
  return p;
}

/** Did the cat `id` really say this? The key must be the one its id comes from, and the signature must fit. */
export async function verify<T extends object>(m: Signed<T>, id: string): Promise<boolean> {
  const k = await keyFor(m.k);
  if (!k || k.id !== id) return false;
  try {
    return await crypto.subtle.verify(SIGN, k.key, unb64(m.s), canonical(m.d));
  } catch {
    return false;
  }
}

/** Accept only the shape of a signed statement (what's inside is checked by the caller). */
export function signedShape(x: unknown): Signed<Record<string, unknown>> | null {
  if (!x || typeof x !== 'object') return null;
  const { d, k, s } = x as Record<string, unknown>;
  const ok = (v: unknown) => typeof v === 'string' && v.length > 0 && v.length <= 200 && /^[A-Za-z0-9_-]+$/.test(v);
  return d && typeof d === 'object' && !Array.isArray(d) && ok(k) && ok(s) ? { d: d as Record<string, unknown>, k: k as string, s: s as string } : null;
}

// ---- keeping the key pair (IndexedDB can hold a key the page itself can't read out) ----

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function readPair(): Promise<CryptoKeyPair | null> {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE).objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve((req.result as CryptoKeyPair | undefined) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function writePair(pair: CryptoKeyPair): Promise<void> {
  const db = await open();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(pair, KEY);
      tx.oncomplete = tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** This browser's identity, loaded once before the garden opens (main.ts). */
let current: Identity | null = null;
export const useIdentity = (i: Identity): void => {
  current = i;
};
export const identity = (): Identity => {
  if (!current) throw new Error('identity not loaded yet');
  return current;
};

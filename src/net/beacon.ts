// The drand beacon: a fresh random value every 3 seconds, signed by the League
// of Entropy (Cloudflare, Protocol Labs, universities and others, together:
// none of them can make or foresee it alone). Each catch on a cat's chain
// carries the latest one, so it can't have been made before that moment: the
// chain can't be written ahead of time. (It can't stop one being backdated:
// old values stay public. Stamps do that: stamp.ts.)
//
// The values are checked here, against drand's public key, with no need to ask
// drand: the signature is a BLS signature of the round's number.
//
// https://drand.love · network "quicknet" (bls-unchained-g1-rfc9380)

import { b64, unb64 } from './identity.ts';

/** quicknet: its chain hash, public key, first round's time (s) and period (s). */
const CHAIN = '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971';
const PUBLIC_KEY =
  '83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a';
const GENESIS = 1692803367, PERIOD = 3;
const DST = 'BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_';
/** Where to ask (all serve the same signed values, so any will do). */
const RELAYS = ['https://api.drand.sh', 'https://api2.drand.sh', 'https://api3.drand.sh', 'https://drand.cloudflare.com'];

/** A beacon: round `r` and its signature `b` (48 bytes, base64url). */
export type Beacon = { r: number; b: string };

/** When round `r` came out (ms since epoch). */
export const roundTime = (r: number): number => (GENESIS + (r - 1) * PERIOD) * 1000;
/** The round out at `ms`. */
export const roundAt = (ms: number): number => Math.floor((ms / 1000 - GENESIS) / PERIOD) + 1;

/** A beacon fetched no longer ago than this is still the latest as far as a catch is concerned. */
const FRESH_MS = 6000;
/** Waiting for drand: try again after this, doubling up to the most. */
const RETRY_MS = 1000, RETRY_MAX_MS = 30000;

export const fromHex = (h: string): Uint8Array<ArrayBuffer> => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));
export const toHex = (u: Uint8Array): string => Array.from(u, (x) => x.toString(16).padStart(2, '0')).join('');

let bls: Promise<{ verify: (sig: Uint8Array, r: number) => boolean }> | null = null;
/** The BLS maths, loaded when first needed (it's a fair bit of code). */
function maths() {
  bls ??= Promise.all([import('@noble/curves/bls12-381.js'), import('@noble/hashes/sha2.js')]).then(([{ bls12_381 }, { sha256 }]) => {
    const S = bls12_381.shortSignatures, key = fromHex(PUBLIC_KEY);
    return {
      verify(sig: Uint8Array, r: number): boolean {
        const round = new Uint8Array(8);
        new DataView(round.buffer).setBigUint64(0, BigInt(r));
        try {
          return S.verify(sig, S.hash(sha256(round), DST), key);
        } catch {
          return false;
        }
      },
    };
  });
  return bls;
}

const verified = new Map<string, Promise<boolean>>();

/** Is this really drand's beacon for its round? (Remembered: a chain's beacons get checked by every cat it meets.) */
export function verifyBeacon(x: Beacon): Promise<boolean> {
  const key = `${x.r}.${x.b}`;
  let v = verified.get(key);
  if (!v) {
    v = (async () => {
      if (!Number.isSafeInteger(x.r) || x.r < 1) return false;
      let sig: Uint8Array;
      try {
        sig = unb64(x.b);
      } catch {
        return false;
      }
      return sig.length === 48 && (await maths()).verify(sig, x.r);
    })();
    verified.set(key, v);
    if (verified.size > 4096) verified.delete(verified.keys().next().value!);
  }
  return v;
}

/** How beacons are checked (tests put in a stand-in). */
export const beacons = { verify: verifyBeacon };

let latest: { beacon: Beacon; at: number } | null = null;
let fetching: Promise<Beacon> | null = null;

async function fetchLatest(): Promise<Beacon | null> {
  for (const relay of RELAYS) {
    try {
      const res = await fetch(`${relay}/${CHAIN}/public/latest`, { cache: 'no-store' });
      if (!res.ok) continue;
      const j = (await res.json()) as { round?: unknown; signature?: unknown };
      if (!Number.isSafeInteger(j.round) || typeof j.signature !== 'string' || !/^[0-9a-f]{96}$/.test(j.signature)) continue;
      const beacon: Beacon = { r: j.round as number, b: b64(fromHex(j.signature)) };
      // (a relay could be anyone's: only drand's own signature counts)
      if (await verifyBeacon(beacon)) return beacon;
    } catch {
      // next relay
    }
  }
  return null;
}

/** The latest beacon: fetched (and checked) if the last one is stale, waiting as long as it takes. */
export function latestBeacon(): Promise<Beacon> {
  if (latest && Date.now() - latest.at < FRESH_MS) return Promise.resolve(latest.beacon);
  fetching ??= (async () => {
    for (let wait = RETRY_MS; ; wait = Math.min(RETRY_MAX_MS, wait * 2)) {
      const at = Date.now();
      const b = await fetchLatest();
      if (b && (!latest || b.r >= latest.beacon.r)) {
        latest = { beacon: b, at };
        return b;
      }
      await new Promise((r) => setTimeout(r, wait));
    }
  })().finally(() => (fetching = null));
  return fetching;
}

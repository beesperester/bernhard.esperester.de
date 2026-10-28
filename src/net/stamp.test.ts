import { afterEach, describe, expect, it, vi } from 'vitest';
import { attestations, bitcoinTime, provenTime, readTree, sanitizeStamp, stampDigest, upgradeStamp, writeTree, type Tree } from './stamp.ts';
import { b64, unb64 } from './identity.ts';
import { toHex } from './beacon.ts';

const CAT = 'abcdefghijklmnopqrst', HEAD = 'A'.repeat(22);
const sha256 = async (m: Uint8Array) => new Uint8Array(await crypto.subtle.digest('SHA-256', m as Uint8Array<ArrayBuffer>));
const bytes = (...xs: number[]) => Uint8Array.from(xs);

/** A receipt as a calendar would hand it out: append, prepend, sha256, then an attestation. */
async function receipt(_digest: Uint8Array, att: Uint8Array): Promise<Uint8Array> {
  return Uint8Array.from([0xf0, 2, 0xaa, 0xbb, 0xf1, 1, 0xcc, 0x08, 0x00, ...att]);
}
const bitcoinAt = (height: number) => [0x05, 0x88, 0x96, 0x0d, 0x73, 0xd7, 0x19, 0x01, 1, height];
const pendingAt = (uri: string) => {
  const u = [...new TextEncoder().encode(uri)];
  return [0x83, 0xdf, 0xe3, 0x0d, 0x2e, 0xf9, 0x0c, 0x8e, u.length + 1, u.length, ...u];
};

/** Where the receipt above folds the digest to. */
async function folded(digest: Uint8Array) {
  return sha256(Uint8Array.from([0xcc, ...digest, 0xaa, 0xbb]));
}

/** A pretend block explorer (and calendar) on the other end of fetch. */
function serve(routes: Record<string, () => Response>) {
  const asked: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    asked.push(url);
    const r = Object.entries(routes).find(([k]) => url.endsWith(k));
    return r ? r[1]() : new Response('no', { status: 404 });
  }));
  return asked;
}

afterEach(() => vi.unstubAllGlobals());

describe('receipts', () => {
  it('read, and write back the same', async () => {
    const digest = await stampDigest(CAT, 3, HEAD);
    const raw = await receipt(digest, Uint8Array.from(bitcoinAt(100)));
    const tree = await readTree(raw, digest);
    expect(attestations(tree)).toEqual([{ kind: 'bitcoin', height: 100 }]);
    expect(writeTree(tree)).toEqual(raw);
    // two branches (one per calendar)
    const two: Tree = { msg: digest, atts: [], ops: [[{ tag: 0xf0, arg: new Uint8Array(0) }, tree], [{ tag: 0xf0, arg: new Uint8Array(0) }, await readTree(Uint8Array.from([0x00, ...pendingAt('https://alice.btc.calendar.opentimestamps.org')]), digest)]] };
    const again = await readTree(writeTree(two), digest);
    expect(attestations(again)).toEqual([{ kind: 'bitcoin', height: 100 }, { kind: 'pending', uri: 'https://alice.btc.calendar.opentimestamps.org' }]);
  });

  it("refuse what isn't one", async () => {
    const digest = await stampDigest(CAT, 3, HEAD);
    await expect(readTree(bytes(0xf0, 5, 1), digest)).rejects.toThrow();
    await expect(readTree(bytes(0x99), digest)).rejects.toThrow();
    await expect(readTree(Uint8Array.from([0x00, ...bitcoinAt(1), 0x00]), digest)).rejects.toThrow();
  });
});

describe('proving a stamp', () => {
  it("by the Bitcoin block whose merkle root it folds up to, and not if it doesn't", async () => {
    const digest = await stampDigest(CAT, 3, HEAD);
    const tree = await readTree(await receipt(digest, Uint8Array.from(bitcoinAt(100))), digest);
    const root = toHex((await folded(digest)).reverse());
    serve({
      '/block-height/100': () => new Response('f'.repeat(64)),
      [`/block/${'f'.repeat(64)}`]: () => Response.json({ height: 100, merkle_root: root, timestamp: 1_700_000_000 }),
    });
    expect(await bitcoinTime(tree)).toBe(1_700_000_000_000);
    // the same receipt for another head
    const other = await stampDigest(CAT, 4, HEAD);
    expect(await bitcoinTime(await readTree(await receipt(other, Uint8Array.from(bitcoinAt(100))), other))).toBeNull();
  });

  it('completes a pending receipt from a calendar we know, and from no other', async () => {
    const digest = await stampDigest(CAT, 3, HEAD);
    const pending = async (uri: string) => ({ n: 3, h: HEAD, o: b64(await receipt(digest, Uint8Array.from(pendingAt(uri)))) });
    const commitment = toHex(await folded(digest));
    const asked = serve({ [`/timestamp/${commitment}`]: () => new Response(Uint8Array.from([0x00, ...bitcoinAt(100)])) });
    const up = await upgradeStamp(CAT, await pending('https://alice.btc.calendar.opentimestamps.org'));
    expect(attestations(await readTree(unb64(up.o), digest))).toEqual([{ kind: 'bitcoin', height: 100 }]);
    asked.length = 0;
    const s = await pending('https://evil.example');
    expect(await upgradeStamp(CAT, s)).toBe(s);
    expect(asked).toEqual([]);
  });

  it('is null while pending, and asks again later', async () => {
    const digest = await stampDigest(CAT, 3, HEAD);
    const s = { n: 3, h: HEAD, o: b64(await receipt(digest, Uint8Array.from(pendingAt('https://alice.btc.calendar.opentimestamps.org')))) };
    const asked = serve({});
    expect(await provenTime(CAT, s)).toBeNull();
    expect(await provenTime(CAT, s)).toBeNull();
    expect(asked.length).toBe(2);
  });
});

describe('sanitizeStamp', () => {
  it('takes only a head and a receipt', () => {
    expect(sanitizeStamp({ n: 1, h: HEAD, o: 'AAAA' })).toEqual({ n: 1, h: HEAD, o: 'AAAA' });
    expect(sanitizeStamp({ n: 1, h: HEAD, o: 'A'.repeat(9000) })).toBeNull();
    expect(sanitizeStamp({ n: 1.5, h: HEAD, o: 'AAAA' })).toBeNull();
    expect(sanitizeStamp([1, HEAD, 'AAAA'])).toBeNull();
  });
});

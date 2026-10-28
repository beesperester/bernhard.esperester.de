// A collar tag: everything that makes a cat this browser's cat (its key, its
// name and coat, its chain of catches with the co-signatures), written out as
// one long code to copy into another browser. Wearing it there makes that
// browser's cat this one, score and all. Whoever has the code *is* the cat,
// so it's for keeping to yourself.
//
// The blocks all belong to the one cat, so the tag leaves out what they have in
// common (the cat's id and public key) and puts it back on reading; the whole
// is compressed, then base64url.

import { Identity, b64, unb64, verify, type Signed } from './identity.ts';
import { Chain, blank, extend, sanitizeBlock, sanitizeCheck, sanitizeList, type Block, type Check, type Link, type Tally } from './ledger.ts';
import { COATS } from '../art/cat.ts';

const PREFIX = 'meow-';
/** At most this many blocks on a tag (a lifetime of snacks, and then some). */
const MAX_BLOCKS = 200_000;

type Tag = {
  /** The private key, as a JWK. */
  key: JsonWebKey;
  name: string;
  custom: boolean;
  coat: number;
  /** The blocks, without the cat's id (`c`) and public key (`k`). */
  blocks: [Omit<Link, 'c'>, string][];
  checks: Signed<Check>[];
};

/** What a tag gives back: the cat, its name and coat, and its chain (checked). */
export type Worn = { me: Identity; name: string; custom: boolean; coat: number; blocks: Block[]; checks: Signed<Check>[]; score: number };

async function squeeze(text: string, how: 'compress' | 'decompress'): Promise<Uint8Array<ArrayBuffer>> {
  const bytes = how === 'compress' ? new TextEncoder().encode(text) : unb64(text);
  const stream = new Blob([bytes]).stream().pipeThrough(how === 'compress' ? new CompressionStream('deflate-raw') : new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Our cat's collar tag. */
export async function makeTag(me: Identity, chain: Chain, who: { name: string; custom: boolean; coat: number }): Promise<string> {
  const { blocks, checks } = chain.all();
  const tag: Tag = {
    key: await me.secret(), ...who, checks,
    blocks: blocks.map(({ d: { c: _, ...rest }, s }) => [rest, s]),
  };
  return PREFIX + b64(await squeeze(JSON.stringify(tag), 'compress'));
}

/** Read a collar tag: null unless it is one, with a key that is a key and a chain that checks out to the last block. */
export async function readTag(code: string): Promise<Worn | null> {
  try {
    const text = code.replace(/\s+/g, '');
    if (!text.startsWith(PREFIX)) return null;
    const tag = JSON.parse(new TextDecoder().decode(await squeeze(text.slice(PREFIX.length), 'decompress'))) as Tag;
    if (!tag || typeof tag !== 'object' || !Array.isArray(tag.blocks) || tag.blocks.length > MAX_BLOCKS) return null;
    if (typeof tag.name !== 'string' || !tag.name.trim() || tag.name.length > 16 || !Number.isInteger(tag.coat) || tag.coat < 0 || tag.coat >= COATS.length) return null;
    const me = await Identity.adopt(tag.key, false);
    if (!me) return null;
    const blocks: Block[] = [];
    let t: Tally = blank(me.id);
    for (const [rest, s] of tag.blocks) {
      const b = sanitizeBlock({ d: { ...rest, c: me.id }, k: me.pub, s });
      const next = b && (await extend(t, b, Date.now(), verify));
      if (!b || !next || typeof next === 'string') return null;
      blocks.push(b);
      t = next;
    }
    const checks = sanitizeList(tag.checks ?? [], sanitizeCheck, 64) ?? [];
    return { me, name: tag.name, custom: !!tag.custom, coat: tag.coat, blocks, checks, score: t.s };
  } catch {
    return null;
  }
}

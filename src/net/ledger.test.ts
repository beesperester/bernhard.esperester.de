import { describe, expect, it } from 'vitest';
import { Identity, verify, type Signed } from './identity.ts';
import { CATCH_EVERY_MS, Chain, RATE_MAX, blank, extend, fault, fromCheck, refuse, sanitizeBlock, sanitizeCheck, weight, type Block, type ChainStore, type Check, type Tally } from './ledger.ts';
import { Prey } from '../game/state.ts';
import { GROWN_AT } from '../game/growth.ts';

const memory = (): ChainStore & { blocks: Map<number, Block> } => {
  const blocks = new Map<number, Block>();
  let checks: Signed<Check>[] = [];
  return {
    blocks,
    load: async () => ({ blocks: [...blocks.values()], checks }),
    put: async (b) => void blocks.set(b.d.n, b),
    putChecks: async (c) => void (checks = c),
  };
};

async function cat() {
  const me = await Identity.make();
  const store = memory();
  const chain = new Chain(me.id, (l) => me.sign(l), store);
  return { me, store, chain };
}

/** Check a whole chain from the start, as a cat meeting it would. */
async function tallyOf(c: string, blocks: Block[], now = Date.now() + 3600_000): Promise<Tally | string> {
  let t: Tally = blank(c);
  for (const b of blocks) {
    const next = await extend(t, b, now, verify);
    if (typeof next === 'string') return next;
    t = next;
  }
  return t;
}

describe('the chain of catches', () => {
  it('adds up, and checks out for another cat', async () => {
    const { me, chain } = await cat();
    await chain.append(7, Prey.Fly, 1, 1);
    await chain.append(7, Prey.Mouse, 2, 3);
    await chain.append(7, Prey.Bee, 3, -1);
    expect(chain.score).toBe(3);
    expect(chain.top).toBe(4);
    const t = await tallyOf(me.id, chain.from(0));
    expect(typeof t).toBe('object');
    expect(t).toMatchObject({ n: 3, s: 3, top: 4, h: chain.head.h });
  });

  it('dates each catch at least a second after the last', async () => {
    const { chain } = await cat();
    const [a, b] = [await chain.append(1, Prey.Fly, 1, 1), await chain.append(1, Prey.Fly, 2, 1)];
    expect(b!.d.t - a!.d.t).toBeGreaterThanOrEqual(CATCH_EVERY_MS);
  });

  it("won't take the same prey twice", async () => {
    const { chain } = await cat();
    expect(await chain.append(1, Prey.Fly, 1, 1)).not.toBeNull();
    expect(chain.fits(1, Prey.Fly, 1)).toBe(false);
    expect(await chain.append(1, Prey.Fly, 1, 1)).toBeNull();
    // (the same id in another garden is another butterfly)
    expect(await chain.append(2, Prey.Fly, 1, 1)).not.toBeNull();
    expect(chain.head.n).toBe(2);
  });

  it('comes back from where it is kept', async () => {
    const { me, store, chain } = await cat();
    await chain.append(1, Prey.Fish, 1, 3);
    await chain.append(1, Prey.Fish, 2, 3);
    const again = new Chain(me.id, (l) => me.sign(l), store);
    await again.load(verify);
    expect(again.head).toEqual(chain.head);
  });

  it('gives away any change to a block', async () => {
    const { me, chain } = await cat();
    await chain.append(1, Prey.Fly, 1, 1);
    await chain.append(1, Prey.Fly, 2, 1);
    const [a, b] = chain.from(0);
    expect(await tallyOf(me.id, [{ ...a, d: { ...a.d, p: 2 } }, b])).toBe('not worth that');
    expect(await tallyOf(me.id, [{ ...a, d: { ...a.d, k: Prey.Mouse, p: 3 } }, b])).toBe('not signed by that cat');
    expect(await tallyOf(me.id, [b])).toBe('not the next block');
    // a block signed by someone else
    const other = await Identity.make();
    expect(await tallyOf(me.id, [await other.sign(a.d), b])).toBe('not signed by that cat');
  });

  it('refuses catches that come too quickly or too far in the future', async () => {
    const { me } = await cat();
    const t0 = Date.now();
    const link = (n: number, v: string, t: number, i = n) => ({ c: me.id, n, v, w: 1, k: Prey.Find, i, p: 12, t });
    let t: Tally = blank(me.id);
    const first = await me.sign(link(0, '', t0));
    t = (await extend(t, first, t0, verify)) as Tally;
    expect(fault(t, await me.sign(link(1, t.h, t0 + 10)), t0)).toBe('too quick');
    expect(fault(t, await me.sign(link(1, t.h, t0 + 3600_000)), t0)).toBe('out of time');
    // a feast every second: fine for a while, then too much
    let n = 1;
    for (; n < 100; n++) {
      const b = await me.sign(link(n, t.h, t0 + n * 1000));
      const next = await extend(t, b, t0 + 3600_000, verify);
      if (typeof next === 'string') {
        expect(next).toBe('too much too quickly');
        break;
      }
      t = next;
    }
    expect(t.s).toBeLessThanOrEqual(RATE_MAX);
    expect(t.s).toBeGreaterThan(RATE_MAX - 12);
  });

  it('takes back a catch the garden turned down', async () => {
    const { me, chain } = await cat();
    await chain.append(1, Prey.Bird, 5, 4);
    const t = (await tallyOf(me.id, chain.from(0))) as Tally;
    expect(refuse(t, '1.3.5').s).toBe(0);
    expect(refuse(t, '1.3.6').s).toBe(4);
  });
});

describe('checkpoints', () => {
  it('weigh a newcomer at a quarter and a grown cat at a whole', () => {
    expect(weight(0)).toBe(0.25);
    expect(weight(GROWN_AT)).toBe(1);
    expect(weight(GROWN_AT * 3)).toBe(1);
  });

  it('let a chain be picked up from a head enough cats co-signed', async () => {
    const { me, chain } = await cat();
    for (let i = 0; i < 3; i++) await chain.append(1, Prey.Fish, i, 3);
    const head = chain.head;
    const signers = await Promise.all([0, 1, 2, 3].map(() => Identity.make()));
    const stake = new Map<string, number>();
    const proof: Signed<Check>[] = [];
    for (const a of signers) {
      const c = await a.sign<Check>({ c: me.id, n: head.n, h: head.h, s: head.s, a: a.id, t: Date.now() });
      expect(await chain.cosigned(c, verify)).toBe(true);
      proof.push(c);
    }
    // two newcomers aren't enough, four are; one grown cat is
    expect(chain.checkpoint((id) => stake.get(id) ?? 0)).toHaveLength(4);
    expect(await fromCheck(me.id, proof.slice(0, 2), () => 0, verify)).toBeNull();
    stake.set(signers[0].id, GROWN_AT);
    const t = await fromCheck(me.id, proof.slice(0, 1), (id) => stake.get(id) ?? 0, verify);
    expect(t).toMatchObject({ n: 3, h: head.h, s: 9 });
    // and the chain goes on from there
    await chain.append(1, Prey.Fish, 9, 3);
    const next = await extend(t!, chain.from(3)[0], Date.now() + 1000, verify);
    expect(next).toMatchObject({ n: 4, s: 12 });
    // the same co-signer twice counts once; a cat can't co-sign itself
    expect(await fromCheck(me.id, [proof[1], proof[1], proof[1], proof[1]], () => 0, verify)).toBeNull();
    const self = await me.sign<Check>({ c: me.id, n: head.n, h: head.h, s: head.s, a: me.id, t: Date.now() });
    expect(await chain.cosigned(self, verify)).toBe(false);
  });

  it("refuses co-signatures of a head that isn't ours, or forged", async () => {
    const { me, chain } = await cat();
    await chain.append(1, Prey.Fish, 1, 3);
    const a = await Identity.make(), b = await Identity.make();
    expect(await chain.cosigned(await a.sign<Check>({ c: me.id, n: 1, h: 'A'.repeat(22), s: 3, a: a.id, t: 0 }), verify)).toBe(false);
    expect(await chain.cosigned(await a.sign<Check>({ c: me.id, n: 1, h: chain.head.h, s: 3, a: b.id, t: 0 }), verify)).toBe(false);
  });
});

describe('what comes in', () => {
  it('takes only well-formed blocks and co-signatures', async () => {
    const { chain } = await cat();
    const b = (await chain.append(1, Prey.Fly, 1, 1))!;
    expect(sanitizeBlock(JSON.parse(JSON.stringify(b)))).toEqual(b);
    expect(sanitizeBlock({ ...b, d: { ...b.d, x: 1 } })).toBeNull();
    expect(sanitizeBlock({ ...b, d: { ...b.d, n: -1 } })).toBeNull();
    expect(sanitizeBlock({ ...b, extra: 1 })).toBeNull();
    const c = { d: { c: b.d.c, n: 1, h: 'A'.repeat(22), s: 1, a: b.d.c, t: 5 }, k: b.k, s: b.s };
    expect(sanitizeCheck(c)).toEqual(c);
    expect(sanitizeCheck({ ...c, d: { ...c.d, h: 'short' } })).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { Identity, verify } from './identity.ts';
import { Chain, type Block } from './ledger.ts';
import { makeTag, readTag } from './collar.ts';
import { Prey } from '../game/state.ts';

describe('the collar tag', () => {
  it('carries a cat, name, coat and chain to another browser', async () => {
    const me = await Identity.make();
    const blocks = new Map<number, Block>();
    const chain = new Chain(me.id, (l) => me.sign(l), { load: async () => ({ blocks: [], checks: [] }), put: async (b) => void blocks.set(b.d.n, b), putChecks: async () => {} });
    await chain.append(3, Prey.Fish, 1, 3);
    await chain.append(3, Prey.Bird, 2, 5);
    const code = await makeTag(me, chain, { name: 'Tuna', custom: true, coat: 2 });
    expect(code).toMatch(/^meow-[A-Za-z0-9_-]+$/);
    const worn = await readTag(`  ${code.slice(0, 20)}\n${code.slice(20)} `);
    expect(worn).toMatchObject({ name: 'Tuna', custom: true, coat: 2, score: 8 });
    expect(worn!.me.id).toBe(me.id);
    expect(worn!.blocks).toEqual(chain.all().blocks);
    // the key on it signs as the cat
    expect(await verify(await worn!.me.sign({ x: 1 }), me.id)).toBe(true);
  });

  it("is refused when it isn't one, or was tampered with", async () => {
    expect(await readTag('hello')).toBeNull();
    expect(await readTag('meow-AAAA')).toBeNull();
    const me = await Identity.make();
    const chain = new Chain(me.id, (l) => me.sign(l), { load: async () => ({ blocks: [], checks: [] }), put: async () => {}, putChecks: async () => {} });
    await chain.append(3, Prey.Fish, 1, 3);
    const code = await makeTag(me, chain, { name: 'Tuna', custom: true, coat: 2 });
    expect(await readTag(code.slice(0, -4) + (code.endsWith('AAAA') ? 'BBBB' : 'AAAA'))).toBeNull();
  });
});

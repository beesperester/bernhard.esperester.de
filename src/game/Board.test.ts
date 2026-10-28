import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Board, NAME_MAX, sanitizeBoard, verifyBoard, type BoardMsg, type Entry } from './Board.ts';
import { Identity, verify, type Signed } from '../net/identity.ts';
import { Chain } from '../net/ledger.ts';
import { memory, testBeacon } from '../net/testing.ts';
import { stamps as stampCheck } from '../net/stamp.ts';
import { Prey } from './state.ts';
import { GROWN_AT } from './growth.ts';

/** A well-formed cat id (20 base32 letters), one per number. */
const ID = (n: number) => `cat${'bcdefghijk'[n]}`.padEnd(20, 'a');
const entry = (over: Partial<Entry> = {}): Entry => ({ id: ID(1), name: 'Sleepy Paws', coat: 0, custom: false, t: 1, p: 'peer-1', n: 0, h: '', s: 0, ...over });
/** Signed in name only (sanitizeBoard only looks at the shape). */
const fake = <T extends object>(d: T): Signed<T> => ({ d, k: 'key', s: 'sig' });
const settle = async () => {
  for (let i = 0; i < 40; i++) await new Promise((r) => setTimeout(r, 0));
};


/** A cat in a garden: its key, its chain, and its board, wired to the others' over a pretend network. */
type Cat = { me: Identity; chain: Chain; board: Board; peer: string; inbox: { from: string; msg: BoardMsg }[] };
let clock = 0;
let cats = new Map<string, Cat>();

async function newCat(peer: string, chain?: Chain, me?: Identity): Promise<Cat> {
  me ??= await Identity.make();
  chain ??= new Chain(me.id, (l) => me!.sign(l), memory(), testBeacon);
  const cat: Cat = { me, chain, peer, inbox: [], board: null! };
  // (this test's garden only: anything a board from an earlier test still has to say goes nowhere)
  const garden = cats;
  const send = (msg: BoardMsg, target?: string) => {
    for (const [p, other] of garden) if (p !== peer && (!target || target === p)) other.inbox.push({ from: peer, msg: JSON.parse(JSON.stringify(msg)) });
  };
  cat.board = new Board(0, { id: me.id, peer, sign: (d) => me!.sign(d), now: () => clock, chain, check: verify, seed: 7 }, send, () => {});
  cats.set(peer, cat);
  return cat;
}

/** Deliver everything sent, as the game would (checked on the way in), until nothing more is said. */
async function run(): Promise<void> {
  // (quiet for a while: the signing and checking going on has finished, and nobody has anything more to say)
  for (let round = 0, quiet = 0; round < 200 && quiet < 5; round++) {
    await settle();
    const mail = [...cats.values()].flatMap((c) => c.inbox.splice(0).map((m) => ({ to: c, ...m })));
    if (!mail.length) {
      if (![...cats.values()].some((c) => c.board.busy)) quiet++;
      await new Promise((r) => setTimeout(r, 10));
      continue;
    }
    quiet = 0;
    for (const { to, from, msg } of mail) {
      const clean = sanitizeBoard(msg);
      const ok = clean && (await verifyBoard(from, clean, clock, verify));
      if (ok) to.board.receive(from, ok, performance.now());
    }
  }
}

const meet = async (a: Cat, b: Cat) => {
  a.board.greet(b.peer, performance.now());
  b.board.greet(a.peer, performance.now());
  await run();
};
const scoreOf = (who: Cat, of: Cat) => who.board.ranking().find((r) => r.id === of.me.id)?.score;

beforeEach(() => {
  cats = new Map();
  clock = 1000;
});

describe('sanitizeBoard', () => {
  it('accepts an entry, a request for blocks, blocks, a checkpoint and a co-signature', () => {
    expect(sanitizeBoard({ me: fake(entry()) })).toEqual({ me: fake(entry()) });
    expect(sanitizeBoard({ want: [3, 'A'.repeat(22)] })).toEqual({ want: [3, 'A'.repeat(22)] });
    expect(sanitizeBoard({ want: [-1, ''] })).toEqual({ want: [-1, ''] });
    expect(sanitizeBoard({ blocks: [] })).toEqual({ blocks: [] });
  });

  it.each([
    ['a bad id', { id: 'NO!' }],
    ['an untrimmed name', { name: '  Tuna  ' }],
    ['an empty name', { name: '   ' }],
    ['a long name', { name: 'x'.repeat(NAME_MAX + 1) }],
    ['a negative score', { s: -1 }],
    ['a bad head', { h: 'nope' }],
    ['an unknown coat', { coat: 999 }],
    ['a non-boolean custom flag', { custom: 'yes' }],
    ['no time', { t: undefined }],
    ['a field that was never signed', { extra: 1 }],
  ])('rejects an entry with %s', (_, over) => {
    expect(sanitizeBoard({ me: fake({ ...entry(), ...over }) })).toBeNull();
  });

  it('rejects an unsigned entry, bad blocks, or too many', () => {
    expect(sanitizeBoard({ me: entry() })).toBeNull();
    expect(sanitizeBoard({ blocks: [{ nope: 1 }] })).toBeNull();
    expect(sanitizeBoard({ blocks: Array.from({ length: 300 }, () => ({})) })).toBeNull();
    expect(sanitizeBoard({ want: [-2, ''] })).toBeNull();
    expect(sanitizeBoard({})).toBeNull();
  });
});

describe('signed entries', () => {
  it("take a cat at its word, but not one signing for another's id, or for another connection", async () => {
    const alice = await Identity.make(), bob = await Identity.make();
    const me = await alice.sign(entry({ id: alice.id, p: 'peer-a' }));
    expect(await verifyBoard('peer-a', { me }, 10, verify)).not.toBeNull();
    expect(await verifyBoard('peer-a', { me: { ...me, d: { ...me.d, s: 9999 } } }, 10, verify)).toBeNull();
    expect(await verifyBoard('peer-b', { me }, 10, verify)).toBeNull();
    expect(await verifyBoard('peer-b', { me: await bob.sign(entry({ id: alice.id, p: 'peer-b' })) }, 10, verify)).toBeNull();
    // nor anything signed far ahead of the garden clock (it would win over everything)
    expect(await verifyBoard('peer-a', { me: await alice.sign(entry({ id: alice.id, p: 'peer-a', t: 10 ** 9 })) }, 10, verify)).toBeNull();
  });
});

describe('the board', () => {
  it('starts a new cat at zero with a name', async () => {
    const a = await newCat('peer-a');
    expect(a.board.me).toMatchObject({ n: 0, s: 0, coat: 0, p: 'peer-a' });
    expect(a.board.me.name.length).toBeGreaterThan(0);
  });

  it('makes up names the others will take', async () => {
    for (let i = 0; i < 200; i++) {
      const name = new Board(0, { id: ID(0), peer: 'p', sign: async (d) => fake(d), now: () => 0, chain: new Chain(ID(0), async (l) => fake(l), memory(), testBeacon), check: verify, seed: 1 }, () => {}, () => {}).me.name;
      expect(sanitizeBoard({ me: fake(entry({ name })) })).not.toBeNull();
    }
  });

  it("shows another cat's score as far as its chain checks out", async () => {
    const a = await newCat('peer-a'), b = await newCat('peer-b');
    await a.board.ate(Prey.Fish, 1, 3);
    await a.board.ate(Prey.Bird, 2, 4);
    await meet(a, b);
    expect(scoreOf(b, a)).toBe(7);
    // and every catch after, as it happens
    await a.board.ate(Prey.Mouse, 3, 3);
    await run();
    expect(scoreOf(b, a)).toBe(10);
    expect(b.board.nameOf('peer-a')).toBe(a.board.me.name);
  });

  it("doesn't take a cat's word for its score", async () => {
    const a = await newCat('peer-a'), b = await newCat('peer-b');
    // a's entry says 9999, but its chain is empty
    const lie = await a.me.sign({ ...a.board.me, s: 9999, n: 5, h: 'A'.repeat(22), t: 5 });
    b.board.receive('peer-a', { me: lie }, 0);
    await run();
    expect(scoreOf(b, a)).toBe(0);
  });

  it('stops counting a chain at a block that was tampered with', async () => {
    const a = await newCat('peer-a'), b = await newCat('peer-b');
    await a.board.ate(Prey.Fish, 1, 3);
    const block = a.chain.from(0)[0];
    // a tampered version of the block (worth more) goes out instead of the real one
    const tampered = { ...block, d: { ...block.d, k: Prey.Bird, p: 4 } };
    b.board.receive('peer-a', { me: await a.me.sign({ ...a.board.me, t: 2 }) }, 0);
    b.board.receive('peer-a', { blocks: [tampered] }, 0);
    await run();
    expect(scoreOf(b, a)).toBe(0);
  });

  it('takes back a catch the garden turned down', async () => {
    const a = await newCat('peer-a'), b = await newCat('peer-b');
    await meet(a, b);
    await a.board.ate(Prey.Bird, 9, 4);
    await run();
    expect(scoreOf(b, a)).toBe(4);
    b.board.refuse('peer-a', Prey.Bird, 9);
    expect(scoreOf(b, a)).toBe(0);
  });

  it('takes cats that left off the board, but remembers how far their chain checked out', async () => {
    const a = await newCat('peer-a'), b = await newCat('peer-b');
    await a.board.ate(Prey.Fish, 1, 3);
    await meet(a, b);
    b.board.leave('peer-a');
    expect(scoreOf(b, a)).toBeUndefined();
    // back on another connection: its score is there at once, nothing to check again
    b.board.receive('peer-a2', { me: await a.me.sign({ ...a.board.me, p: 'peer-a2', t: 9 }) }, 0);
    expect(scoreOf(b, a)).toBe(3);
  });

  it('leaves a cat gone quiet off the board till it is back', async () => {
    const a = await newCat('peer-a'), b = await newCat('peer-b');
    await meet(a, b);
    b.board.silent('peer-a');
    expect(scoreOf(b, a)).toBeUndefined();
    b.board.silent('peer-a', false);
    expect(scoreOf(b, a)).toBe(0);
  });

  it('gives up a random name that clashes with a custom one', async () => {
    const a = await newCat('peer-a'), b = await newCat('peer-b');
    a.board.rename(b.board.me.name);
    await meet(a, b);
    expect(a.board.me.name).not.toBe(b.board.me.name);
  });

  it("answers a request for blocks from a cat that hasn't said who it is yet", async () => {
    const a = await newCat('peer-a'), b = await newCat('peer-b');
    await a.board.ate(Prey.Fish, 1, 3);
    await settle();
    b.inbox.length = 0;
    // b hears of a first and asks for its blocks before a has heard of b
    b.board.receive('peer-a', { me: await a.me.sign({ ...a.board.me, t: 2 }) }, 0);
    await run();
    expect(scoreOf(b, a)).toBe(3);
  });

  it('asks again when an answer is lost', async () => {
    const a = await newCat('peer-a'), b = await newCat('peer-b');
    await a.board.ate(Prey.Fish, 1, 3);
    await settle();
    b.inbox.length = 0;
    b.board.receive('peer-a', { me: await a.me.sign({ ...a.board.me, t: 2 }) }, 0);
    await settle();
    a.inbox.length = 0;
    await run();
    expect(scoreOf(b, a)).toBe(0);
    b.board.update(10_000);
    await run();
    expect(scoreOf(b, a)).toBe(3);
  });

  it('lets no peer switch to another cat mid-visit, or pose as us', async () => {
    const a = await newCat('peer-a'), b = await newCat('peer-b');
    await meet(a, b);
    b.board.receive('peer-a', { me: fake(entry({ id: ID(5), name: 'Beans', p: 'peer-a' })) }, 0);
    expect(b.board.nameOf('peer-a')).toBe(a.board.me.name);
    b.board.receive('peer-x', { me: fake({ ...b.board.me, p: 'peer-x' }) }, 0);
    expect(b.board.nameOf('peer-x')).toBe('');
  });

  it('takes ignored cats off the board', async () => {
    const a = await newCat('peer-a'), b = await newCat('peer-b');
    await a.board.ate(Prey.Fish, 1, 3);
    await meet(a, b);
    b.board.drop('peer-a');
    expect(scoreOf(b, a)).toBeUndefined();
  });
});

describe('checkpoints', () => {
  it('co-sign the chain of a cat played alongside for a while, and spare the next cat the old blocks', async () => {
    const a = await newCat('peer-a');
    for (let i = 0; i < 5; i++) await a.board.ate(Prey.Fish, i, 3);
    // a grown cat (its chain is known to a as worth GROWN_AT) plays alongside a for a minute
    // (its feasts a minute apart, yesterday: no quicker than a cat can eat)
    const gMe = await Identity.make(), gChain = new Chain(gMe.id, (l) => gMe.sign(l), memory(), testBeacon);
    let t = Date.now() - 86_400_000;
    const now = vi.spyOn(Date, 'now').mockImplementation(() => t);
    for (let i = 0; i < GROWN_AT / 12 + 1; i++) {
      t += 60_000;
      expect(await gChain.append(1, Prey.Find, i, 12)).not.toBeNull();
    }
    now.mockRestore();
    const g = await newCat('peer-g', gChain, gMe);
    await meet(a, g);
    expect(scoreOf(a, g)).toBeGreaterThanOrEqual(GROWN_AT);
    g.board.update(performance.now() + 61_000);
    await run();
    expect(a.chain.checkpoint((id) => (id === g.me.id ? GROWN_AT : 0))).toHaveLength(1);
    // a newcomer gets the checkpoint and only what came after it; it counts if it knows g has grown
    await a.board.ate(Prey.Fish, 99, 3);
    const n = await newCat('peer-n');
    const sentBlocks: number[] = [];
    const inbox = n.inbox;
    n.inbox = new Proxy(inbox, {
      get: (t, k) => (k === 'push' ? (m: { from: string; msg: BoardMsg }) => (m.from === 'peer-a' && m.msg.blocks && sentBlocks.push(...m.msg.blocks.map((b) => b.d.n)), t.push(m)) : Reflect.get(t, k)),
    });
    await meet(n, g);
    await meet(a, n);
    expect(scoreOf(n, a)).toBe(18);
    expect(sentBlocks).toContain(5);
    expect(sentBlocks.filter((x) => x < 5)).toEqual([]);
  });
});

describe('stamps', () => {
  /** A cat whose catches were all two days ago. */
  async function oldCat(peer: string) {
    const me = await Identity.make(), chain = new Chain(me.id, (l) => me.sign(l), memory(), testBeacon);
    let t = Date.now() - 2 * 86_400_000;
    const now = vi.spyOn(Date, 'now').mockImplementation(() => t);
    for (let i = 0; i < 3; i++) {
      t += 60_000;
      await chain.append(1, Prey.Fish, i, 3);
    }
    now.mockRestore();
    return { cat: await newCat(peer, chain, me), made: t };
  }

  it("hold back an old chain's points till a stamp shows it was made in time, and earn it the seal", async () => {
    const proven = stampCheck.proven;
    try {
      const { cat: a, made } = await oldCat('peer-a');
      await a.chain.keepStamp({ n: 3, h: a.chain.head.h, o: 'AA' });
      // the stamp was in Bitcoin an hour after the catches
      stampCheck.proven = async () => made + 3_600_000;
      const b = await newCat('peer-b');
      await meet(a, b);
      expect(scoreOf(b, a)).toBe(9);
      expect(b.board.ranking().find((r) => r.id === a.me.id)?.verified).toBe(true);
    } finally {
      stampCheck.proven = proven;
    }
  });

  it('count nothing of an old chain stamped too late, or not at all', async () => {
    const proven = stampCheck.proven;
    try {
      const { cat: a, made } = await oldCat('peer-a');
      const b = await newCat('peer-b');
      await meet(a, b);
      expect(scoreOf(b, a)).toBe(0);
      expect(b.board.ranking().find((r) => r.id === a.me.id)?.verified).toBe(false);
      // stamped only now, two days on: made up after the fact, for all anyone can tell
      const { cat: c } = await oldCat('peer-c');
      await c.chain.keepStamp({ n: 3, h: c.chain.head.h, o: 'AA' });
      stampCheck.proven = async () => made + 2 * 86_400_000;
      await meet(c, b);
      expect(scoreOf(b, c)).toBe(0);
    } finally {
      stampCheck.proven = proven;
    }
  });

  it('pass with the blocks, and only well-formed ones', () => {
    expect(sanitizeBoard({ stamps: [{ n: 3, h: 'A'.repeat(22), o: 'AAAA' }] })).not.toBeNull();
    expect(sanitizeBoard({ stamps: [{ n: 0, h: 'A'.repeat(22), o: 'AAAA' }] })).toBeNull();
    expect(sanitizeBoard({ stamps: [{ n: 3, h: 'A'.repeat(22), o: 'A+A' }] })).toBeNull();
    expect(sanitizeBoard({ stamps: [{ n: 3, h: 'A'.repeat(22), o: 'AAAA', x: 1 }] })).toBeNull();
  });
});

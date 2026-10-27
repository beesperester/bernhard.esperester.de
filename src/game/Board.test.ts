import { beforeEach, describe, expect, it } from 'vitest';
import { Board, NAME_MAX, sanitizeBoard, verifyBoard, type BoardMsg, type Entry, type Signer, type Where } from './Board.ts';
import { Identity, verify, type Signed } from '../net/identity.ts';

/** A well-formed cat id (20 base32 letters), one per number. */
const ID = (n: number) => `cat${'bcdefghijk'[n]}`.padEnd(20, 'a');
const entry = (over: Partial<Entry> = {}): Entry => ({ id: ID(1), name: 'Sleepy Paws', coat: 0, score: 3, custom: false, t: 1, p: 'peer-1', ...over });
/** Signed in name only: the board takes signatures as checked already (verifyBoard does the checking). */
const fake = <T extends object>(d: T): Signed<T> => ({ d, k: 'key', s: 'sig' });
const flush = () => new Promise((r) => setTimeout(r, 0));

let clock = 1000;
const signer = (id = ID(0), peer = 'me-peer'): Signer => ({ id, peer, sign: async (d) => fake(d), now: () => clock });

describe('sanitizeBoard', () => {
  it('accepts a signed entry, a board, what the sender vouches for and where cats were', () => {
    expect(sanitizeBoard({ me: fake(entry()) })).toEqual({ me: fake(entry()) });
    const full = sanitizeBoard({ me: fake(entry()), all: [fake(entry({ id: ID(2) }))], vouch: [[ID(2), 4]], where: [fake({ id: ID(2), x: 5, y: 6, z: 0, f: 1, t: 9 })] });
    expect(full?.all).toHaveLength(1);
    expect(full?.vouch).toEqual([[ID(2), 4]]);
    expect(full?.where?.[0].d.x).toBe(5);
  });

  it.each([
    ['a bad id', { id: 'NO!' }],
    ['an untrimmed name', { name: '  Tuna  ' }],
    ['an empty name', { name: '   ' }],
    ['a long name', { name: 'x'.repeat(NAME_MAX + 1) }],
    ['a negative score', { score: -1 }],
    ['a fractional score', { score: 1.5 }],
    ['an unknown coat', { coat: 999 }],
    ['a non-boolean custom flag', { custom: 'yes' }],
    ['no time', { t: undefined }],
    ['a field that was never signed', { extra: 1 }],
  ])('rejects an entry with %s', (_, over) => {
    expect(sanitizeBoard({ me: fake({ ...entry(), ...over }) })).toBeNull();
  });

  it('rejects an unsigned entry, a bad board, or too much of anything', () => {
    expect(sanitizeBoard({ me: entry() })).toBeNull();
    expect(sanitizeBoard({ me: fake(entry()), all: [fake(entry()), { nope: 1 }] })).toBeNull();
    expect(sanitizeBoard({ me: fake(entry()), all: Array.from({ length: 300 }, () => fake(entry())) })).toBeNull();
    expect(sanitizeBoard({ me: fake(entry()), vouch: [['NO!', 1]] })).toBeNull();
    expect(sanitizeBoard({ where: [fake({ id: ID(2), x: -5, y: 6, z: 0, f: 1, t: 9 })] })).toBeNull();
    expect(sanitizeBoard({ where: [fake({ id: ID(2), x: 5, y: 6, z: 0, f: 7, t: 9 })] })).toBeNull();
    expect(sanitizeBoard({})).toBeNull();
  });
});

describe('signatures', () => {
  let alice: Identity, bob: Identity;
  beforeEach(async () => {
    [alice, bob] = await Promise.all([Identity.load(), Identity.load()]);
  });

  const roundTrip = (m: BoardMsg) => sanitizeBoard(JSON.parse(JSON.stringify(m)))!;

  it('gives every key pair its own id', () => {
    expect(alice.id).toMatch(/^[a-z2-7]{20}$/);
    expect(alice.id).not.toBe(bob.id);
  });

  it('takes a cat at its signed word, and nothing changed on the way', async () => {
    const me = await alice.sign(entry({ id: alice.id, p: 'peer-a' }));
    expect(await verifyBoard('peer-a', roundTrip({ me }), 10, verify)).not.toBeNull();
    // a cat passing it on bumps the score: the signature no longer fits
    const forged = { ...me, d: { ...me.d, score: 9999 } };
    expect(await verifyBoard('peer-a', roundTrip({ me: forged }), 10, verify)).toBeNull();
  });

  it("won't let one cat sign for another's id, or replay its entry on another connection", async () => {
    const posing = await bob.sign(entry({ id: alice.id, p: 'peer-b' }));
    expect(await verifyBoard('peer-b', roundTrip({ me: posing }), 10, verify)).toBeNull();
    const alices = await alice.sign(entry({ id: alice.id, p: 'peer-a' }));
    expect(await verifyBoard('peer-b', roundTrip({ me: alices }), 10, verify)).toBeNull();
  });

  it('leaves out what was tampered with among what is passed on, and keeps the rest', async () => {
    const me = await bob.sign(entry({ id: bob.id, p: 'peer-b' }));
    const a = await alice.sign(entry({ id: alice.id, p: 'peer-a', score: 3 }));
    const w = await alice.sign<Where>({ id: alice.id, x: 10, y: 20, z: 0, f: 1, t: 5 });
    const ok = await verifyBoard('peer-b', roundTrip({ me, all: [a, { ...a, d: { ...a.d, score: 50 } }], where: [w, { ...w, d: { ...w.d, x: 999 } }] }), 10, verify);
    expect(ok?.all).toHaveLength(1);
    expect(ok?.all?.[0].d.score).toBe(3);
    expect(ok?.where).toHaveLength(1);
    expect(ok?.where?.[0].d.x).toBe(10);
  });

  it('believes nothing signed far ahead of the garden clock (it would win over everything)', async () => {
    const w = await alice.sign<Where>({ id: alice.id, x: 10, y: 20, z: 0, f: 1, t: 10 ** 9 });
    expect((await verifyBoard('peer-b', roundTrip({ where: [w] }), 10, verify))?.where).toEqual([]);
  });
});

describe('Board', () => {
  let sent: { msg: BoardMsg; target?: string }[];
  let board: Board;

  beforeEach(() => {
    sent = [];
    clock = 1000;
    board = new Board(2, signer(), (msg, target) => sent.push({ msg, target }), () => {});
  });

  it('starts us at zero with a name', () => {
    expect(board.me.score).toBe(0);
    expect(board.me.name.length).toBeGreaterThan(0);
    expect(board.me.coat).toBe(2);
    expect(board.me.p).toBe('me-peer');
  });

  it('adds up points, never below zero, and announces each change signed and timed', async () => {
    board.ate(3);
    board.ate(-5);
    expect(board.me.score).toBe(0);
    clock = 2000;
    board.ate(4);
    await flush();
    expect(board.me.score).toBe(4);
    expect(sent.at(-1)?.msg.me?.d.score).toBe(4);
    expect(sent.at(-1)?.msg.me?.d.t).toBe(2000);
  });

  it('keeps the newest version of every entry, whoever passes it on', () => {
    board.receive('peer-1', { me: fake(entry({ name: 'Tuna', t: 20 })) });
    board.receive('peer-2', { me: fake(entry({ id: ID(2), p: 'peer-2' })), all: [fake(entry({ name: 'Beans', t: 10 }))] });
    expect(board.nameOf('peer-1')).toBe('Tuna');
    board.receive('peer-3', { me: fake(entry({ id: ID(3), p: 'peer-3' })), all: [fake(entry({ name: 'Pickles', t: 30 }))] });
    expect(board.nameOf('peer-1')).toBe('Pickles');
  });

  it('ranks best first and knows who is here', () => {
    board.receive('peer-1', { me: fake(entry({ name: 'Tuna', score: 9 })) });
    board.receive('peer-2', { me: fake(entry({ id: ID(2), name: 'Beans', score: 2 })) });
    board.credit('peer-1', 9);
    board.credit('peer-2', 2);
    board.leave('peer-2');
    const ranking = board.ranking();
    expect(ranking[0].name).toBe('Tuna');
    expect(ranking.find((e) => e.name === 'Beans')?.here).toBe(false);
    expect(board.nameOf('peer-1')).toBe('Tuna');
  });

  it('greets a newcomer with the board as signed, and what it vouches for on its own account', async () => {
    board.receive('peer-1', { me: fake(entry({ score: 7 })) });
    board.greet('peer-9');
    await flush();
    const msg = sent.at(-1)!;
    expect(msg.target).toBe('peer-9');
    expect(msg.msg.all?.map((s) => s.d.score)).toEqual([7]);
    // (it hasn't seen those 7 confirmed, so it vouches for none)
    expect(msg.msg.vouch).toEqual([[ID(1), 0]]);
  });

  it('gives up a random name that clashes with a custom one', () => {
    board.receive('peer-1', { me: fake(entry({ name: board.me.name, custom: true })) });
    expect(board.available(board.me.name)).toBe(true);
    expect(board.ranking().filter((e) => e.name === board.ranking()[0].name)).toHaveLength(1);
  });

  it('ignores messages claiming to be us', () => {
    board.receive('peer-1', { me: fake({ ...board.me, score: 999, t: 99 }) });
    expect(board.nameOf('peer-1')).toBe('');
    expect(board.me.score).toBe(0);
  });

  it('carries on with its own entry from before a reload, if a cat passes it back', () => {
    board.receive('peer-1', { me: fake(entry()), all: [fake({ ...board.me, score: 42, name: 'Old Name', t: 5000 })] });
    expect(board.me.score).toBe(42);
    expect(board.me.name).toBe('Old Name');
  });

  it('resets the score but keeps the name in a new garden', () => {
    const name = board.me.name;
    board.ate(5);
    board.reset();
    expect(board.me.score).toBe(0);
    expect(board.me.name).toBe(name);
  });

  it('signs where our cat is now and then, not every frame', async () => {
    board.moved(10, 20, 0, 1, 0);
    board.moved(11, 20, 0, 1, 500);
    board.moved(12, 20, 0, 1, 1200);
    board.moved(12, 20, 0, 1, 2500);
    await flush();
    expect(sent.map((m) => m.msg.where?.[0].d.x)).toEqual([10, 12]);
  });

  it('tells a cat that comes back where it was', () => {
    const was = fake<Where>({ id: ID(1), x: 120, y: 340, z: 0, f: 3, t: 50 });
    board.receive('peer-1', { me: fake(entry()), where: [was] });
    board.leave('peer-1');
    sent = [];
    board.receive('peer-9', { me: fake(entry({ p: 'peer-9' })) });
    expect(sent).toEqual([{ msg: { where: [was] }, target: 'peer-9' }]);
  });

  it('keeps the newest of where a cat was, whoever passes it on', () => {
    board.receive('peer-2', { me: fake(entry({ id: ID(2), p: 'peer-2' })), where: [fake<Where>({ id: ID(1), x: 1, y: 1, z: 0, f: 0, t: 50 })] });
    board.receive('peer-3', { me: fake(entry({ id: ID(3), p: 'peer-3' })), where: [fake<Where>({ id: ID(1), x: 2, y: 2, z: 0, f: 0, t: 40 })] });
    sent = [];
    board.receive('peer-1', { me: fake(entry()) });
    expect(sent[0].msg.where?.[0].d.x).toBe(1);
  });

  it('passes on where an absent cat was, so a cat that never met it can tell it', async () => {
    // A plays, B arrives, A leaves: B keeps A's last signed whereabouts
    const toC: BoardMsg[] = [];
    const b = new Board(1, signer(ID(4), 'peer-b'), (msg, target) => target === 'peer-c' && toC.push(msg), () => {});
    const was = fake<Where>({ id: ID(1), x: 200, y: 300, z: 0, f: 2, t: 70 });
    b.receive('peer-a', { me: fake(entry({ p: 'peer-a' })), where: [was] });
    b.leave('peer-a');
    // C (our board) arrives and B greets it; then B leaves
    b.greet('peer-c');
    await flush();
    for (const msg of toC) board.receive('peer-b', sanitizeBoard(JSON.parse(JSON.stringify(msg)))!);
    board.leave('peer-b');
    // A comes back: C tells it where it was
    sent = [];
    board.receive('peer-a2', { me: fake(entry({ p: 'peer-a2' })) });
    expect(sent).toContainEqual({ msg: { where: [was] }, target: 'peer-a2' });
  });

  it('hears where our own cat was', () => {
    const backs: unknown[] = [];
    board.onBack = (pose) => backs.push(pose);
    board.receive('peer-1', { where: [fake<Where>({ id: board.id, x: 50, y: 60, z: 16, f: 1, t: 9 })] });
    expect(backs).toEqual([[50, 60, 16, 1]]);
  });
});

describe('scores that check out', () => {
  let board: Board;
  const score = (id: string) => board.ranking().find((e) => e.id === id)?.score;

  beforeEach(() => {
    board = new Board(0, signer(), () => {}, () => {});
  });

  it('shows a newcomer’s claimed score only as far as confirmed catches go', () => {
    board.receive('peer-1', { me: fake(entry({ id: ID(5), score: 9999 })) });
    expect(score(ID(5))).toBe(0);
    board.credit('peer-1', 3);
    expect(score(ID(5))).toBe(3);
  });

  it('counts catches confirmed before it said who it is', () => {
    board.credit('peer-1', 4);
    board.receive('peer-1', { me: fake(entry({ id: ID(5), score: 4 })) });
    expect(score(ID(5))).toBe(4);
  });

  it('takes the median of what the others vouch, each in its own name, never the cat’s own word', () => {
    board.receive('peer-1', { me: fake(entry({ id: ID(5), score: 50 })) });
    board.receive('peer-2', { me: fake(entry({ id: ID(6), p: 'peer-2' })), vouch: [[ID(5), 40]] });
    board.receive('peer-3', { me: fake(entry({ id: ID(7), p: 'peer-3' })), vouch: [[ID(5), 50]] });
    board.receive('peer-4', { me: fake(entry({ id: ID(2), p: 'peer-4' })), vouch: [[ID(5), 9999]] });
    expect(score(ID(5))).toBe(50);
    // and a cat can't vouch for itself
    board.receive('peer-1', { me: fake(entry({ id: ID(5), score: 50 })), vouch: [[ID(5), 9999]] });
    expect(score(ID(5))).toBe(50);
  });

  it('vouches for a cat that left, should it come back', () => {
    board.receive('peer-1', { me: fake(entry({ id: ID(5), score: 7 })) });
    board.credit('peer-1', 7);
    board.leave('peer-1');
    board.receive('peer-9', { me: fake(entry({ id: ID(5), score: 7, p: 'peer-9' })) });
    expect(score(ID(5))).toBe(7);
  });

  it('lets no peer switch to another cat mid-visit', () => {
    board.receive('peer-1', { me: fake(entry({ id: ID(5), name: 'Tuna' })) });
    board.receive('peer-1', { me: fake(entry({ id: ID(6), name: 'Beans' })) });
    expect(board.nameOf('peer-1')).toBe('Tuna');
  });

  it('takes ignored cats off the board', () => {
    board.receive('peer-1', { me: fake(entry({ id: ID(5) })) });
    board.drop('peer-1');
    expect(score(ID(5))).toBeUndefined();
  });
});

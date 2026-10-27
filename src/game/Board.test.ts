import { beforeEach, describe, expect, it } from 'vitest';
import { Board, NAME_MAX, sanitizeBoard, type BoardMsg, type Entry } from './Board.ts';

const entry = (over: Partial<Entry> = {}): Entry => ({ id: 'abcdefgh12', name: 'Sleepy Paws', coat: 0, score: 3, custom: false, v: 1, ...over });

describe('sanitizeBoard', () => {
  it('accepts a single entry and a full board', () => {
    expect(sanitizeBoard({ me: entry() })).toEqual({ me: entry() });
    expect(sanitizeBoard({ me: entry(), all: [entry({ id: 'zzzzzzzz99' })] })?.all).toHaveLength(1);
  });

  it('trims names', () => {
    expect(sanitizeBoard({ me: entry({ name: '  Tuna  ' }) })?.me.name).toBe('Tuna');
  });

  it.each([
    ['a bad id', { id: 'NO!' }],
    ['an empty name', { name: '   ' }],
    ['a long name', { name: 'x'.repeat(NAME_MAX + 1) }],
    ['a negative score', { score: -1 }],
    ['a fractional score', { score: 1.5 }],
    ['an unknown coat', { coat: 999 }],
    ['a non-boolean custom flag', { custom: 'yes' }],
  ])('rejects an entry with %s', (_, over) => {
    expect(sanitizeBoard({ me: { ...entry(), ...over } })).toBeNull();
  });

  it('rejects a board with any bad entry, or too many entries', () => {
    expect(sanitizeBoard({ me: entry(), all: [entry(), { nope: 1 }] })).toBeNull();
    expect(sanitizeBoard({ me: entry(), all: Array.from({ length: 300 }, () => entry()) })).toBeNull();
  });
});

describe('Board', () => {
  let sent: { msg: BoardMsg; target?: string }[];
  let board: Board;

  beforeEach(() => {
    sent = [];
    board = new Board(2, (msg, target) => sent.push({ msg, target }), () => {});
  });

  it('starts us at zero with a name', () => {
    expect(board.me.score).toBe(0);
    expect(board.me.name.length).toBeGreaterThan(0);
    expect(board.me.coat).toBe(2);
  });

  it('adds up points, never below zero, and announces each change', () => {
    board.ate(3);
    board.ate(-5);
    expect(board.me.score).toBe(0);
    board.ate(4);
    expect(board.me.score).toBe(4);
    expect(sent.at(-1)?.msg.me.score).toBe(4);
    expect(sent.at(-1)?.msg.me.v).toBe(3);
  });

  it('keeps the newest version of every entry', () => {
    board.receive('peer-1', { me: entry({ id: 'otherone01', name: 'Tuna', v: 2 }) });
    board.receive('peer-1', { me: entry({ id: 'otherone01', name: 'Beans', v: 1 }) });
    expect(board.nameOf('peer-1')).toBe('Tuna');
  });

  it('ranks best first and knows who is here', () => {
    board.receive('peer-1', { me: entry({ id: 'otherone01', name: 'Tuna', score: 9 }) });
    board.receive('peer-2', { me: entry({ id: 'otherone02', name: 'Beans', score: 2 }) });
    board.credit('peer-1', 9);
    board.credit('peer-2', 2);
    board.leave('peer-2');
    const ranking = board.ranking();
    expect(ranking[0].name).toBe('Tuna');
    expect(ranking.find((e) => e.name === 'Beans')?.here).toBe(false);
    expect(board.nameOf('peer-1')).toBe('Tuna');
  });

  it('greets a newcomer with the whole board', () => {
    board.receive('peer-1', { me: entry({ id: 'otherone01' }) });
    board.greet('peer-9');
    expect(sent.at(-1)?.target).toBe('peer-9');
    expect(sent.at(-1)?.msg.all).toHaveLength(2);
  });

  it('gives up a random name that clashes with a custom one', () => {
    board.receive('peer-1', { me: entry({ id: 'otherone01', name: board.me.name, custom: true }) });
    expect(board.available(board.me.name)).toBe(true);
    expect(board.ranking().filter((e) => e.name === board.ranking()[0].name)).toHaveLength(1);
  });

  it('ignores messages claiming to be us', () => {
    board.receive('peer-1', { me: { ...board.me, score: 999, v: 99 } });
    expect(board.me.score).toBe(0);
  });

  it('resets the score but keeps the name in a new garden', () => {
    const name = board.me.name;
    board.ate(5);
    board.reset();
    expect(board.me.score).toBe(0);
    expect(board.me.name).toBe(name);
  });
});

describe('scores that check out', () => {
  let board: Board;
  const score = (id: string) => board.ranking().find((e) => e.id === id)?.score;

  beforeEach(() => {
    board = new Board(0, () => {}, () => {});
  });

  it('shows a newcomer’s claimed score only as far as confirmed catches go', () => {
    board.receive('peer-1', { me: entry({ id: 'cheater001', score: 9999 }) });
    expect(score('cheater001')).toBe(0);
    board.credit('peer-1', 3);
    expect(score('cheater001')).toBe(3);
  });

  it('never shows more than the cat itself claims', () => {
    board.receive('peer-1', { me: entry({ id: 'honest0001', score: 2 }) });
    board.credit('peer-1', 5);
    expect(score('honest0001')).toBe(2);
  });

  it('counts catches confirmed before the cat introduced itself', () => {
    board.credit('peer-1', 4);
    board.receive('peer-1', { me: entry({ id: 'honest0001', score: 4 }) });
    expect(score('honest0001')).toBe(4);
  });

  it('takes the median of what the others vouch, never the cat’s own word', () => {
    const vouch = (peer: string, reporter: string, n: number) =>
      board.receive(peer, { me: entry({ id: reporter }), all: [entry({ id: 'returner01', score: n }), entry({ id: reporter, score: 9999 })] });
    vouch('peer-a', 'reportera1', 40);
    vouch('peer-b', 'reporterb1', 41);
    vouch('peer-c', 'liarliar01', 5000);
    board.receive('peer-r', { me: entry({ id: 'returner01', score: 60, v: 2 }) });
    expect(score('returner01')).toBe(41);
    expect(score('reportera1')).toBe(0);
  });

  it('vouches for a cat that left, should it come back', () => {
    board.receive('peer-1', { me: entry({ id: 'honest0001', score: 7 }) });
    board.credit('peer-1', 7);
    board.leave('peer-1');
    board.receive('peer-9', { me: entry({ id: 'honest0001', score: 7 }) });
    expect(score('honest0001')).toBe(7);
  });

  it('lets no peer switch to another cat mid-visit', () => {
    board.receive('peer-1', { me: entry({ id: 'honest0001', name: 'Tuna' }) });
    board.receive('peer-1', { me: entry({ id: 'otherone02', name: 'Beans' }) });
    expect(board.nameOf('peer-1')).toBe('Tuna');
  });

  it('takes ignored cats off the board', () => {
    board.receive('peer-1', { me: entry({ id: 'cheater001' }) });
    board.drop('peer-1');
    expect(score('cheater001')).toBeUndefined();
  });
});

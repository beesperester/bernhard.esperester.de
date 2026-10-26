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
    board.receive('peer-1', { me: entry({ id: 'otherone01', score: 5, v: 2 }) });
    board.receive('peer-1', { me: entry({ id: 'otherone01', score: 1, v: 1 }) });
    expect(board.ranking().find((e) => e.id === 'otherone01')?.score).toBe(5);
  });

  it('ranks best first and knows who is here', () => {
    board.receive('peer-1', { me: entry({ id: 'otherone01', name: 'Tuna', score: 9 }) });
    board.receive('peer-2', { me: entry({ id: 'otherone02', name: 'Beans', score: 2 }) });
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

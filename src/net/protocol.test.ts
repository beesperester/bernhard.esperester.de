import { describe, expect, it } from 'vitest';
import { Prey } from '../game/state.ts';
import { sanitizeCat, sanitizeCatch, sanitizeCoaster, sanitizeSeed, sanitizeShake, sanitizeVote, sanitizeWorld } from './protocol.ts';

describe('sanitizeCat', () => {
  it('accepts a well-formed state and truncates the integer fields', () => {
    expect(sanitizeCat([10.5, 20.25, 0, 2.7, 1.9, 5.5, 3.1, 4.2, 1.6])).toEqual([10.5, 20.25, 0, 2, 1, 5, 3, 4, 1]);
  });

  it('keeps the stage to the three there are', () => {
    expect(sanitizeCat([0, 0, 0, 0, 0, 0, 0, 0, 7])![8]).toBe(2);
    expect(sanitizeCat([0, 0, 0, 0, 0, 0, 0, 0, -3])![8]).toBe(0);
  });

  it.each([
    ['not an array', { x: 1 }],
    ['too short', [1, 2, 3]],
    ['too long', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]],
    ['a string inside', [1, 2, 3, 4, '5', 6, 7, 8, 0]],
    ['NaN', [1, 2, NaN, 4, 5, 6, 7, 8, 0]],
    ['Infinity', [1, Infinity, 3, 4, 5, 6, 7, 8, 0]],
    ['null', null],
  ])('rejects %s', (_, msg) => {
    expect(sanitizeCat(msg)).toBeNull();
  });
});

describe('sanitizeCatch', () => {
  it('accepts every known kind of prey', () => {
    for (const kind of Object.values(Prey)) expect(sanitizeCatch([kind, 42])).toEqual([kind, 42]);
  });

  it.each([
    ['an unknown kind', [99, 1]],
    ['a fractional id', [Prey.Fish, 1.5]],
    ['a string kind', ['0', 1]],
    ['the wrong length', [Prey.Fish]],
    ['an object', { kind: 0, id: 1 }],
  ])('rejects %s', (_, msg) => {
    expect(sanitizeCatch(msg)).toBeNull();
  });
});

describe('sanitizeVote', () => {
  it('accepts catch verdicts and accusations', () => {
    expect(sanitizeVote(['c', 'peerAbc123', Prey.Bird, 12, true])).toEqual(['c', 'peerAbc123', Prey.Bird, 12, true]);
    expect(sanitizeVote(['a', 'peerAbc123', false])).toEqual(['a', 'peerAbc123', false]);
  });

  it.each([
    ['an unknown type', ['x', 'peer', true]],
    ['a bad peer id', ['a', 'no spaces!', true]],
    ['an overlong peer id', ['a', 'p'.repeat(65), true]],
    ['a non-boolean verdict', ['a', 'peer', 1]],
    ['an unknown prey kind', ['c', 'peer', 99, 1, true]],
    ['a fractional prey id', ['c', 'peer', Prey.Fish, 1.5, true]],
    ['extra fields', ['a', 'peer', true, 'more']],
  ])('rejects %s', (_, msg) => {
    expect(sanitizeVote(msg)).toBeNull();
  });
});

describe('sanitizeShake', () => {
  it('accepts a paw at a tree that exists, at a whole garden time', () => {
    expect(sanitizeShake([3, 1700000000000], 10)).toEqual([3, 1700000000000]);
  });

  it.each([
    ['a tree that does not exist', [10, 1700000000000]],
    ['a negative tree', [-1, 1700000000000]],
    ['a fractional time', [3, 1.5]],
    ['not a pair', [3]],
    ['strings', ['3', '1700000000000']],
  ])('rejects %s', (_, d) => {
    expect(sanitizeShake(d, 10)).toBeNull();
  });
});

describe('sanitizeWorld', () => {
  it('accepts recent catches and shaken trees', () => {
    expect(sanitizeWorld({ caught: [[Prey.Fish, 12]], shakes: [[3, 5000]] }, 10)).toEqual({ caught: [[Prey.Fish, 12]], shakes: [[3, 5000]] });
  });

  it('rejects anything malformed or endless', () => {
    expect(sanitizeWorld({ caught: [[999, 1]], shakes: [] }, 10)).toBeNull();
    expect(sanitizeWorld({ caught: [], shakes: [[10, 5000]] }, 10)).toBeNull();
    expect(sanitizeWorld({ caught: Array.from({ length: 600 }, () => [Prey.Fish, 1]), shakes: [] }, 10)).toBeNull();
    expect(sanitizeWorld({ caught: [] }, 10)).toBeNull();
  });
});

describe('garden seeds', () => {
  it('accept a 32-bit seed and a plausible planting time', () => {
    expect(sanitizeSeed([123, 1.75e12])).toEqual({ seed: 123, born: 1.75e12 });
    expect(sanitizeSeed([2 ** 32, 1.75e12])).toBeNull();
    expect(sanitizeSeed([-1, 1.75e12])).toBeNull();
    expect(sanitizeSeed([1.5, 1.75e12])).toBeNull();
    expect(sanitizeSeed([1, 5])).toBeNull();
    expect(sanitizeSeed([1, Date.now() + 1e9])).toBeNull();
    expect(sanitizeSeed({ seed: 1, born: 1.75e12 })).toBeNull();
  });
});

describe('sanitizeCoaster', () => {
  it('accepts a ride on one of the coasters, in one of its seats (or out of it)', () => {
    expect(sanitizeCoaster([0, 12345, 1], 3)).toEqual([0, 12345, 1]);
    expect(sanitizeCoaster([2, 12345, -1], 3)).toEqual([2, 12345, -1]);
  });

  it('rejects anything else', () => {
    for (const d of [[3, 1, 0], [0.5, 1, 0], [0, 0, 0], [0, 1, 2], [0, 1, 0.5], [0, NaN, 0], [0, 1], 'x', null]) expect(sanitizeCoaster(d, 3)).toBeNull();
  });
});

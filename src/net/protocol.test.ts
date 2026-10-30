import { describe, expect, it } from 'vitest';
import { Prey } from '../game/state.ts';
import { accountMsg, sanitizeCat, sanitizeCatch, sanitizeCoaster, sanitizeSeed, sanitizeShake, sanitizeThing, sanitizeVote, sanitizeWorld } from './protocol.ts';
import { Thing, carriedCode } from '../world/thingKinds.ts';

describe('sanitizeCat', () => {
  it('accepts a well-formed state and truncates the integer fields', () => {
    expect(sanitizeCat([10.5, 20.25, 0, 2.7, 1.9, 5.5, 3.1, 4.2, 1.6])).toEqual([10.5, 20.25, 0, 2, 1, 5, 3, 4, 1, 0]);
  });

  it('keeps the stage to the three there are', () => {
    expect(sanitizeCat([0, 0, 0, 0, 0, 0, 0, 0, 7])![8]).toBe(2);
    expect(sanitizeCat([0, 0, 0, 0, 0, 0, 0, 0, -3])![8]).toBe(0);
  });

  it.each([
    ['not an array', { x: 1 }],
    ['too short', [1, 2, 3]],
    ['too long', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]],
    ['a string inside', [1, 2, 3, 4, '5', 6, 7, 8, 0]],
    ['NaN', [1, 2, NaN, 4, 5, 6, 7, 8, 0]],
    ['Infinity', [1, Infinity, 3, 4, 5, 6, 7, 8, 0]],
    ['null', null],
  ])('rejects %s', (_, msg) => {
    expect(sanitizeCat(msg)).toBeNull();
  });
});

describe('what a cat carries', () => {
  it('goes along with its state, if it is something there is', () => {
    const feather = carriedCode({ kind: Thing.Feather, v: 1 });
    expect(sanitizeCat([0, 0, 0, 0, 0, 0, 0, 0, 1, feather])![9]).toBe(feather);
    expect(sanitizeCat([0, 0, 0, 0, 0, 0, 0, 0, 1, 9999])![9]).toBe(0);
  });
});

describe('sanitizeThing', () => {
  const T = 1.79e12;
  it('accepts a taking and a putting down', () => {
    expect(sanitizeThing(['t', 42, T])).toEqual(['t', 42, T]);
    const p = ['p', 42, Thing.Twig, 1, 100, 100, 6, 130, 100, T];
    expect(sanitizeThing(p)).toEqual(p);
  });

  it.each([
    ['an unknown message', ['x', 1, T]],
    ['a bad id', ['t', -1, T]],
    ['a fractional id', ['t', 1.5, T]],
    ['no time', ['t', 1, 0]],
    ['no such kind', ['p', 1, 9, 0, 100, 100, 6, 130, 100, T]],
    ['no such variant', ['p', 1, Thing.Cone, 3, 100, 100, 6, 130, 100, T]],
    ['thrown too far', ['p', 1, Thing.Twig, 0, 100, 100, 6, 400, 100, T]],
    ['off the map', ['p', 1, Thing.Twig, 0, -5, 100, 6, 10, 100, T]],
    ['too high', ['p', 1, Thing.Twig, 0, 100, 100, 9999, 110, 100, T]],
    ['too short', ['p', 1, Thing.Twig, 0, 100]],
  ])('rejects %s', (_, msg) => {
    expect(sanitizeThing(msg)).toBeNull();
  });

  it('passes on what a newcomer is told about things, and rejects a bad account', () => {
    const things = accountMsg({ placed: [{ id: 3, kind: Thing.Leaf, v: 2, x0: 10, y0: 10, z0: 0, x1: 12, y1: 10, gt: T }], taken: [[5, T]] });
    expect(sanitizeWorld({ caught: [], shakes: [], things }, 10)!.things!.placed[0]).toMatchObject({ id: 3, kind: Thing.Leaf, x1: 12 });
    expect(sanitizeWorld({ caught: [], shakes: [], things: { placed: [[1, 2]], taken: [] } }, 10)).toBeNull();
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

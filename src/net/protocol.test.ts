import { describe, expect, it } from 'vitest';
import { Prey } from '../game/state.ts';
import { sanitizeCat, sanitizeCatch } from './protocol.ts';

describe('sanitizeCat', () => {
  it('accepts a well-formed state and truncates the integer fields', () => {
    expect(sanitizeCat([10.5, 20.25, 0, 2.7, 1.9, 5.5, 3.1])).toEqual([10.5, 20.25, 0, 2, 1, 5, 3]);
  });

  it.each([
    ['not an array', { x: 1 }],
    ['too short', [1, 2, 3]],
    ['too long', [1, 2, 3, 4, 5, 6, 7, 8]],
    ['a string inside', [1, 2, 3, 4, '5', 6, 7]],
    ['NaN', [1, 2, NaN, 4, 5, 6, 7]],
    ['Infinity', [1, Infinity, 3, 4, 5, 6, 7]],
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

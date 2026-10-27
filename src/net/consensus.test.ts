import { describe, expect, it } from 'vitest';
import { Consensus, VOTE_MS } from './consensus.ts';

const garden = (...peers: string[]) => {
  const c = new Consensus('me');
  for (const p of peers) c.join(p);
  return c;
};

describe('catch votes', () => {
  it('settles as soon as every witness has voted', () => {
    const c = garden('cat', 'w1', 'w2');
    c.claim('cat', 1, 7, true, 3, 0);
    c.vote('w1', 'cat', 1, 7, true, 10);
    expect(c.settle(20)).toEqual([]);
    c.vote('w2', 'cat', 1, 7, false, 20);
    expect(c.settle(30)).toEqual([{ catcher: 'cat', kind: 1, id: 7, ok: true, points: 3 }]);
  });

  it('needs a strict majority', () => {
    const c = garden('cat', 'w1');
    c.claim('cat', 1, 7, false, 3, 0);
    c.vote('w1', 'cat', 1, 7, true, 0);
    expect(c.settle(1)[0].ok).toBe(false);
  });

  it('never lets the catcher vote for itself', () => {
    const c = garden('cat');
    c.claim('cat', 1, 7, false, 3, 0);
    c.vote('cat', 'cat', 1, 7, true, 0);
    expect(c.settle(1)[0].ok).toBe(false);
  });

  it('goes with the votes in once time is up', () => {
    const c = garden('cat', 'w1', 'w2');
    c.claim('cat', 1, 7, true, 3, 0);
    expect(c.settle(VOTE_MS - 1)).toEqual([]);
    expect(c.settle(VOTE_MS)[0].ok).toBe(true);
  });

  it('counts votes that overtook the claim', () => {
    const c = garden('cat', 'w1');
    c.vote('w1', 'cat', 1, 7, true, 0);
    c.claim('cat', 1, 7, true, 3, 5);
    expect(c.settle(6)[0].ok).toBe(true);
  });

  it('decides nothing when nobody could look', () => {
    const c = garden('cat');
    c.claim('cat', 1, 7, null, 0, 0);
    expect(c.settle(VOTE_MS)[0].ok).toBeNull();
  });

  it('forgets votes on claims that never came', () => {
    const c = garden('cat', 'w1');
    c.vote('w1', 'cat', 1, 7, true, 0);
    expect(c.settle(3 * VOTE_MS)).toEqual([]);
    c.claim('cat', 1, 7, false, 0, 3 * VOTE_MS);
    // (w1's early vote is gone: the new claim waits for it, then goes with ours)
    expect(c.settle(3 * VOTE_MS + 1)).toEqual([]);
    expect(c.settle(4 * VOTE_MS)[0].ok).toBe(false);
  });
});

describe('accusations', () => {
  it('ignore a cat once most witnesses accuse it', () => {
    const c = garden('cheat', 'w1', 'w2');
    expect(c.accuse('me', 'cheat', true)).toBe(false);
    expect(c.accuse('w1', 'cheat', true)).toBe(true);
    expect(c.ignored('cheat')).toBe(true);
  });

  it('need a strict majority, and can be taken back', () => {
    const c = garden('cheat', 'w1', 'w2', 'w3');
    c.accuse('me', 'cheat', true);
    c.accuse('w1', 'cheat', true);
    c.accuse('w1', 'cheat', false);
    expect(c.accuse('w2', 'cheat', true)).toBe(false);
    expect(c.ignored('cheat')).toBe(false);
  });

  it('don’t let a cat accuse itself, or the ignored accuse anyone', () => {
    const c = garden('cheat', 'w1');
    c.accuse('me', 'cheat', true);
    c.accuse('w1', 'cheat', true);
    expect(c.ignored('cheat')).toBe(true);
    expect(c.accuse('cheat', 'w1', true)).toBe(false);
    expect(c.accuse('w1', 'w1', true)).toBe(false);
  });

  it('with just one other cat, our own judgement decides', () => {
    const c = garden('cheat');
    expect(c.accuse('me', 'cheat', true)).toBe(true);
  });

  it('can’t be carried by cats that aren’t here', () => {
    const c = garden('cheat', 'w1', 'w2');
    c.accuse('ghost1', 'cheat', true);
    c.accuse('ghost2', 'cheat', true);
    expect(c.ignored('cheat')).toBe(false);
  });

  it('ignores a cheater’s votes on catches', () => {
    const c = garden('cat', 'cheat');
    c.accuse('me', 'cheat', true);
    c.claim('cat', 1, 7, false, 3, 0);
    c.vote('cheat', 'cat', 1, 7, true, 0);
    expect(c.settle(1)[0].ok).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { Referee } from './Referee.ts';
import { Act, Prey, type CatMsg } from './state.ts';
import { VOTE_MS } from '../net/consensus.ts';
import type { VoteMsg } from '../net/protocol.ts';
import { groundAt, spawnPoints } from '../world/map.ts';

function setup(seen = true) {
  const votes: VoteMsg[] = [];
  const confirmed: [string, number][] = [];
  const ignored: string[] = [];
  const ref = new Referee('me', {
    vote: (m) => votes.push(m),
    judgeCatch: () => (seen ? { ok: true, points: 3 } : { ok: false, points: 3 }),
    confirmed: (p, n) => confirmed.push([p, n]),
    ignore: (p) => ignored.push(p),
  });
  return { ref, votes, confirmed, ignored };
}

const [sx, sy] = spawnPoints()[0];
const at = (x: number, y: number, act: number = Act.Idle): CatMsg => [x, y, groundAt(x, y), 0, act, 0, 0, 0];

describe('the referee', () => {
  it('confirms a catch it saw, votes for it, and credits the points', () => {
    const { ref, votes, confirmed } = setup();
    ref.join('cat');
    expect(ref.claim('cat', Prey.Fish, 1, 0)).toBe(true);
    expect(votes).toEqual([['c', 'cat', Prey.Fish, 1, true]]);
    ref.update(1);
    expect(confirmed).toEqual([['cat', 3]]);
  });

  it('votes against a catch it didn’t see, and doesn’t show it', () => {
    const { ref, votes, confirmed } = setup(false);
    ref.join('cat');
    expect(ref.claim('cat', Prey.Fish, 1, 0)).toBe(false);
    expect(votes[0][4]).toBe(false);
    ref.update(VOTE_MS);
    expect(confirmed).toEqual([]);
  });

  it('goes with the majority even against its own judgement', () => {
    const { ref, confirmed } = setup(false);
    for (const p of ['cat', 'w1', 'w2']) ref.join(p);
    ref.claim('cat', Prey.Fish, 1, 0);
    ref.receiveVote('w1', ['c', 'cat', Prey.Fish, 1, true], 1);
    ref.receiveVote('w2', ['c', 'cat', Prey.Fish, 1, true], 2);
    ref.update(3);
    expect(confirmed).toEqual([['cat', 3]]);
  });

  it('doesn’t believe catches in quick succession', () => {
    const { ref, votes } = setup();
    ref.join('cat');
    ref.claim('cat', Prey.Fly, 1, 0);
    ref.claim('cat', Prey.Fly, 2, 100);
    expect(votes.map((v) => v[4])).toEqual([true, false]);
  });

  it('accuses a cat that keeps teleporting, and ignores it with only us to decide', () => {
    const { ref, votes, ignored } = setup();
    ref.join('cheat');
    const far = spawnPoints().find(([x, y]) => Math.hypot(x - sx, y - sy) > 120)!;
    let t = 0;
    for (let i = 0; i < 4 && !ignored.length; i++) {
      ref.observe('cheat', at(sx, sy), (t += 100));
      ref.observe('cheat', at(far[0], far[1]), (t += 100));
    }
    expect(votes).toContainEqual(['a', 'cheat', true]);
    expect(ignored).toEqual(['cheat']);
    expect(ref.observe('cheat', at(sx, sy), t + 100)).toBe(false);
    expect(ref.claim('cheat', Prey.Fish, 9, t + 200)).toBe(false);
  });

  it('follows the others’ accusations', () => {
    const { ref, ignored } = setup();
    for (const p of ['cheat', 'w1', 'w2']) ref.join(p);
    ref.receiveVote('w1', ['a', 'cheat', true], 0);
    expect(ignored).toEqual([]);
    ref.receiveVote('w2', ['a', 'cheat', true], 0);
    expect(ignored).toEqual(['cheat']);
  });

  it('takes no notice of accusations against us', () => {
    const { ref, ignored } = setup();
    ref.join('w1');
    ref.receiveVote('w1', ['a', 'me', true], 0);
    expect(ignored).toEqual([]);
  });

  it('abstains when it wasn’t watching', () => {
    const votes: VoteMsg[] = [];
    const ref = new Referee('me', { vote: (m) => votes.push(m), judgeCatch: () => null, confirmed: () => {}, ignore: () => {} });
    ref.join('cat');
    expect(ref.claim('cat', Prey.Fish, 1, 0)).toBe(true);
    expect(votes).toEqual([]);
  });
});

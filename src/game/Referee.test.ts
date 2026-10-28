import { describe, expect, it } from 'vitest';
import { Referee } from './Referee.ts';
import { Act, Prey, type CatMsg } from './state.ts';
import { VOTE_MS } from '../net/consensus.ts';
import type { VoteMsg } from '../net/protocol.ts';
import { groundAt, spawnPoints } from '../world/map.ts';

function setup(seen = true) {
  const votes: VoteMsg[] = [];
  const refused: [string, number, number][] = [];
  const ignored: string[] = [];
  const ref = new Referee('me', {
    vote: (m) => votes.push(m),
    judgeCatch: () => (seen ? { ok: true, points: 3 } : { ok: false, points: 3 }),
    refused: (p, k, i) => refused.push([p, k, i]),
    ignore: (p) => ignored.push(p),
  });
  return { ref, votes, refused, ignored };
}

const [sx, sy] = spawnPoints()[0];
const at = (x: number, y: number, act: number = Act.Idle): CatMsg => [x, y, groundAt(x, y), 0, act, 0, 0, 0, 2];

describe('the referee', () => {
  it('confirms a catch it saw, and votes for it', () => {
    const { ref, votes, refused } = setup();
    ref.join('cat');
    expect(ref.claim('cat', Prey.Fish, 1, 0)).toBe(true);
    expect(votes).toEqual([['c', 'cat', Prey.Fish, 1, true]]);
    ref.update(1);
    expect(refused).toEqual([]);
  });

  it('votes against a catch it didn’t see, doesn’t show it, and turns it down', () => {
    const { ref, votes, refused } = setup(false);
    ref.join('cat');
    expect(ref.claim('cat', Prey.Fish, 1, 0)).toBe(false);
    expect(votes[0][4]).toBe(false);
    ref.update(VOTE_MS);
    expect(refused).toEqual([['cat', Prey.Fish, 1]]);
  });

  it('goes with the majority even against its own judgement', () => {
    const { ref, refused } = setup(false);
    for (const p of ['cat', 'w1', 'w2']) ref.join(p);
    ref.claim('cat', Prey.Fish, 1, 0);
    ref.receiveVote('w1', ['c', 'cat', Prey.Fish, 1, true], 1);
    ref.receiveVote('w2', ['c', 'cat', Prey.Fish, 1, true], 2);
    ref.update(3);
    expect(refused).toEqual([]);
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
    const ref = new Referee('me', { vote: (m) => votes.push(m), judgeCatch: () => null, refused: () => {}, ignore: () => {} });
    ref.join('cat');
    expect(ref.claim('cat', Prey.Fish, 1, 0)).toBe(true);
    expect(votes).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { Act } from '../game/state.ts';
import { DASH_MS, DASH_SPEED, JUMP_HEIGHT, WALK_SPEED } from '../game/movement.ts';
import { MAP_H, MAP_W, TILE, WALL, groundAt, heightUnder, spawnPoints } from '../world/map.ts';
import { MoveWitness, STRIKES_TO_ACCUSE, STRIKE_MEMORY_MS, Strikes, WINDOW_MS } from './witness.ts';

/** The longest straight run of open ground along a row: [x0, x1, y]. */
const TRACK = (() => {
  let best: [number, number, number] = [0, 0, 0];
  for (let ty = 1; ty < MAP_H - 1; ty++) {
    const y = ty * TILE + 10;
    let start = -1;
    for (let x = 8; x < MAP_W * TILE - 8; x += 2) {
      const open = heightUnder(x - 5, y - 5, x + 5, y) < WALL;
      if (open && start < 0) start = x;
      if ((!open || x + 2 >= MAP_W * TILE - 8) && start >= 0) {
        if (x - start > best[1] - best[0]) best = [start, x - 2, y];
        start = -1;
      }
    }
  }
  return best;
})();
const track = () => ({ x: TRACK[0], y: TRACK[2] });

/** Feed a witness a run at `speed` px/s to and fro along the track, messages every `every` ms; collect strikes. */
function run(w: MoveWitness, speed: number, ms: number, every = 100) {
  const [x0, x1, y] = TRACK, len = x1 - x0;
  const strikes: string[] = [];
  for (let t = 0; t <= ms; t += every) {
    const lap = ((speed * t) / 1000) % (2 * len);
    const x = x0 + (lap < len ? lap : 2 * len - lap);
    const s = w.observe(x, y, groundAt(x, y), Act.Walk, t);
    if (s) strikes.push(s);
  }
  return strikes;
}

describe('the move witness', () => {
  it('has a long enough track to test on', () => {
    expect(TRACK[1] - TRACK[0]).toBeGreaterThan(150);
  });

  it('lets a cat walk as the rules allow', () => {
    const w = new MoveWitness();
    expect(run(w, WALK_SPEED, 30000)).toEqual([]);
  });

  it('takes messages bunched up by the network in its stride', () => {
    const w = new MoveWitness();
    const { x, y } = track();
    const z = groundAt(x, y);
    w.observe(x, y, z, Act.Walk, 0);
    // 300 ms of dashing arrives all at once
    expect(w.observe(x + 0.3 * DASH_SPEED * 0.5, y, z, Act.Walk, 5)).toBeNull();
    expect(w.observe(x + 0.3 * DASH_SPEED, y, z, Act.Walk, 10)).toBeNull();
  });

  it('strikes a cat that teleports', () => {
    const w = new MoveWitness();
    const [[x, y], [x2, y2]] = spawnPoints().filter(([a, b], i, all) => i === 0 || Math.hypot(a - all[0][0], b - all[0][1]) > 120);
    w.observe(x, y, groundAt(x, y), Act.Idle, 0);
    expect(w.observe(x2, y2, groundAt(x2, y2), Act.Idle, 100)).toBe('too-fast');
  });

  it('strikes a cat that runs faster than a dash', () => {
    expect(run(new MoveWitness(), DASH_SPEED * 2, 2000)).toContain('too-fast');
  });

  it('allows one full dash, but not dashing all the time', () => {
    const w = new MoveWitness();
    expect(run(w, DASH_SPEED, DASH_MS)).toEqual([]);
    expect(run(new MoveWitness(), DASH_SPEED, WINDOW_MS)).toContain('too-far');
  });

  it('strikes a cat standing in the fence', () => {
    expect(new MoveWitness().observe(TILE * 0.5, TILE * 5 + 8, 0, Act.Idle, 0)).toBe('in-wall');
  });

  it('strikes a cat jumping higher than a jump, or hovering', () => {
    const { x, y } = track();
    const g = groundAt(x, y);
    expect(new MoveWitness().observe(x, y, g + JUMP_HEIGHT, Act.Jump, 0)).toBeNull();
    expect(new MoveWitness().observe(x, y, g + JUMP_HEIGHT + 10, Act.Jump, 0)).toBe('too-high');
    expect(new MoveWitness().observe(x, y, g + 10, Act.Idle, 0)).toBe('floating');
  });
});

describe('strikes', () => {
  it('accuse after a few, and are forgotten in time', () => {
    const s = new Strikes();
    for (let i = 0; i < STRIKES_TO_ACCUSE; i++) s.add('peer', i * 1000);
    expect(s.accused('peer', STRIKES_TO_ACCUSE * 1000)).toBe(true);
    expect(s.accused('peer', STRIKE_MEMORY_MS + STRIKES_TO_ACCUSE * 1000)).toBe(false);
  });
});

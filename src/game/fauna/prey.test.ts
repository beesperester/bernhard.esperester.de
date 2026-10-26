import { describe, expect, it } from 'vitest';
import { Act, Prey } from '../state.ts';
import { PREY, preyPoints } from './prey.ts';

describe('the prey table', () => {
  it('has an entry for every kind of prey', () => {
    expect(Object.keys(PREY).map(Number).sort()).toEqual(Object.values(Prey).sort());
  });

  it('scores every kind of prey, bigger prey more', () => {
    for (const kind of Object.values(Prey)) expect(typeof preyPoints(kind)).toBe('number');
    expect(preyPoints(Prey.Bee)).toBeLessThan(0);
    expect(preyPoints(Prey.Fly)).toBeLessThan(preyPoints(Prey.Dragonfly));
    expect(preyPoints(Prey.Dragonfly)).toBeLessThan(preyPoints(Prey.Fish));
    expect(preyPoints(Prey.Fish)).toBeLessThan(preyPoints(Prey.Bird));
    expect(preyPoints(Prey.Bird, 3)).toBeGreaterThan(preyPoints(Prey.Bird, 0));
  });

  it('feasts only on what it holds in its mouth', () => {
    for (const info of Object.values(PREY)) expect(info.eat === Act.Feast).toBe(!!info.held);
  });

  it('only lets fish be fished for', () => {
    expect(Object.values(PREY).filter((p) => p.swipeOnly).map((p) => p.name)).toEqual(['fish']);
  });
});

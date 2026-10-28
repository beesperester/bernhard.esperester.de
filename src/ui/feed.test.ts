import { describe, expect, it } from 'vitest';
import { Prey } from '../game/state.ts';
import { Food } from '../world/food.ts';
import { snackLine, snackName } from './feed.ts';

describe('the snack log', () => {
  it('names what was eaten', () => {
    expect(snackName(Prey.Bird, 3)).toBe('a blackbird');
    expect(snackName(Prey.Find, Food.Currywurst)).toBe('a currywurst');
    // (a catch seen from afar: which one isn't known)
    expect(snackName(Prey.Find, -1)).toBe('something tasty');
    expect(snackName(Prey.Bird, -1)).toBe('a bird');
  });

  it('says it with the cat in it, every way it knows', () => {
    for (const kind of Object.values(Prey))
      for (let pick = 0; pick < 1; pick += 0.05) {
        const line = snackLine(kind, 0, pick);
        expect(line.split('{cat}')).toHaveLength(2);
        expect(line).not.toContain('{food}');
      }
    expect(snackLine(Prey.Find, Food.Sausage, 0)).toBe('{cat} found a sausage and ate it all');
  });
});

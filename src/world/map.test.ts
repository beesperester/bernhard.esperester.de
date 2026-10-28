import { afterEach, describe, expect, it, vi } from 'vitest';
import { GRAVITY, JUMP_V } from '../game/state.ts';
import { STEP_UP, step } from '../game/movement.ts';
import { STAGE_JUMP, Stage } from '../game/growth.ts';
import { TILE_ART } from '../art/tiles.ts';
import { LEGEND } from './legend.ts';
import * as map from './map.ts';
import {
  FEET, LANTERNS, LEVEL, MAP_H, MAP_W, TILE, WALL,
  groundAt, heightUnder, levelAt, spawnPoints, tileAt, treeTiles,
} from './map.ts';

type Map = typeof map;

/** How high a jump gets: v² / 2g. */
const JUMP_HEIGHT = (JUMP_V * JUMP_V) / (2 * GRAVITY);
const WALKABLE = '.,pfBS';

describe('the map', () => {
  it('is fenced in all round', () => {
    for (let x = 0; x < MAP_W; x++) {
      expect('Fg').toContain(tileAt(x, 0));
      expect('Fg').toContain(tileAt(x, MAP_H - 1));
    }
    for (let y = 0; y < MAP_H; y++) {
      expect(tileAt(0, y)).toBe('F');
      expect(tileAt(MAP_W - 1, y)).toBe('F');
    }
  });

  it('treats everything outside as fence at level 0', () => {
    expect(tileAt(-1, 5)).toBe('F');
    expect(tileAt(MAP_W, 5)).toBe('F');
    expect(levelAt(-1, -1)).toBe(0);
  });

  it('only uses tiles from the legend, and every tile kind has art', () => {
    for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) expect(LEGEND).toHaveProperty([tileAt(x, y)]);
    expect(Object.keys(TILE_ART).sort()).toEqual(Object.keys(LEGEND).sort());
  });

  it('draws wide things (the fountain) across all their tiles', () => {
    for (let y = 0; y < MAP_H; y++)
      for (let x = 0; x < MAP_W; x++) {
        const span = LEGEND[tileAt(x, y)].span ?? 1;
        if (span < 2 || tileAt(x - 1, y) === tileAt(x, y)) continue;
        for (let i = 1; i < span; i++) expect(tileAt(x + i, y)).toBe(tileAt(x, y));
      }
  });

  it('cannot be jumped out of, and cliffs and maze hedges are higher than a jump', () => {
    expect(heightUnder(0, 0, TILE, TILE)).toBe(WALL);
    expect(LEVEL).toBeGreaterThan(JUMP_HEIGHT);
    const maze = findTile('m');
    expect(heightUnder(maze[0] * TILE, maze[1] * TILE, maze[0] * TILE + TILE, maze[1] * TILE + TILE)).toBeGreaterThan(JUMP_HEIGHT);
    expect(LEGEND['#'].height).toBeLessThan(JUMP_HEIGHT);
  });

  it('blocks tree trunks where they meet the ground', () => {
    for (const [tx, ty] of treeTiles()) expect(groundAt(tx * TILE + 8, ty * TILE + 15)).toBe(WALL);
  });

  it('has stairs that climb one level, a pixel at a time', () => {
    const [sx, sy] = findTile('S');
    const base = levelAt(sx, sy) * LEVEL;
    const x = sx * TILE + 8;
    // walking north from below the stairs to the top of them
    let prev = groundAt(x, (sy + 1) * TILE + 6);
    expect(prev).toBe(base);
    for (let y = (sy + 1) * TILE + 5; y >= sy * TILE - 2; y--) {
      const h = groundAt(x, y);
      expect(h).toBeGreaterThanOrEqual(prev);
      expect(h - prev).toBeLessThanOrEqual(3); // the walking step-up
      prev = h;
    }
    expect(prev).toBe(base + LEVEL);
  });

  it('spawns cats on open path at ground level', () => {
    const spawns = spawnPoints();
    expect(spawns.length).toBeGreaterThan(5);
    for (const [x, y] of spawns) expect(groundAt(x, y)).toBe(0);
  });

  // A guard for editing the landscape: every lawn, path, bridge and stair
  // tile must be reachable from the spawn by walking and jumping.
  it('lets a cat reach every walkable tile from the spawn', () => {
    expect(unreachable(map)).toEqual([]);
  });

  it('has straight bridges that cross the water from land to land', () => {
    const seen = new Set<string>();
    for (let y = 0; y < MAP_H; y++)
      for (let x = 0; x < MAP_W; x++) {
        if (tileAt(x, y) !== 'B' || seen.has(`${x},${y}`)) continue;
        // the whole bridge, along whichever way it runs
        // (a bridge one tile long runs whichever way has land at both ends)
        const land = (ch: string) => WALKABLE.includes(ch);
        const across = tileAt(x + 1, y) === 'B' || (tileAt(x, y + 1) !== 'B' && land(tileAt(x - 1, y)) && land(tileAt(x + 1, y)));
        const [dx, dy] = across ? [1, 0] : [0, 1];
        let n = 0;
        while (tileAt(x + dx * n, y + dy * n) === 'B') seen.add(`${x + dx * n},${y + dy * n}`), n++;
        expect(n, `bridge at ${x},${y}`).toBeLessThanOrEqual(5);
        // nothing sticking out sideways, and land at both ends
        for (let i = 0; i < n; i++) {
          expect(tileAt(x + dx * i + dy, y + dy * i + dx), `bridge at ${x},${y}`).not.toBe('B');
          expect(tileAt(x + dx * i - dy, y + dy * i - dx), `bridge at ${x},${y}`).not.toBe('B');
        }
        for (const [ex, ey] of [[x - dx, y - dy], [x + dx * n, y + dy * n]]) expect(WALKABLE, `bridge at ${x},${y}`).toContain(tileAt(ex, ey));
      }
  });

  it('has no specks of water or slivers of land', () => {
    const wet = (x: number, y: number) => '~wlB'.includes(tileAt(x, y));
    for (let y = 2; y < MAP_H - 2; y++)
      for (let x = 2; x < MAP_W - 2; x++) {
        const n = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => wet(x + dx, y + dy)).length;
        if (tileAt(x, y) === 'w') expect(n, `water at ${x},${y}`).toBeGreaterThan(1);
        if (tileAt(x, y) === '.') expect(n, `land at ${x},${y}`).toBeLessThan(3);
      }
  });
});

describe('every garden', { timeout: 20000 }, () => {
  afterEach(() => vi.resetModules());

  /** The map of the garden that grows from `seed`. */
  const grow = async (seed: number): Promise<Map> => {
    vi.resetModules();
    (await import('./seed.ts')).plant({ seed, born: 0 });
    return import('./map.ts');
  };
  const SEEDS = [2, 3, 3668339987, 0xdeadbeef, 123456789, 4000000000, 77];

  it.each(SEEDS)('lets a cat reach every walkable tile (seed %i)', async (seed) => {
    expect(unreachable(await grow(seed))).toEqual([]);
  });

  it.each(SEEDS)('has its furniture on plain lawn (seed %i)', async (seed) => {
    const m = await grow(seed);
    furnitureOnLawn(m);
    expect(m.FURNITURE.length).toBeGreaterThan(20);
    expect(m.treeTiles().length).toBeGreaterThan(100);
  });

  it('is different for a different seed, and the same for the same one', async () => {
    const a = await grow(5), b = await grow(6), c = await grow(5);
    expect(a.treeTiles()).not.toEqual(b.treeTiles());
    expect(a.treeTiles()).toEqual(c.treeTiles());
    expect(a.FURNITURE).toEqual(c.FURNITURE);
  });
});

describe('furniture', () => {
  it('stands on plain lawn, inside the fence, without overlapping', () => furnitureOnLawn(map));

  it('has one of every kind', () => {
    for (const kind of Object.keys(map.FURNITURE_SIZE)) expect(map.FURNITURE.some((f) => f.kind === kind)).toBe(true);
  });

  it('has cardboard boxes a cat (a kitten too) hops into, and sits in hidden', () => {
    const box = map.FURNITURE.find((f) => f.kind === 'box')!;
    const ox = box.tx * TILE, oy = box.ty * TILE;
    // the middle of the inside: just the lawn under the paws, walls all round
    const [x, y] = [ox + 16, oy + 12];
    expect(heightUnder(x + FEET.x0, y + FEET.y0, x + FEET.x1, y + FEET.y1)).toBe(0);
    expect(map.inBox(x, y, 0)).toBe(true);
    expect(map.inBox(x, y, 6)).toBe(false);
    expect(map.inBox(ox + 16, oy + 24, 0)).toBe(false);
    // walking in from the front: the wall's in the way
    const body = { x, y: oy + 24, z: 0, airborne: false };
    step(body, 0, -12);
    expect(body.y).toBeGreaterThan(oy + 15);
    expect(STEP_UP).toBeLessThan(map.BOX_H);
    expect(STAGE_JUMP[Stage.Kitten]).toBeGreaterThan(map.BOX_H);
  });

  it('has spots for critters round the vegetable beds', () => {
    const around = map.aroundFurniture('bed');
    expect(around.length).toBeGreaterThan(0);
    for (const [x, y] of around) {
      expect(map.furnished(Math.floor(x / TILE), Math.floor(y / TILE))).toBe(false);
      expect(map.FURNITURE.some((f) => f.kind === 'bed' && x > (f.tx - 1) * TILE && x < (f.tx + 4) * TILE && y > (f.ty - 1) * TILE && y < (f.ty + 3) * TILE)).toBe(true);
    }
  });

  it('finds the nearest piece of a kind', () => {
    const pump = map.FURNITURE.find((f) => f.kind === 'pump')!;
    expect(map.furnitureNear('pump', pump.tx * TILE + 8, pump.ty * TILE + 20, 6)).toBe(pump);
    expect(map.furnitureNear('pump', pump.tx * TILE + 8, pump.ty * TILE + 40, 6)).toBeNull();
  });
});

function furnitureOnLawn({ FURNITURE, FURNITURE_SIZE, tileAt }: Map): void {
  {
    const taken = new Set<string>();
    for (const f of FURNITURE) {
      const [w, h] = FURNITURE_SIZE[f.kind];
      for (let y = f.ty; y < f.ty + h; y++)
        for (let x = f.tx; x < f.tx + w; x++) {
          expect(`${f.kind} at ${x},${y}: ${tileAt(x, y)}`).toBe(`${f.kind} at ${x},${y}: .`);
          expect(taken.has(`${x},${y}`)).toBe(false);
          taken.add(`${x},${y}`);
        }
    }
  }
}

describe('lanterns', () => {
  it('stand on lawn beside a path, well apart', () => {
    expect(LANTERNS.length).toBeGreaterThan(10);
    for (const [x, y] of LANTERNS) expect(tileAt(Math.floor(x / TILE), Math.floor(y / TILE))).toBe('.');
    for (let i = 0; i < LANTERNS.length; i++)
      for (let j = i + 1; j < LANTERNS.length; j++)
        expect(Math.hypot(LANTERNS[i][0] - LANTERNS[j][0], LANTERNS[i][1] - LANTERNS[j][1])).toBeGreaterThan(4 * TILE);
  });
});

describe('ponds through the year', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
  });

  const load = async (iso: string) => {
    vi.useFakeTimers({ now: new Date(iso), toFake: ['Date'] });
    vi.resetModules();
    return import('./map.ts');
  };

  it('are water in summer: cats get wet, nobody walks on them', async () => {
    const m = await load('2026-07-10T12:00:00+02:00');
    const [tx, ty] = findTile('w');
    const x = tx * TILE + 8, y = ty * TILE + 12;
    expect(m.wetAt(x, y)).toBe(true);
    expect(m.iceAt(x, y)).toBe(false);
  });

  it('freeze over in January: solid, slippery ice', async () => {
    const m = await load('2026-01-15T12:00:00+01:00');
    const [tx, ty] = findTile('w');
    const x = tx * TILE + 8, y = ty * TILE + 12;
    expect(m.wetAt(x, y)).toBe(false);
    expect(m.iceAt(x, y)).toBe(true);
  });

  it('but the streams keep running through the winter', async () => {
    const m = await load('2026-01-15T12:00:00+01:00');
    let stream: [number, number] | null = null;
    for (let ty = 0; ty < MAP_H && !stream; ty++)
      for (let tx = 0; tx < MAP_W && !stream; tx++)
        if (tileAt(tx, ty) === '~' && m.isChannel(tx, ty) && m.isChannel(tx, ty + 1) && m.isChannel(tx, ty - 1)) stream = [tx, ty];
    expect(stream).not.toBeNull();
    const x = stream![0] * TILE + 8, y = stream![1] * TILE + 12;
    expect(m.wetAt(x, y)).toBe(true);
    expect(m.iceAt(x, y)).toBe(false);
  });
});

/** Walkable tiles a cat can't get to from the spawn, walking and jumping. */
function unreachable({ heightUnder, tileAt, levelAt, spawnPoints, furnished }: Map): string[] {
  const height = (tx: number, ty: number) => {
    const h = heightUnder(tx * TILE + 3, ty * TILE + 6, tx * TILE + 13, ty * TILE + 11);
    return tileAt(tx, ty) === 'S' ? levelAt(tx, ty) * LEVEL + LEVEL / 2 : h;
  };
  const standable = (tx: number, ty: number) => WALKABLE.includes(tileAt(tx, ty)) && height(tx, ty) < WALL;
  const [sx, sy] = spawnPoints()[0];
  const start = [Math.floor(sx / TILE), Math.floor(sy / TILE)];
  const seen = new Set([start.join()]);
  const queue = [start];
  while (queue.length) {
    const [x, y] = queue.pop()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (seen.has(`${nx},${ny}`) || !standable(nx, ny)) continue;
      // up by at most a jump; down any distance
      if (height(nx, ny) - height(x, y) > JUMP_HEIGHT) continue;
      seen.add(`${nx},${ny}`);
      queue.push([nx, ny]);
    }
  }
  const out: string[] = [];
  for (let y = 0; y < MAP_H; y++)
    for (let x = 0; x < MAP_W; x++)
      if (standable(x, y) && !furnished(x, y) && !seen.has(`${x},${y}`)) out.push(`${x},${y} '${tileAt(x, y)}'`);
  return out;
}

/** The first tile with this character, in the middle of a run of them where possible. */
function findTile(ch: string): [number, number] {
  for (let y = 1; y < MAP_H - 1; y++)
    for (let x = 1; x < MAP_W - 1; x++)
      if (tileAt(x, y) === ch && tileAt(x - 1, y) === ch && tileAt(x + 1, y) === ch) return [x, y];
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) if (tileAt(x, y) === ch) return [x, y];
  throw new Error(`no '${ch}' on the map`);
}

describe('seeds', () => {
  it('keep the older of two gardens that meet', async () => {
    const { older } = await import('./seed.ts');
    const a = { seed: 9, born: 1000 }, b = { seed: 3, born: 2000 }, c = { seed: 4, born: 1000 };
    expect(older(a, b)).toBe(a);
    expect(older(b, a)).toBe(a);
    expect(older(a, c)).toBe(c);
    expect(older(c, a)).toBe(c);
  });
});

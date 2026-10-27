import { afterEach, describe, expect, it, vi } from 'vitest';
import { GRAVITY, JUMP_V } from '../game/state.ts';
import { TILE_ART } from '../art/tiles.ts';
import { LEGEND } from './legend.ts';
import {
  FURNITURE, FURNITURE_SIZE, LANTERNS, LEVEL, MAP_H, MAP_W, TILE, WALL,
  furnished, groundAt, heightUnder, levelAt, spawnPoints, tileAt, treeTiles,
} from './map.ts';

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
    const hedge = findTile('#');
    expect(heightUnder(hedge[0] * TILE, hedge[1] * TILE, hedge[0] * TILE + TILE, hedge[1] * TILE + TILE)).toBeLessThan(JUMP_HEIGHT);
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
    const unreachable: string[] = [];
    for (let y = 0; y < MAP_H; y++)
      for (let x = 0; x < MAP_W; x++)
        if (standable(x, y) && !furnished(x, y) && !seen.has(`${x},${y}`)) unreachable.push(`${x},${y} '${tileAt(x, y)}'`);
    expect(unreachable).toEqual([]);
  });
});

describe('furniture', () => {
  it('stands on plain lawn, inside the fence, without overlapping', () => {
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
  });
});

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
        if (tileAt(tx, ty) === 'w' && m.isChannel(tx, ty) && m.isChannel(tx, ty + 1) && m.isChannel(tx, ty - 1)) stream = [tx, ty];
    expect(stream).not.toBeNull();
    const x = stream![0] * TILE + 8, y = stream![1] * TILE + 12;
    expect(m.wetAt(x, y)).toBe(true);
    expect(m.iceAt(x, y)).toBe(false);
  });
});

/** The first tile with this character, in the middle of a run of them where possible. */
function findTile(ch: string): [number, number] {
  for (let y = 1; y < MAP_H - 1; y++)
    for (let x = 1; x < MAP_W - 1; x++)
      if (tileAt(x, y) === ch && tileAt(x - 1, y) === ch && tileAt(x + 1, y) === ch) return [x, y];
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) if (tileAt(x, y) === ch) return [x, y];
  throw new Error(`no '${ch}' on the map`);
}

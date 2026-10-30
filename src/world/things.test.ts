import { describe, expect, it } from 'vitest';
import {
  GROUND_MS, KINDS, POND_MS, REFILL_MS, SCATTER, SCATTER_BASE, Thing, ThingStore, VARIANTS,
  flightMs, landingAt, placedAt, plantId, scatteredIn, type Placed,
} from './things.ts';
import { STREAMS, along } from './streams.ts';
import { TILE, tileAt } from './map.ts';
import { isOpenGround, isPond } from './legend.ts';
import { PETALS } from '../art/flora.ts';
import { PETAL_COUNT, carriedCode, carriedOf } from './thingKinds.ts';

const T = 1.79e12;
const put = (over: Partial<Placed> = {}): Placed => ({ id: 7, kind: Thing.Twig, v: 0, x0: 100, y0: 100, z0: 6, x1: 130, y1: 100, gt: T, ...over });

/** Somewhere open ground, and somewhere on a pond (not a stream). */
function find(ok: (tx: number, ty: number) => boolean): [number, number] {
  for (let ty = 0; ty < 200; ty++) for (let tx = 0; tx < 260; tx++) if (ok(tx, ty)) return [tx * TILE + 8, ty * TILE + 8];
  throw new Error('none');
}

describe('things put down', () => {
  it('fly from the mouth to where they land, then lie there for a while', () => {
    const p = put(), land = landingAt(p.x1, p.y1), fly = flightMs(p);
    expect(land.on).toBe('ground');
    const start = placedAt(p, land, T)!, mid = placedAt(p, land, T + fly / 2)!, end = placedAt(p, land, T + fly + 1)!;
    expect(start.how).toBe('flying');
    expect([start.x, start.y, start.z]).toEqual([100, 100, 6]);
    expect(mid.z).toBeGreaterThan(3);
    expect(mid.x).toBeCloseTo(115, 0);
    expect(end).toMatchObject({ how: 'ground', x: 130, y: 100, z: 0 });
    expect(placedAt(p, land, T + fly + GROUND_MS + 1)).toBeNull();
    // (nothing before it's put down)
    expect(placedAt(p, land, T - 1)).toBeNull();
  });

  it('float off down a stream with the current', () => {
    const st = STREAMS.findIndex((s) => !s.river && s.length > 80);
    const a = along(STREAMS[st], 20);
    const p = put({ x1: a.x, y1: a.y, x0: a.x, y0: a.y - 10 }), land = landingAt(a.x, a.y);
    expect(land.on).toBe('stream');
    const fly = flightMs(p), first = placedAt(p, land, T + fly + 100)!, later = placedAt(p, land, T + fly + 3000)!;
    expect(first.how).toBe('afloat');
    // further down it
    const s = (x: number, y: number) => { const l = landingAt(x, y); return l.on === 'stream' ? l.s : -1; };
    expect(s(later.x, later.y)).toBeGreaterThan(s(first.x, first.y) + 20);
    // and gone past its mouth
    expect(placedAt(p, land, T + fly + (STREAMS[st].length / 14 + 10) * 1000)).toBeNull();
  });

  it('bob on a pond, then sink', () => {
    const [x, y] = find((tx, ty) => isPond(tileAt(tx, ty)) && [[1, 0], [0, 1], [1, 1], [-1, 0], [0, -1]].every(([dx, dy]) => isPond(tileAt(tx + dx, ty + dy))) && landingAt(tx * TILE + 8, ty * TILE + 8).on === 'pond');
    const p = put({ x1: x, y1: y, x0: x, y0: y - 8 }), land = landingAt(x, y);
    expect(land.on).toBe('pond');
    expect(placedAt(p, land, T + flightMs(p) + 1000)!.how).toBe('afloat');
    expect(placedAt(p, land, T + flightMs(p) + POND_MS + 1)).toBeNull();
  });
});

describe('the park\'s own things', () => {
  it('lie on open ground, of every kind but flowers, each with its own id, new ones every round', () => {
    for (const s of SCATTER) expect(isOpenGround(tileAt(Math.floor(s.x / TILE), Math.floor(s.y / TILE)))).toBe(true);
    // (an autumn day: leaves down)
    const autumn = Date.UTC(2026, 9, 30, 12);
    const now = SCATTER.map((_, n) => scatteredIn(SCATTER, n, autumn, 1)).filter((x) => x);
    const kinds = new Set(SCATTER.filter((_, n) => scatteredIn(SCATTER, n, autumn, 1)).map((s) => s.kind));
    for (const k of [Thing.Leaf, Thing.Twig, Thing.Cone, Thing.Feather]) expect(kinds.has(k), String(k)).toBe(true);
    expect(new Set(now.map((x) => x!.id)).size).toBe(now.length);
    for (const x of now) expect(x!.id).toBeGreaterThanOrEqual(SCATTER_BASE);
    const later = new Set(SCATTER.map((_, n) => scatteredIn(SCATTER, n, autumn + REFILL_MS, 1)?.id));
    expect(now.some((x) => later.has(x!.id))).toBe(false);
  });

  it('have a variant there is a picture of', () => {
    expect(KINDS).toBe(5);
    for (let n = 0; n < SCATTER.length; n += 7) {
      const x = scatteredIn(SCATTER, n, T, 1);
      if (x) expect(x.v).toBeLessThan(VARIANTS[SCATTER[n].kind]);
    }
  });
});

describe('the store every cat keeps', () => {
  it('takes a park thing away, and shows it where it\'s put down instead', () => {
    const store = new ThingStore(SCATTER, 1);
    const n = SCATTER.findIndex((_, i) => scatteredIn(SCATTER, i, T, 1));
    const s = SCATTER[n], here = scatteredIn(SCATTER, n, T, 1)!;
    expect(store.nearest(s.x, s.y, T)?.id).toBe(here.id);
    store.take(here.id, T);
    expect(store.nearest(s.x, s.y, T)?.id).not.toBe(here.id);
    const p = put({ id: here.id, kind: s.kind, x0: 400, y0: 400, x1: 404, y1: 400, gt: T + 1000 });
    const ground = landingAt(404, 400).on === 'ground';
    store.place(p);
    expect(store.nearest(s.x, s.y, T + 5000)?.id).not.toBe(here.id);
    if (ground) expect(store.nearest(404, 400, T + 5000)?.id).toBe(here.id);
  });

  it('keeps the latest of a take and a putting down, whichever order they come in', () => {
    const [x, y] = find((tx, ty) => isOpenGround(tileAt(tx, ty)));
    const p = put({ id: 99, x0: x, y0: y, x1: x, y1: y, z0: 0 });
    const a = new ThingStore(SCATTER, 1), b = new ThingStore(SCATTER, 1);
    a.place(p); a.take(99, T + 5000);
    b.take(99, T + 5000); b.place(p);
    expect(a.nearest(x, y, T + 6000)).toBeNull();
    expect(b.nearest(x, y, T + 6000)).toBeNull();
    // put down again later: back
    b.place({ ...p, gt: T + 9000 });
    expect(b.nearest(x, y, T + 10000)?.id).toBe(99);
  });

  it('tells a newcomer what it knows, and a picked flower grows back', () => {
    const a = new ThingStore(SCATTER, 1), b = new ThingStore(SCATTER, 1);
    a.take(plantId(12), T);
    a.place(put({ id: 5, gt: T }));
    b.recall(a.account(T + 1000));
    expect(b.picked(12, T + 1000)).toBe(true);
    expect(b.picked(12, T + 11 * 60_000)).toBe(false);
    expect(b.account(T + 1000).placed.map((p) => p.id)).toContain(5);
  });
});

describe('kinds', () => {
  it('have a flower for each of the meadow\'s colours', () => expect(PETAL_COUNT).toBe(PETALS.length));
  it('go into a cat\'s state and back, and nothing else does', () => {
    for (let k = 0; k < KINDS; k++) for (let v = 0; v < VARIANTS[k as 0]; v++) expect(carriedOf(carriedCode({ kind: k as 0, v }))).toEqual({ kind: k, v });
    expect(carriedOf(0)).toBeNull();
    expect(carriedOf(1 + 4 * 64 + 40)).toBeNull();
    expect(carriedOf(1 + 9 * 64)).toBeNull();
    expect(carriedOf(2.5)).toBeNull();
  });
});

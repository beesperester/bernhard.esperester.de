// The time of year in the garden, following the Berlin calendar like the sun
// does: leaves colour and fall in autumn, the trees stand bare through the
// winter, the cherries blossom in April, flowers come and go, and from mid
// December to the end of February the garden lies under snow, the ponds
// frozen. Everything changes gradually over days and weeks, and is a pure
// function of the (shared) garden clock, so every visitor sees the same.
//
// ?date=2027-01-15 shows another day of the year (see sky.ts), and
// ?weather=rain or ?weather=snow makes it pour or snow right now.
import { berlinParts, skyTime } from './sky.ts';
import { hash2 } from '../art/raster.ts';

export interface Season {
  /** Day of the year, 0 = 1 January (fractional). */
  day: number;
  /** How much of the foliage has turned yellow, orange and red (0 green .. 1 all turned). */
  turn: number;
  /** How much foliage the trees carry (1 summer .. 0 bare). */
  leaves: number;
  /** How hard leaves are coming down right now (0..1). */
  falling: number;
  /** Fallen leaves lying on the grass (0..1). */
  litter: number;
  /** Cherry blossom on the cherry trees (0..1), and its petals drifting down. */
  blossom: number;
  petals: number;
  /** White blossom on the apple tree, and red apples on it. */
  appleBlossom: number;
  apples: number;
  /** Wildflowers in bloom (0..1). */
  bloom: number;
  /** Lawns gone a little dull in autumn and late winter (0..1)... */
  drab: number;
  /** ...and the long meadow grass gone to hay (0..1). */
  hay: number;
  /** Snow lying on the ground (0..1). */
  snow: number;
  /** The ponds are frozen over. */
  frozen: boolean;
}

const D = (month: number, date: number) => [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334][month - 1] + date - 1;
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
/** 0 before day a, rising to 1 at day b. */
const ramp = (d: number, a: number, b: number) => clamp01((d - a) / (b - a));
/** A hump from a to b, highest in the middle. */
const hump = (d: number, a: number, b: number) => (d <= a || d >= b ? 0 : Math.sin((Math.PI * (d - a)) / (b - a)));

const days = new Map<number, number>();
/** Day of the year in Berlin for the garden moment `ms` (with fractions of a day, to the minute). */
export function dayOfYear(ms: number): number {
  const minute = Math.floor(skyTime(ms) / 60000);
  let d = days.get(minute);
  if (d === undefined) {
    const p = berlinParts(minute * 60000);
    d = D(+p.month, +p.day) + (+p.hour + +p.minute / 60) / 24;
    days.set(minute, d);
    if (days.size > 256) days.delete(days.keys().next().value!);
  }
  return d;
}

export function seasonAt(ms: number): Season {
  const d = dayOfYear(ms);
  // foliage: buds burst in April, everything is green by early May; turning from late September, gone by late November
  const leaves = d < 200 ? ramp(d, D(4, 5), D(5, 5)) : 1 - ramp(d, D(10, 15), D(11, 25));
  const turn = d < 200 ? 0 : ramp(d, D(9, 20), D(10, 20));
  const snow = d > 200 ? ramp(d, D(12, 15), D(12, 18)) : 1 - ramp(d, D(2, 25), D(3, 1));
  return {
    day: d,
    turn,
    leaves,
    falling: hump(d, D(10, 8), D(12, 2)),
    litter: d > 200 ? ramp(d, D(10, 12), D(11, 5)) * (1 - ramp(d, D(12, 1), D(12, 15))) : 0,
    blossom: ramp(d, D(4, 1), D(4, 12)) * (1 - ramp(d, D(4, 25), D(5, 5))),
    petals: hump(d, D(4, 18), D(5, 8)),
    appleBlossom: ramp(d, D(4, 20), D(4, 28)) * (1 - ramp(d, D(5, 8), D(5, 18))),
    apples: d > 150 ? ramp(d, D(8, 1), D(8, 25)) * (1 - ramp(d, D(10, 15), D(11, 5))) : 0,
    bloom: d < 200 ? ramp(d, D(3, 25), D(5, 1)) : 1 - ramp(d, D(9, 15), D(10, 31)),
    drab: Math.max(turn * 0.25 * (1 - snow), (d > 200 ? ramp(d, D(11, 1), D(11, 30)) : 1 - ramp(d, D(3, 20), D(4, 25))) * 0.5),
    hay: Math.max(turn * 0.75, d > 200 ? ramp(d, D(11, 1), D(11, 30)) : 1 - ramp(d, D(3, 20), D(4, 25))) * 0.9,
    snow,
    frozen: d >= D(12, 20) || d <= D(2, 20),
  };
}

/** The season as the page loaded: the garden's look is built from it. */
export const SEASON = seasonAt(Date.now());

// ---- who is about at this time of year ----

export type Critter = 'butterfly' | 'bee' | 'dragonfly' | 'firefly' | 'frog' | 'bat' | 'beetle';

/** When each kind is out: [from month, day, to month, day], with a fortnight's ramp around either end. */
const SEASONS: Record<Critter, [number, number, number, number]> = {
  butterfly: [4, 10, 9, 30],
  bee: [3, 25, 9, 30],
  dragonfly: [5, 15, 9, 15],
  firefly: [6, 1, 7, 31],
  frog: [3, 25, 9, 30],
  bat: [4, 10, 10, 15],
  beetle: [3, 25, 10, 31],
};

/** How many of a kind are about at garden moment `ms` (0 none .. 1 the full summer crowd). */
export function activity(kind: Critter, ms: number): number {
  const d = dayOfYear(ms);
  const [m0, d0, m1, d1] = SEASONS[kind];
  return ramp(d, D(m0, d0) - 7, D(m0, d0) + 7) * (1 - ramp(d, D(m1, d1) - 7, D(m1, d1) + 7));
}

/** Whether a creature turning up with roll `r` (0..1) at `ms` is in season. */
export const inSeason = (kind: Critter, ms: number, r: number) => r < activity(kind, ms);

// ---- snowfall ----

const FORCE = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('weather') : null;

/** How hard it is snowing at garden moment `ms` (0..1): on and off through the winter, a few hours at a time. */
export function snowfall(ms: number): number {
  if (FORCE) return FORCE === 'snow' ? 1 : 0;
  const s = seasonAt(ms).snow;
  if (s <= 0) return 0;
  const t = skyTime(ms) / 3600000;
  const h = Math.floor(t), f = t - h;
  const at = (k: number) => {
    const v = hash2(k, 77, 1201);
    return v < 0.45 ? 0 : 0.3 + (v - 0.45) * 1.3;
  };
  // smooth from one hour to the next
  const u = f * f * (3 - 2 * f);
  return s * (at(h) + (at(h + 1) - at(h)) * u);
}

// ---- rain ----

/** How hard it is raining at garden moment `ms` (0..1): now and then a shower or a wet afternoon, any time of year it isn't snowy. */
export function rainfall(ms: number): number {
  if (FORCE) return FORCE === 'rain' ? 1 : 0;
  const s = seasonAt(ms).snow;
  if (s >= 0.3) return 0;
  // in half-hour steps, so showers can be short
  const t = skyTime(ms) / 1800000;
  const h = Math.floor(t), f = t - h;
  const at = (k: number) => {
    // a wet spell lasts a few steps: look at the spell this step belongs to
    const spell = Math.floor(k / 3);
    if (hash2(spell, 79, 1801) >= 0.16) return 0;
    return 0.35 + hash2(k, 79, 1802) * 0.65;
  };
  const u = f * f * (3 - 2 * f);
  return (1 - s / 0.3) * (at(h) + (at(h + 1) - at(h)) * u);
}

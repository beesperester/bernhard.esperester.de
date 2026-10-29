// Autumn fog: banks of it lying low over the park, thick at dawn and from
// dusk on into the night, burning off by midday; some days more, some days
// none at all. A pure function of the (shared) garden clock, like the
// season and the weather, so every visitor sees the same. game/Fog.ts draws
// it, gathered over the water and drifting.
//
// ?fog=1 brings it in thick right now (for testing).
import { hash2 } from '../art/raster.ts';
import { seasonAt } from './season.ts';
import { skyTime, sunPosition } from './sky.ts';
import { worldSeed } from './seed.ts';

const smooth = (a: number, b: number, v: number) => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Autumn, by day of the year: in from late September, gone by early December. */
const AUTUMN_IN: [number, number] = [262, 278], AUTUMN_OUT: [number, number] = [328, 342];
/** A day has no fog at all this often... */
const CLEAR_DAYS = 0.25;

const forced = typeof location !== 'undefined' && new URLSearchParams(location.search).get('fog') === '1';

/** How autumnal it is on day of the year `day` (0..1). */
export function autumn(day: number): number {
  return smooth(AUTUMN_IN[0], AUTUMN_IN[1], day) * (1 - smooth(AUTUMN_OUT[0], AUTUMN_OUT[1], day));
}

/** How foggy that day is, from the garden's seed (0, or 0.35..1). */
export function foggyDay(dayIndex: number, seed = worldSeed().seed): number {
  const r = hash2(dayIndex, 71, seed + 2201);
  return r < CLEAR_DAYS ? 0 : 0.35 + 0.65 * ((r - CLEAR_DAYS) / (1 - CLEAR_DAYS));
}

/**
 * How thick the fog lies for the sun at `elevation` (degrees), `morning` before noon:
 * thick before sunrise and on into the morning, thinning to nothing as the sun climbs;
 * coming back as it sinks in the evening, and thick through the night.
 */
export function byDaylight(elevation: number, morning: boolean): number {
  return morning ? 1 - smooth(2, 16, elevation) : 1 - smooth(0, 8, elevation);
}

/** How thick the fog lies at garden time `ms` (0..1). */
export function fogAt(ms: number): number {
  if (forced) return 1;
  const t = skyTime(ms), sun = sunPosition(t);
  return autumn(seasonAt(ms).day) * foggyDay(Math.floor(t / 86400000)) * byDaylight(sun.elevation, sun.azimuth < 180);
}

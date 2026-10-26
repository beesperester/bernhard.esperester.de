// The sky over Berlin, for any moment: where the sun is, how the garden is
// lit, and the phase of the moon. Everything is a pure function of the
// (shared) garden clock, so every visitor sees the same time of day.
//
// For a look at other times: ?time=21:30 shows that Berlin time today, and
// ?speed=600 runs the day 600x faster.

const LAT = 52.52, LON = 13.405;
const RAD = Math.PI / 180;

export type RGB = [number, number, number];

export interface Light {
  /** Sun height above the horizon and compass bearing (0 north, 90 east), degrees. */
  elevation: number;
  azimuth: number;
  /** 0 at night, 1 in daylight; and the reverse, but only fully 1 once it's properly dark. */
  day: number;
  night: number;
  /** How much the scene is multiplied by: warm at sunrise and sunset, deep blue at night. */
  tint: RGB;
  /** Where the sun is on screen, as a unit vector from an object towards the sun. */
  sunDir: [number, number];
  /** Strength (0..1) and colour of the sunlit rims. */
  rim: number;
  rimColour: RGB;
  /** 0 new moon, 0.5 full moon. */
  moonPhase: number;
}

/** Sun position for a UTC time in ms (low-precision solar formulas, good to a fraction of a degree). */
export function sunPosition(ms: number): { elevation: number; azimuth: number } {
  const d = ms / 86400000 + 2440587.5 - 2451545.0; // days since J2000
  const g = (357.529 + 0.98560028 * d) * RAD; // mean anomaly
  const q = 280.459 + 0.98564736 * d; // mean longitude
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD; // ecliptic longitude
  const e = (23.439 - 0.00000036 * d) * RAD; // obliquity
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = 280.46061837 + 360.98564736629 * d; // degrees
  const ha = (gmst + LON) * RAD - ra;
  const lat = LAT * RAD;
  const elevation = Math.asin(Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(ha)) / RAD;
  const azimuth = (Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(lat) - Math.tan(dec) * Math.cos(lat)) / RAD + 180 + 360) % 360;
  return { elevation, azimuth };
}

/** Moon phase 0..1 (0 new, 0.5 full) from the mean synodic month. */
export function moonPhase(ms: number): number {
  const NEW = Date.UTC(2000, 0, 6, 18, 14), SYNODIC = 29.530588853 * 86400000;
  return (((ms - NEW) / SYNODIC) % 1 + 1) % 1;
}

// scene tint by sun elevation (degrees)
const TINT: [number, RGB][] = [
  [-12, [72, 92, 160]],
  [-7, [92, 106, 176]],
  [-3, [168, 140, 178]],
  [0, [240, 170, 150]],
  [4, [255, 206, 170]],
  [10, [255, 234, 210]],
  [22, [255, 255, 255]],
];

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function tintFor(el: number): RGB {
  if (el <= TINT[0][0]) return TINT[0][1];
  for (let i = 1; i < TINT.length; i++)
    if (el <= TINT[i][0]) {
      const [a, ca] = TINT[i - 1], [b, cb] = TINT[i];
      return mix(ca, cb, (el - a) / (b - a));
    }
  return TINT[TINT.length - 1][1];
}

/** How the garden is lit at garden time `ms`. */
export function lightAt(ms: number): Light {
  const t = skyTime(ms);
  const { elevation, azimuth } = sunPosition(t);
  // towards the sun: east is right, north is up the screen (squashed, it's a 3/4 view), and up is up
  const A = azimuth * RAD, h = Math.max(0, elevation) * RAD;
  const east = Math.sin(A) * Math.cos(h), north = Math.cos(A) * Math.cos(h), up = Math.sin(h);
  let sx = east, sy = -north * 0.5 - up;
  const len = Math.hypot(sx, sy) || 1;
  sx /= len;
  sy /= len;
  // low sun: strong golden rims; high sun: fainter, paler ones
  const rim = smoothstep(-1, 3, elevation) * (0.75 - 0.45 * smoothstep(5, 45, elevation));
  return {
    elevation, azimuth,
    day: smoothstep(-4, 4, elevation),
    night: 1 - smoothstep(-10, -3, elevation),
    tint: tintFor(elevation),
    sunDir: [sx, sy],
    rim,
    rimColour: mix([255, 190, 110], [255, 246, 214], smoothstep(4, 30, elevation)),
    moonPhase: moonPhase(t),
  };
}

// ---- looking at other times of day (for testing) ----

const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
const SPEED = Math.max(1, Number(params.get('speed')) || 1);
const TIME = /^(\d{1,2}):(\d{2})$/.exec(params.get('time') ?? '');
const START = Date.now();
/** Shift so that "now" shows the requested Berlin wall-clock time today. */
const SHIFT = TIME ? berlinShift(START, +TIME[1], +TIME[2]) : 0;

/** The moment the sky shows at garden time `ms`. */
export function skyTime(ms: number): number {
  return SPEED === 1 ? ms + SHIFT : START + SHIFT + (ms - START) * SPEED;
}

/** Berlin wall-clock time of day for garden time `ms`, as "HH:MM". */
export function berlinClock(ms: number): string {
  return new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' }).format(skyTime(ms));
}

function berlinShift(now: number, hh: number, mm: number): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hourCycle: 'h23', hour: 'numeric', minute: 'numeric', second: 'numeric' })
      .formatToParts(now).map((p) => [p.type, p.value]),
  );
  const current = (+parts.hour * 3600 + +parts.minute * 60 + +parts.second) * 1000;
  return (hh * 3600 + mm * 60) * 1000 - current;
}

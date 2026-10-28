// A funfair's tiny rollercoaster: one long, flat loop of track in a box of
// tiles (two long straights, a tight turn at either end), a station on its
// near side, a chain lift up the far side, a drop round the tight left turn
// and on down the near side, and a camel hump before the station. Its one car (two
// seats) waits at the station; when a cat gets in, it sets off a moment
// later, goes once round and stops at the station again. Where it is follows
// from when it set off alone (the lap is worked out once, here), so every
// cat sees the same ride from a single number.

/** Tiles the coaster takes up (themes.ts places it). */
export const COASTER_SIZE: [number, number] = [10, 4];

const W = COASTER_SIZE[0] * 16, H = COASTER_SIZE[1] * 16;
/** The turns' radius (tight), their middles, and the two straights (local px from the box's top-left). */
const R = 12, YF = H - 16, YB = YF - 2 * R, XL = 8 + R, XR = W - 8 - R, YM = (YF + YB) / 2;
const STRAIGHT = XR - XL, BEND = Math.PI * R;
/** Once round, along the track (px on the ground). */
export const LOOP = 2 * STRAIGHT + 2 * BEND;
/** Where the car waits: on the near straight, by the platform (px round from the start of it). */
export const STATION = STRAIGHT - 16;
/** How long after a cat gets in the car sets off (ms): time for another to hop in too. */
export const BOARDING_MS = 3000;
/** The car's floor above the deck, where its riders sit (px). */
export const CAR_FLOOR = 2;
/** The two seats, along the car from its middle (px; front first). */
export const SEATS = [4, -4];

/** Where on the ground the track is at `s` (px round, from the start of the near straight), and which way it runs. */
export function trackAt(s: number): { x: number; y: number; dx: number; dy: number } {
  s = ((s % LOOP) + LOOP) % LOOP;
  // the near straight, left to right; the right bend; the far straight, right to left; the left bend
  if (s < STRAIGHT) return { x: XL + s, y: YF, dx: 1, dy: 0 };
  s -= STRAIGHT;
  if (s < BEND) {
    const a = Math.PI / 2 - s / R;
    return { x: XR + R * Math.cos(a), y: YM + R * Math.sin(a), dx: Math.sin(a), dy: -Math.cos(a) };
  }
  s -= BEND;
  if (s < STRAIGHT) return { x: XR - s, y: YB, dx: -1, dy: 0 };
  s -= STRAIGHT;
  const a = -Math.PI / 2 - s / R;
  return { x: XL + R * Math.cos(a), y: YM + R * Math.sin(a), dx: Math.sin(a), dy: -Math.cos(a) };
}

const ease = (u: number) => 0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, Math.min(1, u)));
/** The deck's height at the station, at the lift's foot and top, round the turn at the drop's end; the hump's height, and where it is (px). */
const LOW = 5, START_LIFT = 9, TOP = 42, TURNED = 20, HUMP = 16, HUMP0 = 40, HUMP1 = 72;
/** Where the lift starts and ends. */
const LIFT0 = STRAIGHT + BEND, LIFT1 = LIFT0 + STRAIGHT;
/** Is `s` on the chain lift (the far straight)? */
export const onLift = (s: number): boolean => {
  s = ((s % LOOP) + LOOP) % LOOP;
  return s >= LIFT0 && s < LIFT1;
};
/** Is `s` on the drop and after it (where the car runs on its own, fast)? */
export const falling = (s: number): boolean => {
  s = ((s % LOOP) + LOOP) % LOOP;
  return s >= LIFT1 || s < HUMP1;
};

/** How high the track's deck is at `s` (px above the ground). */
export function deckAt(s: number): number {
  s = ((s % LOOP) + LOOP) % LOOP;
  // (the drop goes on down the near side; then over the hump, and level into the station)
  if (s < HUMP0) return LOW + (TURNED - LOW) * (1 - ease(s / HUMP0));
  if (s < HUMP1) return LOW + (HUMP - LOW) * Math.sin((Math.PI * (s - HUMP0)) / (HUMP1 - HUMP0));
  if (s < STRAIGHT) return LOW;
  if (s < LIFT0) return LOW + (START_LIFT - LOW) * ease((s - STRAIGHT) / BEND);
  if (s < LIFT1) return START_LIFT + (TOP - START_LIFT) * ease((s - LIFT0) / STRAIGHT) ** 0.9;
  return TURNED + (TOP - TURNED) * (1 - ease((s - LIFT1) / BEND));
}

/** The ride, worked out once: when (ms after setting off) the car is how far on (px from the station). */
const RIDE: { t: number; d: number }[] = [];
/** Gravity for the car (px/s²), the pushers' and the chain's speed (px/s), and the brakes (px/s²). */
const G = 150, PUSH = 26, CHAIN = 28, BRAKE = 260;
{
  let t = 0, d = 0, v = 0, crest = -1;
  const dt = 1 / 120;
  RIDE.push({ t, d });
  while (d < LOOP && t < 60) {
    const s = STATION + d;
    const u = ((s % LOOP) + LOOP) % LOOP;
    if (u >= LIFT0 && u < LIFT1) v = CHAIN;
    else if (d < LOOP - STATION && u < LIFT0 && u >= STATION) v = Math.min(PUSH, v + 30 * dt);
    else {
      // over the top: it runs on what the drop gives it (a little lost on the way)
      if (crest < 0) crest = deckAt(s);
      const z = deckAt(s);
      v = Math.sqrt(Math.max(64, CHAIN * CHAIN + 2 * G * (crest - z))) * 0.97;
      // into the station: the brakes, to a stop where it set off from
      const left = LOOP - d;
      v = Math.min(v, Math.sqrt(2 * BRAKE * Math.max(0, left)) + 1);
    }
    d = Math.min(LOOP, d + v * dt);
    t += dt;
    RIDE.push({ t: t * 1000, d });
  }
}
/** How long the ride takes (ms), station to station. */
export const RIDE_MS = RIDE[RIDE.length - 1].t;

/** How far round from its station the car is, `ms` after setting off (0 before, and back at the station after). */
export function rideAt(ms: number): number {
  if (ms <= 0 || ms >= RIDE_MS) return 0;
  let lo = 0, hi = RIDE.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (RIDE[mid].t <= ms) lo = mid;
    else hi = mid;
  }
  const a = RIDE[lo], b = RIDE[hi];
  return a.d + ((b.d - a.d) * (ms - a.t)) / Math.max(1e-6, b.t - a.t);
}

/** The car, `ms` after it set off: where it is on the ground (local px), which way it points, how high its deck is. */
export function carAt(ms: number): { x: number; y: number; dx: number; dy: number; z: number; s: number } {
  const s = STATION + rideAt(ms);
  return { ...trackAt(s), z: deckAt(s), s };
}

/** Points along the track every px (local), with the deck's height: for drawing it and for telling who's on it. */
export const TRACK_POINTS: { x: number; y: number; z: number; dx: number; dy: number; s: number }[] = [];
for (let s = 0; s < LOOP; s += 1) TRACK_POINTS.push({ ...trackAt(s), z: deckAt(s), s });

/**
 * How high a cat at (x, y) (local px), height z, would be sitting in the car if it were somewhere
 * on the track here: the car's floor over the nearest bit of the track, or null if it isn't by the
 * track at about that height (for checking other cats: one in the car is up there).
 */
export function seatHeightNear(x: number, y: number, z: number, reach = 7, slack = 10): number | null {
  let best: number | null = null, bd = reach * reach;
  for (const p of TRACK_POINTS) {
    const d = (p.x - x) ** 2 + (p.y - y) ** 2, h = p.z + CAR_FLOOR;
    if (d <= bd && Math.abs(z - h) <= slack) [best, bd] = [h, d];
  }
  return best;
}

/** The station platform (local px box) and how high it is: the car stops beside it. */
export const PLATFORM = { x0: XL + STATION - 26, x1: XL + STATION + 18, y0: YF + 6, y1: YF + 13, h: LOW };


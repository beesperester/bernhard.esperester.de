// Where the light comes from, as the art sees it: a direction on the screen
// (x right, y down) towards the light, and how strongly it models things (k:
// full contrast in a low sun, flatter at noon and at night). Trees, bushes and
// rocks keep a normal per pixel and are shaded from this, so their lit sides
// follow the sun round the garden through the day.

export interface ScreenLight {
  /** Unit direction on screen towards the light. */
  x: number;
  y: number;
  /** Contrast of the modelling (0 flat .. 1 full). */
  k: number;
}

/** Light from the top left: what the art is drawn with before the sun is known (and in tests). */
export const DEFAULT_LIGHT: ScreenLight = { x: -0.55, y: -0.85, k: 1 };

/** The light the art is shaded with right now (set by game/Lighting.ts as the sun moves). */
export const sunLight: ScreenLight = { ...DEFAULT_LIGHT };

/**
 * The screen light for a sun at `elevation` degrees whose direction on screen
 * is `sunDir`; `day` 0..1 fades to a soft light from above at night. Seen from
 * the south and above, sky overhead shows as "up the screen", so a high sun
 * lights things from the top whichever way it stands.
 */
export function screenLight(sunDir: [number, number], elevation: number, day: number): ScreenLight {
  const e = (Math.max(0, elevation) * Math.PI) / 180;
  const sx = sunDir[0] * Math.cos(e), sy = sunDir[1] * Math.cos(e) - 0.6 * Math.sin(e);
  const len = Math.hypot(sx, sy) || 1;
  const dx = sx / len, dy = sy / len;
  // soft from above at night (moonlight, lamps); blended through dusk
  const nx = dx * day, ny = dy * day - (1 - day);
  const n = Math.hypot(nx, ny) || 1;
  return { x: nx / n, y: ny / n, k: 0.55 + 0.45 * day * Math.min(1, 0.4 + Math.cos(e)) };
}

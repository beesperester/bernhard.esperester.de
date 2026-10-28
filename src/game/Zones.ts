// The themed zones in the scene (world/themes.ts lays them out): for now, the
// music. A zone with a playlist of its own (audio/music.ts) takes over from
// the background music while our cat is in it.

import { music } from '../audio/music.ts';
import type { Pos } from '../audio/sound.ts';
import { TILE, THEMED_ZONES } from '../world/map.ts';
import type { ThemedZone } from '../world/themes.ts';

/** Once in a zone, a cat is still in it until this far out (px): no flicking back and forth at its edge. */
const LEAVE = 2.5 * TILE;

export class Zones {
  /** The zone our cat is in. */
  private here: ThemedZone | null = null;

  /** Which zone our cat (at `p`) is in now: its music plays while it's there. */
  update(p: Pos): void {
    const tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE);
    const stay = this.here && nearest(this.here, p) <= LEAVE ? this.here : null;
    const here = stay ?? THEMED_ZONES.find((z) => z.tiles.some(([x, y]) => x === tx && y === ty)) ?? null;
    if (here === this.here) return;
    this.here = here;
    music.setZone(here?.theme ?? null);
  }
}

/** How far `p` is from the middle of the zone's nearest tile (px). */
function nearest(zone: ThemedZone, p: Pos): number {
  let bd = Infinity;
  for (const [x, y] of zone.tiles) bd = Math.min(bd, Math.hypot((x + 0.5) * TILE - p.x, (y + 0.5) * TILE - p.y));
  return bd;
}

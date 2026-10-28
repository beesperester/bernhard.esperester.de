// The themed zones in the scene (world/themes.ts lays them out): for now the
// carnival's music, heard all over the fairground and fading away with
// distance from its edge.

import { sound, type Playing, type Pos } from '../audio/sound.ts';
import { TILE, THEMED_ZONES } from '../world/map.ts';
import type { Theme, ThemedZone } from '../world/themes.ts';

/** The music each theme plays (a sound group), and how loud. */
const MUSIC: Partial<Record<Theme, { group: string; volume: number }>> = {
  carnival: { group: 'carnival', volume: 0.45 },
};

/** Further than this from a zone (px), its music is stopped. */
const EARSHOT = 300;

interface Music {
  zone: ThemedZone;
  group: string;
  volume: number;
  /** Where it is heard from: the bit of the zone nearest the listener (moved every frame). */
  at: Pos;
  playing: Playing | null;
  starting: boolean;
  nextTry: number;
}

export class Zones {
  private readonly music: Music[] = [];

  constructor() {
    for (const zone of THEMED_ZONES) {
      const m = MUSIC[zone.theme];
      if (m) this.music.push({ zone, ...m, at: { x: 0, y: 0 }, playing: null, starting: false, nextTry: 0 });
    }
  }

  /** Keep each zone's music coming from its nearest edge (from all round, inside it), playing only within earshot. */
  update(listener: Pos): void {
    const now = performance.now();
    for (const m of this.music) {
      const inside = m.zone.tiles.some(([x, y]) => Math.floor(listener.x / TILE) === x && Math.floor(listener.y / TILE) === y);
      const best = inside ? listener : nearestTile(m.zone, listener);
      m.at.x = best.x;
      m.at.y = best.y;
      const near = Math.hypot(best.x - listener.x, best.y - listener.y) < EARSHOT;
      if (near && !m.playing && !m.starting && now >= m.nextTry) {
        // (it may not start: the sound off, the tab hidden, not loaded yet; try again in a moment)
        m.starting = true;
        m.nextTry = now + 2000;
        void sound.play(m.group, { at: m.at, loop: true, volume: m.volume, fade: 2 }).then((p) => {
          m.playing = p;
          m.starting = false;
        });
      } else if (!near && m.playing) {
        m.playing.stop(2);
        m.playing = null;
      }
    }
  }
}

/** The middle of the zone's tile nearest to `p`. */
function nearestTile(zone: ThemedZone, p: Pos): Pos {
  let bx = 0, by = 0, bd = Infinity;
  for (const [x, y] of zone.tiles) {
    const cx = (x + 0.5) * TILE, cy = (y + 0.5) * TILE, d = (cx - p.x) ** 2 + (cy - p.y) ** 2;
    if (d < bd) [bx, by, bd] = [cx, cy, d];
  }
  return { x: bx, y: by };
}

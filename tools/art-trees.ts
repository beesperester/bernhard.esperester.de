// The park's trees as files to paint over: each kind and size of tree's
// template (world/templates.ts) as drawn from code, as art/trees/<kind>-<s|m>.aseprite,
// a frame for each season (tagged summer, autumn, winter, spring; winter without
// its snow, which the game lays on) and these layers:
//
//   back    the leaves behind the trunk
//   mid     the trunk, its branches and stumps (what a cat up the tree sees solid round it)
//   front   the leaves hanging in front (drawn in front of a cat up the tree)
//   guide   where a cat can stand (in the first frame), and a mark at the trunk's foot
//
// The trunk's foot is the bottom middle of the canvas; there's room to paint
// out past the tree on either side and above. A file that's already there is
// left alone (it may be painted): a fresh one goes next to it as *.new.aseprite.
//
//   node tools/art-trees.ts [kinds e.g. cherry pine]
process.env.ART = 'off';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { plant } from '../src/world/seed.ts';
import { placed, writeAseprite } from './aseprite.ts';

plant({ seed: 8919, born: 0 });
const { Raster } = await import('../src/art/raster.ts');
const { templateLayers } = await import('../src/art/trees.ts');
const { seasonAt, SEASON_NAMES } = await import('../src/world/season.ts');
const { TREE_KINDS } = await import('../src/world/templates.ts');
const { SIZE_NAMES } = await import('../src/art/paintedTrees.ts');
const { GUIDE } = await import('../src/art/guide.ts');

const OUT = 'art/trees';
mkdirSync(OUT, { recursive: true });
const only = process.argv.slice(2);

/** Room to paint round the tree: either side and above (px). */
const PAD = 24;
/** A day in each season (summer first), as the game's seasons have it at its fullest: autumn's colours, the blossom in spring. */
const DAYS: Record<(typeof SEASON_NAMES)[number], number> = {
  summer: Date.UTC(2026, 6, 10, 10), autumn: Date.UTC(2026, 9, 20, 10), winter: Date.UTC(2027, 0, 15, 10), spring: Date.UTC(2026, 3, 24, 10),
};

for (const kind of TREE_KINDS) {
  if (only.length && !only.includes(kind)) continue;
  for (let size = 0; size < SIZE_NAMES.length; size++) {
    const drawn = SEASON_NAMES.map((name) => templateLayers(kind, size, { ...seasonAt(DAYS[name]), snow: 0 }));
    const { plan } = drawn[0];
    const W = plan.w + PAD * 2, H = plan.h + PAD, cx = W / 2, row = (z: number) => H - 1 - Math.round(z);
    // the guide: every perch along its top, stumps green, the rest red; a mark at the trunk's foot
    const guide = new Raster(W, H);
    for (const p of plan.perches) {
      const c = p.kind === 'stump' ? GUIDE.stump : GUIDE.perch;
      for (let x = Math.round(p.x0); x < Math.round(p.x1); x++) {
        const z = p.z0 + ((p.z1 - p.z0) * (x - p.x0)) / Math.max(1, p.x1 - p.x0);
        guide.set(cx + x, row(z), [...c]);
      }
    }
    for (let d = -3; d <= 3; d++) { guide.set(cx + d, H - 1, [...GUIDE.foot]); guide.set(cx, H - 1 - Math.abs(d), [...GUIDE.foot]); }
    const layers = (['back', 'mid', 'front'] as const).map((name) => ({
      name, visible: true, data: new Uint8ClampedArray(), frames: drawn.map((d) => placed(d[name], W, H, PAD, PAD)),
    }));
    const tags = SEASON_NAMES.map((name, i) => ({ name, from: i, to: i }));
    const all = [...layers, { name: 'guide', visible: true, data: placed(guide, W, H, 0, 0) }];
    const name = `${kind}-${SIZE_NAMES[size]}`;
    const file = existsSync(`${OUT}/${name}.aseprite`) ? `${OUT}/${name}.new.aseprite` : `${OUT}/${name}.aseprite`;
    writeFileSync(file, writeAseprite(W, H, all, tags));
    console.log(file, `${W}x${H}`);
  }
}

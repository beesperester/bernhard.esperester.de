// The park's trees to paint over: each kind and size of tree's template
// (world/templates.ts) as drawn now, as an .aseprite file with its layers:
//
//   back    the leaves behind the trunk
//   mid     the trunk, its branches and stumps (what a cat up the tree sees solid round it)
//   front   the leaves hanging in front (drawn in front of a cat up the tree)
//   guide   where a cat can stand, and the trunk's foot (never brought into the game)
//
// The trunk's foot is the bottom middle of the canvas; there's room to paint
// out past the tree on either side and above. Painted, tools/trees-in.ts
// brings them into the game. A file that's already there is left alone
// (it may be painted): a fresh one goes next to it as *.new.aseprite.
//
//   node tools/tree-layers.ts [out dir]   (default: masters/sprites/trees)
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { plant } from '../src/world/seed.ts';
import { png } from './png.ts';
import { placed, writeAseprite } from './aseprite.ts';

plant({ seed: 8919, born: 0 });
const { Raster } = await import('../src/art/raster.ts');
const { templateLayers } = await import('../src/art/trees.ts');
const { seasonAt } = await import('../src/world/season.ts');
const { GUIDE } = await import('./guide.ts');

const out = process.argv[2] ?? 'masters/sprites/trees';
mkdirSync(out, { recursive: true });

/** Room to paint round the tree: either side and above (px). */
const PAD = 24;
export const SIZES = ['s', 'm', 'l'];
const SUMMER = seasonAt(Date.UTC(2026, 6, 10, 10));

for (const shape of ['broadleaf', 'pine'] as const)
  for (let size = 0; size < 3; size++) {
    const { plan, back, mid, front } = templateLayers(shape, size, SUMMER);
    const W = plan.w + PAD * 2, H = plan.h + PAD, cx = W / 2, row = (z: number) => H - 1 - Math.round(z);
    // the guide: every perch along its top, stumps green, the rest red; a mark at the trunk's foot
    const guide = new Raster(W, H);
    for (const p of plan.perches) {
      const c = p.kind === 'stump' ? GUIDE.stump : GUIDE.perch;
      for (let x = Math.round(p.x0); x <= Math.round(p.x1); x++) {
        const z = p.z0 + ((p.z1 - p.z0) * (x - p.x0)) / Math.max(1, p.x1 - p.x0);
        guide.set(cx + x, row(z), [...c]);
      }
    }
    for (let d = -3; d <= 3; d++) { guide.set(cx + d, H - 1, [...GUIDE.foot]); guide.set(cx, H - 1 - Math.abs(d), [...GUIDE.foot]); }
    const layers = [
      { name: 'back', r: back }, { name: 'mid', r: mid }, { name: 'front', r: front },
    ].map(({ name, r }) => ({ name, visible: true, data: placed(r, W, H, PAD, PAD) }));
    layers.push({ name: 'guide', visible: true, data: placed(guide, W, H, 0, 0) });
    const name = `${shape}-${SIZES[size]}`;
    const file = existsSync(`${out}/${name}.aseprite`) ? `${out}/${name}.new.aseprite` : `${out}/${name}.aseprite`;
    writeFileSync(file, writeAseprite(W, H, layers));
    // (and the whole of it as a picture, to look at)
    const all = new Raster(W, H);
    for (const r of [back, mid, front]) all.blit(r, PAD, PAD);
    all.blit(guide, 0, 0);
    writeFileSync(`${out}/${name}.png`, png(all, 1));
    console.log(file, `${W}x${H}`);
  }

writeFileSync(`${out}/README.txt`, `The park's trees, to paint over (made by tools/tree-layers.ts).

broadleaf-s/m/l and pine-s/m/l: every tree of that kind and size in the park is this one
(every other one mirrored), once it's painted and brought in.

Layers (keep their names; RGB colour mode):
  back    the leaves behind the trunk
  mid     the trunk, branches and stumps: what a cat up the tree sees solid round it
  front   the leaves hanging in front of a cat up the tree
  guide   where a cat can stand, as you draw it:
            red   (255,0,0)  branches
            green (0,255,0)  stumps up the trunk
          (the white mark at the trunk's foot is only a mark; the first exports' softer red
          and orange still count, and their blue top is a branch). Move the lines, draw new ones, rub some out. A cat
          stands on a line's top edge.

back, mid and front can each be a group of layers instead (groups in groups too): it's brought
in as Aseprite shows it, hidden layers left out. Use the Normal blend mode in them.

The trunk's foot stays at the bottom middle of the canvas: if you make the canvas bigger, do it
evenly on the left and right (and only at the top). Fully see-through pixels are left out;
half see-through ones count as solid where they're at least half covered.

The guide's rules (node tools/trees-in.ts says which line breaks one, at its x,y in Aseprite):
  - a line slopes 35° at most (a bent line is a few straight ones: each of those)
  - something is painted under most of each line, within 4 px (back, mid or front)
  - there's a stump, and the lowest one is out of a kitten's jump but in a young cat's
    (8 to 13 px up its trunk; the plans have it at 11)
  - a cat can climb to the highest line, a jump at a time (13 px up at most)
No guide layer at all: the tree is stood on as planned.

Then: node tools/trees-in.ts   (in the project folder) brings them into the game. It climbs
every painted tree first, and if a cat can't get to the highest line of one, brings
nothing in.
`);

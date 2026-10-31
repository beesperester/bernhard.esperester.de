// The park's trees as files to paint over: each kind and size of tree's
// template (world/templates.ts) as drawn from code, in summer, as
// art/trees/<kind>-<s|m>.aseprite with these layers:
//
//   back    the leaves behind the trunk
//   mid     the trunk, its branches and stumps, all of them (also where leaves hide them: in winter it's all there is)
//   front   the leaves hanging in front (drawn in front of a cat up the tree)
//   normal  which way it faces (hidden; red right, green up, blue towards you), as worked out from its outline
//   guide   where a cat can stand, and a mark at the trunk's foot
//
// and art/trees/seasons.aseprite, the colours the leaves turn in the other
// seasons (art/treeSeasons.ts). The trunk's foot is the bottom middle of the
// canvas; there's room to paint out past the tree on either side and above.
// A file that's already there is left alone (it may be painted): a fresh one
// goes next to it as *.new.aseprite.
//
//   node tools/art-trees.ts [kinds e.g. cherry pine, or seasons]
process.env.ART = 'off';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { plant } from '../src/world/seed.ts';
import { placed, writeAseprite } from './aseprite.ts';
import type { RGB } from '../src/art/raster.ts';

plant({ seed: 8919, born: 0 });
const { Raster } = await import('../src/art/raster.ts');
const { templateLayers, CANOPIES, AUTUMN, NEEDLES } = await import('../src/art/trees.ts');
const { hex } = await import('../src/art/raster.ts');
const { fileNormal, outlineNormal } = await import('../src/art/painted.ts');
const { COLUMN, BLOCK, RAMPS, SW, swatchAt } = await import('../src/art/treeSeasons.ts');
const { seasonAt, SEASON_NAMES } = await import('../src/world/season.ts');
const { TREE_KINDS } = await import('../src/world/templates.ts');
const { SIZE_NAMES } = await import('../src/art/paintedTrees.ts');
const { GUIDE } = await import('../src/art/guide.ts');

const OUT = 'art/trees';
mkdirSync(OUT, { recursive: true });
const only = process.argv.slice(2);

/** Room to paint round the tree: either side and above (px). */
const PAD = 24;
const SUMMER = seasonAt(Date.UTC(2026, 6, 10, 10)), WINTER = { ...seasonAt(Date.UTC(2027, 0, 15, 10)), snow: 0 };
const fresh = (name: string) => (existsSync(`${OUT}/${name}.aseprite`) ? `${OUT}/${name}.new.aseprite` : `${OUT}/${name}.aseprite`);

for (const kind of TREE_KINDS) {
  if (only.length && !only.includes(kind)) continue;
  for (let size = 0; size < SIZE_NAMES.length; size++) {
    const { plan, back, mid, front } = templateLayers(kind, size, SUMMER), bare = templateLayers(kind, size, WINTER).mid;
    // the middle, all of it: where leaves hid the trunk and branches in summer, as they are bare (inside the crown's outline);
    // the leaves at the back that hid them come in front of them
    for (let y = 0; y < mid.h; y++)
      for (let x = 0; x < mid.w; x++) {
        if (mid.isSet(x, y) || !bare.isSet(x, y) || !(back.isSet(x, y) || front.isSet(x, y))) continue;
        const o = (y * mid.w + x) * 4;
        mid.set(x, y, [bare.data[o], bare.data[o + 1], bare.data[o + 2]]);
        if (back.isSet(x, y) && !front.isSet(x, y)) front.set(x, y, [back.data[o], back.data[o + 1], back.data[o + 2]]);
        back.data[o + 3] = 0;
      }
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
    const layers = [{ name: 'back', r: back }, { name: 'mid', r: mid }, { name: 'front', r: front }]
      .map(({ name, r }) => ({ name, visible: true, data: placed(r, W, H, PAD, PAD) }));
    // its normals, as the game works them out from the outline of it all (hidden: a base to paint them over)
    const all = new Raster(plan.w, plan.h);
    for (const r of [back, mid, front]) all.blit(r, 0, 0);
    const solid = (x: number, y: number) => all.isSet(x, y), normal = new Raster(plan.w, plan.h);
    for (let y = 0; y < plan.h; y++) for (let x = 0; x < plan.w; x++) if (solid(x, y)) normal.set(x, y, fileNormal(...outlineNormal(solid, x, y)));
    layers.push({ name: 'normal', visible: false, data: placed(normal, W, H, PAD, PAD) });
    layers.push({ name: 'guide', visible: true, data: placed(guide, W, H, 0, 0) });
    const file = fresh(`${kind}-${SIZE_NAMES[size]}`);
    writeFileSync(file, writeAseprite(W, H, layers, [{ name: 'summer', from: 0, to: 0 }]));
    console.log(file, `${W}x${H}`);
  }
}

// the seasons' colours: for each kind, its summer leaves' ramp, and the ramps they turn to (and the dots sprinkled on them)
if (!only.length || only.includes('seasons')) {
  const ramp = (...c: string[]) => c.map(hex);
  const SPRING = ramp('#f2f8a8', '#bce07a', '#7cbc5e', '#46885e', '#383a5e'), SPRING_COOL = ramp('#e4f6b4', '#9ad47e', '#5aa26c', '#346c68', '#2e2c56');
  const A = AUTUMN;
  /** [kind][season]: up to three ramps, and the dots. */
  const looks: Record<string, Record<string, { ramps: RGB[][]; dots?: RGB[] }>> = {
    broadleaf: { summer: { ramps: [CANOPIES[0].c] }, autumn: { ramps: [A[0], A[1], A[3]] }, spring: { ramps: [SPRING] } },
    beech: { summer: { ramps: [CANOPIES[1].c] }, autumn: { ramps: [A[1], A[2], A[0]] }, spring: { ramps: [SPRING_COOL] } },
    cherry: { summer: { ramps: [CANOPIES[0].c] }, autumn: { ramps: [A[2], A[1], A[3]] }, spring: { ramps: [CANOPIES[2].c], dots: CANOPIES[2].dots } },
    apple: { summer: { ramps: [CANOPIES[3].c] }, autumn: { ramps: [A[0], A[3], A[1]], dots: CANOPIES[3].dots }, spring: { ramps: [CANOPIES[3].c], dots: ramp('#ffffff', '#f8d8e8') } },
    pine: { summer: { ramps: [NEEDLES] } },
  };
  const W = COLUMN * SEASON_NAMES.length, H = BLOCK * TREE_KINDS.length, r = new Raster(W, H);
  TREE_KINDS.forEach((kind, k) => SEASON_NAMES.forEach((season, s) => {
    const l = looks[kind][season];
    if (!l) return;
    [...l.ramps, ...Array(RAMPS - l.ramps.length).fill([]), l.dots ?? []].forEach((cs: RGB[], row) => cs.forEach((c, i) => {
      const [x0, y0] = swatchAt(s, k, row, i);
      for (let y = 0; y < SW; y++) for (let x = 0; x < SW; x++) r.set(x0 + x, y0 + y, c);
    }));
  }));
  const file = fresh('seasons');
  writeFileSync(file, writeAseprite(W, H, [{ name: 'colours', visible: true, data: placed(r, W, H, 0, 0) }]));
  console.log(file, `${W}x${H}`);
}

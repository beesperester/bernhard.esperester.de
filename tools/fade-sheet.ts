// A sheet of the hole round your cat through the trees, to look over before
// it goes into the game: for a few trees, your cat behind each in a few
// places, the hole as it is now (left of each pair) and a puff at a time
// (right); the hole opening, a puff at a time; and your cat up a tree.
//
//   npx tsx tools/fade-sheet.ts [out dir]   (default: preview/)
import { writeFileSync, mkdirSync } from 'node:fs';
import { plant } from '../src/world/seed.ts';
import { png } from './png.ts';
import type { Opening } from '../src/art/fade.ts';
import type { Puffs } from '../src/art/trees.ts';

plant({ seed: Number(process.env.SEED ?? 8919), born: 0 });
const { Raster, hex } = await import('../src/art/raster.ts');
const { buildProp } = await import('../src/art/trees.ts');
const { TREES } = await import('../src/world/trees.ts');
const { treeSizeAt } = await import('../src/world/layout.ts');
const { seasonAt } = await import('../src/world/season.ts');
const { keeps, reachUp } = await import('../src/art/fade.ts');
const { buildCatSheet, framePos, frameIndex, CAT } = await import('../src/art/cat.ts');
type Raster = InstanceType<typeof Raster>;

const out = process.argv[2] ?? 'preview';
mkdirSync(out, { recursive: true });

const R = 80, CAT_MID = 8, PAD = 12;
const GRASS = hex('#7cb85a'), GROUND = hex('#5e9a44'), RULE = hex('#3c6a30');
const summer = seasonAt(Date.UTC(2026, 6, 10, 10));
const cats = buildCatSheet(3);

/** Copy what of src shows through `hole` onto dst at (ox, oy), src's pixels counted from its top left as the world. */
function lay(dst: Raster, src: Raster, ox: number, oy: number, hole: Opening | null, puffs: Puffs | null): void {
  for (let y = 0; y < src.h; y++)
    for (let x = 0; x < src.w; x++) {
      const i = y * src.w + x;
      if (src.data[i * 4 + 3] === 0) continue;
      if (hole && !keeps(hole, x, y, puffs, i)) continue;
      const X = ox + x, Y = oy + y;
      if (X < 0 || Y < 0 || X >= dst.w || Y >= dst.h) continue;
      for (let k = 0; k < 4; k++) dst.data[(Y * dst.w + X) * 4 + k] = src.data[i * 4 + k];
    }
}

/** A sitting cat with its feet at (x, y). */
function cat(dst: Raster, x: number, y: number): void {
  const [sx, sy] = framePos(frameIndex('sitDown'));
  const c = new Raster(CAT, CAT);
  for (let j = 0; j < CAT; j++) for (let i = 0; i < CAT; i++) for (let k = 0; k < 4; k++) c.data[(j * CAT + i) * 4 + k] = cats.data[((sy + j) * cats.w + sx + i) * 4 + k];
  lay(dst, c, Math.round(x - CAT / 2), Math.round(y - CAT + 1), null, null);
}

type Prop = ReturnType<typeof buildProp>;

/** One panel: tree p on the grass with a cat behind it, its feet at (fx, fy) in the tree's picture; the hole `style`. */
function behind(p: Prop, fx: number, fy: number, style: 'now' | 'new', open = 1): Raster {
  const W = p.raster.w + PAD * 2, H = p.raster.h + PAD * 2, s = new Raster(W, H);
  s.rect(0, 0, W, H, GRASS);
  s.rect(0, H - PAD - 2, W, 3, GROUND);
  cat(s, PAD + fx, PAD + fy);
  const r = R * open, hy = fy - CAT_MID;
  const hole: Opening = { x: fx, y: hy, r, up: style === 'new' ? reachUp(hy, r, 0) : r };
  lay(s, p.raster, PAD, PAD, hole, style === 'new' ? p.puffs ?? null : null);
  if (p.front) lay(s, p.front.raster, PAD, PAD, hole, style === 'new' ? p.front.puffs ?? null : null);
  return s;
}

/** Your cat up tree p, on a branch at (fx, fy): the leaves behind left be, the trunk and branches solid, the leaves in front opened wide. */
function up(p: Prop, fx: number, fy: number, style: 'now' | 'new'): Raster {
  const W = p.raster.w + PAD * 2, H = p.raster.h + PAD * 2, s = new Raster(W, H);
  s.rect(0, 0, W, H, GRASS);
  s.rect(0, H - PAD - 2, W, 3, GROUND);
  const hy = fy - CAT_MID, puffs = (q: Puffs | undefined) => (style === 'new' ? q ?? null : null);
  lay(s, p.raster, PAD, PAD, null, null);
  cat(s, PAD + fx, PAD + fy);
  if (p.mid) lay(s, p.mid.raster, PAD, PAD, null, null);
  if (p.front) lay(s, p.front.raster, PAD, PAD, { x: fx, y: hy, r: R, up: R }, puffs(p.front.puffs));
  return s;
}

/** Panels side by side, a rule between pairs. */
function row(panels: Raster[], pair = 2): Raster {
  const W = panels.reduce((a, p) => a + p.w, 0) + (Math.ceil(panels.length / pair) - 1) * 4, H = Math.max(...panels.map((p) => p.h));
  const s = new Raster(W, H);
  s.rect(0, 0, W, H, RULE);
  let x = 0;
  panels.forEach((p, k) => {
    s.blit(p, x, H - p.h);
    x += p.w + ((k + 1) % pair === 0 ? 4 : 0);
  });
  return s;
}

function stack(rows: Raster[]): Raster {
  const W = Math.max(...rows.map((r) => r.w)), H = rows.reduce((a, r) => a + r.h + 4, -4), s = new Raster(W, H);
  s.rect(0, 0, W, H, RULE);
  let y = 0;
  for (const r of rows) {
    s.blit(r, 0, y);
    y += r.h + 4;
  }
  return s;
}

const find = (shape: string, size: number) => TREES.findIndex((t) => t.shape === shape && treeSizeAt(t.tx, t.ty) === size);
const picks = [find('broadleaf', 2), find('broadleaf', 1), find('pine', 2)];
const rows: Raster[] = [];
for (const i of picks) {
  const p = buildProp(i, summer), w = p.raster.w, h = p.raster.h, foot = h - 1, cx = w / 2;
  // behind it: by the trunk, under the middle of the crown, at the crown's edge
  const spots: [number, number][] = [[cx + 4, foot - 14], [cx - w * 0.12, foot - h * 0.45], [cx + w * 0.32, foot - h * 0.3]];
  rows.push(row(spots.flatMap(([x, y]) => [behind(p, x, y, 'now'), behind(p, x, y, 'new')])));
}
writeFileSync(`${out}/fade.png`, png(stack(rows), 2));

// the hole opening (a quarter of the way, half, three quarters, all the way), under the middle of the big tree's crown
{
  const p = buildProp(picks[0], summer), w = p.raster.w, h = p.raster.h;
  writeFileSync(`${out}/fade-opening.png`, png(row([0.25, 0.5, 0.75, 1].map((o) => behind(p, w * 0.38, h - 1 - h * 0.45, 'new', o)), 1), 2));
}

// up a tree: on a branch inside its crown
{
  const panels: Raster[] = [];
  for (const i of picks.slice(0, 2)) {
    const p = buildProp(i, summer), t = TREES[i], perch = t.perches.filter((q) => q.kind === 'branch').sort((a, b) => b.z0 - a.z0)[Math.floor(t.perches.length / 8)] ?? t.perches[0];
    const fx = p.raster.w / 2 + (perch.x0 + perch.x1) / 2, fy = p.raster.h - 1 - (perch.z0 + perch.z1) / 2;
    panels.push(up(p, fx, fy, 'now'), up(p, fx, fy, 'new'));
  }
  writeFileSync(`${out}/fade-climbing.png`, png(row(panels), 2));
}
console.log('ok', out, picks.map((i) => `${TREES[i].shape}/${treeSizeAt(TREES[i].tx, TREES[i].ty)}`).join(' '));

// The garden's trees, drawn from their plans (world/trees.ts) so that every
// perch a cat can stand on shows: broadleaf trees with their branches
// zigzagging up to cushions of leaves, pines in tiers of boughs, bird houses,
// and the big tree with a house in it. Leaves and bark keep a normal per
// pixel, so the trees can be shaded again as the sun moves (game/Lighting.ts).
import { Raster, hex, hash2, mulberry32, type RGB } from './raster.ts';
import { SEASON, type Season } from '../world/season.ts';
import { DEFAULT_LIGHT, type ScreenLight } from './lighting.ts';
import { SNOW, bayer } from './tiles.ts';
import { FORK_Z } from '../world/map.ts';
import { TREES, type Perch, type TreePlan } from '../world/trees.ts';

export interface Prop {
  raster: Raster;
  /** The pixels shaded by the light, and how (relightProp redraws them for another sun). */
  lit?: Map<number, LitPixel>;
  x: number;
  y: number;
  /** y used for depth sorting against cats (their feet). */
  depthY: number;
  /** 0, 1 green trees, 2 cherry, 3 apple, 4 pine. */
  kind: number;
  plan: TreePlan;
}

// [highlight, light, mid, dark, outline]
const CANOPIES: { c: RGB[]; dots?: RGB[] }[] = [
  { c: ['#a6e070', '#72c050', '#4c9c3c', '#307430', '#173f1c'].map(hex) },
  { c: ['#7cc85e', '#52a242', '#378036', '#245c2a', '#10301a'].map(hex) },
  { c: ['#fff0f6', '#f9c0d8', '#ee92b8', '#c86492', '#5c2642'].map(hex), dots: [hex('#ffffff')] },
  { c: ['#a6e070', '#72c050', '#4c9c3c', '#307430', '#173f1c'].map(hex), dots: [hex('#e83838'), hex('#ff6a50')] },
];
/** A pine's needles: darker and bluer than the leaves, the same all year. */
const NEEDLES = ['#86c08a', '#58996a', '#3a7652', '#25543e', '#102c22'].map(hex);
const BARK = ['#b88048', '#86532a', '#5a3417', '#2e1a0a'].map(hex);
/** Autumn foliage: yellow, orange, red and russet, same tone order as the canopies. */
const AUTUMN: RGB[][] = [
  ['#fff2a8', '#f8d450', '#e0a430', '#b07420', '#4a2c10'].map(hex),
  ['#ffdc98', '#f8a444', '#d87028', '#a04818', '#4a2010'].map(hex),
  ['#ffb898', '#ea6444', '#c23a2a', '#862222', '#3e1010'].map(hex),
  ['#e8c890', '#c89458', '#9c6a38', '#6e4626', '#36200e'].map(hex),
];
/** Planks, light to dark. */
const WOOD = ['#e2b47a', '#b98250', '#87582e', '#4e3018'].map(hex);
/** The tree house's thatch. */
const THATCH = ['#f0d690', '#cfa95a', '#9a7536', '#5e4420'].map(hex);
/** The bird houses' paint: blue, red or green. */
const PAINT: RGB[][] = [
  ['#8cc0ec', '#5a8cc4', '#38608e'].map(hex),
  ['#f08c78', '#c85a4c', '#8a3430'].map(hex),
  ['#b4dc8c', '#78ae5a', '#4a7a3a'].map(hex),
];
const HOLE = hex('#1c120c');
/** The tree house's window. */
const PANE = ['#fff2b0', '#e8c060'].map(hex);

/** Leaves further back in the crown: a shade darker. */
const back = (p: RGB[]): RGB[] => [p[1], p[2], p[3], p[3], p[4]];

/**
 * What a pixel needs to be shaded again: a leaf knows its palette, which way
 * its clump curves there (nx, ny) and where the clump sits in the crown (cx,
 * cy), plus fixed noise; bark knows where across the trunk it is.
 */
export type LitPixel =
  | { leaf: true; pal: RGB[]; nx: number; ny: number; cx: number; cy: number; jit: number; speck: number; rim: boolean }
  | { leaf: false; u: number; dark: boolean };

/** A leaf's tone (0 highlight .. 3 dark) in light L. */
function leafTone(p: Extract<LitPixel, { leaf: true }>, L: ScreenLight): number {
  const facing = p.nx * L.x + p.ny * L.y;
  // the soft dark rim of a clump, on its side away from the light
  if (p.rim && facing < 0.15) return 3;
  const l = facing * L.k + (p.cx * L.x + p.cy * L.y) * 0.5 * L.k + p.jit;
  let tone = l > 0.55 ? 0 : l > 0.05 ? 1 : l > -0.45 ? 2 : 3;
  // leaf speckle
  if (p.speck < 0.07 && tone > 0) tone--;
  else if (p.speck > 0.95 && tone < 3) tone++;
  return tone;
}

/** A bark colour in light L: the trunk is round, lit on the side towards the light. */
function barkColour(p: Extract<LitPixel, { leaf: false }>, L: ScreenLight): RGB {
  if (p.dark) return BARK[2];
  const v = (p.u - 0.5) * 2 * L.x * L.k;
  return v > 0.15 ? BARK[0] : v > -0.35 ? BARK[1] : BARK[2];
}

const litColour = (p: LitPixel, L: ScreenLight): RGB => (p.leaf ? p.pal[leafTone(p, L)] : barkColour(p, L));

/** Shade a prop's lit pixels for light L (in place). */
export function relightProp(prop: Prop, L: ScreenLight): void {
  if (!prop.lit) return;
  const w = prop.raster.w;
  for (const [i, p] of prop.lit) prop.raster.set(i % w, Math.floor(i / w), litColour(p, L));
}

type Clump = { x: number; y: number; r: number };

/** A tree being drawn: its picture, lit pixels, and where things are in it. */
class Sketch {
  readonly r: Raster;
  readonly lit = new Map<number, LitPixel>();
  /** Which palette each leafy pixel was painted from, for its outline. */
  readonly painted = new Map<number, RGB[]>();
  readonly W: number;
  readonly H: number;
  /** The trunk's middle. */
  readonly cx: number;
  readonly rnd: () => number;
  /** The crown's middle and size, for shading it as a whole. */
  crown = { x: 0, y: 0, rx: 1, ry: 1 };
  private clumps = 0;
  readonly t: TreePlan;
  readonly season: Season;

  constructor(t: TreePlan, season: Season) {
    this.t = t;
    this.season = season;
    this.W = t.w;
    this.H = t.h;
    this.cx = t.w / 2;
    this.r = new Raster(t.w, t.h);
    this.rnd = mulberry32(t.seed * 977 + t.colour * 13);
  }

  /** The picture's row of the top of something z px above the tree's foot. */
  row(z: number): number {
    return this.H - 1 - z;
  }

  /** The leaves' palette for the next clump: some have fallen, some turned, some are blossom; null if this one is bare. */
  leaves(): RGB[] | null {
    const { t, season } = this;
    const i = this.clumps++;
    if (t.shape === 'pine') return NEEDLES;
    const roll = hash2(i, t.seed, 1301);
    const blossom = t.colour === 2 && roll < season.blossom;
    if (!blossom && roll >= season.leaves) return null;
    if (blossom) return CANOPIES[2].c;
    if (hash2(i, t.seed, 1302) < season.turn) return AUTUMN[Math.floor(hash2(i, t.seed, 1303) * AUTUMN.length)];
    return t.colour === 2 ? CANOPIES[0].c : CANOPIES[t.colour].c;
  }

  /** A shaded leaf pixel. */
  leaf(x: number, y: number, pal: RGB[], nx: number, ny: number, rim: boolean, salt: number): void {
    if (x < 0 || y < 0 || x >= this.W || y >= this.H) return;
    const { crown, t } = this;
    const px: LitPixel = {
      leaf: true, pal, nx, ny, cx: (x - crown.x) / crown.rx, cy: (y - crown.y) / crown.ry,
      jit: (bayer(x, y) - 0.5) * 0.35 + (hash2(x, y, t.seed + salt) - 0.5) * 0.25, speck: hash2(x, y, t.seed * 7 + salt), rim,
    };
    this.lit.set(y * this.W + x, px);
    this.r.set(x, y, litColour(px, DEFAULT_LIGHT));
    this.painted.set(y * this.W + x, pal);
  }

  /** A round clump of leaves; nothing above row `cut` (a cushion's flat top). */
  clump(c: Clump, pal: RGB[], cut = -Infinity): void {
    const salt = this.clumps * 31;
    for (let y = Math.floor(c.y - c.r); y <= c.y + c.r; y++) {
      if (y < cut) continue;
      for (let x = Math.floor(c.x - c.r); x <= c.x + c.r; x++) {
        const dx = x + 0.5 - c.x, dy = y + 0.5 - c.y, d = Math.hypot(dx, dy);
        if (d > c.r) continue;
        // a flat top faces up
        const flat = y === cut ? 0.6 : 0;
        this.leaf(x, y, pal, (dx / c.r) * (1 - flat), (dy / c.r) * (1 - flat) - flat, d > c.r - 1.2, salt);
      }
    }
  }

  /** A bark pixel, round across the trunk (u 0..1 from left to right). */
  bark(x: number, y: number, u: number): void {
    if (u < 0.1 || u >= 0.9) { this.r.set(x, y, BARK[3]); return; }
    const px: LitPixel = { leaf: false, u, dark: hash2(x, Math.floor(y / 3) + (x % 2), this.t.seed) < 0.18 };
    this.lit.set(y * this.W + x, px);
    this.r.set(x, y, litColour(px, DEFAULT_LIGHT));
  }

  /** The trunk from the ground up to height `top`, `half` px wide either side at height z, flaring into roots. */
  trunk(top: number, half: (z: number) => number): void {
    const { cx } = this;
    for (let z = 0; z <= top; z++) {
      const y = this.row(z);
      const flare = Math.max(0, 4 - z);
      const h = half(z) + Math.floor(flare * flare * 0.3);
      for (let x = Math.round(cx - h); x < Math.round(cx + h); x++) {
        if (z === 0) { this.r.set(x, y, BARK[3]); continue; }
        this.bark(x, y, (x + 0.5 - (cx - h)) / (2 * h));
      }
    }
  }

  /** A limb from (x0, y0) to (x1, y1), `th` px thick, its top edge catching the light. */
  limb(x0: number, y0: number, x1: number, y1: number, th: number, taper = 0.4): void {
    const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)));
    for (let i = 0; i <= n; i++) {
      const s = i / Math.max(1, n), x = Math.round(x0 + (x1 - x0) * s), y = Math.round(y0 + (y1 - y0) * s);
      const w = Math.max(1, Math.round(th * (1 - s * taper)));
      for (let k = 0; k < w; k++) this.r.set(x, y + k, w === 1 ? BARK[2] : k === 0 ? BARK[1] : k === w - 1 ? BARK[3] : BARK[2]);
    }
  }

  /** True when the leaves are too thin to hide the bare wood (winter, early spring, late autumn). */
  get bare(): boolean {
    return this.season.leaves <= 0.6 && !(this.t.colour === 2 && this.season.blossom > 0.3);
  }

  /** The crown's bare limbs, forking up and out from the trunk at height z. */
  crownLimbs(z: number, spread: number): void {
    if (!this.bare) return;
    const limb = (x: number, y: number, a: number, len: number, th: number, depth: number) => {
      const x1 = x + Math.cos(a) * len, y1 = y + Math.sin(a) * len * 0.8;
      this.limb(Math.round(x), Math.round(y), Math.round(x1), Math.round(y1), th, 0.3);
      if (depth >= 2) return;
      for (const da of [-0.45 - this.rnd() * 0.3, 0.35 + this.rnd() * 0.3]) limb(x1, y1, a + da, len * (0.6 + this.rnd() * 0.15), Math.max(1, th - 1), depth + 1);
    };
    for (const a of [-2.45, -1.95, -1.2, -0.7]) limb(this.cx, this.row(z), a + (this.rnd() - 0.5) * 0.2, spread * (0.8 + this.rnd() * 0.3), 2, 0);
  }

  /** A few bare twigs from (x, y) reaching out and up, when the leaves are thin enough to show them. */
  twigs(x: number, y: number, side: number): void {
    if (!this.bare) return;
    for (let k = 0; k < 3; k++) {
      const a = -Math.PI / 2 + side * (0.4 + this.rnd() * 0.9), len = 4 + this.rnd() * 5;
      this.limb(x, y, x + Math.cos(a) * len, y + Math.sin(a) * len, 1, 0);
    }
  }

  /** A cushion of leaves along a branch whose top is at height z, from x0 to x1 (trunk-relative). */
  cushion(x0: number, x1: number, z: number, depth: number): void {
    const top = this.row(z);
    const n = Math.max(2, Math.round((x1 - x0) / 6));
    for (let i = 0; i <= n; i++) {
      const pal = this.leaves();
      const r = 4 + this.rnd() * 2.5;
      const x = this.cx + x0 + ((x1 - x0) * i) / n + (this.rnd() - 0.5) * 2;
      // the middle hangs lower than the ends
      const sag = Math.sin((i / n) * Math.PI) * (depth - r);
      if (pal) this.clump({ x, y: top + r - 1 + sag * 0.6, r }, pal, top - (this.rnd() < 0.3 ? 1 : 0));
    }
  }

  /** The dark mass of leaves at the back of the crown. */
  backCrown(x: number, y: number, rx: number, ry: number, count: number): void {
    this.crown = { x, y, rx, ry };
    const ring = Math.round(count * 0.6);
    const clumps: Clump[] = [];
    for (let i = 0; i < ring; i++) {
      const a = (i / ring) * Math.PI * 2 + this.rnd() * 0.3;
      clumps.push({ x: x + Math.cos(a) * rx * 0.8, y: y + Math.sin(a) * ry * 0.8, r: 6 + this.rnd() * 3 });
    }
    for (let i = ring; i < count; i++) {
      const a = this.rnd() * Math.PI * 2, d = Math.sqrt(this.rnd()) * 0.6;
      clumps.push({ x: x + Math.cos(a) * rx * d, y: y + Math.sin(a) * ry * d, r: 6 + this.rnd() * 4 });
    }
    clumps.sort((a, b) => a.y - b.y);
    for (const c of clumps) {
      const pal = this.leaves();
      if (pal) this.clump(c, back(pal));
    }
  }

  /** A bird house hanging on the front of the trunk, its roof at height z. */
  birdhouse(z: number): void {
    const paint = PAINT[Math.floor(hash2(this.t.seed, 3, 1310) * PAINT.length)];
    const cx = this.cx, top = this.row(z);
    // roof: a little gable, flat along the ridge
    for (let dy = 0; dy < 3; dy++)
      for (let x = cx - 5 - dy; x < cx + 5 + dy; x++) this.r.set(x, top + dy, dy === 0 ? WOOD[1] : x < cx ? WOOD[2] : WOOD[3]);
    // box, with its round door and a peg to sit on
    for (let y = top + 3; y < top + 11; y++)
      for (let x = cx - 4; x < cx + 4; x++) this.r.set(x, y, x === cx - 4 ? paint[0] : x === cx + 3 || y === top + 10 ? paint[2] : paint[1]);
    for (const [dx, dy] of [[-1, 5], [0, 5], [-2, 6], [-1, 6], [0, 6], [1, 6], [-1, 7], [0, 7]]) this.r.set(cx + dx, top + dy, HOLE);
    this.r.set(cx - 1, top + 9, WOOD[3]); this.r.set(cx, top + 9, WOOD[3]);
  }

  /** The tree house: a deck at height z (x0..x1) with a thatched hut on it, its roof flat at roofZ. */
  treehouse(x0: number, x1: number, z: number, roofZ: number, roofHalf: number): void {
    const { cx, r } = this;
    const deck = this.row(z);
    // beams from the trunk out under the deck
    this.limb(cx - 4, deck + 12, cx + x0 + 4, deck + 3, 2, 0);
    this.limb(cx + 3, deck + 12, cx + x1 - 5, deck + 3, 2, 0);
    // the deck: planks seen end on along the front
    for (let x = cx + x0 - 1; x <= cx + x1; x++) {
      const seam = (x - cx - x0) % 6 === 0;
      r.set(x, deck, WOOD[0]);
      r.set(x, deck + 1, seam ? WOOD[3] : WOOD[1]);
      r.set(x, deck + 2, seam ? WOOD[3] : WOOD[2]);
      r.set(x, deck + 3, WOOD[3]);
    }
    // a railing post and rail at either end
    for (const px of [cx + x0 - 1, cx + x1 - 1]) {
      for (let y = deck - 6; y < deck; y++) { r.set(px, y, WOOD[2]); r.set(px + 1, y, WOOD[3]); }
      r.set(px, deck - 7, WOOD[1]); r.set(px + 1, deck - 7, WOOD[2]);
    }
    for (let x = cx + x0 - 1; x < cx + x0 + 6; x++) r.set(x, deck - 5, WOOD[1]);
    for (let x = cx + x1 - 6; x <= cx + x1; x++) r.set(x, deck - 5, WOOD[1]);
    // the hut: plank walls up to the eaves
    const wall = 11, eaves = this.row(roofZ - 9);
    for (let y = eaves + 1; y < deck; y++)
      for (let x = cx - wall; x < cx + wall; x++) {
        const edge = x === cx - wall || x === cx + wall - 1;
        r.set(x, y, edge ? WOOD[3] : (x - cx) % 4 === 0 ? WOOD[2] : (y - eaves) % 5 === 0 ? WOOD[2] : WOOD[1]);
      }
    // its door, and a window with a warm light inside
    for (let y = deck - 8; y < deck; y++) for (let x = cx - 2; x < cx + 3; x++) r.set(x, y, y === deck - 8 ? WOOD[3] : HOLE);
    r.set(cx + 1, deck - 4, WOOD[1]);
    for (let y = deck - 9; y < deck - 5; y++)
      for (let x = cx - 9; x < cx - 5; x++) r.set(x, y, x === cx - 9 || y === deck - 9 ? WOOD[3] : (x + y) % 3 === 0 ? PANE[0] : PANE[1]);
    // the thatch: wide at the eaves, flat on top
    const roof = this.row(roofZ);
    for (let y = roof; y <= eaves; y++) {
      const u = (y - roof) / Math.max(1, eaves - roof), half = Math.round(roofHalf + u * 4);
      for (let x = cx - half; x < cx + half; x++) {
        const k = hash2(x, Math.floor(y / 2), 1320);
        r.set(x, y, y === roof ? THATCH[0] : y === eaves ? THATCH[3] : k < 0.2 ? THATCH[2] : x < cx - half + 2 || x >= cx + half - 1 ? THATCH[2] : THATCH[1]);
      }
    }
  }

  /** Outline the leaves' silhouette, then snow and the clean-up of the lit pixels. */
  finish(): Prop {
    const { r, W, H, lit, painted, season, t } = this;
    const leafy = (x: number, y: number) => painted.has(y * W + x) && r.isSet(x, y);
    const edge: [number, number][] = [];
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        if (leafy(x, y) && (!r.isSet(x - 1, y) || !r.isSet(x + 1, y) || !r.isSet(x, y - 1) || !r.isSet(x, y + 1))) edge.push([x, y]);
    for (const [x, y] of edge) {
      const k = (y * W + x) * 4, pal = painted.get(y * W + x)!;
      // (only over leaves still showing: not over a branch or the house drawn on top)
      const c = litColour(lit.get(y * W + x) ?? { leaf: false, u: 0, dark: false }, DEFAULT_LIGHT);
      if (r.data[k] === c[0] && r.data[k + 1] === c[1] && r.data[k + 2] === c[2]) r.set(x, y, pal[4]);
    }
    // snow lying along the tops of the branches, the boughs and the roofs
    if (season.snow > 0)
      for (let x = 0; x < W; x++)
        for (let y = 1; y < H - 4; y++)
          if (r.isSet(x, y) && !r.isSet(x, y - 1) && hash2(x, y, t.seed + 1304) < season.snow * (t.shape === 'pine' ? 1.2 : 1)) {
            r.set(x, y, SNOW[3]);
            if (r.isSet(x, y + 1) && hash2(x, y, t.seed + 1305) < 0.5) r.set(x, y + 1, SNOW[1]);
          }
    // only what is still as it was shaded stays lit (outlines, branches, fruit and snow were painted over it)
    for (const [i, px] of lit) {
      const c = litColour(px, DEFAULT_LIGHT), k = i * 4;
      if (r.data[k] !== c[0] || r.data[k + 1] !== c[1] || r.data[k + 2] !== c[2]) lit.delete(i);
    }
    return {
      raster: r, lit, x: t.x - W / 2, y: t.y - (H - 1) - t.elev, depthY: t.y,
      kind: t.shape === 'pine' ? 4 : t.colour, plan: t,
    };
  }
}

const branchesOf = (t: TreePlan) => t.perches.filter((p) => p.kind === 'branch');

/** The limb out to a branch perch, with twigs at its end. */
function limbTo(s: Sketch, p: Perch, thick: number): void {
  const side = p.x0 < 0 ? -1 : 1;
  const inner = side < 0 ? p.x1 : p.x0, outer = side < 0 ? p.x0 : p.x1;
  const top = s.row(p.z);
  // out of the trunk a little lower, rising to the perch, then along it
  s.limb(s.cx + side * 2, top + 7, s.cx + inner, top, thick, 0.1);
  s.limb(s.cx + inner, top, s.cx + outer, top, thick, 0.5);
  s.twigs(s.cx + outer, top, side);
}

/** Apples or blossom dotted over the leaves. */
function dots(s: Sketch): void {
  const { t, season, r, painted, W } = s;
  const colours = t.colour === 3 ? (season.appleBlossom > 0.3 ? [hex('#ffffff'), hex('#f8d8e8')] : season.apples > 0.3 ? CANOPIES[3].dots : undefined)
    : t.colour === 2 && season.blossom > 0.3 ? CANOPIES[2].dots : undefined;
  if (!colours) return;
  for (let k = 0; k < 36; k++) {
    const x = Math.floor(s.rnd() * W), y = Math.floor(s.rnd() * s.H);
    if (!painted.has(y * W + x - 1) || !painted.has((y + 2) * W + x + 2)) continue;
    const c = colours[k % colours.length];
    r.set(x, y, c); r.set(x + 1, y, c); r.set(x, y + 1, c); r.set(x + 1, y + 1, painted.get(y * W + x)?.[3] ?? c);
  }
}

/** A broadleaf: trunk, branches zigzagging up to cushions of leaves, a crown on top (and maybe a bird house). */
function broadleaf(t: TreePlan, season: Season): Prop {
  const s = new Sketch(t, season);
  const top = t.perches.find((p) => p.kind === 'top')!;
  const branches = branchesOf(t);
  const reach = Math.max(...branches.map((p) => Math.max(-p.x0, p.x1)), 14);
  const yTop = s.row(top.z), yLow = s.row(FORK_Z + 11);
  s.backCrown(s.cx, (yTop + yLow) / 2 + 2, reach * 0.75 + 3, (yLow - yTop) / 2 + 2, 22);
  // the trunk carries on up the middle, thinning, to the crown
  s.trunk(top.z - 2, (z) => (z <= FORK_Z ? 5 : Math.max(2, 4 - (z - FORK_Z) / 18)));
  // the fork: a stub out to either side
  const fork = s.row(FORK_Z);
  s.limb(s.cx - 3, fork + 3, s.cx - 9, fork, 3, 0.3);
  s.limb(s.cx + 2, fork + 3, s.cx + 8, fork, 3, 0.3);
  for (const p of branches) limbTo(s, p, 3);
  s.crownLimbs(top.z - 8, 11);
  for (const p of branches) s.cushion(p.x0 - 3, p.x1 + 3, p.z, 8);
  // the crown: a big cushion on top
  s.cushion(top.x0 - 7, top.x1 + 7, top.z, 12);
  dots(s);
  const house = t.perches.find((p) => p.kind === 'birdhouse');
  if (house) s.birdhouse(house.z);
  return s.finish();
}

/** A pine: a straight trunk with tiers of drooping boughs, narrowing to a spire. */
function pine(t: TreePlan, season: Season): Prop {
  const s = new Sketch(t, season);
  const tiers = t.perches;
  const tip = tiers[tiers.length - 1].z + 9;
  s.crown = { x: s.cx, y: s.row(tip / 2), rx: 22, ry: tip / 2 };
  s.trunk(tip - 2, (z) => Math.max(1, 3.5 - (z / tip) * 2.5));
  const { r } = s;
  // from the top down, so the lower boughs hang over the trunk between them
  for (const p of [...tiers].reverse()) {
    const top = s.row(p.z);
    const mid = s.cx + (p.x0 + p.x1) / 2, half = (p.x1 - p.x0) / 2 + 2;
    const thick = p.kind === 'top' ? 8 : 10;
    s.leaves();
    for (let dy = 0; dy < thick; dy++) {
      // narrow at the top where it meets the trunk, spreading and drooping to the hem
      const w = half * (0.55 + 0.45 * Math.min(1, dy / 3)) + dy * 0.6;
      for (let x = Math.floor(mid - w); x < Math.ceil(mid + w); x++) {
        const u = (x + 0.5 - mid) / w;
        // ragged, drooping ends and a scalloped hem
        if (dy >= thick - 3 && hash2(x, top + dy, t.seed + 1311) < 0.25 + (dy - thick + 3) * 0.25) continue;
        if (Math.abs(u) > 0.85 && dy < 2 && hash2(x, dy, t.seed + 1312) < 0.5) continue;
        s.leaf(x, top + dy, NEEDLES, u * 0.9, (dy / (thick - 1)) * 1.2 - 0.5, dy === thick - 1 || Math.abs(u) > 0.94, p.z);
      }
    }
    // a cone or two hanging under the bough
    if (season.snow < 0.5 && hash2(p.z, t.seed, 1313) < 0.6) {
      const x = Math.round(mid + (hash2(p.z, t.seed, 1314) - 0.5) * half * 1.4);
      r.set(x, top + thick, BARK[1]); r.set(x, top + thick + 1, BARK[2]);
    }
  }
  // the spire above the top tier
  const peak = tiers[tiers.length - 1];
  for (let z = peak.z + 1; z <= tip; z++) {
    const w = Math.max(0.5, ((tip - z) / (tip - peak.z)) * 4);
    const mid = s.cx + (peak.x0 + peak.x1) / 2;
    for (let x = Math.floor(mid - w); x < Math.ceil(mid + w); x++) s.leaf(x, s.row(z), NEEDLES, (x + 0.5 - mid) / (w + 1), -0.4, false, 99);
  }
  return s.finish();
}

/** The big tree with a house in it. */
function treehouse(t: TreePlan, season: Season): Prop {
  const s = new Sketch(t, season);
  const at = (k: string) => t.perches.find((p) => p.kind === k)!;
  const deck = at('deck'), roof = at('roof'), top = at('top');
  const branches = branchesOf(t);
  const yTop = s.row(top.z), yLow = s.row(FORK_Z + 11);
  s.backCrown(s.cx, (yTop + yLow) / 2, 44, (yLow - yTop) / 2 + 4, 34);
  s.trunk(top.z - 2, (z) => (z <= FORK_Z ? 7 : Math.max(3, 6 - (z - FORK_Z) / 14)));
  const fork = s.row(FORK_Z);
  s.limb(s.cx - 4, fork + 3, s.cx - 10, fork, 4, 0.3);
  s.limb(s.cx + 3, fork + 3, s.cx + 9, fork, 4, 0.3);
  for (const p of branches) limbTo(s, p, 4);
  s.crownLimbs(top.z - 6, 13);
  for (const p of branches) if (p.z < deck.z) s.cushion(p.x0 - 3, p.x1 + 3, p.z, 8);
  s.treehouse(deck.x0, deck.x1, deck.z, roof.z, roof.x1);
  for (const p of branches) if (p.z > deck.z) s.cushion(p.x0 - 3, p.x1 + 3, p.z, 8);
  s.cushion(top.x0 - 9, top.x1 + 9, top.z, 12);
  return s.finish();
}

export function buildProps(season: Season = SEASON): Prop[] {
  return TREES.map((t) => (t.shape === 'pine' ? pine(t, season) : t.shape === 'treehouse' ? treehouse(t, season) : broadleaf(t, season)));
}

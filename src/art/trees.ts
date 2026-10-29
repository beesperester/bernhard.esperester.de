// The garden's trees, drawn from their plans (world/trees.ts) so that every
// perch a cat can stand on shows: broadleaf trees with their branches
// forking out to clouds of leaves, pines in tiers of boughs, bird houses,
// and the big tree with a house in it. Leaves and bark keep a normal per
// pixel, so the trees can be shaded again as the sun moves (game/Lighting.ts).
import { Raster, hex, hash2, mulberry32, type RGB } from './raster.ts';
import { SEASON, type Season } from '../world/season.ts';
import { DEFAULT_LIGHT, type ScreenLight } from './lighting.ts';
import { SNOW, bayer } from './tiles.ts';
import { dab, patch, noise } from './paint.ts';
import { puff, PUFF_SHAPES, PUFF_SIZES } from './leaves.ts';
import { TREES, type Blob, type Perch, type TreePlan } from '../world/trees.ts';

export interface Prop {
  /** The tree from the back: the leaves at the back, the trunk and branches, the small leaves along them. */
  raster: Raster;
  /** The pixels shaded by the light, and how (relightProp redraws them for another sun). */
  lit?: LitPixels;
  /** Which puff of leaves each pixel of `raster` belongs to (see Puffs), for opening a hole in the tree a puff at a time. */
  puffs?: Puffs;
  /** The leaves in front of the branches (drawn in front of a cat sitting in the tree), if any. */
  front?: { raster: Raster; lit: LitPixels; puffs: Puffs };
  /** Just the trunk, the branches and what grows on them, out of `raster` (up the tree, they stay solid round a cat). */
  mid?: { raster: Raster; lit: LitPixels };
  x: number;
  y: number;
  /** y used for depth sorting against cats (their feet). */
  depthY: number;
  /** 0, 1 green trees, 2 cherry, 3 apple, 4 pine. */
  kind: number;
  plan: TreePlan;
}

/**
 * Which puff of leaves each pixel of a picture belongs to, 4 bytes a pixel like
 * the picture (so the GPU can have it as a texture): the way to the puff's
 * middle (px, +128 each way), the puff's radius, and 255 where it is a leaf (0
 * elsewhere: bark, a branch, the bird house).
 */
export type Puffs = Uint8ClampedArray;

// [highlight, light, mid, dark, outline]
// (painted, and a little whimsical: the lights a warm lime-yellow, the shadows cool teal, and the
// deepest a plum-violet, the complement of the yellow-greens, so the greens sing against it)
const CANOPIES: { c: RGB[]; dots?: RGB[] }[] = [
  { c: ['#e8f08c', '#a2d066', '#5fa25a', '#367260', '#3a3260'].map(hex) },
  { c: ['#d6ee9c', '#82c270', '#4a9268', '#2c6068', '#2e2a56'].map(hex) },
  { c: ['#fff0ee', '#f6c4d2', '#e494b4', '#b46290', '#4e2440'].map(hex), dots: [hex('#ffffff')] },
  { c: ['#e8f08c', '#a2d066', '#5fa25a', '#367260', '#3a3260'].map(hex), dots: [hex('#e83a4a'), hex('#ff7a5a')] },
];
/** A green tree's clouds of leaves lean warmer or cooler, one from the next: the same tree, more alive. */
const WARMER: RGB[] = ['#f6ee8a', '#bcd462', '#78a850', '#4a7656', '#4a3460'].map(hex);
const COOLER: RGB[] = ['#c8eeb0', '#6cbc84', '#3a8a74', '#285a6c', '#2a2858'].map(hex);
/** The little blossoms some green trees are sprinkled with: pinks and corals, against the green. */
const WHIMSY: RGB[] = ['#ff9ab8', '#ffd2de', '#ff8a6a'].map(hex);
/** A pine's needles: darker and bluer than the leaves, the same all year. */
const NEEDLES = ['#cce88e', '#6cb066', '#3a8066', '#2a5664', '#2a2652'].map(hex);
/** Bark: warm orange-brown in the light, falling away to plum in the shadow. */
const BARK = ['#d8955e', '#a05c46', '#6c3a4c', '#3a2240'].map(hex);
/** Bark ridges catching the full sun, and the deep cracks between them. */
const BARK_SHINE = hex('#ecb87a'), BARK_CRACK = hex('#4c2a44');
/** Moss on the shady side of the bark: a soft yellow-green in the light down to a cool deep green. */
const MOSS = ['#c4d27a', '#8eae58', '#5e844c', '#3c5a48'].map(hex);
/** Autumn foliage: yellow, orange, red and russet, same tone order as the canopies. */
// (their shadows falling to plum and violet, cool against the warm leaves)
const AUTUMN: RGB[][] = [
  ['#fff0a0', '#f2c25a', '#d08a3a', '#9a5440', '#4a2a4a'].map(hex),
  ['#ffd49a', '#f09a54', '#c8623e', '#8a3e48', '#42203e'].map(hex),
  ['#ffb4a0', '#e4605a', '#b03a4c', '#742a4e', '#3a1838'].map(hex),
  ['#eccaa0', '#c49060', '#946048', '#64404c', '#30203a'].map(hex),
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

/** A spruce's needles: fine strokes slanting down and outward from the trunk (-0.4 in a stroke's shadow .. 0.3). */
function needleAt(x: number, y: number, mid: number, seed: number): number {
  const side = x < mid ? 1 : -1, d = x + y * side, k = ((d % 7) + 7) % 7;
  // (each stroke a little longer or shorter: broken up every few rows)
  const on = hash2(Math.floor(d / 7), Math.floor(y / 5), seed + 1350) < 0.7;
  return !on ? 0 : k < 2 ? -0.3 : k === 2 ? 0.25 : 0;
}

/** Leaves further back in the crown: a shade darker. */
const backs = new WeakMap<RGB[], RGB[]>();
const back = (p: RGB[]): RGB[] => {
  let b = backs.get(p);
  if (!b) backs.set(p, (b = [p[1], p[2], p[3], p[3], p[4]]));
  return b;
};

/** A palette leaning part way towards another, tone for tone: a stroke of warmer or cooler light across a crown. */
const leans = new WeakMap<RGB[], RGB[][]>();
function lean(p: RGB[], warm: boolean): RGB[] {
  let l = leans.get(p);
  if (!l) {
    const to = (o: RGB[], k: number) => p.map((c, i): RGB => [0, 1, 2].map((j) => Math.round(c[j] + (o[i][j] - c[j]) * k)) as unknown as RGB);
    leans.set(p, (l = [to(COOLER, 0.5), to(WARMER, 0.5)]));
  }
  return l[warm ? 1 : 0];
}

/** A broad brush stroke of warmer or cooler colour laid across a crown (in crown units, -1..1). */
interface Stroke { x: number; y: number; ux: number; uy: number; len: number; wide: number; soft: number; warm: boolean }

/** Numbers kept for shading are rounded to this, so they pack into 16 bits. */
const Q = 4096;
const fix = (v: number) => Math.max(-32768, Math.min(32767, Math.round(v * Q)));
/** A lit pixel's flags: it is one, a leaf (else bark), on a puff's rim, mossy. */
const SET = 8, LEAF = 1, RIM = 2, MOSSY = 4;
/**
 * While a tree is drawn, a lit pixel is only marked (this alpha), and shaded once at the end: puffs
 * of leaves lie over each other many times. Anything else drawn over it (alpha 255) unmarks it.
 */
const LIT = 254, UNSHADED: RGB = [0, 0, 0];

/**
 * What a pixel needs to be shaded again, packed as 16-bit fixed point at f[o..o+5]: a leaf knows
 * its palette, which way its puff curves there (nx, ny), where it sits in the crown (cx, cy), its
 * texture and speck; bark knows where across the trunk it is (u) and how rough it is there (g).
 */
function shade(fl: number, pal: RGB[] | undefined, f: Int16Array, o: number, L: ScreenLight): RGB {
  if (fl & LEAF) {
    const nx = f[o] / Q, ny = f[o + 1] / Q, speck = f[o + 5] / Q;
    const facing = nx * L.x + ny * L.y;
    // the soft dark rim of a puff, on its side away from the light
    if (fl & RIM && facing < 0.15) return pal![3];
    const l = facing * L.k + ((f[o + 2] / Q) * L.x + (f[o + 3] / Q) * L.y) * 0.8 * L.k + f[o + 4] / Q;
    let tone = l > 0.55 ? 0 : l > 0.05 ? 1 : l > -0.45 ? 2 : 3;
    // leaf speckle (pale dabs where the leaves turn up to the sky)
    if ((speck < 0.07 || (speck < 0.16 && ny < -0.25)) && tone > 0) tone--;
    else if (speck > 0.95 && tone < 3) tone++;
    return pal![tone];
  }
  // bark: round across, and rough: the ridges (g > 0) stand into the light, the furrows (g < 0) sink from it
  const u = f[o] / Q, g = f[o + 1] / Q, v = (u - 0.5) * 2 * L.x * L.k + g;
  if (fl & MOSSY) return MOSS[v > 0.3 ? 0 : v > -0.1 ? 1 : v > -0.5 ? 2 : 3];
  if (g < -0.45) return BARK_CRACK;
  return v > 0.55 ? BARK_SHINE : v > 0.12 ? BARK[0] : v > -0.35 ? BARK[1] : BARK[2];
}

/** The lit pixels of a picture being drawn, one slot for each of its pixels. */
class Lit {
  readonly fl: Uint8Array;
  readonly pi: Uint8Array;
  readonly f: Int16Array;
  readonly pals: RGB[][] = [];

  constructor(n: number) {
    this.fl = new Uint8Array(n);
    this.pi = new Uint8Array(n);
    this.f = new Int16Array(n * 6);
  }

  /** Pal's number among this picture's palettes. */
  palIndex(pal: RGB[]): number {
    let k = this.pals.indexOf(pal);
    if (k < 0) k = this.pals.push(pal) - 1;
    return k;
  }

  leaf(i: number, pal: RGB[], nx: number, ny: number, cx: number, cy: number, jit: number, speck: number, rim: boolean): void {
    const f = this.f, o = i * 6;
    this.fl[i] = SET | LEAF | (rim ? RIM : 0);
    this.pi[i] = this.palIndex(pal);
    f[o] = fix(nx); f[o + 1] = fix(ny); f[o + 2] = fix(cx); f[o + 3] = fix(cy); f[o + 4] = fix(jit); f[o + 5] = fix(speck);
  }

  bark(i: number, u: number, g: number, moss: boolean): void {
    const f = this.f, o = i * 6;
    this.fl[i] = SET | (moss ? MOSSY : 0);
    f[o] = fix(u); f[o + 1] = fix(g);
  }

  /** The palette of the leaf at pixel i (null: no leaf there). */
  palette(i: number): RGB[] | null {
    return this.fl[i] & LEAF ? this.pals[this.pi[i]] : null;
  }

  colour(i: number, L: ScreenLight): RGB {
    return shade(this.fl[i], this.pals[this.pi[i]], this.f, i * 6, L);
  }

  /** Just those still lit (and in `keep`, if given), packed. */
  pack(keep?: Uint8Array): LitPixels {
    let n = 0;
    for (let i = 0; i < this.fl.length; i++) if (this.fl[i] && (!keep || keep[i])) n++;
    const out = new LitPixels(n, this.pals);
    for (let i = 0, k = 0; i < this.fl.length; i++) {
      if (!this.fl[i] || (keep && !keep[i])) continue;
      out.at[k] = i;
      out.flags[k] = this.fl[i];
      out.pal[k] = this.pi[i];
      out.f.set(this.f.subarray(i * 6, i * 6 + 6), k * 6);
      k++;
    }
    return out;
  }
}

/**
 * A prop's lit pixels, packed (a park has hundreds of trees with thousands of
 * them each): where each is, its palette, and its numbers as 16-bit fixed point.
 */
export class LitPixels {
  readonly at: Int32Array;
  readonly flags: Uint8Array;
  readonly pal: Uint8Array;
  readonly f: Int16Array;
  readonly pals: RGB[][];

  constructor(n: number, pals: RGB[][]) {
    this.at = new Int32Array(n);
    this.flags = new Uint8Array(n);
    this.pal = new Uint8Array(n);
    this.f = new Int16Array(n * 6);
    this.pals = pals;
  }

  get size(): number {
    return this.at.length;
  }

  /** The k-th pixel's colour in light L. */
  colour(k: number, L: ScreenLight): RGB {
    return shade(this.flags[k], this.pals[this.pal[k]], this.f, k * 6, L);
  }
}

/** The sheet of puffs the trees are made from, each size in a row, shaded as they'd be in the middle of a crown. */
export function puffSheet(pal: RGB[] = CANOPIES[0].c): Raster {
  const PAD = 4, rows = PUFF_SIZES.map((r) => Array.from({ length: PUFF_SHAPES }, (_, k) => puff(r, k)));
  const W = Math.max(...rows.map((row) => row.reduce((a, p) => a + p.w + PAD, PAD)));
  const out = new Raster(W, rows.reduce((a, row) => a + row[0].w + PAD, PAD));
  const lit = new Lit(1);
  let y = PAD;
  for (const row of rows) {
    let x = PAD;
    for (const p of row) {
      for (let i = 0; i < p.w * p.w; i++)
        if (p.on[i]) {
          lit.leaf(0, pal, p.nx[i], p.ny[i], 0, 0, p.jit[i], p.speck[i], p.rim[i] === 1);
          out.set(x + (i % p.w), y + Math.floor(i / p.w), lit.colour(0, DEFAULT_LIGHT));
        }
      x += p.w + PAD;
    }
    y += row[0].w + PAD;
  }
  return out;
}

/** A tree drawn elsewhere (a worker), sent as plain data: its pictures' pixels and lit pixels, to move rather than copy. */
export interface PropParts {
  i: number;
  layers: ({ w: number; h: number; data: Uint8ClampedArray; lit: LitParts | null; puffs: Puffs | null } | null)[];
  x: number; y: number; depthY: number; kind: number;
}
type LitParts = { at: Int32Array; flags: Uint8Array; pal: Uint8Array; f: Int16Array; pals: RGB[][] };

/** Tree i's prop as parts to send, and the buffers to move with them. */
export function propParts(i: number, p: Prop): [PropParts, ArrayBuffer[]] {
  const moved: ArrayBuffer[] = [];
  const layer = (r: Raster | undefined, lit: LitPixels | undefined, puffs?: Puffs) => {
    if (!r) return null;
    moved.push(r.data.buffer as ArrayBuffer);
    if (lit) moved.push(...[lit.at, lit.flags, lit.pal, lit.f].map((a) => a.buffer as ArrayBuffer));
    if (puffs) moved.push(puffs.buffer as ArrayBuffer);
    return { w: r.w, h: r.h, data: r.data, lit: lit ? { at: lit.at, flags: lit.flags, pal: lit.pal, f: lit.f, pals: lit.pals } : null, puffs: puffs ?? null };
  };
  const layers = [layer(p.raster, p.lit, p.puffs), layer(p.front?.raster, p.front?.lit, p.front?.puffs), layer(p.mid?.raster, p.mid?.lit)];
  return [{ i, layers, x: p.x, y: p.y, depthY: p.depthY, kind: p.kind }, moved];
}

/** A prop again, from its parts. */
export function propFrom(parts: PropParts): Prop {
  const layer = (l: PropParts['layers'][number]) => {
    if (!l) return undefined;
    const raster = new Raster(l.w, l.h);
    raster.data.set(l.data);
    let lit: LitPixels | undefined;
    if (l.lit) {
      lit = new LitPixels(0, l.lit.pals);
      Object.assign(lit, { at: l.lit.at, flags: l.lit.flags, pal: l.lit.pal, f: l.lit.f });
    }
    return { raster, lit, puffs: l.puffs ?? undefined };
  };
  const [base, front, mid] = parts.layers.map(layer);
  return {
    raster: base!.raster, lit: base!.lit, puffs: base!.puffs,
    front: front && { raster: front.raster, lit: front.lit!, puffs: front.puffs! }, mid: mid && { raster: mid.raster, lit: mid.lit! },
    x: parts.x, y: parts.y, depthY: parts.depthY, kind: parts.kind, plan: TREES[parts.i],
  };
}

/** Shade a prop's lit pixels for light L (in place). */
export function relightProp(prop: Prop, L: ScreenLight): void {
  for (const { raster, lit } of [{ raster: prop.raster, lit: prop.lit }, ...(prop.front ? [prop.front] : []), ...(prop.mid ? [prop.mid] : [])]) {
    if (!lit) continue;
    const w = raster.w;
    for (let k = 0; k < lit.size; k++) {
      const i = lit.at[k];
      raster.set(i % w, Math.floor(i / w), lit.colour(k, L));
    }
  }
}

/** One of a tree's two pictures being drawn. */
interface Layer {
  r: Raster;
  lit: Lit;
  puffs: Puffs;
}

/** A cloud of leaves to draw in three goes: its back, its middle (on the branches), its front. */
interface Mass { back(): void; mid(): void; front(): void }

type Clump = { x: number; y: number; r: number };

/** A tree being drawn: its picture, lit pixels, and where things are in it. */
class Sketch {
  /** The tree from the back, and the leaves in front of its branches. */
  readonly layers: [Layer, Layer];
  /** Which of them is being drawn on. */
  private cur = 0;
  get r(): Raster { return this.layers[this.cur].r; }
  get lit(): Lit { return this.layers[this.cur].lit; }
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
    const layer = (): Layer => {
      const r = new Raster(t.w, t.h), puffs: Puffs = new Uint8ClampedArray(t.w * t.h * 4), set = r.set;
      // (anything but leaves drawn over a puff takes the pixel off it)
      r.set = (x, y, c, a) => {
        x |= 0;
        y |= 0;
        if (!this.leafing && x >= 0 && y >= 0 && x < r.w && y < r.h) puffs[(y * r.w + x) * 4 + 3] = 0;
        set.call(r, x, y, c, a);
      };
      return { r, lit: new Lit(t.w * t.h), puffs };
    };
    this.layers = [layer(), layer()];
    this.rnd = mulberry32(t.seed * 977 + t.colour * 13);
  }

  /** Drawing leaves (or what lies on them: their outline, blossom, snow), which keep to their puff. */
  leafing = false;
  /** The puff being drawn: its middle and radius in the picture. */
  private puffAt = { x: 0, y: 0, r: 0 };

  /** The leaves drawn next belong to a puff round (x, y), r px wide. */
  setPuff(x: number, y: number, r: number): void {
    this.puffAt = { x: Math.round(x), y: Math.round(y), r: Math.min(255, Math.round(r)) };
  }

  /** Draw f as leaves. */
  leafy<T>(f: () => T): T {
    const was = this.leafing;
    this.leafing = true;
    try {
      return f();
    } finally {
      this.leafing = was;
    }
  }

  /** Which pixels of the tree from the back belong to its middle: trunk, branches and what grows on them. */
  private midMask: Uint8Array | null = null;

  /** Draw the tree's middle: what a cat up it sees solid round it, while the leaves behind and in front open up. */
  middle(f: () => void): void {
    const r = this.layers[0].r, mask = (this.midMask ??= new Uint8Array(this.W * this.H)), W = this.W;
    const set = r.set;
    r.set = (x, y, c, a) => {
      x |= 0;
      y |= 0;
      if (x >= 0 && y >= 0 && x < r.w && y < r.h) mask[y * W + x] = 1;
      set.call(r, x, y, c, a);
    };
    try {
      f();
    } finally {
      r.set = set;
    }
  }

  /** Draw on the leaves in front of the branches. */
  inFront(f: () => void): void {
    this.cur = 1;
    f();
    this.cur = 0;
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
    // (in autumn a whole cloud of leaves turns the same colour: mostly the tree's own, now and then the next shade)
    const k = this.group ?? i;
    if (hash2(k, t.seed, 1302) < season.turn) {
      const own = Math.floor(hash2(t.seed, 0, 1303) * AUTUMN.length), u = hash2(k, t.seed, 1303);
      return AUTUMN[(own + (u < 0.65 ? 0 : u < 0.85 ? 1 : AUTUMN.length - 1)) % AUTUMN.length];
    }
    return t.colour === 2 ? CANOPIES[0].c : CANOPIES[t.colour].c;
  }

  /** Added to the light on the leaves drawn now (a spruce's tiers: bright along the top, dark under the hem). */
  bias = 0;

  /** While drawing one cloud of leaves: the clump number its colour goes by. */
  private group: number | null = null;

  private strokes: Stroke[] | null = null;

  /**
   * A few broad strokes across the crown, the warm ones up towards the light and the cool ones
   * down in the shade: some laid on wet, their edges blended away, some dry, with a hard edge.
   */
  private brush(): Stroke[] {
    if (this.strokes) return this.strokes;
    const { t } = this, rnd = mulberry32(t.seed * 13 + 1360), n = 3 + Math.floor(rnd() * 3);
    this.strokes = [];
    for (let k = 0; k < n; k++) {
      const warm = k % 2 === 0, a = (rnd() - 0.5) * 1.2 + (rnd() < 0.5 ? 0.6 : -0.6);
      this.strokes.push({
        x: (rnd() - 0.5) * 1.2 + (warm ? -0.25 : 0.25), y: (rnd() - 0.5) * 1.0 + (warm ? -0.3 : 0.3),
        ux: Math.cos(a), uy: Math.sin(a), len: 0.45 + rnd() * 0.5, wide: 0.16 + rnd() * 0.16, soft: rnd() < 0.5 ? 0.6 : 0.08, warm,
      });
    }
    return this.strokes;
  }

  /** The palette a leaf pixel at (x, y) takes: its own, unless a stroke lies over it. */
  stroked(x: number, y: number, pal: RGB[]): RGB[] {
    // (only on green leaves and needles: blossom and autumn colours have their own)
    const greens = [CANOPIES[0].c, CANOPIES[1].c, CANOPIES[3].c, NEEDLES];
    if (!greens.some((g) => g === pal || backs.get(g) === pal)) return pal;
    const { crown } = this, px = (x + 0.5 - crown.x) / crown.rx, py = (y + 0.5 - crown.y) / crown.ry;
    for (const s of this.brush()) {
      const dx = px - s.x, dy = py - s.y, along = dx * s.ux + dy * s.uy, across = -dx * s.uy + dy * s.ux;
      // (a stroke: long and flat, tapering at its ends, its sides wavering a little)
      const half = s.wide * (1 - (along / s.len) ** 2) * (1 + 0.15 * Math.sin(along * 9 + s.x * 20));
      if (half <= 0) continue;
      const v = (half - Math.abs(across)) / (half * s.soft + 0.02);
      if (v >= 1 || (v > 0 && v * 1.1 > bayer(x, y))) return lean(pal, s.warm);
    }
    return pal;
  }

  /** A shaded needle pixel (a spruce's: their fine grain, no speckle, drawn in broad strokes). */
  leaf(x: number, y: number, pal: RGB[], nx: number, ny: number, rim: boolean, salt: number): void {
    const { crown, t } = this;
    this.leafPx(x, y, pal, nx, ny, rim, needleAt(x, y, crown.x, t.seed) + (hash2(x >> 1, y >> 1, t.seed + salt) - 0.5) * 0.1, 0.5);
  }

  /** A shaded leaf pixel, its texture `jit` and speck given. */
  private leafPx(x: number, y: number, pal: RGB[], nx: number, ny: number, rim: boolean, jit: number, speck: number): void {
    if (x < 0 || y < 0 || x >= this.W || y >= this.H) return;
    const { crown, puffAt } = this, i = y * this.W + x, k = i * 4, puffs = this.layers[this.cur].puffs;
    this.lit.leaf(i, pal, nx, ny, (x - crown.x) / crown.rx, (y - crown.y) / crown.ry, this.bias + jit, speck, rim);
    this.leafy(() => this.r.set(x, y, UNSHADED, LIT));
    // (needles aren't in puffs: a spruce opens smoothly, its tiers would part in slivers)
    if (!puffAt.r) return;
    puffs[k] = puffAt.x - x + 128;
    puffs[k + 1] = puffAt.y - y + 128;
    puffs[k + 2] = puffAt.r;
    puffs[k + 3] = 255;
  }

  /** A puff of leaves off the sheet (art/leaves.ts), stamped at c; nothing above row `cut` (a cushion's flat top). */
  clump(c: Clump, pal: RGB[], cut = -Infinity, seam = false): void {
    const p = puff(c.r, Math.floor(hash2(this.clumps, this.t.seed, 1322) * PUFF_SHAPES)), R = (p.w - 1) / 2;
    const ox = Math.round(c.x) - R, oy = Math.round(c.y) - R;
    this.setPuff(c.x, c.y, c.r);
    for (let y = 0; y < p.w; y++) {
      const Y = oy + y;
      if (Y < cut) continue;
      // a flat top faces up
      const flat = Y === cut ? 0.6 : 0;
      for (let x = 0; x < p.w; x++) {
        const i = y * p.w + x;
        if (!p.on[i]) continue;
        this.leafPx(ox + x, Y, pal, p.nx[i] * (1 - flat), p.ny[i] * (1 - flat) - flat, p.rim[i] === 1, p.jit[i], p.speck[i]);
        // a puff in front of others shows its round underside against them
        if (seam && p.seam[i]) this.leafy(() => this.r.set(ox + x, Y, pal[3]));
      }
    }
  }

  /**
   * A bark pixel, round across the trunk (u 0..1 from left to right), `deep` in shadow (0..1: under the
   * crown, down at the roots), `mossy` the more it is a trunk moss grows on (0..1).
   */
  bark(x: number, y: number, u: number, deep = 0, mossy = 0): void {
    if (u < 0.1 || u >= 0.9) { this.r.set(x, y, BARK[3]); return; }
    const seed = this.t.seed;
    // the bark's texture: long ridges running up it, wavering and broken, with deep cracks between
    // (thin furrows 3 or 4 px apart, wavering as they go up and broken off here and there; each ridge
    // between them round, lit on its side to the light and dark on the other)
    const wx = x + (noise(x / 7, y / 16, seed + 1370) - 0.5) * 5, P = 3.5, col = Math.floor(wx / P), f = wx / P - col;
    const len = 5 + hash2(col, 0, seed + 1371) * 8, broken = hash2(col, Math.floor((y + hash2(col, 1, seed + 1371) * 12) / len), seed + 1372) < 0.3;
    const crack = f < 1 / P && !broken;
    let g = crack ? -0.6 : (f < 0.5 ? 0.18 : -0.12) + (hash2(x, y >> 1, seed + 1373) - 0.5) * 0.14;
    // (and a knot here and there on a wide trunk: a dark eye with a lit lip above it)
    const kx = Math.floor(x / 9), ky = Math.floor(y / 13);
    if (mossy > 0.4 && hash2(kx, ky, seed + 1374) < 0.05) {
      const ox = kx * 9 + 4.5, oy = ky * 13 + 6.5, d = Math.hypot((x + 0.5 - ox) / 1.6, y + 0.5 - oy);
      if (d < 1.4) g = -0.6;
      else if (d < 2.4) g = y + 0.5 < oy ? 0.6 : -0.3;
    }
    g -= deep * 0.55;
    // moss on the shady side, in soft patches, thicker low down (ragged at its edges)
    const m = patch(x, y, seed + 1375, 12) + (u - 0.5) * 0.9 + mossy * 0.35 + dab(x, y, seed + 1376) * 0.25;
    this.lit.bark(y * this.W + x, u, g, mossy > 0 && m > 0.62 && !crack);
    this.r.set(x, y, UNSHADED, LIT);
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
        // (in the crown's shadow at its top, and dim down among the roots; moss low down on it, little higher up)
        const deep = Math.max(0, Math.min(1, (z - (top - 16)) / 16)) * 0.8 + Math.max(0, 3 - z) * 0.12;
        this.bark(x, y, (x + 0.5 - (cx - h)) / (2 * h), deep, h >= 3 ? 1 - Math.min(1, z / Math.max(24, top)) * 0.7 : 0);
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

  /** A round limb from (x0, y0) to (x1, y1), thinning from th0 to th1 px, lit across like the trunk. */
  branch(x0: number, y0: number, x1: number, y1: number, th0: number, th1: number): (f: number) => [number, number] {
    const dx = x1 - x0, dy = y1 - y0, n = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))), steep = Math.abs(dy) >= Math.abs(dx);
    const len = Math.hypot(dx, dy), px = -dy / Math.max(1, len), py = dx / Math.max(1, len);
    // (organic: a gentle bend one way, and kinks along it, a little off the straight line)
    const bend = (this.rnd() - 0.5) * len * 0.16, seed = Math.floor(this.rnd() * 1e6), seg = Math.max(12, len * 0.3);
    const kink = (d: number) => {
      const k = Math.floor(d / seg), u = d / seg - k, a = hash2(k, seed, 1340) - 0.5, b = hash2(k + 1, seed, 1340) - 0.5;
      return (a + (b - a) * (u * u * (3 - 2 * u))) * Math.min(3, 0.6 + len * 0.025);
    };
    const at = (f: number): [number, number] => {
      const off = Math.sin(f * Math.PI) * bend + kink(f * len) * Math.min(1, f * 4);
      return [x0 + dx * f + px * off, y0 + dy * f + py * off];
    };
    for (let i = 0; i <= n; i++) {
      const f = i / Math.max(1, n), [x, y] = at(f), w = Math.max(1, th0 + (th1 - th0) * f);
      for (let k = 0; k < w; k++) {
        const u = w < 2 ? 0.5 : (k + 0.5) / w;
        if (steep) this.bark(Math.round(x - w / 2 + k), Math.round(y), u);
        else this.bark(Math.round(x), Math.round(y - w / 2 + k), u);
      }
    }
    return at;
  }

  /** True when the leaves are too thin to hide the bare wood (winter, early spring, late autumn). */
  get bare(): boolean {
    return this.season.leaves <= 0.6 && !(this.t.colour === 2 && this.season.blossom > 0.3);
  }

  /** The crown's bare limbs, forking up and out from the trunk at height z. */
  crownLimbs(z: number, spread: number, th = 2): void {
    if (!this.bare) return;
    const limb = (x: number, y: number, a: number, len: number, th: number, depth: number) => {
      const x1 = x + Math.cos(a) * len, y1 = y + Math.sin(a) * len * 0.8;
      this.limb(Math.round(x), Math.round(y), Math.round(x1), Math.round(y1), th, 0.3);
      if (depth >= 2) return;
      for (const da of [-0.45 - this.rnd() * 0.3, 0.35 + this.rnd() * 0.3]) limb(x1, y1, a + da, len * (0.6 + this.rnd() * 0.15), Math.max(1, th - 1), depth + 1);
    };
    for (const a of [-2.45, -1.95, -1.2, -0.7]) limb(this.cx, this.row(z), a + (this.rnd() - 0.5) * 0.2, spread * (0.8 + this.rnd() * 0.3), th, 0);
  }

  /** Bare twigs spraying from the end of a branch at (x, y), heading at angle a (from straight up), forking as they go. */
  spray(x: number, y: number, a: number, len: number, depth = 0): void {
    for (const da of depth === 0 ? [-0.45, 0, 0.45] : [-0.4, 0.35]) {
      const b = a + da + (this.rnd() - 0.5) * 0.3, l = len * (0.7 + this.rnd() * 0.4);
      const end = this.branch(x, y, x + Math.sin(b) * l, y - Math.cos(b) * l, depth === 0 ? 1.5 : 1, 1)(1);
      if (depth < 1) this.spray(end[0], end[1], b, len * 0.55, depth + 1);
    }
  }

  /** A few bare twigs from (x, y) reaching out and up, when the leaves are thin enough to show them. */
  twigs(x: number, y: number, side: number): void {
    if (!this.bare) return;
    for (let k = 0; k < 3; k++) {
      const a = -Math.PI / 2 + side * (0.4 + this.rnd() * 0.9), len = 4 + this.rnd() * 5;
      this.limb(x, y, x + Math.cos(a) * len, y + Math.sin(a) * len, 1, 0);
    }
  }

  /**
   * A cluster of leaves: round puffs heaped together like a little cloud,
   * darker ones peeking out behind. Its puffs sit on the line of height z
   * from x0 to x1 (trunk-relative), where a cat on that branch stands, and
   * bulge a little above it; `dome` px more rise in the middle (the crown),
   * and it hangs `depth` px down below.
   */
  cluster(x0: number, x1: number, z: number, depth: number, dome = 3): void {
    const line = this.row(z), span = x1 - x0, mid = this.cx + (x0 + x1) / 2;
    const n = Math.max(2, Math.round(span / 10));
    // how high the cloud rises above the line at x: a hump in the middle
    const rise = (x: number) => 2 + dome * Math.max(0, 1 - ((x - mid) / (span / 2 + 2)) ** 2);
    const behind: Clump[] = [], front: Clump[] = [];
    this.group = this.clumps;
    for (let i = 0; i < n; i++) {
      const x = this.cx + x0 + (span * (i + 0.5)) / n + (this.rnd() - 0.5) * 4, r = 5 + this.rnd() * 2.5;
      behind.push({ x, y: line - rise(x) + r - 1 + this.rnd() * 2, r });
    }
    // the top row, its puffs rising to the line and a little over
    for (let i = 0; i <= n; i++) {
      const x = this.cx + x0 + (span * i) / n + (this.rnd() - 0.5) * 2, r = 5.5 + this.rnd() * 2.5;
      front.push({ x, y: line - rise(x) + r, r });
    }
    // filling the middle, where a high crown would leave a gap
    if (dome > 3) for (let i = 0; i < n; i++) {
      const x = this.cx + x0 + (span * (i + 0.5)) / n, r = 6 + this.rnd() * 2;
      front.push({ x, y: line - rise(x) + r + 4, r });
    }
    // and below it, hanging lowest in the middle
    for (let i = 0; i < n; i++) {
      const u = (i + 0.3 + this.rnd() * 0.4) / n, sag = Math.sin(u * Math.PI);
      const r = 3.5 + this.rnd() * 1.5 + sag, x = this.cx + x0 + span * u;
      front.push({ x, y: line + 2 + r * 0.8 + sag * Math.max(0, depth - 8) * 0.5 + this.rnd(), r });
    }
    for (const c of behind) {
      const pal = this.leaves();
      if (pal) this.clump(c, back(pal));
    }
    // (top first: the lower puffs in front of them)
    front.sort((a, b) => a.y - b.y);
    for (const c of front) {
      const pal = this.leaves();
      if (pal) this.clump(c, pal, -Infinity, true);
    }
    this.group = null;
  }

  /**
   * A big mass of leaves filling blob b: darker puffs behind, lighter ones
   * heaped in front of them, the lower ones over the upper. With `line` (a
   * height), its top is flattened there, a little hump at most: a branch level
   * a cat walks along.
   */
  mass(b: Blob, line: number | null = null, dome = 0, hasFront = true): Mass {
    const mx = this.cx + b.x, my = this.row(b.z), top = line === null ? -Infinity : this.row(line) + 3;
    // (a flattened underside: no puff hangs below it)
    const floor = b.base === undefined ? Infinity : this.row(b.base);
    const inside = (x: number, y: number, r: number) =>
      y + r * 0.7 <= floor && ((x - mx) / Math.max(1, b.rx - r * 0.6)) ** 2 + ((y - my) / Math.max(1, b.rz - r * 0.6)) ** 2 <= 1;
    const puffs = (n: number, r0: number, r1: number): Clump[] => {
      const out: Clump[] = [];
      for (let tries = 0; out.length < n && tries < n * 8; tries++) {
        const r = r0 + this.rnd() * (r1 - r0);
        const x = mx + (this.rnd() * 2 - 1) * b.rx, y = Math.max(my + (this.rnd() * 2 - 1) * b.rz, top + r);
        if (inside(x, y, r)) out.push({ x, y, r });
      }
      return out;
    };
    const area = Math.PI * b.rx * b.rz;
    // (big masses in bigger puffs)
    const k = Math.min(2.6, Math.max(1.2, Math.sqrt(area) / 38));
    const backs = puffs(Math.ceil(area / (330 * k * k)), 9 * k, 13 * k);
    // (top first: the lower puffs in front of them)
    const fronts = puffs(Math.ceil(area / (210 * k * k)), 7 * k, 11 * k).sort((a, c) => a.y - c.y);
    // along a branch level, a row of smaller puffs on the branch makes the edge a cat walks on: rising a little over it, a hump in the middle
    const row: Clump[] = [];
    if (line !== null)
      for (let x = mx - b.rx + 7 * k; x <= mx + b.rx - 7 * k; x += 8 * k) {
        const r = (5 + this.rnd() * 2.5) * k, hump = dome * Math.max(0, 1 - ((x - mx) / b.rx) ** 2);
        row.push({ x: x + (this.rnd() - 0.5) * 3, y: this.row(line) - 1 - this.rnd() * 3 - hump + r, r });
      }
    // the puffs hang in front of the branches (or, with nothing in front, behind them): up the tree, among
    // its branches, there is bark to see, not leaves
    const mid = [...row.sort((a, c) => a.y - c.y)], front: Clump[] = [], behind: Clump[] = [];
    for (const c of fronts) {
      this.rnd();
      (hasFront ? front : behind).push(c);
    }
    // (a cloud turns colour as one, whichever part of it is drawn)
    const group = this.clumps++;
    const draw = (list: Clump[], dark: boolean) => {
      this.group = group;
      for (const c of list) {
        const pal = this.leaves();
        if (pal) dark ? this.clump(c, back(pal)) : this.clump(c, pal, -Infinity, true);
      }
      this.group = null;
    };
    return { back: () => { draw(backs, true); draw(behind, false); }, mid: () => draw(mid, false), front: () => draw(front, false) };
  }

  /** Little tufts of leaves round the ends of the branches (they show when the leaves in front are gone). */
  tufts(ends: [number, number][], size: number): void {
    this.group = this.clumps++;
    for (const [x, y] of ends)
      for (let k = 0; k < 3; k++) {
        const pal = this.leaves();
        const r = size * (0.7 + this.rnd() * 0.5);
        if (pal) this.clump({ x: x + (this.rnd() - 0.5) * size * 2, y: y + (this.rnd() - 0.6) * size * 1.5, r }, pal);
      }
    this.group = null;
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
    const wall = Math.max(11, this.t.trunk + 3), eaves = this.row(roofZ - 9);
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
    const { W, H, t } = this;
    // (outlines and snow lie on the leaves: they keep to their puffs)
    const [base, front] = this.leafy(() => this.layers.map((l) => this.finishLayer(l)));
    return {
      raster: base.r, lit: base.lit, puffs: this.layers[0].puffs,
      front: front.r.data.some((v, i) => i % 4 === 3 && v > 0) ? { raster: front.r, lit: front.lit, puffs: this.layers[1].puffs } : undefined,
      mid: this.midMask ? this.cutMiddle(base.r, this.layers[0].lit, this.midMask) : undefined,
      x: t.x - W / 2, y: t.y - (H - 1) - t.elev, depthY: t.y, kind: t.shape === 'pine' ? 4 : t.colour, plan: t,
    };
  }

  /** The tree's middle, out of the finished tree from the back. */
  private cutMiddle(base: Raster, lit: Lit, mask: Uint8Array): { raster: Raster; lit: LitPixels } {
    const { W, H } = this, r = new Raster(W, H);
    for (let i = 0; i < W * H; i++) if (mask[i]) for (let k = 0; k < 4; k++) r.data[i * 4 + k] = base.data[i * 4 + k];
    return { raster: r, lit: lit.pack(mask) };
  }

  /** Outline a layer's leaves, lay snow on it, and keep what is still as shaded. */
  private finishLayer({ r, lit }: Layer): { r: Raster; lit: LitPixels } {
    const { W, H, season, t } = this;
    // what is still as drawn stays lit (not where branches, fruit or the house went over it), its leaves
    // in the colour strokes across the crown
    for (let i = 0; i < W * H; i++) {
      if (!lit.fl[i]) continue;
      if (r.data[i * 4 + 3] !== LIT) lit.fl[i] = 0;
      else if (lit.fl[i] & LEAF) lit.pi[i] = lit.palIndex(this.stroked(i % W, Math.floor(i / W), lit.pals[lit.pi[i]]));
    }
    const leafy = (x: number, y: number) => lit.fl[y * W + x] & LEAF;
    const edge: [number, number][] = [];
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        // (shaded along the lower and the far edges, the way the light falls; no hard outline)
        if (leafy(x, y) && (!r.isSet(x + 1, y) || !r.isSet(x, y + 1) || (!r.isSet(x - 1, y) && !r.isSet(x, y - 1) && hash2(x, y, 1333) < 0.3))) edge.push([x, y]);
    for (const [x, y] of edge) {
      const pal = lit.palette(y * W + x)!;
      r.set(x, y, pal[t.shape === 'pine' ? 4 : 3]);
      lit.fl[y * W + x] = 0;
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
    // and shaded, at last
    for (let i = 0; i < W * H; i++) {
      if (!lit.fl[i]) continue;
      if (r.data[i * 4 + 3] !== LIT) lit.fl[i] = 0;
      else r.set(i % W, Math.floor(i / W), lit.colour(i, DEFAULT_LIGHT));
    }
    return { r, lit: lit.pack() };
  }
}

/** A bough along branch level p: out of the trunk a little lower, rising to the level, then along it either way, with twigs at its ends. */
function bough(s: Sketch, p: Perch, thick: number): void {
  const y = s.row(p.z), root = Math.round(s.t.trunk * 0.4), knee = Math.round(s.t.trunk * 0.9) + 4;
  for (const end of [p.x0, p.x1]) {
    const side = Math.sign(end) || 1;
    s.limb(s.cx + side * root, y + Math.round(thick * 2.5), s.cx + side * knee, y + 1, thick, 0.1);
    s.limb(s.cx + side * knee, y + 1, s.cx + end, y + 1, thick, 0.6);
    s.twigs(s.cx + end, y, side);
  }
}

/** Apples or blossom dotted over the leaves. */
function dots(s: Sketch): void {
  const { t, season, r, lit, W } = s;
  // (and now and then a green tree in leaf is sprinkled with little blossoms of its own)
  const whimsy = t.colour < 2 && season.leaves > 0.6 && season.turn < 0.3 && hash2(t.seed, 4, 1360) < 0.35;
  const colours = t.colour === 3 ? (season.appleBlossom > 0.3 ? [hex('#ffffff'), hex('#f8d8e8')] : season.apples > 0.3 ? CANOPIES[3].dots : undefined)
    : t.colour === 2 && season.blossom > 0.3 ? CANOPIES[2].dots : whimsy ? WHIMSY : undefined;
  if (!colours) return;
  for (let k = 0; k < (W * s.H) / (whimsy ? 400 : 120); k++) {
    const x = Math.floor(s.rnd() * W), y = Math.floor(s.rnd() * s.H);
    if (!lit.palette(y * W + x - 1) || !lit.palette((y + 2) * W + x + 2)) continue;
    const c = colours[k % colours.length];
    r.set(x, y, c); r.set(x + 1, y, c); r.set(x, y + 1, c); r.set(x + 1, y + 1, lit.palette(y * W + x)?.[3] ?? c);
  }
}

/** The whole crown's middle and size, for shading it as one. */
function crownOf(s: Sketch, crown: Blob[]): Sketch['crown'] {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const b of crown) {
    x0 = Math.min(x0, b.x - b.rx); x1 = Math.max(x1, b.x + b.rx);
    y0 = Math.min(y0, s.row(b.z + b.rz)); y1 = Math.max(y1, s.row(b.z - b.rz));
  }
  return { x: s.cx + (x0 + x1) / 2, y: (y0 + y1) / 2, rx: (x1 - x0) / 2, ry: (y1 - y0) / 2 };
}


/**
 * A broadleaf: a stout trunk with a bough at every branch level, each
 * carrying a mass of leaves whose flat top is that level, the crown the
 * biggest on top (and maybe a bird house).
 */
function broadleaf(t: TreePlan, season: Season): Prop {
  const s = new Sketch(t, season);
  s.crown = crownOf(s, t.crown);
  const c = t.crown[0];
  // the crown: its main cloud and the lumps round its rim
  const masses = t.crown.map((b) => s.mass(b));
  // the leaves at the back, behind the trunk...
  for (const m of masses) m.back();
  s.middle(() => {
    // ...the trunk, up into the crown, where it forks into limbs that spread up and out, with branches off them...
    const fork = Math.max(14, c.z - c.rz * 0.45), thin = t.trunk * 0.7;
    s.trunk(fork, (z) => t.trunk - (z / fork) * (t.trunk - thin));
    // (nothing reaches out below the crown's flat underside)
    const under = s.row((c.base ?? c.z - c.rz) + 8);
    const n = 2 + (s.rnd() < 0.5 ? 1 : 0), ends: { x: number; y: number; a: number; len: number }[] = [];
    for (let j = 0; j < n; j++) {
      const a = ((j / (n - 1)) - 0.5) * 1.3 + (s.rnd() - 0.5) * 0.3, len = c.rz * (0.9 + s.rnd() * 0.35);
      const x0 = s.cx + ((j / (n - 1)) - 0.5) * thin, y0 = s.row(fork) + 2;
      // (its end well inside the crown)
      const mx = s.cx + c.x, my = s.row(c.z);
      let x1 = s.cx + c.x + Math.sin(a) * len * Math.min(1.2, c.rx / c.rz), y1 = Math.min(under, s.row(fork) - Math.cos(a) * len);
      const out = Math.hypot((x1 - mx) / c.rx, (y1 - my) / c.rz);
      if (out > 0.7) { x1 = mx + ((x1 - mx) * 0.7) / out; y1 = my + ((y1 - my) * 0.7) / out; }
      const th = Math.max(2, (thin * 2) / n + 1);
      const along = s.branch(x0, y0, x1, y1, th, Math.max(1.5, th * 0.3));
      const [ex, ey] = along(1);
      ends.push({ x: ex, y: ey, a, len });
      // a branch or two off it (from where the limb really is, bent as it is)
      for (let k = 0; k < 2; k++) {
        const f = 0.35 + s.rnd() * 0.35, [bx, by] = along(f);
        const b = a + (k ? 1 : -1) * (0.5 + s.rnd() * 0.4), bl = len * (0.3 + s.rnd() * 0.2);
        const tx = bx + Math.sin(b) * bl, ty = Math.min(under, by - Math.cos(b) * bl * 0.8);
        const [fx, fy] = s.branch(bx, by, tx, ty, Math.max(1.5, th * (1 - f) * 0.6), 1)(1);
        ends.push({ x: fx, y: fy, a: b, len: bl });
      }
    }
    // (bare, twigs spray from the ends of the branches)
    if (s.bare) for (const e of ends) s.spray(e.x, e.y, e.a, Math.min(26, e.len * 0.35));
    // ...leaves on the branches...
    // (small: up the tree, it's the branches that show)
    s.tufts(ends.map((e): [number, number] => [e.x, e.y]), 3);
    for (const m of masses) m.mid();
    // (the bird house on the trunk, below its fork)
    const house = t.perches.find((p) => p.kind === 'birdhouse');
    if (house && fork - 2 >= 16) s.birdhouse(Math.min(house.z, fork - 2));
  });
  // (blossom and fruit on the leaves at the back: not part of the middle)
  s.leafy(() => dots(s));
  // ...and the leaves in front of them
  s.inFront(() => {
    for (const m of masses) m.front();
    s.leafy(() => dots(s));
  });
  return s.finish();
}

/** A spruce: a straight trunk under tiers of drooping, saw-toothed boughs of needles, up to a spire. */
function pine(t: TreePlan, season: Season): Prop {
  const s = new Sketch(t, season);
  s.crown = crownOf(s, t.crown);
  const spire = t.crown[t.crown.length - 1], tip = spire.z + spire.rz;
  s.middle(() => s.trunk(tip - 6, (z) => Math.max(1.5, t.trunk - (z / tip) * (t.trunk - 1.5))));
  const tiers = t.crown.slice(0, -1);
  // a bough of needles: a band whose lower edge hangs in points, drooping more towards its tips
  const size = Math.max(4, Math.min(8, tiers[0].rx / 9));
  const snowy = season.snow > 0.2, owner = new Int32Array(s.W * s.H);
  const band = (mid: number, y: number, w: number, salt: number) => {
    const deep = size * 1.8;
    // (the points along its lower edge: each its own width and length, no two alike)
    const x0 = Math.floor(mid - w), x1 = Math.ceil(mid + w), points = new Float32Array(x1 - x0 + 1);
    for (let x = x0, k = 0; x <= x1; k++) {
      const wide = 3 + Math.floor(hash2(k, salt, 1352) * (3 + size * 0.7)), long = 1 + hash2(k, salt, 1351) * size * 1.1;
      for (let i = 0; i < wide && x + i <= x1; i++) points[x + i - x0] = (1 - Math.abs((i + 0.5) / wide - 0.5) * 2) * long;
      x += wide;
    }
    for (let x = x0; x <= x1; x++) {
      const u = (x + 0.5 - mid) / w;
      if (Math.abs(u) > 1) continue;

      const point = points[x - x0];
      const droop = Math.abs(u) ** 2 * size * 1.6, top = y + droop * 0.9 + Math.abs(u) ** 3 * deep * 0.7 - (1 - Math.abs(u)) * 1.5;
      const bottom = y + deep + droop + point;
      for (let yy = Math.floor(top); yy <= bottom; yy++) {
        const f = (yy - top) / Math.max(1, bottom - top);
        s.leaf(x, yy, NEEDLES, u * 0.8, f * 1.2 - 0.6, yy >= bottom - 1, salt);
        if (yy >= 0 && yy < s.H && x >= 0 && x < s.W) owner[yy * s.W + x] = salt + 1;
      }
    }
  };
  // from the bottom up, each tier's upper boughs hanging over the lower ones, and each tier over the one below
  for (const b of [...tiers, spire]) {
    const y0 = s.row(b.z + b.rz), y1 = s.row(b.z - b.rz), mid = s.cx + b.x;
    const rows = Math.max(2, Math.round((y1 - y0) / (size * 1.9)));
    for (let i = rows; i >= 0; i--) {
      const v = i / rows, y = y0 + (y1 - y0) * v - size, w = b.rx * (0.15 + 0.85 * v) * (0.92 + s.rnd() * 0.16);
      s.bias = 0.6 - v * 0.8;
      band(mid + (s.rnd() - 0.5) * 2, y, w, Math.floor(s.rnd() * 1000));
    }
  }
  s.bias = 0;
  // snow lying on every bough where it shows from above, a gap here and there where it slid off
  if (snowy)
    for (let x = 0; x < s.W; x++) {
      let was = 0, d = 0, cap = 0;
      for (let y = 0; y < s.H; y++) {
        const o = owner[y * s.W + x];
        if (o !== was) {
          d = 0;
          cap = o && hash2(x >> 2, o, 1353) < 0.25 + 0.7 * season.snow ? 2 + Math.round(hash2(x >> 1, o, 1354) * 1.6) : 0;
        }
        was = o;
        if (o && d < cap) s.r.set(x, y, SNOW[d === cap - 1 ? 2 : 3]);
        d++;
      }
    }
  return s.finish();
}

/** The big tree with a house in it. */
function treehouse(t: TreePlan, season: Season): Prop {
  const s = new Sketch(t, season);
  s.crown = crownOf(s, t.crown);
  const at = (k: string) => t.perches.find((p) => p.kind === k)!;
  const fork = at('fork'), deck = at('deck'), roof = at('roof'), top = at('top');
  // the crown, the branch below it, and the clouds either side behind the hut (those all at the back)
  const masses = [s.mass(t.crown[3]), s.mass(t.crown[2]), s.mass(t.crown[0], null, 0, false), s.mass(t.crown[1], null, 0, false)];
  for (const m of masses) m.back();
  s.middle(() => {
    s.trunk(top.z - 6, (z) => Math.max(6, t.trunk - (z / top.z) * (t.trunk - 6)));
    bough(s, fork, 7);
    // limbs up behind the hut to the crown
    const crownBase = s.row(deck.z + 8);
    s.limb(s.cx - 6, crownBase, s.cx + top.x0 - 20, s.row(top.z) + 14, 6, 0.3);
    s.limb(s.cx + 5, crownBase, s.cx + top.x1 + 20, s.row(top.z) + 14, 6, 0.3);
    s.crownLimbs(top.z - 20, 60, 3);
    for (const m of masses) m.mid();
    s.treehouse(deck.x0, deck.x1, deck.z, roof.z, roof.x1);
  });
  s.inFront(() => { for (const m of masses) m.front(); });
  return s.finish();
}

/** The picture of tree i (they're drawn as the camera comes near them: the park has far too many to draw them all at once). */
export function buildProp(i: number, season: Season = SEASON): Prop {
  const t = TREES[i];
  return t.shape === 'pine' ? pine(t, season) : t.shape === 'treehouse' ? treehouse(t, season) : broadleaf(t, season);
}

/**
 * Tree i's outline, worked out from its plan rather than drawn (its leaf
 * masses, trunk and boughs): for its shadow, and what it hides of a light.
 * In its picture's px, 1 where it is.
 */
export function treeOutline(i: number): { w: number; h: number; data: Uint8Array } {
  const t = TREES[i], { w, h } = t, data = new Uint8Array(w * h), cx = w / 2;
  const row = (z: number) => h - 1 - z;
  for (const b of t.crown) {
    const mx = cx + b.x, my = row(b.z);
    for (let y = Math.max(0, Math.floor(my - b.rz)); y <= Math.min(h - 1, my + b.rz); y++) {
      const half = b.rx * Math.sqrt(Math.max(0, 1 - ((y - my) / b.rz) ** 2));
      for (let x = Math.max(0, Math.round(mx - half)); x < Math.min(w, Math.round(mx + half)); x++) data[y * w + x] = 1;
    }
  }
  const top = Math.max(...t.perches.map((p) => p.z));
  for (let z = 0; z < top; z++) {
    const half = Math.max(2, t.trunk - (z / top) * (t.trunk - 2));
    for (let x = Math.round(cx - half); x < Math.round(cx + half); x++) data[row(z) * w + x] = 1;
  }
  for (const p of t.perches)
    for (let x = Math.max(0, Math.round(cx + p.x0)); x < Math.min(w, Math.round(cx + p.x1)); x++)
      for (let dy = 1; dy < 5; dy++) data[row(p.z) + dy >= 0 && row(p.z) + dy < h ? (row(p.z) + dy) * w + x : 0] = 1;
  return { w, h, data };
}


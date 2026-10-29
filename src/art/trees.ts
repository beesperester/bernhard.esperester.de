// The garden's trees, drawn from their plans (world/trees.ts) so that every
// perch a cat can stand on shows: broadleaf trees with their branches
// forking out to clouds of leaves, pines in tiers of boughs, bird houses,
// and the big tree with a house in it. Leaves and bark keep a normal per
// pixel, so the trees can be shaded again as the sun moves (game/Lighting.ts).
import { Raster, hex, hash2, mulberry32, type RGB } from './raster.ts';
import { SEASON, type Season } from '../world/season.ts';
import { DEFAULT_LIGHT, type ScreenLight } from './lighting.ts';
import { SNOW, bayer } from './tiles.ts';
import { dab } from './paint.ts';
import { TREES, type Blob, type Perch, type TreePlan } from '../world/trees.ts';

export interface Prop {
  raster: Raster;
  /** The pixels shaded by the light, and how (relightProp redraws them for another sun). */
  lit?: LitPixels;
  x: number;
  y: number;
  /** y used for depth sorting against cats (their feet). */
  depthY: number;
  /** 0, 1 green trees, 2 cherry, 3 apple, 4 pine. */
  kind: number;
  plan: TreePlan;
}

// [highlight, light, mid, dark, outline]
// (painted: the lights warm and yellowish, the shadows cool and bluish, the outline a deep version of them)
const CANOPIES: { c: RGB[]; dots?: RGB[] }[] = [
  { c: ['#c2d47e', '#8eb35e', '#5f8c4a', '#3c6440', '#1c3326'].map(hex) },
  { c: ['#a6c472', '#6f9c54', '#4a7a46', '#2f5440', '#142a22'].map(hex) },
  { c: ['#fff0ee', '#f6c4d2', '#e494b4', '#b46290', '#4e2440'].map(hex), dots: [hex('#ffffff')] },
  { c: ['#c2d47e', '#8eb35e', '#5f8c4a', '#3c6440', '#1c3326'].map(hex), dots: [hex('#d83838'), hex('#f06a50')] },
];
/** A pine's needles: darker and bluer than the leaves, the same all year. */
const NEEDLES = ['#8cb48a', '#5c8a6a', '#3c6a56', '#284a44', '#122626'].map(hex);
const BARK = ['#a87850', '#7a5034', '#523424', '#2a1a16'].map(hex);
/** Autumn foliage: yellow, orange, red and russet, same tone order as the canopies. */
const AUTUMN: RGB[][] = [
  ['#f6e0a0', '#e8bc5a', '#c88e3a', '#94642c', '#43281a'].map(hex),
  ['#f6cc94', '#e49a54', '#c06c38', '#8a4a2e', '#42221c'].map(hex),
  ['#f0a890', '#d0604e', '#a83c3a', '#742a34', '#381620'].map(hex),
  ['#e2c294', '#bc8e5e', '#8e6440', '#624432', '#30201a'].map(hex),
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
  // (pale dabs where the leaves turn up to the sky)
  if ((p.speck < 0.07 || (p.speck < 0.16 && p.ny < -0.25)) && tone > 0) tone--;
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

/** Numbers kept for shading are rounded to this, so they pack into 16 bits and shade the same packed as not. */
const Q = 4096;
const q = (v: number) => Math.max(-32768, Math.min(32767, Math.round(v * Q))) / Q;

/**
 * A prop's lit pixels, packed (a park has hundreds of trees with thousands of
 * them each): where each is, its palette, and its numbers as 16-bit fixed point.
 */
export class LitPixels {
  readonly at: Int32Array;
  private readonly flags: Uint8Array;
  private readonly pal: Uint8Array;
  private readonly pals: RGB[][] = [];
  private readonly f: Int16Array;

  constructor(lit: Map<number, LitPixel>) {
    const n = lit.size;
    this.at = new Int32Array(n);
    this.flags = new Uint8Array(n);
    this.pal = new Uint8Array(n);
    this.f = new Int16Array(n * 6);
    let k = 0;
    for (const [i, p] of lit) {
      this.at[k] = i;
      const f = this.f, o = k * 6;
      if (p.leaf) {
        let pi = this.pals.indexOf(p.pal);
        if (pi < 0) pi = this.pals.push(p.pal) - 1;
        this.pal[k] = pi;
        this.flags[k] = 1 | (p.rim ? 2 : 0);
        [p.nx, p.ny, p.cx, p.cy, p.jit, p.speck].forEach((v, j) => (f[o + j] = Math.round(v * Q)));
      } else {
        this.flags[k] = p.dark ? 4 : 0;
        f[o] = Math.round(p.u * Q);
      }
      k++;
    }
  }

  get size(): number {
    return this.at.length;
  }

  /** The k-th pixel, unpacked. */
  pixel(k: number): LitPixel {
    const f = this.f, o = k * 6, fl = this.flags[k];
    return fl & 1
      ? { leaf: true, pal: this.pals[this.pal[k]], nx: f[o] / Q, ny: f[o + 1] / Q, cx: f[o + 2] / Q, cy: f[o + 3] / Q, jit: f[o + 4] / Q, speck: f[o + 5] / Q, rim: !!(fl & 2) }
      : { leaf: false, u: f[o] / Q, dark: !!(fl & 4) };
  }
}

/** Shade a prop's lit pixels for light L (in place). */
export function relightProp(prop: Prop, L: ScreenLight): void {
  const lit = prop.lit;
  if (!lit) return;
  const w = prop.raster.w;
  for (let k = 0; k < lit.size; k++) {
    const i = lit.at[k];
    prop.raster.set(i % w, Math.floor(i / w), litColour(lit.pixel(k), L));
  }
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
    // (in autumn a whole cloud of leaves turns the same colour: mostly the tree's own, now and then the next shade)
    const k = this.group ?? i;
    if (hash2(k, t.seed, 1302) < season.turn) {
      const own = Math.floor(hash2(t.seed, 0, 1303) * AUTUMN.length), u = hash2(k, t.seed, 1303);
      return AUTUMN[(own + (u < 0.65 ? 0 : u < 0.85 ? 1 : AUTUMN.length - 1)) % AUTUMN.length];
    }
    return t.colour === 2 ? CANOPIES[0].c : CANOPIES[t.colour].c;
  }

  /** While drawing one cloud of leaves: the clump number its colour goes by. */
  private group: number | null = null;

  /** A shaded leaf pixel. */
  leaf(x: number, y: number, pal: RGB[], nx: number, ny: number, rim: boolean, salt: number): void {
    if (x < 0 || y < 0 || x >= this.W || y >= this.H) return;
    const { crown, t } = this;
    const px: LitPixel = {
      leaf: true, pal, nx: q(nx), ny: q(ny), cx: q((x - crown.x) / crown.rx), cy: q((y - crown.y) / crown.ry),
      // (needles keep their fine grain; leaves come in dabs, little clusters of them catching the light)
      jit: q(t.shape === 'pine' ? (bayer(x, y) - 0.5) * 0.35 + (hash2(x, y, t.seed + salt) - 0.5) * 0.25 : dab(x, y, t.seed + salt) * 0.7),
      speck: q(hash2(x, y, t.seed * 7 + salt)), rim,
    };
    this.lit.set(y * this.W + x, px);
    this.r.set(x, y, litColour(px, DEFAULT_LIGHT));
    this.painted.set(y * this.W + x, pal);
  }

  /** A round clump of leaves; nothing above row `cut` (a cushion's flat top). */
  clump(c: Clump, pal: RGB[], cut = -Infinity, seam = false): void {
    const salt = this.clumps * 31;
    for (let y = Math.floor(c.y - c.r); y <= c.y + c.r; y++) {
      if (y < cut) continue;
      for (let x = Math.floor(c.x - c.r); x <= c.x + c.r; x++) {
        const dx = x + 0.5 - c.x, dy = y + 0.5 - c.y, d = Math.hypot(dx, dy);
        if (d > c.r) continue;
        // a flat top faces up
        const flat = y === cut ? 0.6 : 0;
        this.leaf(x, y, pal, (dx / c.r) * (1 - flat), (dy / c.r) * (1 - flat) - flat, d > c.r - 1.2, salt);
        // a puff in front of others shows its round underside against them
        if (seam && d > c.r - 1 && dy > c.r * 0.35 && Math.abs(dx) < c.r * 0.8) this.r.set(x, y, pal[3]);
      }
    }
  }

  /** A bark pixel, round across the trunk (u 0..1 from left to right). */
  bark(x: number, y: number, u: number): void {
    if (u < 0.1 || u >= 0.9) { this.r.set(x, y, BARK[3]); return; }
    const px: LitPixel = { leaf: false, u: q(u), dark: hash2(x, Math.floor(y / 3) + (x % 2), this.t.seed) < 0.18 };
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
  mass(b: Blob, line: number | null = null, dome = 0): void {
    const mx = this.cx + b.x, my = this.row(b.z), top = line === null ? -Infinity : this.row(line) + 3;
    const inside = (x: number, y: number, r: number) => ((x - mx) / Math.max(1, b.rx - r * 0.6)) ** 2 + ((y - my) / Math.max(1, b.rz - r * 0.6)) ** 2 <= 1;
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
    const k = Math.min(1.7, Math.max(1, Math.sqrt(area) / 60));
    this.group = this.clumps;
    for (const c of puffs(Math.ceil(area / (260 * k * k)), 8 * k, 12 * k)) {
      const pal = this.leaves();
      if (pal) this.clump(c, back(pal));
    }
    // (top first: the lower puffs in front of them)
    const front = puffs(Math.ceil(area / (150 * k * k)), 6 * k, 10 * k).sort((a, c) => a.y - c.y);
    // along a branch level, a row of puffs makes the edge a cat walks on: rising a little over it, a hump in the middle
    if (line !== null) {
      const row: Clump[] = [];
      for (let x = mx - b.rx + 7 * k; x <= mx + b.rx - 7 * k; x += 8 * k) {
        const r = (6.5 + this.rnd() * 2.5) * k, hump = dome * Math.max(0, 1 - ((x - mx) / b.rx) ** 2);
        row.push({ x: x + (this.rnd() - 0.5) * 3, y: this.row(line) - 1 - this.rnd() * 3 - hump + r, r });
      }
      front.unshift(...row.sort((a, c) => a.y - c.y));
    }
    for (const c of front) {
      const pal = this.leaves();
      if (pal) this.clump(c, pal, -Infinity, true);
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
      raster: r, lit: new LitPixels(lit), x: t.x - W / 2, y: t.y - (H - 1) - t.elev, depthY: t.y,
      kind: t.shape === 'pine' ? 4 : t.colour, plan: t,
    };
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
  const { t, season, r, painted, W } = s;
  const colours = t.colour === 3 ? (season.appleBlossom > 0.3 ? [hex('#ffffff'), hex('#f8d8e8')] : season.apples > 0.3 ? CANOPIES[3].dots : undefined)
    : t.colour === 2 && season.blossom > 0.3 ? CANOPIES[2].dots : undefined;
  if (!colours) return;
  for (let k = 0; k < (W * s.H) / 120; k++) {
    const x = Math.floor(s.rnd() * W), y = Math.floor(s.rnd() * s.H);
    if (!painted.has(y * W + x - 1) || !painted.has((y + 2) * W + x + 2)) continue;
    const c = colours[k % colours.length];
    r.set(x, y, c); r.set(x + 1, y, c); r.set(x, y + 1, c); r.set(x + 1, y + 1, painted.get(y * W + x)?.[3] ?? c);
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

/** The leaf mass on top of branch level p (the one whose cloud reaches up to it), if any. */
const massAt = (t: TreePlan, p: Perch): Blob | undefined => t.crown.find((b) => Math.abs(b.z + b.rz - 4 - p.z) < 1);

/**
 * A broadleaf: a stout trunk with a bough at every branch level, each
 * carrying a mass of leaves whose flat top is that level, the crown the
 * biggest on top (and maybe a bird house).
 */
function broadleaf(t: TreePlan, season: Season): Prop {
  const s = new Sketch(t, season);
  s.crown = crownOf(s, t.crown);
  const levels = t.perches.filter((p) => p.kind !== 'birdhouse');
  const top = levels[levels.length - 1];
  // the trunk carries on up the middle, thinning, into the crown
  const thin = t.trunk * 0.3;
  s.trunk(top.z - 6, (z) => Math.max(thin, t.trunk - (z / top.z) * (t.trunk - thin)));
  // (the boughs thinner further up)
  levels.forEach((p, i) => bough(s, p, Math.max(3, Math.round(t.trunk * 0.45 * (1 - (i / levels.length) * 0.5)))));
  // (bare, the limbs that carry each mass show)
  for (const b of t.crown) s.crownLimbs(b.z - b.rz + 6, Math.min(70, b.rx * 0.6), Math.max(2, Math.round(t.trunk / 5)));
  // the masses from the top down: each level's flat top over the bottom of the one above
  for (const p of [...levels].reverse()) {
    const b = massAt(t, p);
    if (b) s.mass(b, p.z, p === top ? 6 : 0);
  }
  dots(s);
  const house = t.perches.find((p) => p.kind === 'birdhouse');
  if (house) s.birdhouse(house.z);
  return s.finish();
}

/** A pine: a straight trunk with tiers of drooping boughs, narrowing to a spire. */
function pine(t: TreePlan, season: Season): Prop {
  const s = new Sketch(t, season);
  s.crown = crownOf(s, t.crown);
  const tiers = t.perches;
  const spire = t.crown[t.crown.length - 1], tip = spire.z + spire.rz;
  s.trunk(tip - 4, (z) => Math.max(1.5, t.trunk - (z / tip) * (t.trunk - 1.5)));
  const { r } = s;
  // from the top down, so the lower boughs hang over the trunk between them
  const peak = tiers[tiers.length - 1];
  for (let z = peak.z + 1; z <= tip; z++) {
    const w = Math.max(0.5, ((tip - z) / (tip - peak.z)) * 13);
    const mid = s.cx + (peak.x0 + peak.x1) / 2;
    for (let x = Math.floor(mid - w); x < Math.ceil(mid + w); x++) s.leaf(x, s.row(z), NEEDLES, (x + 0.5 - mid) / (w + 1), -0.4, false, 99);
  }
  for (const [k, p] of [...tiers.entries()].reverse()) {
    const top = s.row(p.z);
    const mid = s.cx + (p.x0 + p.x1) / 2, half = t.crown[k].rx - 3;
    const thick = p.kind === 'top' ? 46 : 50;
    s.leaves();
    for (let dy = 0; dy < thick; dy++) {
      // a cone: narrow at the top where a cat stands by the trunk, spreading and drooping to the hem
      const u0 = dy / (thick - 1), w = half * (0.3 + 0.7 * u0) + 2 * Math.sin(u0 * Math.PI);
      for (let x = Math.floor(mid - w); x < Math.ceil(mid + w); x++) {
        const u = (x + 0.5 - mid) / w;
        // ragged, drooping ends and a scalloped hem
        if (dy >= thick - 5 && hash2(x, top + dy, t.seed + 1311) < 0.15 + (dy - thick + 5) * 0.17) continue;
        if (Math.abs(u) > 0.85 && dy < 3 && hash2(x, dy, t.seed + 1312) < 0.5) continue;
        // in layers of drooping fronds
        const frond = Math.floor((dy + Math.abs(u) * 6) / 6) % 2;
        s.leaf(x, top + dy, frond ? back(NEEDLES) : NEEDLES, u * 0.9, (dy / (thick - 1)) * 1.2 - 0.5, dy === thick - 1 || Math.abs(u) > 0.95, p.z + frond);
      }
    }
    // a cone or two hanging under the bough
    if (season.snow < 0.5)
      for (let k = 0; k < 2; k++) {
        if (hash2(p.z, t.seed + k, 1313) > 0.6) continue;
        const x = Math.round(mid + (hash2(p.z, t.seed + k, 1314) - 0.5) * half * 1.4);
        for (let dy = 0; dy < 4; dy++) r.set(x, top + thick + dy, dy === 0 ? BARK[1] : BARK[2]);
        r.set(x + 1, top + thick + 1, BARK[3]); r.set(x + 1, top + thick + 2, BARK[3]);
      }
  }
  return s.finish();
}

/** The big tree with a house in it. */
function treehouse(t: TreePlan, season: Season): Prop {
  const s = new Sketch(t, season);
  s.crown = crownOf(s, t.crown);
  const at = (k: string) => t.perches.find((p) => p.kind === k)!;
  const fork = at('fork'), deck = at('deck'), roof = at('roof'), branch = at('branch'), top = at('top');
  s.trunk(top.z - 6, (z) => Math.max(6, t.trunk - (z / top.z) * (t.trunk - 6)));
  bough(s, fork, 7);
  bough(s, branch, 6);
  bough(s, top, 5);
  // limbs up behind the hut to the crown
  const crownBase = s.row(deck.z + 8);
  s.limb(s.cx - 6, crownBase, s.cx + top.x0 - 20, s.row(top.z) + 14, 6, 0.3);
  s.limb(s.cx + 5, crownBase, s.cx + top.x1 + 20, s.row(top.z) + 14, 6, 0.3);
  s.crownLimbs(top.z - 20, 60, 3);
  // the crown, the branch below it, the clouds either side behind the hut, and the hut on top of them
  s.mass(t.crown[3], top.z, 8);
  s.mass(t.crown[2], branch.z);
  s.mass(t.crown[0]);
  s.mass(t.crown[1]);
  s.treehouse(deck.x0, deck.x1, deck.z, roof.z, roof.x1);
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


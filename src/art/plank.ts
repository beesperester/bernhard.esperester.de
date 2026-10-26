import { Raster, hex, mulberry32, type RGB } from './raster.ts';

// Wooden planks for the scoreboard: one board per name, nailed on at both ends.
// The middle is stretched to fit the name, so the grain there runs straight across.

export const PLANK_W = 32, PLANK_H = 12;
/** How much of each end stays unstretched (the nails live there). */
export const PLANK_END = 7, PLANK_EDGE = 4;

type Wood = { outline: RGB; dark: RGB; base: RGB; light: RGB; shine: RGB; grain: RGB };

export const WOODS: Record<'oak' | 'pine' | 'walnut', Wood> = {
  oak: { outline: hex('#3b2412'), dark: hex('#7a4522'), base: hex('#a8642e'), light: hex('#c07a3e'), shine: hex('#e2a868'), grain: hex('#8d5226') },
  pine: { outline: hex('#4a2c10'), dark: hex('#a0662a'), base: hex('#d8a050'), light: hex('#e8b868'), shine: hex('#fbe0a0'), grain: hex('#b8803a') },
  walnut: { outline: hex('#22140a'), dark: hex('#4a2a16'), base: hex('#6a3e20'), light: hex('#7e4e2a'), shine: hex('#a0703e'), grain: hex('#553018') },
};

export function buildPlank(wood: Wood, seed: number): Raster {
  const r = new Raster(PLANK_W, PLANK_H);
  const rnd = mulberry32(seed);
  const W = PLANK_W, H = PLANK_H;
  // body: a highlight along the top, shade along the bottom
  for (let y = 1; y < H - 1; y++) r.rect(1, y, W - 2, 1, y === 1 ? wood.shine : y === 2 ? wood.light : y === H - 2 ? wood.dark : wood.base);
  // grain: long lines through the middle, short wiggles at the ends
  for (let y = 3; y < H - 3; y++) {
    if (rnd() < 0.45) r.rect(PLANK_END, y, W - 2 * PLANK_END, 1, wood.grain);
    for (const x0 of [1, W - PLANK_END]) {
      for (let x = x0; x < x0 + PLANK_END - 1; x++) if (rnd() < 0.3) r.set(x, y, wood.grain);
    }
  }
  // a knot at one end
  const kx = rnd() < 0.5 ? 4 : W - 6, ky = 4 + Math.floor(rnd() * 3);
  r.rect(kx, ky, 2, 2, wood.grain);
  r.set(kx, ky, wood.dark);
  // outline with rounded corners
  r.rect(1, 0, W - 2, 1, wood.outline);
  r.rect(1, H - 1, W - 2, 1, wood.outline);
  r.rect(0, 1, 1, H - 2, wood.outline);
  r.rect(W - 1, 1, 1, H - 2, wood.outline);
  // nails
  for (const nx of [2, W - 4]) {
    const ny = 5;
    r.rect(nx, ny, 2, 2, hex('#3a3438'));
    r.set(nx, ny, hex('#c8c0c8'));
    r.set(nx + 1, ny + 1, hex('#18141a'));
  }
  return r;
}

export function rasterURL(r: Raster): string {
  const c = document.createElement('canvas');
  c.width = r.w;
  c.height = r.h;
  c.getContext('2d')!.putImageData(new ImageData(r.data, r.w, r.h), 0, 0);
  return c.toDataURL('image/png');
}

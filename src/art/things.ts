// The things a cat can carry (world/things.ts), lying flat: small, outlined
// like the critters, the light from the top left; the GPU shades them from
// their outline like the furniture (game/Things.ts). Each faces right; drawn
// flipped (and turned in the air) for variety.

import { Raster, hex, type RGB } from './raster.ts';
import { BIRD_COLOURS } from './critters.ts';
import { PETALS } from './flora.ts';
import { LEAF_GREEN, Thing, type ThingKind } from '../world/things.ts';

const OUTLINE = hex('#24181c');
/** Autumn's leaves (the ones that drift down the streams, game/Weather.ts), and a summer one. */
const LEAVES: [string, string][] = [['#e8b030', '#b07818'], ['#e07828', '#a04c18'], ['#c84828', '#882818'], ['#a85a28', '#6c3818'], ['#f0d058', '#b89828']];
const GREEN: [string, string] = ['#7ab040', '#4a7a28'];
const WOOD = { w: hex('#8a5a32'), d: hex('#5a3820'), l: hex('#b07a48') };

/** Its picture, by kind and variant. */
export function buildThing(kind: ThingKind, v: number): Raster {
  switch (kind) {
    case Thing.Feather: {
      // a long vane with its quill showing, lighter along the shaft
      const [, b, l, w] = BIRD_COLOURS[v].map(hex);
      return sprite(['.oooooo..', 'oblllbbo.', '.owwbboqq', '..oooo...'], { o: OUTLINE, b, l, w, q: hex('#e8e0d0') });
    }
    case Thing.Leaf: {
      const [c, d] = (v === LEAF_GREEN ? GREEN : LEAVES[v]).map(hex);
      return sprite(['..ooo..', '.occdo.', 'occdcco', '.odcco.', 'ssooo..'], { o: OUTLINE, c, d, s: d });
    }
    case Thing.Twig:
      // thin: no outline, just the wood (darker underneath), with a side shoot
      return sprite([
        ['......l..', 'lllllwdw.', 'wwwwwdd..'],
        ['..l......', '.ddwlllll', 'dd..wwwww'],
        ['.......l.', 'lllwlllw.', 'wwwdwwd..', '....d....'],
      ][v], WOOD);
    case Thing.Cone:
      return sprite(['.oooo.', 'olbldo', 'obldbo', 'olbldo', '.obdo.', '..oo..'], { o: OUTLINE, l: hex('#c08a50'), b: hex('#8a5a30'), d: hex('#5a3820') });
    case Thing.Flower: {
      // picked: the head at one end, the stem with a leaf
      const p = PETALS[v], c: RGB = v === 1 ? hex('#e07820') : hex('#f8d838');
      return sprite(['.p.....', 'pcpggg.', '.p..gl.'], { p, c, g: hex('#4a7a28'), l: hex('#6a9a3a') });
    }
  }
  throw new Error(`no such thing: ${kind}`);
}

function sprite(rows: string[], pal: Record<string, RGB>): Raster {
  const r = new Raster(Math.max(...rows.map((x) => x.length)), rows.length);
  r.paint(rows, 0, 0, pal);
  return r;
}

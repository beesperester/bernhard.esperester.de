// The park's small things as files to paint over, as drawn from code in summer
// (the other seasons are worked out from it: src/art/seasonal.ts):
//
//   art/plants/<kind>.aseprite   the meadow's and the forest floor's plants, standing upright
//                                (the game bends them in the wind itself), and seasons.aseprite
//   art/water/lily-pad-<0..3>, lily-flower-<0..3>, and seasons.aseprite
//   art/woodland/log, stump, stone, boulder (the same all year: snow is laid on them in winter)
//
// Each has one layer, `art`. A file that's already there is left alone (it may
// be painted): a fresh one goes next to it as *.new.aseprite.
//
//   node tools/art-plants.ts [plants | water | woodland]
process.env.ART = 'off';
// (drawn as in summer: the plants' colours go by the season the page loads in)
const SUMMER = Date.UTC(2026, 6, 10, 10);
Date.now = () => SUMMER;
import { plant } from '../src/world/seed.ts';
import { writeArt, writeSeasons } from './art-common.ts';

plant({ seed: 8919, born: 0 });
const { Raster, mix } = await import('../src/art/raster.ts');
const { FLORA, G, CATTAIL } = await import('../src/art/flora.ts');
const { FERN, BRACKEN, RUST, SHRUB, SHRUB_TURNED, BRAMBLE_LEAF, BERRY } = await import('../src/art/undergrowth.ts');
const { PAD, PAD_TURNED, PAD_SIZES, buildPad, buildFlower } = await import('../src/art/lilies.ts');
const { buildLog, buildStump, buildStone, buildBoulder } = await import('../src/art/woodland.ts');
const { drabFor } = await import('../src/art/tiles.ts');
const { seasonAt } = await import('../src/world/season.ts');
type RGB = readonly [number, number, number];

const only = process.argv.slice(2), want = (g: string) => !only.length || only.includes(g);
/** The days the seasons' colours are taken on (as the trees' are: tools/art-trees.ts). */
const AUTUMN = seasonAt(Date.UTC(2026, 9, 20, 10)), WINTER = seasonAt(Date.UTC(2027, 0, 15, 10)), SPRING = seasonAt(Date.UTC(2026, 3, 24, 10));
const lum = (c: RGB) => c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
/** A ramp light to dark. */
const light = (r: readonly RGB[]): RGB[] => (lum(r[0]) < lum(r[r.length - 1]) ? [...r].reverse() : [...r]);
const mixed = (a: readonly RGB[], b: readonly RGB[], t: number): RGB[] => light(a.map((c, i) => mix(c, b[i], t)));

if (want('plants')) {
  for (const k of FLORA) {
    const r = new Raster(k.w, k.h);
    k.draw(r, 0, 0);
    writeArt('plants', k.key, r);
  }
  // the colours: the blades go over to straw (half way, as the meadow's tufts do), the ferns rusty, the shrubs turn
  const blades = light([G.t, G.l, G.m, G.d]), hay = (s: typeof AUTUMN) => light([G.t, G.l, G.m, G.d].map((c) => drabFor(c, s.hay * 0.5)));
  const meadow = { summer: { ramps: [blades, [CATTAIL.s]] }, autumn: { ramps: [hay(AUTUMN)] }, winter: { ramps: [hay(WINTER)] } };
  const rusty = (s: typeof AUTUMN, more = 1) => Math.min(1, Math.min(1, s.turn * 0.9 + (1 - s.leaves) * 0.6) * more);
  const fronds = (greens: readonly RGB[], more = 1) => ({
    summer: { ramps: [light(greens)] }, autumn: { ramps: [mixed(greens, RUST, rusty(AUTUMN, more))] },
    winter: { ramps: [mixed(greens, RUST, rusty(WINTER, more))] }, spring: { ramps: [mixed(greens, RUST, rusty(SPRING, more))] },
  });
  const shrub = { summer: { ramps: [light(SHRUB)] }, autumn: { ramps: [mixed(SHRUB, SHRUB_TURNED, AUTUMN.turn * 0.7), light(SHRUB_TURNED)] } };
  await writeSeasons('plants', {
    ...Object.fromEntries(FLORA.slice(0, 9).map((k) => [k.key, meadow])),
    fern: fronds(FERN), bracken: fronds(BRACKEN, 1.2),
    shrub, 'shrub-berries': { ...shrub, autumn: { ...shrub.autumn, dots: [BERRY[1], BERRY[0]] } },
    bramble: { summer: { ramps: [light(BRAMBLE_LEAF)] }, autumn: { ramps: [mixed(BRAMBLE_LEAF, RUST, AUTUMN.turn * 0.5)], dots: [BERRY[0], BERRY[1]] } },
  });
}

if (want('water')) {
  const summer = seasonAt(SUMMER);
  PAD_SIZES.forEach((_, i) => writeArt('water', `lily-pad-${i}`, buildPad(i, summer)));
  for (let i = 0; i < 4; i++) writeArt('water', `lily-flower-${i}`, buildFlower(i));
  // (the pads yellow and brown in clouds in autumn, half way in winter)
  const turned = (s: typeof AUTUMN) => Math.min(1, s.turn * 0.8 + (1 - s.leaves) * 0.5);
  const pad = {
    summer: { ramps: [light(PAD)] }, autumn: { ramps: [mixed(PAD, PAD_TURNED, turned(AUTUMN) * 0.6), light(PAD_TURNED)] },
    winter: { ramps: [mixed(PAD, PAD_TURNED, turned(WINTER))] }, spring: { ramps: [mixed(PAD, PAD_TURNED, turned(SPRING))] },
  };
  await writeSeasons('water', Object.fromEntries(PAD_SIZES.map((_, i) => [`lily-pad-${i}`, pad])));
}

if (want('woodland'))
  for (const [name, build] of [['log', buildLog], ['stump', buildStump], ['stone', buildStone], ['boulder', buildBoulder]] as const) writeArt('woodland', name, build());

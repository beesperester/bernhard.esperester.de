// The park's furniture and follies as files to paint over, as drawn from code
// in summer, painted over (paint.ts) as the game paints them; the game lays
// snow on them in winter, and freezes the water:
//
//   art/furniture/<name>   bench, picnic, bistro, chair, birdbath, blanket, basket, box (layers
//                          `back` and `front`: a cat sits between them), pump, puddle, hotel, and
//                          those that look different through the year, a frame for each, tagged:
//                          catnip (bare, young, grown, flowering), bed (bare, young, grown),
//                          barrow (empty, soil)
//   art/funfair/<name>     tent, booth, pole
//   art/woodland/<name>    log, stump, stone, boulder
//   art/follies/<kind>     layer `art`, and `roof` for those with one (drawn over a cat up on it)
//
// Keep the canvas sizes: where each stands is anchored to them. A file that's
// already there is left alone (it may be painted): a fresh one goes next to it
// as *.new.aseprite.
//
//   node tools/art-furniture.ts [furniture | funfair | woodland | follies]
process.env.ART = 'off';
const SUMMER = Date.UTC(2026, 6, 10, 10);
Date.now = () => SUMMER;
import { writeFileSync } from 'node:fs';
import { plant } from '../src/world/seed.ts';
import { placed, writeAseprite, type AseLayer } from './aseprite.ts';
import { fresh, writeArt } from './art-common.ts';

plant({ seed: 8919, born: 0 });
const F = await import('../src/art/furniture.ts');
const { buildTent, buildBooth, buildPole } = await import('../src/art/funfair.ts');
const { buildLog, buildStump, buildStone, buildBoulder } = await import('../src/art/woodland.ts');
const { buildLandmark, hasRoof } = await import('../src/art/landmarks.ts');
const { LANDMARK_SHAPES } = await import('../src/world/landmarks.ts');
const { paintOver } = await import('../src/art/paint.ts');
const { seasonAt } = await import('../src/world/season.ts');
type R = ReturnType<typeof buildTent>;

const only = process.argv.slice(2), want = (g: string) => !only.length || only.includes(g);
/** A piece as the game shows it: painted over, by its name. */
const painted = (key: string, r: R) => (paintOver(r, F.paintSeed(key)), r);
const layer = (name: string, r: R): AseLayer => ({ name, visible: true, data: placed(r, r.w, r.h, 0, 0) });

if (want('furniture')) {
  const plain: [string, () => R][] = [
    ['bench', F.buildBench], ['picnic', F.buildPicnicTable], ['bistro', F.buildBistroTable], ['chair', F.buildChair], ['birdbath', F.buildBirdBath],
    ['blanket', F.buildBlanket], ['basket', F.buildBasket], ['pump', F.buildPump], ['puddle', F.buildPumpPuddle], ['hotel', F.buildInsectHotel],
  ];
  for (const [key, build] of plain) writeArt('furniture', key, painted(key, build()));
  const back = painted('box-back', F.buildBox('back')), front = painted('box-front', F.buildBox('front'));
  const box = fresh('furniture', 'box');
  writeFileSync(box, writeAseprite(back.w, back.h, [layer('back', back), layer('front', front)]));
  console.log(box);
  const builds: Record<string, (s: ReturnType<typeof seasonAt>) => R> = { catnip: F.buildCatnip, bed: F.buildRaisedBed, barrow: F.buildBarrow };
  for (const [key, v] of Object.entries(F.VARIANTS)) {
    const frames = v.tags.map((_, i) => painted(key, builds[key](v.season(i))));
    const file = fresh('furniture', key), w = frames[0].w, h = frames[0].h;
    writeFileSync(file, writeAseprite(w, h, [{ name: 'art', visible: true, data: new Uint8Array(w * h * 4), frames: frames.map((r) => placed(r, w, h, 0, 0)) }], v.tags.map((name, i) => ({ name, from: i, to: i }))));
    console.log(file, v.tags.join(' '));
  }
}

if (want('funfair')) for (const [key, build] of [['tent', buildTent], ['booth', buildBooth], ['pole', buildPole]] as const) writeArt('funfair', key, painted(key, build()));

if (want('woodland'))
  for (const [key, build] of [['log', buildLog], ['stump', buildStump], ['stone', buildStone], ['boulder', buildBoulder]] as const) writeArt('woodland', key, painted(key, build()));

if (want('follies')) {
  const summer = seasonAt(SUMMER);
  for (const kind of Object.keys(LANDMARK_SHAPES) as (keyof typeof LANDMARK_SHAPES)[]) {
    const art = buildLandmark(kind, summer);
    writeArt('follies', kind, art, hasRoof(kind) ? [layer('roof', buildLandmark(kind, summer, true))] : []);
  }
}

import Phaser from 'phaser';
import { Raster } from '../art/raster.ts';
import { buildCatSheet, buildEyeSheet, COATS, CAT, FRAME_NAMES } from '../art/cat.ts';
import { buildGrounds, buildWaterMask } from '../art/tiles.ts';
import { buildProps } from '../art/trees.ts';
import { buildTerrain } from '../art/terrain.ts';
import { FLORA, buildFloraSheet } from '../art/flora.ts';
import { BIRD_COLOURS, BIRD_W, BIRD_H, BUTTERFLY_COLOURS, HELD_W, RIPPLE_W, RIPPLE_H, Z_SIZES, buildAlert, buildBee, buildBird, buildFirefly, buildFrog, buildGlow, buildHeldFrog, buildHeldBat, buildMouse, buildHeldMouse, MOUSE_W, MOUSE_H, buildLantern, FROG_W, FROG_H, LANTERN_W, LANTERN_H, buildButterfly, buildDust, buildDashPuff, PUFF_W, PUFF_H, buildFeather, buildFish, buildFishShadow, buildHeldBird, buildHeldFish, buildRipples, buildZ, buildBat, buildHangingBat, buildBeetle, buildDragonfly, BEETLE_COLOURS, BEETLE_W, BEETLE_H, DRAGONFLY_W, DRAGONFLY_H, buildOwl, buildOwlEyes, BAT_W, BAT_H, OWL_W, OWL_H } from '../art/critters.ts';
import { ICONS } from '../art/icons.ts';
import { snowCap } from '../art/furniture.ts';
import { SEASON } from '../world/season.ts';
import { addFloraTextures } from './Meadow.ts';
import { addWeatherTextures } from './Weather.ts';

// Every picture in the game is drawn in code; this turns them all into Phaser
// textures (sprite sheets cut into frames) once, when the garden starts.

/** A raster as a canvas, for Phaser and for drawing. */
export function toCanvas(r: Raster): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = r.w;
  c.height = r.h;
  c.getContext('2d')!.putImageData(new ImageData(r.data, r.w, r.h), 0, 0);
  return c;
}

export function makeTextures(scene: Phaser.Scene) {
const tex = scene.textures;
  const cats = COATS.map((_, c) => {
    const canvas = toCanvas(buildCatSheet(c));
    const t = tex.addCanvas(`cat-${c}`, canvas)!;
    for (let f = 0; f < FRAME_NAMES.length * 2; f++) t.add(f, 0, f * CAT, 0, CAT, CAT);
    return canvas;
  });
  const grounds = buildGrounds();
  grounds.forEach((g, i) => tex.addCanvas(`ground-${i}`, toCanvas(g)));
  const terrain = buildTerrain(grounds[0]).map((t, i) => {
    tex.addCanvas(`terrain-${i}`, toCanvas(t.raster));
    return t;
  });
  const props = buildProps().map((p) => toCanvas(p.raster));
  const flora = addFloraTextures(scene, (i) => toCanvas(buildFloraSheet(FLORA[i])));
  for (const [k, make] of Object.entries(ICONS)) tex.addCanvas(k, toCanvas(make()));
  const sheet = (key: string, r: Raster, fw: number, fh: number) => {
    const t = tex.addCanvas(key, toCanvas(r))!;
    for (let f = 0; f * fw < r.w; f++) t.add(f, 0, f * fw, 0, fw, fh);
  };
  BUTTERFLY_COLOURS.forEach((_, i) => sheet(`butterfly-${i}`, buildButterfly(i), 7, 5));
  sheet('bee', buildBee(), 4, 3);
  tex.addCanvas('alert', toCanvas(buildAlert()));
  COATS.forEach((_, c) => sheet(`cat-eyes-${c}`, buildEyeSheet(c), CAT, CAT));
  tex.addCanvas('firefly', toCanvas(buildFirefly()));
  tex.addCanvas('glow-firefly', toCanvas(buildGlow(9, 9, [200, 255, 120])));
  tex.addCanvas('glow-puff', toCanvas(buildGlow(15, 15, [220, 255, 150])));
  tex.addCanvas('glow-lamp', toCanvas(buildGlow(11, 11, [255, 220, 130])));
  tex.addCanvas('glow-lantern', toCanvas(buildGlow(76, 40, [255, 190, 100], 6)));
  sheet('frog', buildFrog(), FROG_W, FROG_H);
  sheet('bat', buildBat(), BAT_W, BAT_H);
  BEETLE_COLOURS.forEach((_, i) => sheet(`beetle-${i}`, buildBeetle(i), BEETLE_W, BEETLE_H));
  sheet('dragonfly', buildDragonfly(), DRAGONFLY_W, DRAGONFLY_H);
  sheet('bat-hang', buildHangingBat(), BAT_W, 7);
  sheet('owl', buildOwl(), OWL_W, OWL_H);
  sheet('owl-eyes', buildOwlEyes(), OWL_W, OWL_H);
  sheet('held-frog', buildHeldFrog(), HELD_W, 5);
  sheet('held-bat', buildHeldBat(), HELD_W, 5);
  sheet('mouse', buildMouse(), MOUSE_W, MOUSE_H);
  sheet('held-mouse', buildHeldMouse(), HELD_W, 5);
  const lantern = buildLantern();
  snowCap(lantern, SEASON.snow);
  sheet('lantern', lantern, LANTERN_W, LANTERN_H);
  BIRD_COLOURS.forEach((_, i) => {
    sheet(`bird-${i}`, buildBird(i), BIRD_W, BIRD_H);
    sheet(`held-bird-${i}`, buildHeldBird(i), HELD_W, 5);
    tex.addCanvas(`feather-${i}`, toCanvas(buildFeather(i)));
  });
  sheet('ripple', buildRipples(), RIPPLE_W, RIPPLE_H);
  addWeatherTextures(scene, toCanvas);
  sheet('dust', buildDust(), 6, 5);
  sheet('dash-puff', buildDashPuff(), PUFF_W, PUFF_H);
  tex.addCanvas('fish', toCanvas(buildFish()));
  tex.addCanvas('fish-shadow', toCanvas(buildFishShadow()));
  sheet('held-fish', buildHeldFish(), HELD_W, 5);
  Z_SIZES.forEach((n, i) => tex.addCanvas(`z-${i}`, toCanvas(buildZ(n))));
  const drop = new Raster(1, 1);
  drop.set(0, 0, [232, 244, 255]);
  tex.addCanvas('drop', toCanvas(drop));
  return { cats, props, flora, terrain, water: buildWaterMask(grounds[0], grounds[1]) };
}


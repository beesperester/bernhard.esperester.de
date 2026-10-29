import Phaser from 'phaser';
import type { Light } from '../world/sky.ts';
import { DEPTH } from './Daylight.ts';
import { seedRng } from './fauna/kit.ts';
import { cullerFor } from './Culler.ts';
import type { Occluder } from './Lanterns.ts';
import { toCanvas } from './textures.ts';
import type { Mask } from '../art/raster.ts';

type Box = { x: number; y: number; w: number; h: number };
const MOON_R = 6, HALO_R = MOON_R * 3;
/** Slack at the edge between the moon's lit and dark side (as a fraction of its radius). */
const TERMINATOR = 0.5 / MOON_R;

/**
 * Stars, and the moon in its current phase, mirrored in the ponds at night.
 * Drawn above the night tint so they twinkle; clipped to open water, less
 * whatever stands in front of it (a tree leaning over, a bank, a folly).
 */
export class NightWater {
  private readonly pools: { box: Box; tex: Phaser.Textures.CanvasTexture; img: Phaser.GameObjects.Image; mask: HTMLCanvasElement; stars: [number, number, number, number][] }[] = [];
  private readonly moon: { x: number; y: number } | null;
  private next = 0;

  constructor(scene: Phaser.Scene, boxes: Box[], waterMask: Mask, occluders: Occluder[]) {
    const wet = (x: number, y: number) => waterMask.isSet(x, y);
    // the moon sits in the widest stretch of open water
    let moon: { x: number; y: number } | null = null, best = 0;
    for (const b of boxes)
      for (let y = b.y + MOON_R + 2; y < b.y + b.h - MOON_R - 2; y += 3)
        for (let x = b.x + MOON_R + 2; x < b.x + b.w - MOON_R - 2; x += 3) {
          let room = 0;
          while (room < 40 && [[room, 0], [-room, 0], [0, room], [0, -room]].every(([dx, dy]) => wet(x + dx, y + dy))) room += 2;
          if (room > best) { best = room; moon = { x, y }; }
        }
    this.moon = moon;

    boxes.forEach((box, i) => {
      const key = `night-water-${i}`;
      const tex = scene.textures.createCanvas(key, box.w, box.h)!;
      const mask = toCanvas(waterMask.crop(box.x, box.y, box.w, box.h));
      const mg = mask.getContext('2d')!;
      // (only the water behind it: above the line its foot stands on)
      mg.globalCompositeOperation = 'destination-out';
      for (const o of occluders)
        if (o.depth > box.y && o.x < box.x + box.w && o.x + o.w > box.x && o.y < box.y + box.h && o.y + o.h > box.y) {
          mg.save();
          mg.beginPath();
          mg.rect(0, 0, box.w, Math.ceil(o.depth) - box.y);
          mg.clip();
          mg.drawImage(o.canvas, o.x - box.x, o.y - box.y);
          mg.restore();
        }
      const r = seedRng(box.x, box.y, 77);
      const stars: [number, number, number, number][] = [];
      for (let n = 0; n < (box.w * box.h) / 140; n++) {
        const x = Math.floor(r() * box.w), y = Math.floor(r() * box.h);
        if (wet(box.x + x, box.y + y)) stars.push([x, y, 0.6 + r() * 2, r() * 6.3]);
      }
      const img = cullerFor(scene).add(scene.add.image(box.x, box.y, key).setOrigin(0).setDepth(DEPTH.glow).setBlendMode(Phaser.BlendModes.ADD).setVisible(false));
      this.pools.push({ box, tex, img, mask, stars });
    });
  }

  update(light: Light, time: number, view: Phaser.Geom.Rectangle): void {
    const night = light.night;
    for (const p of this.pools) p.img.setVisible(night > 0.02).setAlpha(night);
    if (night <= 0.02 || time < this.next) return;
    this.next = time + 120;
    const t = time / 1000;
    for (const p of this.pools) {
      const { box, tex, mask, stars } = p;
      // on screen or just off it (so it's ready when the camera gets there)
      if (box.x > view.right + 48 || box.x + box.w < view.x - 48 || box.y > view.bottom + 48 || box.y + box.h < view.y - 48) continue;
      const g = tex.getContext();
      g.globalCompositeOperation = 'source-over';
      g.clearRect(0, 0, box.w, box.h);
      for (const [x, y, f, ph] of stars) {
        const a = 0.25 + 0.75 * Math.sin(t * f + ph) ** 2;
        g.fillStyle = `rgba(220, 230, 255, ${(a * 0.8).toFixed(2)})`;
        g.fillRect(x, y, 1, 1);
      }
      if (this.moon) this.drawMoon(g, box, light.moonPhase, t);
      // only on open water
      g.globalCompositeOperation = 'destination-in';
      g.drawImage(mask, 0, 0);
      g.globalCompositeOperation = 'source-over';
      tex.refresh();
    }
  }

  /** The moon's reflection: its lit part for today's phase, gently rippling. */
  private drawMoon(g: CanvasRenderingContext2D, box: Box, phase: number, t: number): void {
    const mx = this.moon!.x - box.x, my = this.moon!.y - box.y;
    // (the halo reaches into the boxes next to the moon's: each draws its part)
    if (mx < -HALO_R || my < -HALO_R || mx > box.w + HALO_R || my > box.h + HALO_R) return;
    // within a couple of days of full it's drawn round: at this size a sliver of shadow only looks like a bite
    const k = Math.abs(phase - 0.5) < 0.08 ? -1 : Math.cos(phase * Math.PI * 2);
    for (let y = -MOON_R; y <= MOON_R; y++) {
      const half = Math.sqrt(Math.max(0, MOON_R * MOON_R - y * y));
      const wobble = Math.round(Math.sin((this.moon!.y + y) * 0.9 + t * 2.2) * 0.8);
      for (let x = -MOON_R; x <= MOON_R; x++) {
        if (Math.abs(x) > half) continue;
        const u = x / MOON_R, s = half / MOON_R;
        // waxing: lit from the right; waning: from the left
        // (by pixel centres, give or take half a pixel, so the round edge stays round)
        const lit = phase < 0.5 ? u > k * s - TERMINATOR : u < -k * s + TERMINATOR;
        g.fillStyle = lit ? 'rgba(255, 248, 210, 0.9)' : 'rgba(120, 130, 170, 0.18)';
        g.fillRect(mx + x + wobble, my + y, 1, 1);
      }
    }
    // a soft halo around it
    const halo = g.createRadialGradient(mx, my, MOON_R, mx, my, HALO_R);
    halo.addColorStop(0, 'rgba(200, 210, 255, 0.25)');
    halo.addColorStop(1, 'rgba(200, 210, 255, 0)');
    g.fillStyle = halo;
    g.fillRect(mx - HALO_R, my - HALO_R, HALO_R * 2, HALO_R * 2);
  }
}

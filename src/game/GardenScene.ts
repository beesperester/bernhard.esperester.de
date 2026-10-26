import Phaser from 'phaser';
import { Raster } from '../art/raster.ts';
import { buildCatSheet, COATS, CAT, FRAME_NAMES } from '../art/cat.ts';
import { buildGround, buildProps, buildWaterMask } from '../art/tiles.ts';
import { FLORA, buildFloraSheet } from '../art/flora.ts';
import { BUTTERFLY_COLOURS, HELD_W, RIPPLE_W, RIPPLE_H, Z_SIZES, buildBee, buildButterfly, buildDust, buildFish, buildFishShadow, buildHeldFish, buildRipples, buildZ } from '../art/critters.ts';
import { ICONS } from '../art/icons.ts';
import { WORLD_W, WORLD_H, TILE, MAP_W, MAP_H, FEET, heightUnder, waterUnder, wetAt, groundAt, spawnPoints, tileAt, pondBounds } from '../world/map.ts';
import { Act, CATCH_MS, EAT_MS, Facing, GRAVITY, HISS_MS, JUMP_V, LICK_MS, ROLL_MS, SIT_AFTER_MS, SLEEP_AFTER_MS, SWIPE_AT_MS, type CatMsg } from './state.ts';
import { CatView, RemoteCat } from './CatView.ts';
import { Meadow, addFloraTextures } from './Meadow.ts';
import { Sunlight } from './Sunlight.ts';
import { Clouds } from './Clouds.ts';
import { PondReflection } from './PondReflection.ts';
import { Trees } from './Trees.ts';
import { Vignette } from './Vignette.ts';
import { Ambient } from './Ambient.ts';
import { Net } from '../net/net.ts';
import { touch, setupUI } from '../ui/ui.ts';

const SPEED = 64; // px per second
const DASH_SPEED = 168;
/** Dash lasts while held, up to this long. */
const DASH_MS = 2500;
/** Recovery after a full-length dash; shorter dashes recover proportionally faster. */
const DASH_COOLDOWN_MS = 30000;
const DASH_COOLDOWN_MIN_MS = 2000;
// a cat that lands in the pond hops straight back out to dry land
const HOP_MS = 480;
const HOP_HEIGHT = 16;
// send up to 20x/s while airborne (jumps are short), otherwise up to 10x/s
const TICK_MS = 50;
const SEND_MS = 100;
const HEARTBEAT_MS = 1000;
const STALE_MS = 15000;

function toCanvas(r: Raster): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = r.w;
  c.height = r.h;
  c.getContext('2d')!.putImageData(new ImageData(r.data, r.w, r.h), 0, 0);
  return c;
}

function loadCoat(): number {
  try {
    const v = localStorage.getItem('cat-coat');
    if (v !== null && /^\d+$/.test(v) && +v < COATS.length) return +v;
  } catch { /* storage unavailable */ }
  const coat = Math.floor(Math.random() * COATS.length);
  try { localStorage.setItem('cat-coat', String(coat)); } catch { /* ignore */ }
  return coat;
}

export class GardenScene extends Phaser.Scene {
  private me!: CatView;
  private remotes = new Map<string, RemoteCat>();
  private net!: Net;
  private keys!: {
    up: Phaser.Input.Keyboard.Key; down: Phaser.Input.Keyboard.Key;
    left: Phaser.Input.Keyboard.Key; right: Phaser.Input.Keyboard.Key;
    jump: Phaser.Input.Keyboard.Key; hiss: Phaser.Input.Keyboard.Key; roll: Phaser.Input.Keyboard.Key;
    dash: Phaser.Input.Keyboard.Key; catch: Phaser.Input.Keyboard.Key;
  };
  private lastInput = 0;
  private nextLick = 0;
  private youMarker!: Phaser.GameObjects.Image;
  private ui!: ReturnType<typeof setupUI>;
  private lastSent: CatMsg | null = null;
  private lastSentAt = 0;
  private garden = 1;
  private meadow!: Meadow;
  private sun!: Sunlight;
  private clouds!: Clouds;
  private pond!: PondReflection;
  private trees!: Trees;
  private vignette!: Vignette;
  private camAnchor!: Phaser.GameObjects.Zone;
  private vz = 0;
  private ambient!: Ambient;
  private dashStart = 0;
  private dashing = false;
  private dashReadyAt = 0;
  private lastDry = { x: 0, y: 0 };
  private hop: { fx: number; fy: number; tx: number; ty: number; tz: number; t0: number } | null = null;
  private catching: { target: number | null; swiped: boolean; got: boolean } | null = null;

  constructor() {
    super('garden');
  }

  create(): void {
    const canvases = this.makeTextures();

    const grounds = [0, 1].map((p) => this.add.image(0, 0, `ground-${p}`).setOrigin(0).setDepth(-100000));
    grounds[1].setVisible(false);
    this.time.addEvent({ delay: 700, loop: true, callback: () => grounds.forEach((g) => g.setVisible(!g.visible)) });

    const props = buildProps();
    this.trees = new Trees(this, props, canvases.props);
    this.meadow = new Meadow(this);
    this.pond = new PondReflection(this, {
      waterMask: toCanvas(buildWaterMask()),
      catSheets: canvases.cats,
      floraSheets: canvases.flora,
      props: props.map((p, i) => ({ p, canvas: canvases.props[i] })),
      plants: this.meadow.plants,
    });
    this.clouds = new Clouds(this, toCanvas);
    this.sun = new Sunlight(this, toCanvas);
    // soft glow: bright areas (path, blossom, sunlight, white fur) bleed light into their surroundings
    Phaser.Actions.AddEffectBloom(this.cameras.main, { threshold: 0.55, blurRadius: 3, blurSteps: 4, blurQuality: 0, blendAmount: 0.35 });
    this.vignette = new Vignette(this);
    const flowers: [number, number][] = this.meadow.plants.filter((p) => p.kind >= 3).map((p) => [p.x, p.y - 9]);
    for (let ty = 0; ty < MAP_H; ty++)
      for (let tx = 0; tx < MAP_W; tx++) if (tileAt(tx, ty) === 'f') flowers.push([tx * TILE + 8, ty * TILE + 8]);
    this.ambient = new Ambient(this, { flowers, water: buildWaterMask(), pond: pondBounds() });

    const spawns = spawnPoints();
    const [sx, sy] = spawns[Math.floor(Math.random() * spawns.length)];
    const now = this.time.now;
    this.me = new CatView(this, sx, sy, loadCoat());
    this.lastDry = { x: sx, y: sy };
    this.lastInput = now;

    this.youMarker = this.add.image(sx, sy, 'you').setOrigin(0.5, 1).setDepth(100001);
    this.time.delayedCall(4000, () => this.youMarker.destroy());

    const cam = this.cameras.main;
    cam.setBounds(0, 0, WORLD_W, WORLD_H);
    // follow the cat's feet on the ground plane, so jumps don't shake the view
    this.camAnchor = this.add.zone(sx, sy, 1, 1);
    cam.startFollow(this.camAnchor, true);
    cam.setRoundPixels(true);
    this.scale.on('resize', () => this.fitZoom());
    this.fitZoom();

    const kb = this.input.keyboard!;
    const K = Phaser.Input.Keyboard.KeyCodes;
    this.keys = {
      up: kb.addKey(K.UP), down: kb.addKey(K.DOWN), left: kb.addKey(K.LEFT), right: kb.addKey(K.RIGHT),
      jump: kb.addKey(K.SPACE), hiss: kb.addKey(K.H), roll: kb.addKey(K.R), dash: kb.addKey(K.SHIFT), catch: kb.addKey(K.C),
    };

    this.ui = setupUI();
    this.ui.setStatus('looking for other cats…');
    this.net = new Net(() => this.state(), {
      onState: (id, msg) => {
        const cat = this.remotes.get(id);
        if (cat) cat.apply(msg, this.time.now);
        else {
          const cat = new RemoteCat(this, msg, this.time.now);
          cat.id = id;
          this.remotes.set(id, cat);
        }
        this.updateStatus();
      },
      onCatch: (id, fishId) => {
        const cat = this.remotes.get(id);
        if (cat) this.ambient.catchFish(fishId, cat);
      },
      onLeave: (id) => {
        this.remotes.get(id)?.destroy();
        this.remotes.delete(id);
        this.updateStatus();
      },
      onStatus: (garden) => {
        this.garden = garden;
        this.updateStatus();
      },
    });
    this.me.id = this.net.id;
    this.net.start();
    // timers keep running while the tab is in the background, so others still see us
    window.setInterval(() => this.sendState(), TICK_MS);
  }

  private makeTextures() {
    const tex = this.textures;
    const cats = COATS.map((_, c) => {
      const canvas = toCanvas(buildCatSheet(c));
      const t = tex.addCanvas(`cat-${c}`, canvas)!;
      for (let f = 0; f < FRAME_NAMES.length * 2; f++) t.add(f, 0, f * CAT, 0, CAT, CAT);
      return canvas;
    });
    tex.addCanvas('ground-0', toCanvas(buildGround(0)));
    tex.addCanvas('ground-1', toCanvas(buildGround(1)));
    const props = buildProps().map((p) => toCanvas(p.raster));
    const flora = addFloraTextures(this, (i) => toCanvas(buildFloraSheet(FLORA[i])));
    for (const [k, make] of Object.entries(ICONS)) tex.addCanvas(k, toCanvas(make()));
    const sheet = (key: string, r: Raster, fw: number, fh: number) => {
      const t = tex.addCanvas(key, toCanvas(r))!;
      for (let f = 0; f * fw < r.w; f++) t.add(f, 0, f * fw, 0, fw, fh);
    };
    BUTTERFLY_COLOURS.forEach((_, i) => sheet(`butterfly-${i}`, buildButterfly(i), 7, 5));
    sheet('bee', buildBee(), 4, 3);
    sheet('ripple', buildRipples(), RIPPLE_W, RIPPLE_H);
    sheet('dust', buildDust(), 6, 5);
    tex.addCanvas('fish', toCanvas(buildFish()));
    tex.addCanvas('fish-shadow', toCanvas(buildFishShadow()));
    sheet('held-fish', buildHeldFish(), HELD_W, 5);
    Z_SIZES.forEach((n, i) => tex.addCanvas(`z-${i}`, toCanvas(buildZ(n))));
    const drop = new Raster(1, 1);
    drop.set(0, 0, [232, 244, 255]);
    tex.addCanvas('drop', toCanvas(drop));
    return { cats, props, flora };
  }

  private fitZoom(): void {
    const { width, height } = this.scale.gameSize;
    const zoom = Math.max(2, Math.round(Math.min(width / 260, height / 220)));
    this.cameras.main.setZoom(zoom);
    this.sun?.resize();
    this.vignette?.resize();
  }

  private state(): CatMsg {
    const m = this.me;
    const r = (v: number) => Math.round(v * 10) / 10;
    return [r(m.x), r(m.y), r(m.z), m.facing, m.act, m.seq, m.coat];
  }

  private sendState(): void {
    const s = this.state();
    const now = performance.now();
    const changed = !this.lastSent || s.some((v, i) => v !== this.lastSent![i]);
    const airborne = this.me.act === Act.Jump;
    if (changed ? !airborne && now - this.lastSentAt < SEND_MS : now - this.lastSentAt < HEARTBEAT_MS) return;
    this.net.broadcast(s);
    this.lastSent = s;
    this.lastSentAt = now;
  }

  private updateStatus(): void {
    const n = this.remotes.size;
    const others = n === 0 ? 'just you so far' : n === 1 ? '1 other cat' : `${n} other cats`;
    this.ui.setStatus(`garden ${this.garden} · ${others}`);
  }

  update(time: number, delta: number): void {
    const dt = Math.min(delta, 100) / 1000;
    this.updateLocal(time, dt);

    for (const [id, cat] of this.remotes) {
      if (time - cat.lastSeen > STALE_MS) {
        cat.destroy();
        this.remotes.delete(id);
        this.updateStatus();
        continue;
      }
      cat.step(dt);
      cat.render(time);
    }
    this.me.render(time);

    this.camAnchor.setPosition(this.me.x, this.me.y);

    const cats: CatView[] = [this.me, ...this.remotes.values()];
    this.trees.update(cats);
    // the garden clock is shared by all visitors, so wind and fauna line up
    const gt = this.net.now();
    this.meadow.update(gt, cats);
    this.pond.update(time, cats);
    this.ambient.update(gt, dt, cats);
    this.clouds.update(gt);
    const view = this.cameras.main.worldView;
    this.sun.update(time, dt, this.clouds.coverAt(view.centerX, view.centerY));
    if (this.youMarker.active) {
      const bob = Math.floor(time / 300) % 2;
      this.youMarker.setPosition(Math.round(this.me.x), Math.round(this.me.y - this.me.z) - 18 - bob).setVisible(Math.floor(time / 300) % 4 !== 3);
    }
  }

  private updateLocal(now: number, dt: number): void {
    const me = this.me;
    const k = this.keys;
    const JD = Phaser.Input.Keyboard.JustDown;
    let dx = (k.right.isDown || touch.right ? 1 : 0) - (k.left.isDown || touch.left ? 1 : 0);
    let dy = (k.down.isDown || touch.down ? 1 : 0) - (k.up.isDown || touch.up ? 1 : 0);
    const jump = JD(k.jump) || touch.pressed.has('jump');
    const hiss = JD(k.hiss) || touch.pressed.has('hiss');
    const roll = JD(k.roll) || touch.pressed.has('roll');
    const dash = JD(k.dash) || touch.pressed.has('dash');
    const dashHeld = k.dash.isDown || touch.held.has('dash');
    const grab = JD(k.catch) || touch.pressed.has('catch');
    touch.pressed.clear();
    const moving = dx !== 0 || dy !== 0;
    if (moving || jump || hiss || roll || dash || grab) {
      this.lastInput = now;
      this.ui.hideHelp();
    }

    if (this.hop) {
      // scrambling back out of the pond: no control until back on dry land
      const h = this.hop;
      const u = Math.min(1, (now - h.t0) / HOP_MS);
      me.x = h.fx + (h.tx - h.fx) * u;
      me.y = h.fy + (h.ty - h.fy) * u;
      me.z = h.tz * u + HOP_HEIGHT * 4 * u * (1 - u);
      if (u >= 1) {
        me.z = h.tz;
        this.hop = null;
        me.setAct(Act.Idle, now);
      }
      return;
    }

    const elapsed = now - me.actStart;
    const begin = (act: Act) => {
      me.seq = (me.seq + 1) & 0xffff;
      me.setAct(act, now);
    };

    // finish timed acts
    if ((me.act === Act.Hiss && elapsed >= HISS_MS) || (me.act === Act.Roll && elapsed >= ROLL_MS)) me.setAct(Act.Idle, now);
    if (me.act === Act.Lick && elapsed >= LICK_MS) {
      me.setAct(Act.Sit, now);
      this.nextLick = now + 4000 + Math.random() * 7000;
    }

    // dash runs while the key is held (up to DASH_MS), then needs a long rest
    if (dash && !this.dashing && now >= this.dashReadyAt) {
      this.dashing = true;
      this.dashStart = now;
    }
    if (this.dashing && (!dashHeld || now - this.dashStart >= DASH_MS)) {
      this.dashing = false;
      const used = Math.min(1, (now - this.dashStart) / DASH_MS);
      this.dashReadyAt = now + Math.max(DASH_COOLDOWN_MIN_MS, used * DASH_COOLDOWN_MS);
    }
    this.ui.setDashCooldown(Math.ceil(Math.max(0, this.dashReadyAt - now) / 1000));
    if (me.act === Act.Eat && elapsed >= EAT_MS) me.setAct(Act.Idle, now);
    if (me.act === Act.Sleep && (jump || hiss || roll || grab)) me.setAct(Act.Idle, now);

    // catching: swipe at a fish lingering within a tile of the cat
    if (grab && me.act !== Act.Jump && me.act !== Act.Catch && me.act !== Act.Eat && !wetAt(me.x, me.y)) {
      const fish = this.ambient.fishNear(me);
      if (fish) me.facing = fish.x < me.x ? Facing.Left : Facing.Right;
      else if (me.facing === Facing.Up || me.facing === Facing.Down) me.facing = Facing.Left;
      this.catching = { target: fish?.id ?? null, swiped: false, got: false };
      begin(Act.Catch);
      return;
    }
    if (me.act === Act.Catch && this.catching) {
      const c = this.catching;
      if (!c.swiped && elapsed >= SWIPE_AT_MS) {
        c.swiped = true;
        // the fish may have drifted off or been taken by someone else meanwhile
        const fish = this.ambient.fishNear(me);
        if (c.target !== null && fish?.id === c.target) {
          this.ambient.catchFish(fish.id, me);
          this.net.catchFish(fish.id);
          c.got = true;
        }
      }
      if (elapsed >= CATCH_MS) {
        if (c.got) begin(Act.Eat);
        else me.setAct(Act.Idle, now);
        this.catching = null;
      }
      return;
    }
    const grounded = me.act !== Act.Jump;
    if (hiss && grounded) begin(Act.Hiss);
    else if (roll && grounded) begin(Act.Roll);
    else if (jump && grounded) {
      begin(Act.Jump);
      this.vz = JUMP_V;
    }

    if (moving) {
      if (me.act === Act.Hiss || me.act === Act.Roll || me.act === Act.Sit || me.act === Act.Lick || me.act === Act.Sleep || me.act === Act.Eat)
        me.setAct(Act.Idle, now);
      if (dx !== 0) me.facing = dx < 0 ? Facing.Left : Facing.Right;
      else me.facing = dy < 0 ? Facing.Up : Facing.Down;
      if (dx !== 0 && dy !== 0) { dx *= Math.SQRT1_2; dy *= Math.SQRT1_2; }
      const speed = this.dashing ? DASH_SPEED : SPEED;
      this.move(dx * speed * dt, dy * speed * dt);
      if (me.act === Act.Idle) me.setAct(Act.Walk, now);
    } else if (me.act === Act.Walk) {
      me.setAct(Act.Idle, now);
    }

    // vertical: fall onto whatever surface is below (also when walking off a hedge)
    const ground = groundAt(me.x, me.y);
    if (me.z > ground || this.vz > 0) {
      if (me.act !== Act.Jump) me.setAct(Act.Jump, now);
      this.vz -= GRAVITY * dt;
      me.z += this.vz * dt;
      if (me.z <= ground) {
        me.z = ground;
        this.vz = 0;
        me.setAct(moving ? Act.Walk : Act.Idle, now);
        if (wetAt(me.x, me.y)) {
          // splash! straight back out to where we last stood on dry land
          const { x, y } = this.lastDry;
          if (Math.abs(x - me.x) > 0.5) me.facing = x < me.x ? Facing.Left : Facing.Right;
          this.hop = { fx: me.x, fy: me.y, tx: x, ty: y, tz: groundAt(x, y), t0: now };
          begin(Act.Jump);
          return;
        }
      }
    } else {
      me.z = ground;
      if (me.act === Act.Jump) me.setAct(moving ? Act.Walk : Act.Idle, now);
    }

    if (me.act !== Act.Jump && !wetAt(me.x, me.y)) this.lastDry = { x: me.x, y: me.y };

    if (me.act === Act.Idle && now - this.lastInput > SIT_AFTER_MS) {
      if (me.facing === Facing.Up) me.facing = Facing.Down;
      me.setAct(Act.Sit, now);
      this.nextLick = now + 2500 + Math.random() * 4000;
    }
    if (me.act === Act.Sit && now >= this.nextLick) begin(Act.Lick);
    // after a long while the cat curls up and falls asleep
    if (me.act === Act.Sit && now - this.lastInput > SLEEP_AFTER_MS) me.setAct(Act.Sleep, now);
  }

  /**
   * Move horizontally, but only onto surfaces no higher than the cat currently is.
   * Cats won't walk into the pond, but they can jump in.
   */
  private move(mx: number, my: number): void {
    const me = this.me;
    const airborne = me.act === Act.Jump;
    const hits = (x: number, y: number) => {
      const [x0, y0, x1, y1] = [x + FEET.x0, y + FEET.y0, x + FEET.x1, y + FEET.y1];
      return heightUnder(x0, y0, x1, y1) > me.z + 0.5 || (!airborne && waterUnder(x0, y0, x1, y1));
    };
    if (mx && !hits(me.x + mx, me.y)) me.x += mx;
    if (my && !hits(me.x, me.y + my)) me.y += my;
  }
}

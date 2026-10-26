import Phaser from 'phaser';
import { Raster } from '../art/raster.ts';
import { buildCatSheet, COATS, CAT, FRAME_NAMES } from '../art/cat.ts';
import { buildGround, buildProps } from '../art/tiles.ts';
import { ICONS } from '../art/icons.ts';
import { WORLD_W, WORLD_H, boxHitsSolid, spawnPoints } from '../world/map.ts';
import { Act, Facing, HISS_MS, JUMP_MS, LICK_MS, ROLL_MS, SIT_AFTER_MS, type CatMsg } from './state.ts';
import { CatView, RemoteCat } from './CatView.ts';
import { Net } from '../net/net.ts';
import { touch, setupUI } from '../ui/ui.ts';

const SPEED = 64; // px per second
const SEND_MS = 100;
const HEARTBEAT_MS = 1000;
const STALE_MS = 15000;
// feet hitbox, relative to the cat's (x, y) = bottom centre
const HIT = { x0: -5, x1: 5, y0: -5, y1: 0 };

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
  };
  private lastInput = 0;
  private nextLick = 0;
  private youMarker!: Phaser.GameObjects.Image;
  private ui!: ReturnType<typeof setupUI>;
  private lastSent: CatMsg | null = null;
  private lastSentAt = 0;
  private garden = 1;

  constructor() {
    super('garden');
  }

  create(): void {
    this.makeTextures();

    const grounds = [0, 1].map((p) => this.add.image(0, 0, `ground-${p}`).setOrigin(0).setDepth(-100000));
    grounds[1].setVisible(false);
    this.time.addEvent({ delay: 700, loop: true, callback: () => grounds.forEach((g) => g.setVisible(!g.visible)) });

    buildProps().forEach((p, i) => this.add.image(p.x, p.y, `prop-${i}`).setOrigin(0).setDepth(p.depthY));

    const spawns = spawnPoints();
    const [sx, sy] = spawns[Math.floor(Math.random() * spawns.length)];
    const now = this.time.now;
    this.me = new CatView(this, sx, sy, loadCoat());
    this.lastInput = now;

    this.youMarker = this.add.image(sx, sy, 'you').setOrigin(0.5, 1).setDepth(100001);
    this.time.delayedCall(4000, () => this.youMarker.destroy());

    const cam = this.cameras.main;
    cam.setBounds(0, 0, WORLD_W, WORLD_H);
    cam.startFollow(this.me.shadow, true);
    cam.setRoundPixels(true);
    this.scale.on('resize', () => this.fitZoom());
    this.fitZoom();

    const kb = this.input.keyboard!;
    const K = Phaser.Input.Keyboard.KeyCodes;
    this.keys = {
      up: kb.addKey(K.UP), down: kb.addKey(K.DOWN), left: kb.addKey(K.LEFT), right: kb.addKey(K.RIGHT),
      jump: kb.addKey(K.SPACE), hiss: kb.addKey(K.H), roll: kb.addKey(K.R),
    };

    this.ui = setupUI();
    this.ui.setStatus('looking for other cats…');
    this.net = new Net(() => this.state(), {
      onState: (id, msg) => {
        const cat = this.remotes.get(id);
        if (cat) cat.apply(msg, this.time.now);
        else this.remotes.set(id, new RemoteCat(this, msg, this.time.now));
        this.updateStatus();
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
    this.net.start();
    // timers keep running while the tab is in the background, so others still see us
    window.setInterval(() => this.sendState(), SEND_MS);
  }

  private makeTextures(): void {
    const tex = this.textures;
    for (let c = 0; c < COATS.length; c++) {
      const t = tex.addCanvas(`cat-${c}`, toCanvas(buildCatSheet(c)))!;
      for (let f = 0; f < FRAME_NAMES.length * 2; f++) t.add(f, 0, f * CAT, 0, CAT, CAT);
    }
    tex.addCanvas('ground-0', toCanvas(buildGround(0)));
    tex.addCanvas('ground-1', toCanvas(buildGround(1)));
    buildProps().forEach((p, i) => tex.addCanvas(`prop-${i}`, toCanvas(p.raster)));
    for (const [k, make] of Object.entries(ICONS)) tex.addCanvas(k, toCanvas(make()));
  }

  private fitZoom(): void {
    const { width, height } = this.scale.gameSize;
    const zoom = Math.max(2, Math.round(Math.min(width / 260, height / 220)));
    this.cameras.main.setZoom(zoom);
  }

  private state(): CatMsg {
    const m = this.me;
    return [Math.round(m.x * 10) / 10, Math.round(m.y * 10) / 10, m.facing, m.act, m.seq, m.coat];
  }

  private sendState(): void {
    const s = this.state();
    const now = performance.now();
    const changed = !this.lastSent || s.some((v, i) => v !== this.lastSent![i]);
    if (!changed && now - this.lastSentAt < HEARTBEAT_MS) return;
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
    if (this.youMarker.active) {
      const bob = Math.floor(time / 300) % 2;
      this.youMarker.setPosition(Math.round(this.me.x), Math.round(this.me.y) - 18 - bob).setVisible(Math.floor(time / 300) % 4 !== 3);
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
    touch.pressed.clear();
    const moving = dx !== 0 || dy !== 0;
    if (moving || jump || hiss || roll) {
      this.lastInput = now;
      this.ui.hideHelp();
    }

    const elapsed = now - me.actStart;
    const begin = (act: Act) => {
      me.seq = (me.seq + 1) & 0xffff;
      me.setAct(act, now);
    };

    // finish timed acts
    if (me.act === Act.Jump && elapsed >= JUMP_MS) me.setAct(moving ? Act.Walk : Act.Idle, now);
    if ((me.act === Act.Hiss && elapsed >= HISS_MS) || (me.act === Act.Roll && elapsed >= ROLL_MS)) me.setAct(Act.Idle, now);
    if (me.act === Act.Lick && elapsed >= LICK_MS) {
      me.setAct(Act.Sit, now);
      this.nextLick = now + 4000 + Math.random() * 7000;
    }

    if (hiss && me.act !== Act.Jump) begin(Act.Hiss);
    else if (roll && me.act !== Act.Jump) begin(Act.Roll);
    else if (jump && me.act !== Act.Jump) begin(Act.Jump);

    if (moving) {
      if (me.act === Act.Hiss || me.act === Act.Roll || me.act === Act.Sit || me.act === Act.Lick) me.setAct(Act.Idle, now);
      if (dx !== 0) me.facing = dx < 0 ? Facing.Left : Facing.Right;
      else me.facing = dy < 0 ? Facing.Up : Facing.Down;
      if (dx !== 0 && dy !== 0) { dx *= Math.SQRT1_2; dy *= Math.SQRT1_2; }
      this.move(dx * SPEED * dt, dy * SPEED * dt);
      if (me.act === Act.Idle) me.setAct(Act.Walk, now);
    } else if (me.act === Act.Walk) {
      me.setAct(Act.Idle, now);
    }

    if (me.act === Act.Idle && now - this.lastInput > SIT_AFTER_MS) {
      if (me.facing === Facing.Up) me.facing = Facing.Down;
      me.setAct(Act.Sit, now);
      this.nextLick = now + 2500 + Math.random() * 4000;
    }
    if (me.act === Act.Sit && now >= this.nextLick) begin(Act.Lick);
  }

  private move(mx: number, my: number): void {
    const me = this.me;
    const hits = (x: number, y: number) => boxHitsSolid(x + HIT.x0, y + HIT.y0, x + HIT.x1, y + HIT.y1);
    if (mx && !hits(me.x + mx, me.y)) me.x += mx;
    if (my && !hits(me.x, me.y + my)) me.y += my;
  }
}

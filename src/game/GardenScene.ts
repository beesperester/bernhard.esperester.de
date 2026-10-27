import Phaser from 'phaser';
import { PIXEL_FONT } from '../ui/pixel.ts';
import { COATS, CAT, FRAME_NAMES } from '../art/cat.ts';
import { buildProps, buildUprightMask, TREE_W, type Prop } from '../art/tiles.ts';
import { LANTERN_W, LANTERN_H } from '../art/critters.ts';
import { WORLD_W, WORLD_H, TILE, MAP_W, MAP_H, LEVEL, LANTERNS, levelAt, wetAt, iceAt, groundAt, spawnPoints, tileAt, pondBounds, waterBoxes, elevAt, terrainCover } from '../world/map.ts';
import { Act, CATCH_MS, EAT_MS, MEW_MS, MUNCH_MS, Prey, Facing, GRAVITY, HISS_MS, JUMP_V, LICK_MS, ROLL_MS, SIT_AFTER_MS, SLEEP_AFTER_MS, SWIPE_AT_MS, type CatMsg } from './state.ts';
import { CatView, RemoteCat, catLight } from './CatView.ts';
import { Meadow } from './Meadow.ts';
import { Sunlight } from './Sunlight.ts';
import { Clouds } from './Clouds.ts';
import { PondReflection } from './PondReflection.ts';
import { Trees } from './Trees.ts';
import { Furniture } from './Furniture.ts';
import { Shadows, type Caster } from './Shadows.ts';
import { Vignette } from './Vignette.ts';
import { Daylight } from './Daylight.ts';
import { RimLight } from './RimLight.ts';
import { Lanterns } from './Lanterns.ts';
import { NightWater } from './NightWater.ts';
import { Streams } from './Streams.ts';
import { berlinClock } from '../world/sky.ts';
import { SEASON, rainfall } from '../world/season.ts';
import { Weather } from './Weather.ts';
import { Ambient } from './Ambient.ts';
import { DASH_SPEED, Dash, ICE_DASH_GRIP, ICE_GLIDE, ICE_GRIP, SNEAK_SPEED, WALK_SPEED, alignDiagonal, step } from './movement.ts';
import { makeTextures, toCanvas } from './textures.ts';
import { PREY, preyPoints } from './fauna/prey.ts';
import { Net } from '../net/net.ts';
import { Referee } from './Referee.ts';
import { sound } from '../audio/sound.ts';
import { CatSounds } from './CatSounds.ts';
import { touch, setupUI } from '../ui/ui.ts';
import { setCatCount } from '../ui/favicon.ts';
import { Board, NAME_AT } from './Board.ts';
import { askName, renderBoard } from '../ui/board.ts';
import { cullerFor } from './Culler.ts';
import { castsNightBlob, groundOf } from '../world/legend.ts';

// a cat that lands in the pond hops straight back out to dry land
const HOP_MS = 480;
const HOP_HEIGHT = 16;
/** How often the pond reflections are redrawn, ms. */
const REFLECTION_MS = 33;
// send up to 20x/s while airborne (jumps are short), otherwise up to 10x/s
const TICK_MS = 50;
const SEND_MS = 100;
const HEARTBEAT_MS = 1000;
const STALE_MS = 15000;

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
    dash: Phaser.Input.Keyboard.Key; catch: Phaser.Input.Keyboard.Key; sneak: Phaser.Input.Keyboard.Key;
    mew: Phaser.Input.Keyboard.Key;
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
  private ponds: PondReflection[] = [];
  private readonly catSounds = new CatSounds();
  private trees!: Trees;
  private vignette!: Vignette;
  private daylight!: Daylight;
  private rims!: RimLight;
  private lanterns!: Lanterns;
  private shadows!: Shadows;
  private nightWater!: NightWater;
  private nextReflection = 0;
  private nextClock = 0;
  private board!: Board;
  /** Offered a name of our own already (or the dialog is open). */
  private naming = false;
  private camAnchor!: Phaser.GameObjects.Zone;
  /** Smoothed terrain height under the cat, so the view rises with the hills. */
  private camZ = 0;
  private vz = 0;
  private ambient!: Ambient;
  private referee!: Referee;
  private weather!: Weather;
  private streams!: Streams;
  private readonly dash = new Dash();
  private lastDry = { x: 0, y: 0 };
  /** Our velocity, kept up only on ice (anywhere else the cat goes where the keys say). */
  private vel = { x: 0, y: 0 };
  /** The way we were last pushed ("dx,dy"), to notice a new diagonal. */
  private heading = '';
  private hop: { fx: number; fy: number; tx: number; ty: number; tz: number; t0: number } | null = null;
  private catching: { swiped: boolean; got: Prey | null } | null = null;
  /** A swipe made in mid-jump (one per jump), and what it got, to eat on landing. */
  private airCatch: { got: Prey | null } | null = null;

  constructor() {
    super('garden');
  }

  create(): void {
    const canvases = makeTextures(this);

    const grounds = [0, 1].map((p) => this.add.image(0, 0, `ground-${p}`).setOrigin(0).setDepth(-100000));
    grounds[1].setVisible(false);
    // raised ground: each plateau row lifted by its height, sorted like everything else by ground y
    canvases.terrain.forEach((t, i) => cullerFor(this).add(this.add.image(t.x, t.y, `terrain-${i}`).setOrigin(0).setDepth(t.depth)));
    this.time.addEvent({ delay: 700, loop: true, callback: () => grounds.forEach((g) => g.setVisible(!g.visible)) });

    const props = buildProps();
    this.trees = new Trees(this, props, canvases.props);
    const furniture = new Furniture(this, toCanvas);
    // birds sing from a tree somewhere near you, preferably one with a bird in it
    sound.setSource('birds', () => {
      const { x, y } = sound.listener;
      // birds sleep at night
      if (this.daylight && this.daylight.light.night > 0.5) return null;
      const bird = this.ambient?.perchedBird(x, y, 220);
      if (bird) return bird;
      const near = props.filter((p) => Math.hypot(p.x + TREE_W / 2 - x, p.depthY - 40 - y) < 220);
      const p = near[Math.floor(Math.random() * near.length)];
      return p ? { x: p.x + TREE_W / 2, y: p.depthY - 40 } : null;
    });
    this.meadow = new Meadow(this);
    const water = canvases.water;
    const reflect = {
      waterMask: toCanvas(water),
      catSheets: canvases.cats,
      floraSheets: canvases.flora,
      props: props.map((p, i) => ({ p, canvas: canvases.props[i] })),
      plants: this.meadow.plants,
    };
    this.ponds = waterBoxes().map((box) => new PondReflection(this, box, reflect));
    this.clouds = new Clouds(this, toCanvas);
    this.sun = new Sunlight(this, toCanvas);
    // soft glow: bright areas (path, blossom, sunlight, white fur) bleed light into their surroundings
    // (snow is bright all over: only the brightest bits glow then)
    Phaser.Actions.AddEffectBloom(this.cameras.main, { threshold: SEASON.snow > 0.3 ? 0.82 : 0.55, blurRadius: 3, blurSteps: 4, blurQuality: 0, blendAmount: 0.35 });
    this.vignette = new Vignette(this);
    // time of day: tint, sunlit rims, lanterns, and stars and moon in the water
    this.daylight = new Daylight(this, Date.now());
    this.rims = new RimLight(this, {
      trees: [...reflect.props, ...furniture.pieces], upright: buildUprightMask(), terrain: canvases.terrain,
      catSheet: canvases.cats[0], catFrames: FRAME_NAMES.length * 2, catSize: CAT,
    });
    // what can stand in front of a lantern's light
    const source = (key: string) => this.textures.get(key).getSourceImage() as HTMLCanvasElement;
    this.lanterns = new Lanterns(this, [
      ...props.map((p, i) => ({ canvas: canvases.props[i], x: p.x, y: p.y, w: canvases.props[i].width, h: canvases.props[i].height, depth: p.depthY })),
      ...furniture.pieces.map(({ p, canvas }) => ({ canvas, x: p.x, y: p.y, w: canvas.width, h: canvas.height, depth: p.depthY })),
      ...canvases.terrain.map((t, i) => ({ canvas: source(`terrain-${i}`), x: t.x, y: t.y, w: t.raster.w, h: t.raster.h, depth: t.depth })),
    ]);
    this.shadows = this.makeShadows(props, canvases, furniture);
    this.nightWater = new NightWater(this, waterBoxes(), reflect.waterMask);
    catLight.shade = (x, y) => this.shadows.shadeAt(x, y);
    catLight.occluded = (x, y, feetY) => this.trees.covers(x, y, feetY) || !!terrainCover(x, feetY, feetY - y - 1, 4, 2);
    const flowers: [number, number][] = this.meadow.plants.filter((p) => p.kind >= 3).map((p) => [p.x, p.y - 9]);
    for (let ty = 0; ty < MAP_H; ty++)
      for (let tx = 0; tx < MAP_W; tx++) if (groundOf(tileAt(tx, ty)) === 'flowers') flowers.push([tx * TILE + 8, ty * TILE + 8]);
    this.ambient = new Ambient(this, { flowers, water, pond: pondBounds(), trees: reflect.props });
    this.weather = new Weather(this, props, water);
    this.streams = new Streams(this, water);

    const spawns = spawnPoints();
    const [sx, sy] = spawns[Math.floor(Math.random() * spawns.length)];
    const now = this.time.now;
    this.me = new CatView(this, sx, sy, loadCoat(), true);
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
      jump: kb.addKey(K.SPACE), hiss: kb.addKey(K.H), roll: kb.addKey(K.R), dash: kb.addKey(K.SHIFT), catch: kb.addKey(K.C), sneak: kb.addKey(K.X), mew: kb.addKey(K.E),
    };

    this.ui = setupUI();
    this.ui.setStatus('looking for other cats…');
    setCatCount(1);
    this.board = new Board(this.me.coat, (msg, target) => this.net.board(msg, target), () => renderBoard(this.board.ranking(), this.board.id));
    renderBoard(this.board.ranking(), this.board.id);
    this.net = new Net(() => this.state(), {
      onState: (id, msg) => {
        if (!this.referee.observe(id, msg, performance.now())) return;
        const cat = this.remotes.get(id);
        if (cat) cat.apply(msg, this.time.now);
        else {
          const cat = new RemoteCat(this, msg, this.time.now);
          cat.id = id;
          this.remotes.set(id, cat);
        }
        this.updateStatus();
      },
      onCatch: (id, kind, preyId) => {
        const cat = this.remotes.get(id);
        if (cat && this.referee.claim(id, kind, preyId, performance.now())) this.ambient.catchPrey(kind, preyId, cat);
      },
      onVote: (id, msg) => this.referee.receiveVote(id, msg, performance.now()),
      onLeave: (id) => {
        this.referee.leave(id);
        this.remotes.get(id)?.destroy();
        this.remotes.delete(id);
        this.board.leave(id);
        this.updateStatus();
      },
      onJoin: (id) => {
        this.referee.join(id);
        this.board.greet(id);
      },
      onBoard: (id, msg) => {
        if (!this.referee.ignored(id)) this.board.receive(id, msg);
      },
      onStatus: (garden) => {
        // every garden keeps its own scoreboard
        if (garden !== this.garden) this.board.reset();
        this.garden = garden;
        this.updateStatus();
      },
    });
    this.me.id = this.net.id;
    this.referee = new Referee(this.net.id, {
      vote: (msg) => this.net.vote(msg),
      judgeCatch: (peer, kind, id) => {
        // in a background tab nothing moves: we haven't been watching
        if (document.hidden) return null;
        const cat = this.remotes.get(peer);
        const seen = cat ? this.ambient.sawWithinReach(kind, id, cat.tx, cat.ty, cat.tz) : null;
        return { ok: !!seen, points: preyPoints(kind, seen?.colour ?? 0) };
      },
      confirmed: (peer, points) => this.board.credit(peer, points),
      ignore: (peer) => {
        this.remotes.get(peer)?.destroy();
        this.remotes.delete(peer);
        this.board.drop(peer);
        this.updateStatus();
      },
    });
    this.net.start();
    // timers keep running while the tab is in the background, so others still see us
    window.setInterval(() => this.sendState(), TICK_MS);
  }

  /** Who casts what shadow: trees, lanterns and furniture by their outlines, and soft blobs under everything for the night. */
  private makeShadows(props: Prop[], canvases: ReturnType<typeof makeTextures>, furniture: Furniture): Shadows {
    const casters: Caster[] = [];
    const blobs: { x: number; y: number; w: number; h: number; depth: number }[] = [];
    props.forEach((p, i) => {
      const c = canvases.props[i];
      const lift = levelAt(Math.floor((p.x + TREE_W / 2) / TILE), Math.floor(p.depthY / TILE)) * LEVEL;
      casters.push({ src: c, sx: 0, sy: 0, w: c.width, h: c.height, x: p.x, y: p.y, ground: p.depthY, lift, cap: Infinity });
      blobs.push({ x: p.x + TREE_W / 2, y: p.depthY - lift - 1, w: 46, h: 14, depth: p.depthY - 0.01 });
    });
    const lantern = this.textures.get('lantern').getSourceImage() as HTMLCanvasElement;
    for (const [x, y] of LANTERNS) {
      const top = y - elevAt(x, y);
      casters.push({ src: lantern, sx: 0, sy: 0, w: LANTERN_W, h: LANTERN_H, x: x - LANTERN_W / 2, y: top - LANTERN_H, ground: y, lift: elevAt(x, y), cap: LANTERN_H });
      blobs.push({ x, y: top - 1, w: 12, h: 5, depth: y - 0.01 });
    }
    for (const { p, canvas } of furniture.pieces) {
      const w = canvas.width, h = canvas.height;
      // the shed is in the height map; the low things cast their outlines (their tops are deep, not tall)
      if (h < 40) casters.push({ src: canvas, sx: 0, sy: 0, w, h, x: p.x, y: p.y, ground: p.y + h - 1, lift: 0, cap: 14 });
      blobs.push({ x: p.x + w / 2, y: p.y + h - 2, w: w + 8, h: h < 40 ? 10 : 18, depth: p.depthY - 0.01 });
    }
    // bushes and rocks in the ground art
    for (let ty = 0; ty < MAP_H; ty++)
      for (let tx = 0; tx < MAP_W; tx++)
        if (castsNightBlob(tileAt(tx, ty))) {
          const l = levelAt(tx, ty);
          blobs.push({ x: tx * TILE + 8, y: ty * TILE + 13 - l * LEVEL, w: 20, h: 8, depth: l ? ty * TILE + 0.0012 : -99992 });
        }
    return new Shadows(this, { terrain: canvases.terrain, casters, blobs, catSheet: canvases.cats[0] });
  }

  private fitZoom(): void {
    const { width, height } = this.scale.gameSize;
    const zoom = Math.max(2, Math.round(Math.min(width / 260, height / 220)));
    this.cameras.main.setZoom(zoom);
    this.sun?.resize();
    this.vignette?.resize();
    this.daylight?.resize();
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
    this.ui.setStatus(`garden ${this.garden} · ${others} · ${berlinClock(this.net.now())}`);
    setCatCount(n + 1);
  }

  update(time: number, delta: number): void {
    const dt = Math.min(delta, 100) / 1000;
    this.updateLocal(time, dt);
    // (the referee goes by the page clock: messages keep coming while the tab is hidden and Phaser's clock stands still)
    this.referee.update(performance.now());

    this.me.name = this.board.me.name;
    for (const [id, cat] of this.remotes) {
      cat.name = this.board.nameOf(id);
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

    // follow the cat's feet on the terrain (not mid-jump), so the view climbs the hills smoothly
    this.camZ += (elevAt(this.me.x, this.me.y) - this.camZ) * Math.min(1, dt * 6);
    // in whole pixels like the cat sprite, or the cat wobbles against the view by a sub-pixel each frame
    this.camAnchor.setPosition(Math.round(this.me.x), Math.round(this.me.y) - Math.round(this.camZ));
    sound.setListener({ x: this.me.x, y: this.me.y });

    const cats: CatView[] = [this.me, ...this.remotes.values()];
    // only your own cat shows through the trees; the others are simply behind them
    this.trees.update([this.me]);
    this.catSounds.update(cats, time);
    // the garden clock is shared by all visitors, so wind and fauna line up
    const gt = this.net.now();
    // only animate plants and redraw reflections that are on screen
    const view = this.cameras.main.worldView;
    cullerFor(this).update(view);
    this.meadow.update(gt, cats, view);
    // the ripple is slow, so reflections only need redrawing about 30 times a second
    if (time >= this.nextReflection) {
      this.nextReflection = time + REFLECTION_MS;
      for (const pond of this.ponds) {
        const b = pond.box;
        if (b.x < view.right && b.x + b.w > view.x && b.y < view.bottom && b.y + b.h > view.y) pond.update(time, cats);
      }
    }
    this.daylight.update(gt);
    const light = this.daylight.light;
    // under rain clouds the sun's rims, shadows and rays fade
    const overcast = Math.min(1, rainfall(gt) * 1.4);
    this.rims.update(overcast ? { ...light, rim: light.rim * (1 - overcast * 0.85) } : light);
    this.shadows.update(light, cats, overcast);
    catLight.soft = 0.06 + 0.2 * (1 - this.shadows.strength);
    catLight.rim = this.rims.strength;
    catLight.rimColour = this.rims.colour;
    catLight.night = light.night;
    this.ambient.update(gt, dt, cats, view);
    this.weather.update(gt, time, dt, cats, view);
    this.streams.update(gt, light.night, view);
    this.clouds.update(gt);
    this.clouds.setDaylight(light.day);
    this.sun.update(time, dt, Math.max(overcast, this.clouds.coverAt(view.centerX, view.centerY)), light.day);
    this.lanterns.update(light, time);
    this.nightWater.update(light, time, view);
    // keep the clock in the status line current
    if (time >= this.nextClock) {
      this.nextClock = time + 10000;
      this.updateStatus();
    }
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
    const mew = JD(k.mew) || touch.pressed.has('mew');
    const dash = JD(k.dash) || touch.pressed.has('dash');
    const dashHeld = k.dash.isDown || touch.held.has('dash');
    const grab = JD(k.catch) || touch.pressed.has('catch');
    const sneakHeld = k.sneak.isDown || touch.held.has('sneak');
    touch.pressed.clear();
    const moving = dx !== 0 || dy !== 0;
    if (moving || jump || hiss || roll || mew || dash || grab || sneakHeld) {
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
    if ((me.act === Act.Hiss && elapsed >= HISS_MS) || (me.act === Act.Roll && elapsed >= ROLL_MS) || (me.act === Act.Mew && elapsed >= MEW_MS)) me.setAct(Act.Idle, now);
    if (me.act === Act.Lick && elapsed >= LICK_MS) {
      me.setAct(Act.Sit, now);
      this.nextLick = now + 4000 + Math.random() * 7000;
    }

    // dash runs while the key is held (up to DASH_MS), then needs a long rest
    this.dash.update(dash, dashHeld, now);
    this.ui.setDashCooldown(Math.ceil(this.dash.cooldown(now) / 1000));
    if (((me.act === Act.Eat || me.act === Act.Feast) && elapsed >= EAT_MS) || (me.act === Act.Munch && elapsed >= MUNCH_MS)) me.setAct(Act.Idle, now);
    if (me.act === Act.Sleep && (jump || hiss || roll || mew || grab)) me.setAct(Act.Idle, now);

    // in mid-jump: one swipe at whatever flies within reach, a bird or bat on the wing included
    if (grab && me.act === Act.Jump && !this.airCatch) {
      this.airCatch = { got: null };
      const prey = this.ambient.preyNear(me);
      if (prey && !PREY[prey.kind].swipeOnly) {
        me.facing = facingTowards(me, prey);
        this.ambient.catchPrey(prey.kind, prey.id, me);
        this.net.catchPrey(prey.kind, prey.id);
        this.ate(prey.kind, prey.colour);
        this.airCatch.got = prey.kind;
      }
    }
    // catching: swipe at a fish, butterfly, bee or bird within a tile of the cat
    const busy = me.act === Act.Jump || me.act === Act.Catch || me.act === Act.Eat || me.act === Act.Munch || me.act === Act.Feast;
    if (grab && !busy && !wetAt(me.x, me.y)) {
      const prey = this.ambient.preyNear(me);
      // (with nothing in reach it swipes the way it faces)
      if (prey) me.facing = facingTowards(me, prey);
      this.catching = { swiped: false, got: null };
      begin(Act.Catch);
      return;
    }
    // pounce: dashing into prey grabs it, no swipe needed (fish have to be fished for)
    if (this.dash.active && !busy) {
      const prey = this.ambient.preyNear(me);
      if (prey && !PREY[prey.kind].swipeOnly) {
        me.facing = facingTowards(me, prey);
        this.ambient.catchPrey(prey.kind, prey.id, me);
        this.net.catchPrey(prey.kind, prey.id);
        this.ate(prey.kind, prey.colour);
        this.catching = { swiped: true, got: prey.kind };
        this.dash.stop(now);
        begin(Act.Catch);
        return;
      }
    }
    if (me.act === Act.Catch && this.catching) {
      const c = this.catching;
      if (!c.swiped && elapsed >= SWIPE_AT_MS) {
        c.swiped = true;
        // whatever is within reach when the paw lands (things drift and fly)
        const prey = this.ambient.preyNear(me);
        if (prey) {
          this.ambient.catchPrey(prey.kind, prey.id, me);
          this.net.catchPrey(prey.kind, prey.id);
          this.ate(prey.kind, prey.colour);
          c.got = prey.kind;
        }
      }
      if (elapsed >= CATCH_MS) {
        const after = c.got === null ? null : PREY[c.got].eat;
        if (after !== null) begin(after);
        else me.setAct(Act.Idle, now);
        this.catching = null;
      }
      return;
    }
    const grounded = me.act !== Act.Jump;
    if (hiss && grounded) begin(Act.Hiss);
    else if (mew && grounded) begin(Act.Mew);
    else if (roll && grounded) begin(Act.Roll);
    else if (jump && grounded) {
      begin(Act.Jump);
      this.vz = JUMP_V;
    }

    // holding sneak: belly to the ground, creeping slowly (and quietly); dashing from it is a pounce
    const low = sneakHeld && me.act !== Act.Jump && !this.dash.active;
    const to = (act: Act) => { if (me.act !== act) me.setAct(act, now); };
    const afoot = (act: Act) => act === Act.Idle || act === Act.Walk || act === Act.Crouch || act === Act.Sneak;
    // out on the ice the cat keeps its momentum: speed builds slowly, turns are wide, and it slides on
    const icy = me.act !== Act.Jump && iceAt(me.x, me.y);
    let wx = 0, wy = 0;
    if (moving) {
      if (me.act === Act.Hiss || me.act === Act.Roll || me.act === Act.Mew || me.act === Act.Sit || me.act === Act.Lick || me.act === Act.Sleep || me.act === Act.Eat || me.act === Act.Munch || me.act === Act.Feast)
        me.setAct(Act.Idle, now);
      if (dx !== 0) me.facing = dx < 0 ? Facing.Left : Facing.Right;
      else me.facing = dy < 0 ? Facing.Up : Facing.Down;
      if (dx !== 0 && dy !== 0) { dx *= Math.SQRT1_2; dy *= Math.SQRT1_2; }
      const speed = low ? SNEAK_SPEED : this.dash.active ? DASH_SPEED : WALK_SPEED;
      wx = dx * speed;
      wy = dy * speed;
      if (afoot(me.act)) to(low ? Act.Sneak : Act.Walk);
    } else if (afoot(me.act) || (low && (me.act === Act.Sit || me.act === Act.Lick || me.act === Act.Sleep))) {
      to(low ? Act.Crouch : Act.Idle);
    }
    if (icy) {
      const k = Math.min(1, (this.dash.active ? ICE_DASH_GRIP : moving ? ICE_GRIP : ICE_GLIDE) * dt);
      this.vel.x += (wx - this.vel.x) * k;
      this.vel.y += (wy - this.vel.y) * k;
    } else {
      this.vel.x = wx;
      this.vel.y = wy;
    }
    if (Math.abs(this.vel.x) + Math.abs(this.vel.y) > (icy ? 1.5 : 0)) {
      const [bx, by] = [me.x, me.y];
      const body = { x: me.x, y: me.y, z: me.z, airborne: me.act === Act.Jump };
      // a fresh diagonal: get x and y stepping in time, so the view doesn't staircase
      const heading = `${Math.sign(wx)},${Math.sign(wy)}`;
      if (heading !== this.heading && wx && wy && !icy) alignDiagonal(body, wx, wy);
      this.heading = heading;
      step(body, this.vel.x * dt, this.vel.y * dt);
      me.x = body.x; me.y = body.y; me.z = body.z;
      // sliding into something stops the slide that way
      if (icy) {
        if (Math.abs(me.x - bx) < Math.abs(this.vel.x * dt) * 0.5) this.vel.x = 0;
        if (Math.abs(me.y - by) < Math.abs(this.vel.y * dt) * 0.5) this.vel.y = 0;
      }
    } else if (icy) this.vel.x = this.vel.y = 0;

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
        // landing with something caught on the way: eat it
        const got = this.airCatch?.got ?? null;
        this.airCatch = null;
        if (got !== null && !wetAt(me.x, me.y)) {
          begin(PREY[got].eat);
          return;
        }
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
      this.airCatch = null;
    }

    if (me.act !== Act.Jump && !wetAt(me.x, me.y)) this.lastDry = { x: me.x, y: me.y };

    if (me.act === Act.Idle && now - this.lastInput > SIT_AFTER_MS && Math.abs(this.vel.x) + Math.abs(this.vel.y) < 2) {
      if (me.facing === Facing.Up) me.facing = Facing.Down;
      me.setAct(Act.Sit, now);
      this.nextLick = now + 2500 + Math.random() * 4000;
    }
    if (me.act === Act.Sit && now >= this.nextLick) begin(Act.Lick);
    // after a long while the cat curls up and falls asleep
    if (me.act === Act.Sit && now - this.lastInput > SLEEP_AFTER_MS) me.setAct(Act.Sleep, now);
  }

  /** Count a catch (bigger prey, more points), and at NAME_AT snacks offer a name of our own. */
  private ate(kind: Prey, colour: number): void {
    const points = preyPoints(kind, colour);
    this.board.ate(points);
    this.scorePop(points);
    const me = this.board.me;
    if (me.score < NAME_AT || me.custom || this.naming || asked(this.board.id)) return;
    this.naming = true;
    // the keyboard belongs to the text field while the dialog is open
    const kb = this.input.keyboard!;
    kb.enabled = false;
    kb.disableGlobalCapture();
    askName(me.name, (name) => this.board.available(name), (name) => {
      if (name) this.board.rename(name);
      setAsked(this.board.id);
      kb.enabled = true;
      kb.enableGlobalCapture();
      kb.resetKeys();
    });
  }

  /** "+3" floating up from our cat after a catch (or "-1" after a bee). */
  private scorePop(points: number): void {
    const me = this.me;
    const zoom = this.cameras.main.zoom;
    const t = this.add.text(Math.round(me.x), Math.round(me.y - me.z) - 20, points > 0 ? `+${points}` : String(points), {
      fontFamily: PIXEL_FONT,
      fontSize: '12px',
      fontStyle: 'bold',
      color: points > 0 ? '#ffe890' : '#ff8080',
      stroke: '#183018',
      strokeThickness: 3,
      resolution: Math.max(1, window.devicePixelRatio || 1),
    }).setOrigin(0.5, 1).setDepth(100001).setScale(1 / zoom);
    this.tweens.add({ targets: t, y: t.y - 14, alpha: 0, delay: 500, duration: 900, ease: 'Sine.easeIn', onComplete: () => t.destroy() });
  }
}

/** Which way to turn to swipe at something at (x, y): sideways unless it is clearly ahead or behind. */
function facingTowards(cat: { x: number; y: number }, at: { x: number; y: number }): Facing {
  const dx = at.x - cat.x, dy = at.y - cat.y;
  if (Math.abs(dy) > Math.abs(dx) * 1.2) return dy < 0 ? Facing.Up : Facing.Down;
  return dx < 0 ? Facing.Left : Facing.Right;
}

function asked(id: string): boolean {
  try { return localStorage.getItem(`named-${id}`) === '1'; } catch { return false; }
}
function setAsked(id: string): void {
  try { localStorage.setItem(`named-${id}`, '1'); } catch { /* storage unavailable */ }
}

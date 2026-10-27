import Phaser from 'phaser';
import { PIXEL_FONT } from '../ui/pixel.ts';
import { COATS, CAT, FRAME_NAMES } from '../art/cat.ts';
import { buildUprightMask } from '../art/tiles.ts';
import { buildProps, type Prop } from '../art/trees.ts';
import type { Raster } from '../art/raster.ts';
import { LANTERN_W, LANTERN_H } from '../art/critters.ts';
import { HOUSES, TREES, standingOn, surfaceAt } from '../world/trees.ts';
import { WORLD_W, WORLD_H, TILE, MAP_W, MAP_H, LEVEL, LANTERNS, FEET, WALL, levelAt, wetAt, iceAt, spawnPoints, tileAt, pondBounds, waterBoxes, elevAt, heightUnder, terrainCover } from '../world/map.ts';
import { Act, CATCH_MS, EAT_MS, MEW_MS, MUNCH_MS, Prey, Facing, GRAVITY, HISS_MS, JUMP_V, LICK_MS, ROLL_MS, SIT_AFTER_MS, SLEEP_AFTER_MS, SWIPE_AT_MS, type CatMsg } from './state.ts';
import { CatView, RemoteCat, catLight } from './CatView.ts';
import { Meadow } from './Meadow.ts';
import { Sunlight } from './Sunlight.ts';
import { Clouds } from './Clouds.ts';
import { PondReflection } from './PondReflection.ts';
import { Trees } from './Trees.ts';
import { Furniture } from './Furniture.ts';
import { Landmarks } from './Landmarks.ts';
import { trunkNear } from '../world/fruit.ts';
import { Shadows, type Caster } from './Shadows.ts';
import { Vignette } from './Vignette.ts';
import { Daylight } from './Daylight.ts';
import { RimLight } from './RimLight.ts';
import { Lanterns } from './Lanterns.ts';
import { NightWater } from './NightWater.ts';
import { Streams } from './Streams.ts';
import { Puddles } from './Puddles.ts';
import { WaterSurface } from './WaterSurface.ts';
import { Lighting } from './Lighting.ts';
import { berlinClock } from '../world/sky.ts';
import { SEASON, rainfall } from '../world/season.ts';
import { Weather } from './Weather.ts';
import { Ambient } from './Ambient.ts';
import { DASH_SPEED, Dash, ICE_DASH_GRIP, ICE_GLIDE, ICE_GRIP, SNEAK_SPEED, WALK_SPEED, alignDiagonal, step } from './movement.ts';
import { makeTextures, toCanvas } from './textures.ts';
import { PREY, preyPoints } from './fauna/prey.ts';
import { PEER, theNet, type Net, type NetEvents } from '../net/net.ts';
import { Referee } from './Referee.ts';
import { sound } from '../audio/sound.ts';
import { CatSounds } from './CatSounds.ts';
import { touch, setupUI, type Button } from '../ui/ui.ts';
import { setCatCount } from '../ui/favicon.ts';
import { Board, NAME_AT, verifyBoard, type Pose } from './Board.ts';
import { identity, verify } from '../net/identity.ts';
import { RESUME_MS } from '../net/witness.ts';
import { askName, renderBoard } from '../ui/board.ts';
import { cullerFor } from './Culler.ts';
import { Fader } from '../ui/fader.ts';
import { loaded, loading } from '../ui/loading.ts';
import { castsNightBlob, groundOf } from '../world/legend.ts';

// a cat that lands in the pond hops straight back out to dry land
const HOP_MS = 480;
const HOP_HEIGHT = 16;
/** How quickly a cat that landed on a branch settles onto its line (px/s). */
const SETTLE_SPEED = 60;
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

/**
 * How long the garden stays behind its curtain once it is laid out: a moment,
 * or, with other cats here, long enough for one that remembers us (from
 * before a reload) to say so; HELLO_MS more for each cat that turns up
 * meanwhile, up to LAST_LOOK_MS. (The waiting for the cats to connect at all
 * was done before: net.ts, seed().)
 */
const FIRST_LOOK_MS = 300, HELLO_MS = 1200, LAST_LOOK_MS = 4000;

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
  /** Height of what the cat last stood on (the ground, a hedge, a branch): the view rises with it. */
  private camFloor = 0;
  private vz = 0;
  private ambient!: Ambient;
  private referee!: Referee;
  private weather!: Weather;
  private streams!: Streams;
  private landmarks!: Landmarks;
  private puddles!: Puddles;
  private waterSurface!: WaterSurface;
  private lighting!: Lighting;
  private readonly dash = new Dash();
  private lastDry = { x: 0, y: 0, z: 0 };
  /** When we arrived, and whether a cat that stayed has put us back where we were before a reload. */
  private arrived = 0;
  private resumed = false;
  /**
   * The garden stays behind a curtain until we know where our cat belongs: a
   * moment to hear from the cats here (longer while new ones are still saying
   * hello), at most until the garden settles. Then it dithers in.
   */
  private fader!: Fader;
  private revealAt = 0;
  private revealed = false;
  /** Dropping down out of a tree: perches from this height up don't catch the cat. */
  private dropFrom = Infinity;
  /** Our velocity, kept up only on ice (anywhere else the cat goes where the keys say). */
  private vel = { x: 0, y: 0 };
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
    this.landmarks = new Landmarks(this, toCanvas);
    const standing = [...furniture.pieces, ...this.landmarks.pieces];
    // birds sing from a tree somewhere near you, preferably one with a bird in it
    sound.setSource('birds', () => {
      const { x, y } = sound.listener;
      // birds sleep at night
      if (this.daylight && this.daylight.light.night > 0.5) return null;
      const bird = this.ambient?.perchedBird(x, y, 220);
      if (bird) return bird;
      const near = props.filter((p) => Math.hypot(p.plan.x - x, p.depthY - 40 - y) < 220);
      const p = near[Math.floor(Math.random() * near.length)];
      return p ? { x: p.plan.x, y: p.depthY - 40 } : null;
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
    // which pixels of the ground art stand up from it: for sunlit rims, and for where shadows can't fall
    const upright = buildUprightMask();
    this.rims = new RimLight(this, {
      trees: [...reflect.props, ...standing], upright, terrain: canvases.terrain,
      catSheet: canvases.cats[0], catFrames: FRAME_NAMES.length * 2, catSize: CAT,
    });
    // what can stand in front of a lantern's light
    const source = (key: string) => this.textures.get(key).getSourceImage() as HTMLCanvasElement;
    this.lanterns = new Lanterns(this, [
      ...props.map((p, i) => ({ canvas: canvases.props[i], x: p.x, y: p.y, w: canvases.props[i].width, h: canvases.props[i].height, depth: p.depthY })),
      ...standing.map(({ p, canvas }) => ({ canvas, x: p.x, y: p.y, w: canvas.width, h: canvas.height, depth: p.depthY })),
      ...canvases.terrain.map((t, i) => ({ canvas: source(`terrain-${i}`), x: t.x, y: t.y, w: t.raster.w, h: t.raster.h, depth: t.depth })),
    ]);
    this.shadows = this.makeShadows(props, canvases, furniture, upright);
    this.nightWater = new NightWater(this, waterBoxes(), reflect.waterMask);
    this.waterSurface = new WaterSurface(this, waterBoxes(), water);
    this.lighting = new Lighting(this, reflect.props, this.trees, canvases.terrain);
    catLight.shade = (x, y) => this.shadows.shadeAt(x, y);
    catLight.occluded = (x, y, feetY) => this.trees.covers(x, y, feetY) || !!terrainCover(x, feetY, feetY - y - 1, 4, 2);
    const flowers: [number, number][] = this.meadow.plants.filter((p) => p.kind >= 3).map((p) => [p.x, p.y - 9]);
    for (let ty = 0; ty < MAP_H; ty++)
      for (let tx = 0; tx < MAP_W; tx++) if (groundOf(tileAt(tx, ty)) === 'flowers') flowers.push([tx * TILE + 8, ty * TILE + 8]);
    this.ambient = new Ambient(this, { flowers, water, pond: pondBounds(), trees: reflect.props });
    this.weather = new Weather(this, props, water);
    this.streams = new Streams(this, water);
    this.puddles = new Puddles(this, this.ambient.fx);

    const spawns = spawnPoints();
    const [sx, sy] = spawns[Math.floor(Math.random() * spawns.length)];
    const now = this.time.now;
    this.me = new CatView(this, sx, sy, loadCoat(), true);
    this.lastDry = { x: sx, y: sy, z: 0 };
    this.lastInput = now;
    this.arrived = now;
    this.revealAt = now + FIRST_LOOK_MS;
    this.fader = new Fader(() => this.cameras.main.zoom);
    loading(0.65, 200, 'looking for other cats…');

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

    // the keys belong to the help sign while it is up
    this.ui = setupUI((open) => {
      kb.enabled = !open;
      kb.resetKeys();
    });
    this.ui.setStatus('looking for other cats…');
    setCatCount(1);
    const me = identity();
    this.board = new Board(
      this.me.coat,
      { id: me.id, peer: PEER, sign: (d) => me.sign(d), now: () => this.net.now() },
      (msg, target) => this.net.board(msg, target),
      () => renderBoard(this.board.ranking(), this.board.id),
    );
    this.board.onBack = (pose) => this.resume(pose);
    renderBoard(this.board.ranking(), this.board.id);
    this.net = theNet();
    const events: NetEvents = {
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
      // another cat pawed at a tree: believed if that cat is at the trunk (as far as we can see) and it is about now
      onShake: (id, tree, gt) => {
        const cat = this.remotes.get(id);
        if (cat && Math.abs(gt - this.net.now()) < 5000 && trunkNear(cat.x, cat.y, cat.z, 24) === tree) this.ambient.shakeTree(tree, gt);
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
        // (give a cat that may remember us time to say so)
        if (!this.revealed) this.revealAt = Math.min(this.arrived + LAST_LOOK_MS, Math.max(this.revealAt, this.time.now + HELLO_MS));
        this.referee.join(id);
        this.board.greet(id);
        const { caught, shakes } = this.ambient.memory(this.net.now());
        this.net.world({ caught, shakes }, id);
      },
      // what a cat already here knows: prey that's gone, fruit lying about
      onWorld: (id, msg) => {
        if (!this.referee.ignored(id)) this.ambient.recall(msg.caught, msg.shakes);
      },
      // (only what checks out: signed by whom it says, the sender's own entry for this very connection)
      onBoard: (id, msg) => {
        void verifyBoard(id, msg, this.net.now(), verify).then((ok) => {
          if (ok && !this.referee.ignored(id)) this.board.receive(id, ok);
        });
      },
      onStatus: (garden) => {
        // every garden keeps its own scoreboard
        if (garden !== this.garden) this.board.reset();
        this.garden = garden;
        this.updateStatus();
      },
    };
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
    // (what the others said while the garden was being laid out comes in now)
    this.net.attach(() => this.state(), events, TREES.length);
    // timers keep running while the tab is in the background, so others still see us
    window.setInterval(() => this.sendState(), TICK_MS);
  }

  /** Who casts what shadow: trees, lanterns and furniture by their outlines, and soft blobs under everything for the night. */
  private makeShadows(props: Prop[], canvases: ReturnType<typeof makeTextures>, furniture: Furniture, upright: Raster): Shadows {
    const casters: Caster[] = [];
    const blobs: { x: number; y: number; w: number; h: number; depth: number }[] = [];
    props.forEach((p, i) => {
      const c = canvases.props[i];
      const lift = p.plan.elev;
      casters.push({ src: c, sx: 0, sy: 0, w: c.width, h: c.height, x: p.x, y: p.y, ground: p.depthY, lift, cap: Infinity, depth: 'round' });
      blobs.push({ x: p.plan.x, y: p.depthY - lift - 1, w: Math.round(p.raster.w * 0.65), h: 14, depth: p.depthY - 0.01 });
    });
    const lantern = this.textures.get('lantern').getSourceImage() as HTMLCanvasElement;
    for (const [x, y] of LANTERNS) {
      const top = y - elevAt(x, y);
      casters.push({ src: lantern, sx: 0, sy: 0, w: LANTERN_W, h: LANTERN_H, x: x - LANTERN_W / 2, y: top - LANTERN_H, ground: y, lift: elevAt(x, y), cap: LANTERN_H, depth: 1 });
      blobs.push({ x, y: top - 1, w: 12, h: 5, depth: y - 0.01 });
    }
    for (const { p, canvas } of furniture.pieces) {
      const w = canvas.width, h = canvas.height;
      // the shed is in the height map; the low things cast their outlines (their tops are deep, not tall)
      if (h < 40) casters.push({ src: canvas, sx: 0, sy: 0, w, h, x: p.x, y: p.y, ground: p.y + h - 1, lift: 0, cap: 14, depth: 3 });
      blobs.push({ x: p.x + w / 2, y: p.y + h - 2, w: w + 8, h: h < 40 ? 10 : 18, depth: p.depthY - 0.01 });
    }
    // the follies cast their whole outlines, as tall as they are
    for (const { p, canvas, depth } of this.landmarks.pieces) {
      const w = canvas.width, h = canvas.height;
      casters.push({ src: canvas, sx: 0, sy: 0, w, h, x: p.x, y: p.y, ground: p.depthY + 1, lift: 0, cap: Infinity, depth });
      blobs.push({ x: p.x + w / 2, y: p.depthY, w: w + 8, h: 14, depth: p.depthY - 0.01 });
    }
    // bushes and rocks in the ground art
    for (let ty = 0; ty < MAP_H; ty++)
      for (let tx = 0; tx < MAP_W; tx++)
        if (castsNightBlob(tileAt(tx, ty))) {
          const l = levelAt(tx, ty);
          blobs.push({ x: tx * TILE + 8, y: ty * TILE + 13 - l * LEVEL, w: 20, h: 8, depth: l ? ty * TILE + 0.0012 : -99992 });
        }
    return new Shadows(this, { terrain: canvases.terrain, casters, blobs, catSheet: canvases.cats[0], upright });
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
    return [r(m.x), r(m.y), r(m.z), m.facing, m.act, m.seq, m.coat, m.mews];
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
    if (!this.revealed) {
      if (time >= this.revealAt) this.reveal();
      else loading(0.65 + 0.35 * (time - this.arrived) / (this.revealAt - this.arrived), 120);
    }
    this.updateLocal(time, dt);
    // (the referee goes by the page clock: messages keep coming while the tab is hidden and Phaser's clock stands still)
    this.referee.update(performance.now());

    this.me.name = this.board.me.name;
    // the garden clock is shared by all visitors, so wind and fauna line up
    const gt = this.net.now();
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

    // follow the cat's feet on the terrain or up a tree (not mid-jump), so the view climbs the hills smoothly
    if (this.me.act !== Act.Jump) this.camFloor = this.me.z;
    this.camZ += (Math.max(elevAt(this.me.x, this.me.y), this.camFloor) - this.camZ) * Math.min(1, dt * (this.camFloor > this.camZ + 4 ? 3 : 6));
    // in whole pixels like the cat sprite, or the cat wobbles against the view by a sub-pixel each frame
    this.camAnchor.setPosition(Math.round(this.me.x), Math.round(this.me.y) - Math.round(this.camZ));
    sound.setListener({ x: this.me.x, y: this.me.y });

    const cats: CatView[] = [this.me, ...this.remotes.values()];
    // only your own cat shows through the trees; the others are simply behind them
    // only animate plants and redraw reflections that are on screen
    const view = this.cameras.main.worldView;
    this.trees.update([this.me], view);
    this.catSounds.update(cats, time);
    cullerFor(this).update(view);
    this.meadow.update(gt, cats, view);
    // the ripple is slow, so trees' reflections only need redrawing about 30 times a second;
    // cats move, so theirs are redrawn every frame (only where one is near the water)
    const reflectTrees = time >= this.nextReflection;
    if (reflectTrees) this.nextReflection = time + REFLECTION_MS;
    for (const pond of this.ponds) {
      const b = pond.box;
      // (on screen, and just off it, so they're ready when the camera gets there)
      if (b.x >= view.right + 48 || b.x + b.w <= view.x - 48 || b.y >= view.bottom + 48 || b.y + b.h <= view.y - 48) continue;
      if (reflectTrees) pond.update(time);
      pond.updateCats(time, cats);
    }
    this.daylight.update(gt);
    const light = this.daylight.light;
    // trees, bushes and rocks lit from where the sun is, and the sun's rays falling from there
    this.lighting.update(light);
    this.sun.setSun(light.sunDir);
    // under rain clouds the sun's rims, shadows and rays fade
    const overcast = Math.min(1, rainfall(gt) * 1.4);
    this.rims.update(overcast ? { ...light, rim: light.rim * (1 - overcast * 0.85) } : light);
    this.shadows.update(light, cats, overcast);
    catLight.soft = 0.06 + 0.2 * (1 - this.shadows.strength);
    catLight.rim = this.rims.strength;
    catLight.rimColour = this.rims.colour;
    catLight.night = light.night;
    this.ambient.update(gt, dt, cats, view);
    this.weather.update(gt, time, dt, cats, view, light);
    this.streams.update(gt, light.night, view);
    this.landmarks.update(time, this.cameras.main.zoom);
    this.puddles.update(gt, time, dt, cats, view);
    this.clouds.update(gt);
    this.clouds.setDaylight(light.day);
    this.sun.update(time, dt, Math.max(overcast, this.clouds.coverAt(view.centerX, view.centerY)), light.day);
    this.lanterns.update(light, time);
    this.nightWater.update(light, time, view);
    this.waterSurface.update(light, gt, time, overcast, view);
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
    // (nothing to steer while the garden is still behind its curtain)
    const live = this.revealed;
    const k = this.keys;
    const held = (key: Phaser.Input.Keyboard.Key, t: boolean) => live && (key.isDown || t);
    const hit = (key: Phaser.Input.Keyboard.Key, b: Button) => (Phaser.Input.Keyboard.JustDown(key) || touch.pressed.has(b)) && live;
    let dx = (held(k.right, touch.right) ? 1 : 0) - (held(k.left, touch.left) ? 1 : 0);
    let dy = (held(k.down, touch.down) ? 1 : 0) - (held(k.up, touch.up) ? 1 : 0);
    const jump = hit(k.jump, 'jump');
    const hiss = hit(k.hiss, 'hiss');
    const roll = hit(k.roll, 'roll');
    const mew = hit(k.mew, 'mew');
    const dash = hit(k.dash, 'dash');
    const dashHeld = held(k.dash, touch.held.has('dash'));
    const grab = hit(k.catch, 'catch');
    const sneakHeld = held(k.sneak, touch.held.has('sneak'));
    touch.pressed.clear();
    // up a tree the cat walks along the branch it is on: up looks up, down drops it onto the one below
    const perch = this.hop || me.act === Act.Jump ? null : standingOn(me.x, me.y, me.z);
    if (perch && dy !== 0) {
      if (dy > 0) this.dropFrom = perch.z;
      else if (dx === 0) me.facing = Facing.Up;
      dy = 0;
    }
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
    // where we are, signed now and then, for the cats to remember should we leave and come back
    if (this.revealed) this.board.moved(me.x, me.y, me.z, me.facing, now);
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
      // pawing at a monument brings up its name; at a tree's trunk, maybe shakes something down
      else if (!this.landmarks.touch(me.x, me.y, now)) {
        const tree = trunkNear(me.x, me.y, me.z);
        if (tree >= 0) {
          const gt = Math.round(this.net.now());
          this.ambient.shakeTree(tree, gt);
          this.net.shake(tree, gt);
        }
      }
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
    // a mew, whatever the cat is doing (one standing about sits up for it)
    if (mew) {
      me.mews = (me.mews + 1) & 0xffff;
      me.mewAt = now;
      if (!moving && (me.act === Act.Idle || me.act === Act.Sit || me.act === Act.Lick || me.act === Act.Sleep)) begin(Act.Mew);
    }
    if (hiss && grounded) begin(Act.Hiss);
    else if (roll && grounded) begin(Act.Roll);
    else if (jump && grounded) {
      begin(Act.Jump);
      this.vz = JUMP_V;
      this.dropFrom = Infinity;
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
      step(body, this.vel.x * dt, this.vel.y * dt);
      // going diagonally, keep x and y stepping in time so the view doesn't staircase: whenever
      // the cat moved freely both ways (not on the first frame only: sliding along a bush or
      // a fence holds one of them back and puts them out of step)
      const free = Math.abs(body.x - bx - this.vel.x * dt) < 1e-6 && Math.abs(body.y - by - this.vel.y * dt) < 1e-6;
      if (wx && wy && !icy && free) alignDiagonal(body, wx, wy);
      me.x = body.x; me.y = body.y; me.z = body.z;
      // sliding into something stops the slide that way
      if (icy) {
        if (Math.abs(me.x - bx) < Math.abs(this.vel.x * dt) * 0.5) this.vel.x = 0;
        if (Math.abs(me.y - by) < Math.abs(this.vel.y * dt) * 0.5) this.vel.y = 0;
      }
    } else if (icy) this.vel.x = this.vel.y = 0;

    // vertical: fall onto whatever surface is below (also when walking off a hedge or a branch);
    // on the way up, branches are jumped through
    const ground = surfaceAt(me.x, me.y, me.z, this.dropFrom);
    if (me.z > ground || this.vz > 0) {
      if (me.act !== Act.Jump) me.setAct(Act.Jump, now);
      this.vz -= GRAVITY * dt;
      me.z += this.vz * dt;
      if (me.z <= ground && this.vz <= 0) {
        me.z = ground;
        this.vz = 0;
        this.dropFrom = Infinity;
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
          const { x, y, z } = this.lastDry;
          if (Math.abs(x - me.x) > 0.5) me.facing = x < me.x ? Facing.Left : Facing.Right;
          this.hop = { fx: me.x, fy: me.y, tx: x, ty: y, tz: z, t0: now };
          begin(Act.Jump);
          return;
        }
      }
    } else {
      me.z = ground;
      if (me.act === Act.Jump) me.setAct(moving ? Act.Walk : Act.Idle, now);
      this.airCatch = null;
    }

    if (me.act !== Act.Jump && !wetAt(me.x, me.y)) this.lastDry = { x: me.x, y: me.y, z: me.z };

    // on a branch, settle onto its line (where it was landed on anywhere in front of or behind the trunk)
    const on = me.act === Act.Jump ? null : standingOn(me.x, me.y, me.z);
    if (on && me.y !== on.y) me.y += Math.sign(on.y - me.y) * Math.min(Math.abs(on.y - me.y), SETTLE_SPEED * dt);

    if (me.act === Act.Idle && now - this.lastInput > SIT_AFTER_MS && Math.abs(this.vel.x) + Math.abs(this.vel.y) < 2) {
      if (me.facing === Facing.Up) me.facing = Facing.Down;
      me.setAct(Act.Sit, now);
      this.nextLick = now + 2500 + Math.random() * 4000;
    }
    if (me.act === Act.Sit && now >= this.nextLick) begin(Act.Lick);
    // after a long while the cat curls up and falls asleep
    if (me.act === Act.Sit && now - this.lastInput > SLEEP_AFTER_MS) me.setAct(Act.Sleep, now);
    // a rest in a bird house or the tree house: ready to dash again
    if (on && HOUSES.has(on.kind) && (me.act === Act.Sit || me.act === Act.Lick || me.act === Act.Sleep)) this.dash.rest(now);
  }

  /**
   * A cat that stayed in the garden remembers where ours was before a reload:
   * carry on from there, if we've only just arrived (and it's somewhere a cat can be).
   */
  private resume(pose: Pose): void {
    if (this.resumed || this.time.now - this.arrived > RESUME_MS) return;
    const [x, y, z0] = pose;
    const z = surfaceAt(x, y, z0 + 4);
    if (heightUnder(x + FEET.x0, y + FEET.y0, x + FEET.x1, y + FEET.y1, z + 4) >= WALL || Math.abs(z - z0) > 4) return;
    this.resumed = true;
    // still behind the curtain: just be there when it opens. Already showing: dither out, move, dither back in
    if (!this.revealed) {
      this.placeAt(pose, z);
      this.reveal();
    } else void this.fader.close().then(() => {
      this.placeAt(pose, z);
      void this.fader.reveal(500);
    });
  }

  private placeAt([x, y, , facing]: Pose, z: number): void {
    const me = this.me;
    Object.assign(me, { x, y, z });
    if (Object.values(Facing).includes(facing as Facing)) me.facing = facing as Facing;
    me.setAct(Act.Idle, this.time.now);
    this.vel = { x: 0, y: 0 };
    this.vz = 0;
    this.hop = null;
    this.lastDry = { x, y, z };
    this.camFloor = this.camZ = z;
    this.camAnchor.setPosition(Math.round(x), Math.round(y) - Math.round(z));
    this.cameras.main.centerOn(Math.round(x), Math.round(y) - Math.round(z));
  }

  private reveal(): void {
    if (this.revealed) return;
    this.revealed = true;
    this.lastInput = this.time.now;
    this.input.keyboard!.resetKeys();
    loaded();
    void this.fader.reveal();
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

// Peer-to-peer networking. Visitors find each other through public Nostr relays
// (Trystero's default strategy); after that all traffic flows browser-to-browser
// over WebRTC. The web server is never involved.
import { joinRoom, selfId, type Room } from 'trystero';
import type { Prey, CatMsg } from '../game/state.ts';
import { sanitizeCat, sanitizeCatch, sanitizeCoaster, sanitizeSeed, sanitizeShake, sanitizeTrain, sanitizeVote, sanitizeWorld, type CoasterMsg, type TrainMsg, type VoteMsg, type WorldMsg } from './protocol.ts';
import { NOTCHES, SPEEDS, TRACK_LENGTH } from '../game/train.ts';
import { sanitizeBoard, type BoardMsg } from '../game/Board.ts';
import { newSeed, older, type WorldSeed } from '../world/seed.ts';
import { MAX_ZONES } from '../world/themes.ts';

// unversioned until the site is released; after that, version it when the protocol changes
const APP_ID = 'bernhard.esperester.de/garden-of-cats';
/** A garden is "full" at this many cats; later visitors open the next one. */
const ROOM_CAP = 20;
const MAX_ROOMS = 50;
/** How long to listen in a garden before deciding whether it's full. */
const SETTLE_MS = 4000;

/**
 * How long to listen for the cats already in a garden before laying out a
 * new one: briefly for a new visitor, longer for one that was here a moment
 * ago (a reload: the cats take a few seconds to connect, and the garden is
 * likely still there); HELLO_MS more for each cat that turns up meanwhile, up
 * to LAST_LOOK_MS. Once one hands us the garden's seed, a moment more for
 * the others to (should two gardens have just met).
 */
const FIRST_LOOK_MS = 1500, RETURN_LOOK_MS = 5000, HELLO_MS = 1500, LAST_LOOK_MS = 6000, MORE_SEEDS_MS = 300;
/** Back within this long counts as returning. */
const RETURN_WITHIN_MS = 10 * 60 * 1000;

/** When this browser last left the garden (ms since epoch), or 0. */
function leftAt(): number {
  try { return Number(localStorage.getItem('cat-left')) || 0; } catch { return 0; }
}
addEventListener('pagehide', () => {
  try { localStorage.setItem('cat-left', String(Date.now())); } catch { /* storage unavailable */ }
});

// A garden lasts as long as there are cats in it: each one that arrives is
// handed the seed. The last cat to leave keeps it a while, though: should it
// be back within RETURN_WITHIN_MS to find the garden empty, it's the same
// garden again (for anyone else it's gone: they plant a new one).
const KEPT = 'garden-kept', KEEP_EVERY_MS = 30_000;

/** The seed of the garden this browser was last in, if it was there within RETURN_WITHIN_MS. */
function keptSeed(garden: number): WorldSeed | null {
  try {
    const [g, seed, born, at] = JSON.parse(localStorage.getItem(KEPT) ?? 'null') as number[];
    const s = sanitizeSeed([seed, born]);
    return s && g === garden && Date.now() - at < RETURN_WITHIN_MS ? s : null;
  } catch {
    return null;
  }
}
function keepSeed(garden: number, s: WorldSeed): void {
  try { localStorage.setItem(KEPT, JSON.stringify([garden, s.seed, s.born, Date.now()])); } catch { /* storage unavailable */ }
}

// Moving to another garden means laying out another park, so the page starts
// over: these say where to go (the next garden when this one is full; or
// this garden, grown from an older seed that turned up), for the next load only.
const NEXT_GARDEN = 'garden-next', NEXT_SEED = 'garden-seed', RESEEDS = 'garden-reseeds';
/** A garden whose seed keeps changing is someone playing tricks: start over at most this often. */
const MAX_RESEEDS = 2, RESEED_WINDOW_MS = 10 * 60 * 1000;

function takeNext<T>(key: string, parse: (v: string) => T | null): T | null {
  try {
    const v = sessionStorage.getItem(key);
    sessionStorage.removeItem(key);
    return v === null ? null : parse(v);
  } catch {
    return null;
  }
}

/** Start the page over, to land in garden `garden` (grown from `seed`, if given). */
function startOver(garden: number, seed?: WorldSeed): boolean {
  try {
    if (seed) {
      const recent = (JSON.parse(sessionStorage.getItem(RESEEDS) ?? '[]') as number[]).filter((t) => Date.now() - t < RESEED_WINDOW_MS);
      if (recent.length >= MAX_RESEEDS) return false;
      sessionStorage.setItem(RESEEDS, JSON.stringify([...recent, Date.now()]));
      sessionStorage.setItem(NEXT_SEED, JSON.stringify([seed.seed, seed.born]));
    }
    sessionStorage.setItem(NEXT_GARDEN, String(garden));
  } catch {
    return false;
  }
  location.reload();
  return true;
}

export interface NetEvents {
  onState: (peerId: string, msg: CatMsg) => void;
  /** Another cat caught (or swiped at) the fish, butterfly or bee with this id. */
  onCatch: (peerId: string, kind: Prey, id: number) => void;
  /** Another cat pawed at tree `tree` at garden time gt. */
  onShake: (peerId: string, tree: number, gt: number) => void;
  onLeave: (peerId: string) => void;
  /** Someone new in the garden. */
  onJoin: (peerId: string) => void;
  /** What a cat already here knows of the garden (sent to us as we arrive). */
  onWorld: (peerId: string, msg: WorldMsg) => void;
  /** Scoreboard news from another cat. */
  onBoard: (peerId: string, msg: BoardMsg) => void;
  onStatus: (garden: number, peers: number, settled: boolean) => void;
  /** Another cat's verdict on a catch or on a cat (see consensus.ts). */
  onVote: (peerId: string, msg: VoteMsg) => void;
  /** The cat driving the train says where it is. */
  onTrain: (peerId: string, msg: TrainMsg) => void;
  /** Another cat rides (or is about to ride) a rollercoaster. */
  onCoaster: (peerId: string, msg: CoasterMsg) => void;
}

const trainOf = (d: unknown) => sanitizeTrain(d, TRACK_LENGTH, NOTCHES, SPEEDS[NOTCHES]);

/** This visit's connection id (what our signed scoreboard entry is bound to). */
export const PEER = selfId;

/**
 * The connection to the other cats. It starts before the garden is laid out
 * (to find out which garden this is: seed()); until the game is attached,
 * whatever the others send waits in a queue.
 */
export class Net {
  private room: Room | null = null;
  private send: ((msg: CatMsg, target?: string) => void) | null = null;
  private sendCatch: ((kind: Prey, id: number) => void) | null = null;
  private sendShake: ((tree: number, gt: number) => void) | null = null;
  private sendBoard: ((msg: BoardMsg, target?: string) => void) | null = null;
  private sendVote: ((msg: VoteMsg) => void) | null = null;
  private sendWorld: ((msg: WorldMsg, target: string) => void) | null = null;
  private sendSeed: ((s: [number, number], target?: string) => void) | null = null;
  private sendTrain: ((msg: TrainMsg) => void) | null = null;
  private sendCoaster: ((msg: CoasterMsg) => void) | null = null;
  /** Peer clock minus our clock, in ms, measured once when a peer joins. */
  private offsets = new Map<string, number>();
  readonly id = selfId;
  private garden = 0;
  private settled = false;
  private getState: (() => CatMsg) | null = null;
  private ev: NetEvents | null = null;
  /** How many trees this garden has (to check the paws at them). */
  private trees = 0;
  /** What came before the game was attached, in order. */
  private queued: (() => void)[] = [];
  /** This garden's seed, once we know it. */
  private planted: WorldSeed | null = null;
  /** Before we know it: the oldest garden's seed the cats here have told us of. */
  private offered: WorldSeed | null = null;
  /** On the way to another garden (the page is starting over). */
  private leaving = false;
  /** While looking for the garden: news of a seed, or of a cat arriving. */
  private looking: { seed: () => void; joined: () => void } | null = null;

  start(): void {
    this.enter(takeNext(NEXT_GARDEN, (v) => (/^\d+$/.test(v) ? Math.min(MAX_ROOMS, Math.max(1, +v)) : null)) ?? 1);
    window.addEventListener('pagehide', () => void this.room?.leave());
  }

  /**
   * Which garden this is: the seed the cats already here have (we listen for
   * them a little while), or a new one if there are none (seed.ts). Calls
   * `progress` with 0..1 while it listens.
   */
  seed(progress: (p: number) => void): Promise<WorldSeed> {
    const kept = takeNext(NEXT_SEED, (v) => sanitizeSeed(JSON.parse(v)));
    if (kept) return Promise.resolve(this.plant(kept));
    return new Promise((resolve) => {
      const t0 = Date.now();
      let until = t0 + (t0 - leftAt() < RETURN_WITHIN_MS ? RETURN_LOOK_MS : FIRST_LOOK_MS);
      this.looking = {
        seed: () => {
          until = Math.min(until, Date.now() + MORE_SEEDS_MS);
        },
        joined: () => {
          if (!this.offered) until = Math.min(t0 + LAST_LOOK_MS, Math.max(until, Date.now() + HELLO_MS));
        },
      };
      if (this.offered) this.looking.seed();
      else if (this.peerCount()) this.looking.joined();
      const tick = () => {
        const now = Date.now();
        if (now < until) {
          progress((now - t0) / (until - t0));
          setTimeout(tick, 50);
          return;
        }
        this.looking = null;
        resolve(this.plant(this.offered ?? keptSeed(this.garden) ?? newSeed()));
      };
      tick();
    });
  }

  /** This is the garden's seed now: tell the cats here (so that of two gardens that meet, they keep the older). */
  private plant(s: WorldSeed): WorldSeed {
    this.planted = s;
    this.sendSeed?.([s.seed, s.born]);
    // (kept now and then, and on leaving: should we be the last cat here and come back)
    const keep = () => !this.leaving && keepSeed(this.garden, s);
    keep();
    setInterval(keep, KEEP_EVERY_MS);
    addEventListener('pagehide', keep);
    return s;
  }

  /** A cat told us its garden's seed. */
  private seedFrom(peerId: string, s: WorldSeed): void {
    const ours = this.planted;
    if (!ours) {
      this.offered = this.offered ? older(this.offered, s) : s;
      return this.looking?.seed();
    }
    if (s.seed === ours.seed && s.born === ours.born) return;
    // an older garden than ours: move over to it (should it be younger, it will move to ours)
    if (older(ours, s) === ours) this.sendSeed?.([ours.seed, ours.born], peerId);
    else if (!this.leaving) {
      this.leaving = startOver(this.garden, s);
      if (!this.leaving) console.warn('the garden keeps changing; staying in this one');
    }
  }

  /** From now on the game hears what the others send (starting with what came while it was being built). */
  attach(getState: () => CatMsg, ev: NetEvents, trees: number): void {
    this.getState = getState;
    this.ev = ev;
    this.trees = trees;
    for (const f of this.queued) f();
    this.queued = [];
  }

  /** Hand something to the game, or keep it until there is one. */
  private deliver(f: (ev: NetEvents) => void): void {
    if (this.ev) f(this.ev);
    else if (this.queued.length < 4000) this.queued.push(() => f(this.ev!));
  }

  broadcast(msg: CatMsg): void {
    this.send?.(msg);
  }

  catchPrey(kind: Prey, id: number): void {
    this.sendCatch?.(kind, id);
  }

  shake(tree: number, gt: number): void {
    this.sendShake?.(tree, gt);
  }

  board(msg: BoardMsg, target?: string): void {
    this.sendBoard?.(msg, target);
  }

  /** Tell a cat that just arrived what we know of the garden. */
  world(msg: WorldMsg, target: string): void {
    this.sendWorld?.(msg, target);
  }

  vote(msg: VoteMsg): void {
    this.sendVote?.(msg);
  }

  /** Where the train is (we're driving it, or just let go of it). */
  train(msg: TrainMsg): void {
    this.sendTrain?.(msg);
  }

  /** Our cat rides a rollercoaster (or got out of it before it left). */
  coaster(msg: CoasterMsg): void {
    this.sendCoaster?.(msg);
  }

  /**
   * Shared garden clock (ms). Everyone follows the clock of the peer with the
   * lowest id, so seeded fauna plays out identically for all visitors.
   */
  now(): number {
    let leader = selfId, offset = 0;
    for (const [id, o] of this.offsets) if (id < leader) { leader = id; offset = o; }
    return Date.now() + offset;
  }

  peerCount(): number {
    return this.room ? Object.keys(this.room.getPeers()).length : 0;
  }

  private status(): void {
    const garden = this.garden, peers = this.peerCount(), settled = this.settled;
    this.deliver((ev) => ev.onStatus(garden, peers, settled));
  }

  private enter(garden: number): void {
    this.garden = garden;
    this.settled = false;
    const room = joinRoom({ appId: APP_ID }, `garden-${garden}`);
    this.room = room;
    const action = room.makeAction<CatMsg>('cat');
    this.send = (msg, target) => void action.send(msg, target ? { target } : undefined).catch(() => {});
    action.onMessage = (data, { peerId }) => {
      if (this.room !== room) return;
      const msg = sanitizeCat(data);
      if (msg) this.deliver((ev) => ev.onState(peerId, msg));
    };
    const prey = room.makeAction<[number, number]>('catch');
    this.sendCatch = (kind, id) => void prey.send([kind, id]).catch(() => {});
    prey.onMessage = (data, { peerId }) => {
      const caught = this.room === room ? sanitizeCatch(data) : null;
      if (caught) this.deliver((ev) => ev.onCatch(peerId, ...caught));
    };
    const shake = room.makeAction<[number, number]>('shake');
    this.sendShake = (tree, gt) => void shake.send([tree, gt]).catch(() => {});
    shake.onMessage = (data, { peerId }) => {
      if (this.room !== room) return;
      this.deliver((ev) => {
        const s = sanitizeShake(data, this.trees);
        if (s) ev.onShake(peerId, ...s);
      });
    };
    const board = room.makeAction<BoardMsg>('board');
    this.sendBoard = (msg, target) => void board.send(msg, target ? { target } : undefined).catch(() => {});
    board.onMessage = (data, { peerId }) => {
      if (this.room !== room) return;
      const msg = sanitizeBoard(data);
      if (msg) this.deliver((ev) => ev.onBoard(peerId, msg));
    };
    const world = room.makeAction<WorldMsg>('world');
    this.sendWorld = (msg, target) => void world.send(msg, { target }).catch(() => {});
    world.onMessage = (data, { peerId }) => {
      if (this.room !== room) return;
      this.deliver((ev) => {
        const msg = sanitizeWorld(data, this.trees, trainOf);
        if (msg) ev.onWorld(peerId, msg);
      });
    };
    const train = room.makeAction<TrainMsg>('train');
    this.sendTrain = (msg) => void train.send(msg).catch(() => {});
    train.onMessage = (data, { peerId }) => {
      const msg = this.room === room ? trainOf(data) : null;
      if (msg) this.deliver((ev) => ev.onTrain(peerId, msg));
    };
    const coaster = room.makeAction<CoasterMsg>('coaster');
    this.sendCoaster = (msg) => void coaster.send(msg).catch(() => {});
    coaster.onMessage = (data, { peerId }) => {
      const msg = this.room === room ? sanitizeCoaster(data, MAX_ZONES) : null;
      if (msg) this.deliver((ev) => ev.onCoaster(peerId, msg));
    };
    // which garden this is: the seed it grew from, told to every cat that arrives
    const seed = room.makeAction<[number, number]>('seed');
    this.sendSeed = (s, target) => void seed.send(s, target ? { target } : undefined).catch(() => {});
    seed.onMessage = (data, { peerId }) => {
      const s = this.room === room ? sanitizeSeed(data) : null;
      if (s) this.seedFrom(peerId, s);
    };
    const vote = room.makeAction<VoteMsg>('vote');
    this.sendVote = (msg) => void vote.send(msg).catch(() => {});
    vote.onMessage = (data, { peerId }) => {
      const msg = this.room === room ? sanitizeVote(data) : null;
      if (msg) this.deliver((ev) => ev.onVote(peerId, msg));
    };
    // clock sync: ask a new peer for its time, take the best of a few round trips
    const clock = room.makeAction<number, number>('clock', { kind: 'request', onRequest: () => Date.now() });
    const syncClock = async (peerId: string) => {
      let best = Infinity;
      for (let i = 0; i < 3; i++) {
        const t0 = Date.now();
        const theirs = await clock.request(0, { target: peerId, timeoutMs: 3000 }).catch(() => null);
        const t1 = Date.now();
        if (typeof theirs !== 'number' || t1 - t0 >= best) continue;
        best = t1 - t0;
        this.offsets.set(peerId, theirs - (t0 + t1) / 2);
      }
    };
    room.onPeerJoin = (peerId) => {
      if (this.room !== room) return;
      void syncClock(peerId);
      if (this.planted) this.sendSeed?.([this.planted.seed, this.planted.born], peerId);
      this.looking?.joined();
      this.deliver((ev) => {
        if (this.getState) this.send?.(this.getState(), peerId);
        ev.onJoin(peerId);
      });
      this.status();
    };
    room.onPeerLeave = (peerId) => {
      if (this.room !== room) return;
      this.offsets.delete(peerId);
      this.deliver((ev) => ev.onLeave(peerId));
      this.status();
    };
    this.status();

    setTimeout(() => {
      if (this.room !== room) return;
      // We count as one of the cats, so "full" means ROOM_CAP - 1 others.
      if (this.peerCount() >= ROOM_CAP && garden < MAX_ROOMS && !this.leaving && (this.leaving = startOver(garden + 1))) return;
      this.settled = true;
      this.status();
    }, SETTLE_MS);
  }
}

/** The connection, made before the garden is laid out (main.ts) and used by the game once it is. */
let current: Net | null = null;
export const useNet = (n: Net): void => {
  current = n;
};
export const theNet = (): Net => {
  if (!current) throw new Error('not connected yet');
  return current;
};

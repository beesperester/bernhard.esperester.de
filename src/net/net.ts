// Peer-to-peer networking. Visitors find each other through public Nostr relays
// (Trystero's default strategy); after that all traffic flows browser-to-browser
// over WebRTC. The web server is never involved.
import { joinRoom, type Room } from 'trystero';
import type { CatMsg } from '../game/state.ts';

// bump the version whenever CatMsg changes so old and new clients don't mix
const APP_ID = 'bernhard.esperester.de/garden-of-cats/v2';
/** A garden is "full" at this many cats; later visitors open the next one. */
const ROOM_CAP = 20;
const MAX_ROOMS = 50;
/** How long to listen in a garden before deciding whether it's full. */
const SETTLE_MS = 4000;

export interface NetEvents {
  onState: (peerId: string, msg: CatMsg) => void;
  onLeave: (peerId: string) => void;
  onStatus: (garden: number, peers: number, settled: boolean) => void;
}

export class Net {
  private room: Room | null = null;
  private send: ((msg: CatMsg, target?: string) => void) | null = null;
  private garden = 0;
  private settled = false;
  private readonly getState: () => CatMsg;
  private readonly ev: NetEvents;

  constructor(getState: () => CatMsg, ev: NetEvents) {
    this.getState = getState;
    this.ev = ev;
  }

  start(): void {
    this.enter(1);
    window.addEventListener('pagehide', () => void this.room?.leave());
  }

  broadcast(msg: CatMsg): void {
    this.send?.(msg);
  }

  peerCount(): number {
    return this.room ? Object.keys(this.room.getPeers()).length : 0;
  }

  private status(): void {
    this.ev.onStatus(this.garden, this.peerCount(), this.settled);
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
      const msg = sanitize(data);
      if (msg) this.ev.onState(peerId, msg);
    };
    room.onPeerJoin = (peerId) => {
      if (this.room !== room) return;
      this.send?.(this.getState(), peerId);
      this.status();
    };
    room.onPeerLeave = (peerId) => {
      if (this.room !== room) return;
      this.ev.onLeave(peerId);
      this.status();
    };
    this.status();

    setTimeout(() => {
      if (this.room !== room) return;
      // We count as one of the cats, so "full" means ROOM_CAP - 1 others.
      if (this.peerCount() >= ROOM_CAP && garden < MAX_ROOMS) {
        for (const id of Object.keys(room.getPeers())) this.ev.onLeave(id);
        this.room = null;
        this.send = null;
        void room.leave();
        this.enter(garden + 1);
        return;
      }
      this.settled = true;
      this.status();
    }, SETTLE_MS);
  }
}

/** Peers are untrusted: accept only a well-formed state tuple. */
function sanitize(d: unknown): CatMsg | null {
  if (!Array.isArray(d) || d.length !== 7 || !d.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  const [x, y, z, facing, act, seq, coat] = d as number[];
  return [x, y, z, facing | 0, act | 0, seq | 0, coat | 0];
}

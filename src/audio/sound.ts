// Sound effects and ambience on Web Audio, so any number of sounds can overlap.
//
// Every folder in src/sounds/ is a group (birds/, later steps/, purr/, hiss/,
// splash/, wind/ …); playing a group picks one of its files at random. Groups
// can be triggered by the game (`play`), or run as ambient layers that fire on
// their own every so often (`LAYERS`), or loop underneath everything (wind).
// Sounds placed in the park get quieter with distance from the listener (your
// cat) and pan left/right.

const files = import.meta.glob('../sounds/*/*.{mp3,ogg,m4a}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

/** Group name → file URLs. */
export const SOUNDS: Record<string, string[]> = {};
for (const [path, url] of Object.entries(files)) (SOUNDS[path.split('/').at(-2)!] ??= []).push(url);

export interface Pos { x: number; y: number }
type Range = [number, number];

export interface PlayOptions {
  /** Where in the park it happens; omit for sounds that are everywhere. */
  at?: Pos | null;
  volume?: number;
  /** Playback rate: <1 lower and slower, >1 higher and faster. */
  rate?: number;
  loop?: boolean;
  /** Fade in/out in seconds (a loop fades out when stopped). */
  fade?: number;
}

export interface Playing {
  stop(fade?: number): void;
  setVolume(v: number): void;
}

/** An ambient layer: a group that plays by itself at random intervals. */
export interface Layer {
  /** Seconds between the starts of two sounds. */
  every: Range;
  volume: Range;
  rate?: Range;
  fade?: number;
  /** Where the next one comes from; `null` skips this turn (e.g. no tree nearby). */
  where?: () => Pos | null;
}

export const LAYERS: Record<string, Layer> = {
  birds: { every: [12, 40], volume: [0.35, 0.6], rate: [0.94, 1.08], fade: 0.4 },
};

/** Beyond this distance (px) a sound is silent. */
const HEARING = 320;
const MASTER = 0.8;
const MUTE_KEY = 'sound-muted';

const rand = ([a, b]: Range) => a + Math.random() * (b - a);

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly buffers = new Map<string, Promise<AudioBuffer | null>>();
  private readonly lastPick = new Map<string, string>();
  private readonly timers = new Map<string, number>();
  private readonly positioned = new Set<{ at: Pos; gain: GainNode; pan: StereoPannerNode; volume: number }>();
  private readonly listeners: ((muted: boolean) => void)[] = [];
  /** Where your cat is: what positioned sounds are heard relative to. */
  listener: Pos = { x: 0, y: 0 };
  muted: boolean;

  constructor() {
    this.muted = load();
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else if (!this.muted) void this.ctx.resume();
    });
  }

  /**
   * Call from a user gesture: creates the audio context (and starts the
   * ambient layers), or wakes it up again. Safari is stricter than Chrome:
   * the context only runs if it is resumed and actually plays something
   * within the gesture, and it can also be 'interrupted' (not just
   * 'suspended'), e.g. by another app or a phone call.
   */
  unlock(): void {
    if (!this.ctx) {
      // (iPhone and iPad: play through the ringer switch, like the music does)
      const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
      if (session) session.type = 'playback';
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : MASTER;
      this.master.connect(this.ctx.destination);
      for (const name of Object.keys(LAYERS)) if (SOUNDS[name]) this.schedule(name, true);
    }
    if (this.ctx.state !== 'running' && !this.muted && !document.hidden) {
      void this.ctx.resume().catch(() => {});
      // a moment of silence, played in the gesture, is what unlocks it in Safari
      const blip = this.ctx.createBufferSource();
      blip.buffer = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
      blip.connect(this.ctx.destination);
      blip.start();
    }
  }

  toggle(): void {
    this.muted = !this.muted;
    save(this.muted);
    if (this.ctx && this.master) {
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setTargetAtTime(this.muted ? 0 : MASTER, t, 0.15);
      if (!this.muted) void this.ctx.resume();
    } else if (!this.muted) this.unlock();
    for (const fn of this.listeners) fn(this.muted);
  }

  onChange(fn: (muted: boolean) => void): void {
    this.listeners.push(fn);
    fn(this.muted);
  }

  /** Let the scene decide where a layer's sounds come from (e.g. birds in a nearby tree). */
  setSource(layer: string, where: () => Pos | null): void {
    const l = LAYERS[layer];
    if (l) l.where = where;
  }

  /** Move the listener and re-balance sounds that are still playing. */
  setListener(p: Pos): void {
    this.listener = p;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const s of this.positioned) {
      const { gain, pan } = this.spatial(s.at);
      s.gain.gain.setTargetAtTime(s.volume * gain, t, 0.1);
      s.pan.pan.setTargetAtTime(pan, t, 0.1);
    }
  }

  /** Play one sound from a group. Resolves to null if there is nothing to play (yet). */
  async play(group: string, opts: PlayOptions = {}): Promise<Playing | null> {
    const ctx = this.ctx, master = this.master;
    if (!ctx || !master || document.hidden || this.muted) return null;
    const url = this.pick(group);
    if (!url) return null;
    const at = opts.at ?? null;
    if (at && this.spatial(at).gain <= 0) return null; // too far away to hear
    const buffer = await this.load(url);
    if (!buffer) return null;

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = !!opts.loop;
    // MP3 pads both ends with a little silence; loop inside it so there is no click
    if (src.loop) {
      src.loopStart = Math.min(0.06, buffer.duration / 4);
      src.loopEnd = buffer.duration - Math.min(0.06, buffer.duration / 4);
    }
    src.playbackRate.value = opts.rate ?? 1;
    const env = ctx.createGain(); // fades
    const vol = ctx.createGain(); // volume × distance
    const pan = ctx.createStereoPanner();
    src.connect(env).connect(vol).connect(pan).connect(master);

    const volume = opts.volume ?? 1;
    const place = at ? { at, gain: vol, pan, volume } : null;
    const sp = at ? this.spatial(at) : { gain: 1, pan: 0 };
    vol.gain.value = volume * sp.gain;
    pan.pan.value = sp.pan;
    if (place) this.positioned.add(place);

    const fade = opts.fade ?? 0.02;
    const t = ctx.currentTime;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(1, t + fade);
    if (!src.loop) {
      const end = t + buffer.duration / src.playbackRate.value;
      env.gain.setValueAtTime(1, Math.max(t + fade, end - fade));
      env.gain.linearRampToValueAtTime(0, end);
    }
    src.start(t, src.loop ? src.loopStart : 0);
    src.onended = () => { if (place) this.positioned.delete(place); };

    return {
      stop: (f = fade) => {
        const now = ctx.currentTime;
        env.gain.cancelScheduledValues(now);
        env.gain.setValueAtTime(env.gain.value, now);
        env.gain.linearRampToValueAtTime(0, now + f);
        src.stop(now + f + 0.05);
      },
      setVolume: (v) => {
        if (place) place.volume = v;
        vol.gain.setTargetAtTime(v * (at ? this.spatial(at).gain : 1), ctx.currentTime, 0.1);
      },
    };
  }

  /** Volume factor and stereo pan for a sound at `p`, heard from the listener. */
  private spatial(p: Pos): { gain: number; pan: number } {
    const dx = p.x - this.listener.x, dy = p.y - this.listener.y;
    const d = Math.hypot(dx, dy);
    const g = Math.max(0, 1 - d / HEARING);
    return { gain: g * g, pan: Math.max(-0.8, Math.min(0.8, dx / 200)) };
  }

  /** Random file of a group, avoiding the one it played last. */
  private pick(group: string): string | null {
    const list = SOUNDS[group];
    if (!list?.length) return null;
    let url = list[Math.floor(Math.random() * list.length)];
    if (list.length > 1 && url === this.lastPick.get(group)) url = list[(list.indexOf(url) + 1) % list.length];
    this.lastPick.set(group, url);
    return url;
  }

  private load(url: string): Promise<AudioBuffer | null> {
    let p = this.buffers.get(url);
    if (!p) {
      const ctx = this.ctx!;
      p = fetch(url)
        .then((r) => r.arrayBuffer())
        // (older Safari only knows the callback form)
        .then((b) => new Promise<AudioBuffer>((resolve, reject) => void ctx.decodeAudioData(b, resolve, reject)?.catch?.(reject)))
        .catch(() => null);
      this.buffers.set(url, p);
    }
    return p;
  }

  /** Fire a layer after a random wait, then keep going. The first one comes a bit sooner. */
  private schedule(name: string, first = false): void {
    const l = LAYERS[name];
    const wait = rand(l.every) * (first ? 0.4 : 1);
    this.timers.set(name, window.setTimeout(() => {
      const at = l.where ? l.where() : null;
      if (!l.where || at) void this.play(name, { at, volume: rand(l.volume), rate: l.rate ? rand(l.rate) : 1, fade: l.fade });
      this.schedule(name);
    }, wait * 1000));
  }
}

/** The one sound engine, shared by the page (mute button) and the game (what plays where). */
export const sound = new Sound();

function load(): boolean {
  try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; }
}
function save(muted: boolean): void {
  try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch { /* storage unavailable */ }
}

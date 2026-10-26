// Background music in two playlists: src/music/day/ while the sun is up and
// src/music/night/ after dark (following the garden's real Berlin sun). Songs
// play in random order (never the same one twice in a row), so a single song
// simply loops; at dusk and dawn the song fades out and the other list takes
// over. If one list is empty, the other plays all the time. Browsers only
// allow sound after the visitor interacts, so the music starts on the first
// key press or tap.
import { lightAt } from '../world/sky.ts';

const files = import.meta.glob('../music/{day,night}/*.{mp3,ogg,m4a}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

export interface Track { title: string; src: string }
type Period = 'day' | 'night';

export const PLAYLISTS: Record<Period, Track[]> = { day: [], night: [] };
for (const [path, src] of Object.entries(files)) {
  const [period, name] = path.split('/').slice(-2);
  PLAYLISTS[period as Period].push({ title: name.replace(/\.[^.]+$/, ''), src });
}
for (const list of Object.values(PLAYLISTS)) list.sort((a, b) => a.title.localeCompare(b.title));

/** Night music once it is properly dark (the same moment the birds go to sleep). */
const periodNow = (): Period => (lightAt(Date.now()).night >= 0.5 ? 'night' : 'day');
/** How often to look whether day turned to night. */
const CHECK_MS = 20000;

const VOLUME = 0.45;
const FADE_MS = 1500;
const MUTE_KEY = 'music-muted';

export class Music {
  private readonly audio = new Audio();
  private period = periodNow();
  private current: Track | null = null;
  private started = false;
  private fade = 0;
  muted: boolean;
  private readonly listeners: ((muted: boolean, track: Track | null) => void)[] = [];

  constructor() {
    this.muted = load();
    this.audio.preload = 'none';
    this.audio.volume = 0;
    this.audio.addEventListener('ended', () => this.next());
    // dusk and dawn: fade out, then carry on with the other playlist
    window.setInterval(() => {
      const p = periodNow();
      if (p === this.period) return;
      this.period = p;
      if (!this.started || this.list.includes(this.current!)) return;
      if (this.muted || document.hidden || this.audio.paused) this.next();
      else this.fadeTo(0, () => this.next());
    }, CHECK_MS);
    // be quiet while the tab is in the background
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.fadeTo(0, () => this.audio.pause());
      else if (this.started && !this.muted) this.resume();
    });
  }

  /** Call from a user gesture (key press, tap): starts the music the first time. */
  unlock(): void {
    if (this.started || !this.list.length) return;
    this.started = true;
    this.next();
  }

  toggle(): void {
    this.muted = !this.muted;
    save(this.muted);
    if (this.muted) this.fadeTo(0, () => this.audio.pause());
    else if (this.started) this.resume();
    else this.unlock();
    this.emit();
  }

  onChange(fn: (muted: boolean, track: Track | null) => void): void {
    this.listeners.push(fn);
    fn(this.muted, this.track);
  }

  get track(): Track | null {
    return this.current;
  }

  /** The songs for this time of day (or the other list, if this one is empty). */
  private get list(): Track[] {
    const own = PLAYLISTS[this.period];
    return own.length ? own : PLAYLISTS[this.period === 'day' ? 'night' : 'day'];
  }

  /** Pick a random song other than the one that just played. */
  private next(): void {
    const list = this.list, n = list.length;
    if (!n) return;
    let i = Math.floor(Math.random() * n);
    if (n > 1 && list[i] === this.current) i = (i + 1 + Math.floor(Math.random() * (n - 1))) % n;
    this.current = list[i];
    this.audio.src = list[i].src;
    this.audio.currentTime = 0;
    this.emit();
    if (!this.muted && !document.hidden) this.resume();
  }

  private resume(): void {
    this.audio.play().then(() => this.fadeTo(VOLUME)).catch(() => {
      // not allowed yet (no gesture registered): try again on the next one
      this.started = false;
    });
  }

  private fadeTo(target: number, done?: () => void): void {
    cancelAnimationFrame(this.fade);
    const from = this.audio.volume, t0 = performance.now();
    const step = () => {
      const u = Math.min(1, (performance.now() - t0) / FADE_MS);
      this.audio.volume = from + (target - from) * u;
      if (u < 1) this.fade = requestAnimationFrame(step);
      else done?.();
    };
    // rAF doesn't run in hidden tabs; finish immediately there
    if (document.hidden) { this.audio.volume = target; done?.(); }
    else step();
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.muted, this.track);
  }
}

function load(): boolean {
  try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; }
}
function save(muted: boolean): void {
  try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch { /* storage unavailable */ }
}

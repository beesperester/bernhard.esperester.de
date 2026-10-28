// Background music in two playlists: src/music/day/ while the sun is up and
// src/music/night/ after dark (following the garden's real Berlin sun). Songs
// play in random order (never the same one twice in a row), so a single song
// simply loops; at dusk and dawn the song fades out and the other list takes
// over. If one list is empty, the other plays all the time. A themed zone can
// have a playlist of its own (src/music/carnival/ …): while our cat is in the
// zone that plays instead, and on leaving, the song from before carries on
// where it left off. Browsers only allow sound after the visitor interacts,
// so the music starts on the first key press or tap.
import { lightAt } from '../world/sky.ts';

const files = import.meta.glob('../music/*/*.{mp3,ogg,m4a}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

export interface Track { title: string; src: string }
type Period = 'day' | 'night';

/** The day and night lists, and one for each themed zone that has music (by its theme). */
export const PLAYLISTS: Record<string, Track[]> = { day: [], night: [] };
for (const [path, src] of Object.entries(files)) {
  const [list, name] = path.split('/').slice(-2);
  (PLAYLISTS[list] ??= []).push({ title: name.replace(/\.[^.]+$/, ''), src });
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
  /** The zone our cat is in, if it has music of its own; and the song from before, to go back to. */
  private zone: string | null = null;
  private before: { track: Track; time: number } | null = null;
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

  /**
   * Our cat walked into a themed zone (its theme), or out of one (null). A zone with a playlist
   * takes over from the music playing; out of it again, the song from before carries on.
   */
  setZone(theme: string | null): void {
    const zone = theme && PLAYLISTS[theme]?.length ? theme : null;
    if (zone === this.zone) return;
    const leaving = this.zone !== null;
    // (the song from before, kept from the moment the first zone took over)
    if (!leaving && this.current) this.before = { track: this.current, time: this.audio.currentTime };
    this.zone = zone;
    if (!this.started) return;
    const back = zone === null ? this.before : null;
    const go = () => {
      if (!back || !this.list.includes(back.track)) return this.next();
      this.before = null;
      this.play(back.track, back.time);
    };
    if (this.muted || document.hidden || this.audio.paused) go();
    else this.fadeTo(0, go);
  }

  /** The songs for this time of day (or the other list, if this one is empty); in a zone, its own. */
  private get list(): Track[] {
    if (this.zone) return PLAYLISTS[this.zone];
    const own = PLAYLISTS[this.period];
    return own.length ? own : PLAYLISTS[this.period === 'day' ? 'night' : 'day'];
  }

  /** Pick a random song other than the one that just played. */
  private next(): void {
    const list = this.list, n = list.length;
    if (!n) return;
    let i = Math.floor(Math.random() * n);
    if (n > 1 && list[i] === this.current) i = (i + 1 + Math.floor(Math.random() * (n - 1))) % n;
    this.play(list[i], 0);
  }

  /** Put on a song, `at` seconds in (and play it, unless we're quiet). */
  private play(track: Track, at: number): void {
    this.current = track;
    this.audio.src = track.src;
    // (a list of one loops without a gap)
    this.audio.loop = this.list.length === 1;
    if (at > 0) this.audio.addEventListener('loadedmetadata', () => (this.audio.currentTime = at), { once: true });
    else this.audio.currentTime = 0;
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

/** The one music player, shared by the page (the note button) and the game (the zones' playlists). */
export const music = new Music();

function load(): boolean {
  try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; }
}
function save(muted: boolean): void {
  try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch { /* storage unavailable */ }
}

// Background music. Every file in src/music/ is part of the playlist; songs
// play in random order (never the same one twice in a row), so a single song
// simply loops. Browsers only allow sound after the visitor interacts, so the
// music starts on the first key press or tap.

const files = import.meta.glob('../music/*.{mp3,ogg,m4a}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

export interface Track { title: string; src: string }

export const PLAYLIST: Track[] = Object.entries(files)
  .map(([path, src]) => ({ title: path.split('/').pop()!.replace(/\.[^.]+$/, ''), src }))
  .sort((a, b) => a.title.localeCompare(b.title));

const VOLUME = 0.45;
const FADE_MS = 1500;
const MUTE_KEY = 'music-muted';

export class Music {
  private readonly audio = new Audio();
  private current = -1;
  private started = false;
  private fade = 0;
  muted: boolean;
  private readonly listeners: ((muted: boolean, track: Track | null) => void)[] = [];

  constructor() {
    this.muted = load();
    this.audio.preload = 'none';
    this.audio.volume = 0;
    this.audio.addEventListener('ended', () => this.next());
    // be quiet while the tab is in the background
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.fadeTo(0, () => this.audio.pause());
      else if (this.started && !this.muted) this.resume();
    });
  }

  /** Call from a user gesture (key press, tap): starts the music the first time. */
  unlock(): void {
    if (this.started || !PLAYLIST.length) return;
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
    return PLAYLIST[this.current] ?? null;
  }

  /** Pick a random song other than the one that just played. */
  private next(): void {
    const n = PLAYLIST.length;
    let i = Math.floor(Math.random() * n);
    if (n > 1 && i === this.current) i = (i + 1 + Math.floor(Math.random() * (n - 1))) % n;
    this.current = i;
    this.audio.src = PLAYLIST[i].src;
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

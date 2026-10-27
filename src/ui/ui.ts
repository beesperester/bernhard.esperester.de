// DOM overlay: status line, the how-to-play sign, and Game Boy style touch controls.
import { dpadURL } from './pixel.ts';

export type Button = 'jump' | 'hiss' | 'roll' | 'dash' | 'catch' | 'sneak' | 'mew';

export interface Controls {
  up: boolean; down: boolean; left: boolean; right: boolean;
  /** Buttons pressed since the last frame. */
  pressed: Set<Button>;
  /** Buttons currently held down. */
  held: Set<Button>;
}

export const touch: Controls = { up: false, down: false, left: false, right: false, pressed: new Set(), held: new Set() };

const isTouch = () => matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

export interface UI {
  setStatus: (s: string) => void;
  /** The player has started playing: stop nudging them towards the help. */
  hideHelp: () => void;
  /** Seconds until dash can be used again (0 = ready). */
  setDashCooldown: (s: number) => void;
}

/** A key (or, on touch, a button) as drawn on the help sign: 'arrows' and 'dpad' are whole clusters. */
type Key = string;
/** Each row of the help: one or more keys with what they do. */
type Row = [Key[], string][];

const KEYBOARD: Row[] = [
  [[['arrows'], 'walk about']],
  [[['SPACE'], 'jump, up onto things and into trees'], [['down'], 'drops back down']],
  [[['SHIFT'], 'dash (hold it; it needs a breather after)']],
  [[['X'], 'sneak up on something, then'], [['SHIFT'], 'to pounce']],
  [[['C'], 'catch, splash to lure fish, paw at a tree, a monument or a find']],
  [[['H'], 'hiss'], [['R'], 'roll'], [['E'], 'mew']],
];

const TOUCH: Row[] = [
  [[['dpad'], 'walk about']],
  [[['A'], 'jump, up onto things and into trees (down drops back down)']],
  [[['B'], 'dash (it needs a breather after)']],
  [[['SNEAK'], 'hold to creep up, then'], [['B'], 'to pounce']],
  [[['CATCH'], 'splash to lure fish, paw at a tree or a monument']],
  [[['HISS'], ''], [['ROLL'], ''], [['MEW'], 'to talk']],
];

function keyEl(key: Key, onTouch: boolean): HTMLElement {
  if (key === 'arrows') {
    // the inverted T
    const t = document.createElement('span');
    t.className = 'arrows';
    for (const name of ['up', 'left', 'down', 'right']) t.append(keyEl(name, false));
    return t;
  }
  if (['up', 'down', 'left', 'right'].includes(key)) return Object.assign(document.createElement('kbd'), { className: `arrow ${key}`, title: `arrow ${key}` });
  const k = document.createElement('kbd');
  if (key === 'dpad') k.className = 'dpad';
  else if (onTouch) k.className = key.length === 1 ? 'round' : 'pill';
  k.textContent = key === 'dpad' ? '' : key;
  if (key === 'SPACE' || key === 'SHIFT') k.classList.add('wide');
  return k;
}

/** The how-to-play sign behind the ? button (or the ? key); Esc, a tap outside or "Got it" puts it away. */
function setupHelp(onTouch: boolean, onOpen: (open: boolean) => void): { nudged: () => void } {
  const btn = document.getElementById('help-btn')!;
  const dialog = document.getElementById('help-dialog')!;
  const rows = dialog.querySelector('.rows')!;
  for (const row of onTouch ? TOUCH : KEYBOARD) {
    const r = document.createElement('div');
    r.className = 'row';
    for (const [keys, text] of row) {
      const item = document.createElement('span');
      item.className = 'item';
      for (const key of keys) item.append(keyEl(key, onTouch));
      if (text) item.append(Object.assign(document.createElement('span'), { className: 'what', textContent: text }));
      r.append(item);
    }
    rows.append(r);
  }
  const isOpen = () => !dialog.hidden;
  const show = (open: boolean) => {
    if (isOpen() === open) return;
    dialog.hidden = !open;
    btn.classList.remove('nudge');
    onOpen(open);
  };
  btn.addEventListener('pointerdown', (e) => e.stopPropagation());
  btn.addEventListener('click', () => show(!isOpen()));
  dialog.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    if (e.target === dialog) show(false);
  });
  dialog.querySelector('.close')!.addEventListener('click', () => show(false));
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === '?') show(!isOpen());
    else if (isOpen() && (e.key === 'Escape' || e.key === 'Enter')) show(false);
  });
  // a little wobble on the button until the cat gets going
  btn.classList.add('nudge');
  let timer = 0;
  return { nudged: () => { if (!timer) timer = window.setTimeout(() => btn.classList.remove('nudge'), 6000); } };
}

/** `onHelp` hears when the help sign opens and closes (the game holds still meanwhile). */
export function setupUI(onHelp: (open: boolean) => void = () => {}): UI {
  const status = document.getElementById('status')!;
  const pad = document.getElementById('touch')!;
  // the park is laid out after Berlin from OpenStreetMap data (ODbL), which asks for this credit
  const credit = document.getElementById('credit')!;
  const osm = Object.assign(document.createElement('a'), { href: 'https://www.openstreetmap.org/copyright', target: '_blank', rel: 'noopener', textContent: 'OpenStreetMap contributors' });
  credit.append(`© ${__BUILD_YEAR__} Bernhard Esperester · build ${__BUILD__} · map © `, osm);

  const onTouch = isTouch();
  const help = setupHelp(onTouch, onHelp);
  const hideHelp = help.nudged;

  if (onTouch) {
    pad.hidden = false;
    setupDpad(document.getElementById('dpad')!);
    for (const btn of pad.querySelectorAll<HTMLElement>('[data-btn]')) {
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        touch.pressed.add(btn.dataset.btn as Button);
        touch.held.add(btn.dataset.btn as Button);
        btn.classList.add('down');
      });
      const up = () => {
        touch.held.delete(btn.dataset.btn as Button);
        btn.classList.remove('down');
      };
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('pointerleave', up);
    }
  }

  let base = '';
  let cooldown = 0;
  const render = () => (status.textContent = cooldown ? `${base} · dash ${cooldown}s` : base);
  const dashBtn = pad.querySelector<HTMLElement>('[data-btn="dash"]')!;
  const setDashCooldown = (s: number) => {
    if (s === cooldown) return;
    cooldown = s;
    render();
    dashBtn.textContent = s ? String(s) : 'B';
    dashBtn.classList.toggle('cooling', s > 0);
  };

  return { setStatus: (s) => { base = s; render(); }, hideHelp, setDashCooldown };
}

function setupDpad(el: HTMLElement): void {
  let active: number | null = null;
  // the pixel-art pad with the pressed arms pushed in, drawn once per combination
  const art = new Map<string, string>();
  const show = (dir: string) => {
    if (!art.has(dir)) art.set(dir, `url(${dpadURL(dir)})`);
    el.style.backgroundImage = art.get(dir)!;
  };
  const set = (e: PointerEvent | null) => {
    touch.up = touch.down = touch.left = touch.right = false;
    if (!e) return;
    const r = el.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    const dead = r.width * 0.12;
    if (Math.hypot(dx, dy) < dead) return show('');
    // 8-way: allow diagonals within a 30° band around 45°
    const a = Math.atan2(dy, dx);
    const oct = Math.round(a / (Math.PI / 4));
    touch.right = oct === 0 || oct === 1 || oct === -1;
    touch.left = Math.abs(oct) === 4 || oct === 3 || oct === -3;
    touch.down = oct === 1 || oct === 2 || oct === 3;
    touch.up = oct === -1 || oct === -2 || oct === -3;
    show(`${touch.up ? 'u' : ''}${touch.down ? 'd' : ''}${touch.left ? 'l' : ''}${touch.right ? 'r' : ''}`);
  };
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    active = e.pointerId;
    el.setPointerCapture(e.pointerId);
    set(e);
  });
  el.addEventListener('pointermove', (e) => e.pointerId === active && set(e));
  const end = (e: PointerEvent) => {
    if (e.pointerId !== active) return;
    active = null;
    set(null);
    show('');
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}

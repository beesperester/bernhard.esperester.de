// DOM overlay: status line, key help, and Game Boy style touch controls.

export type Button = 'jump' | 'hiss' | 'roll' | 'dash';

export interface Controls {
  up: boolean; down: boolean; left: boolean; right: boolean;
  /** Buttons pressed since the last frame. */
  pressed: Set<Button>;
}

export const touch: Controls = { up: false, down: false, left: false, right: false, pressed: new Set() };

const isTouch = () => matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

export function setupUI(): { setStatus: (s: string) => void; hideHelp: () => void } {
  const status = document.getElementById('status')!;
  const help = document.getElementById('help')!;
  const pad = document.getElementById('touch')!;
  document.getElementById('credit')!.textContent = `© ${__BUILD_YEAR__} Bernhard Esperester · build ${__BUILD__}`;

  let helpTimer = 0;
  const hideHelp = () => {
    if (helpTimer) return;
    helpTimer = window.setTimeout(() => help.classList.add('hidden'), 6000);
  };

  if (isTouch()) {
    pad.hidden = false;
    help.textContent = 'D-pad to move · A jump · B dash · hiss & roll to talk';
    setupDpad(document.getElementById('dpad')!);
    for (const btn of pad.querySelectorAll<HTMLElement>('[data-btn]')) {
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        touch.pressed.add(btn.dataset.btn as Button);
        btn.classList.add('down');
      });
      const up = () => btn.classList.remove('down');
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('pointerleave', up);
    }
  }

  return { setStatus: (s) => (status.textContent = s), hideHelp };
}

function setupDpad(el: HTMLElement): void {
  let active: number | null = null;
  const set = (e: PointerEvent | null) => {
    touch.up = touch.down = touch.left = touch.right = false;
    if (!e) return;
    const r = el.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    const dead = r.width * 0.12;
    if (Math.hypot(dx, dy) < dead) return;
    // 8-way: allow diagonals within a 30° band around 45°
    const a = Math.atan2(dy, dx);
    const oct = Math.round(a / (Math.PI / 4));
    touch.right = oct === 0 || oct === 1 || oct === -1;
    touch.left = Math.abs(oct) === 4 || oct === 3 || oct === -3;
    touch.down = oct === 1 || oct === 2 || oct === 3;
    touch.up = oct === -1 || oct === -2 || oct === -3;
    el.dataset.dir = `${touch.up ? 'u' : ''}${touch.down ? 'd' : ''}${touch.left ? 'l' : ''}${touch.right ? 'r' : ''}`;
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
    el.dataset.dir = '';
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}

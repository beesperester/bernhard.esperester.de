// Full screen, on the button or F. Most browsers can take a page full screen;
// Safari on the iPhone can't (only videos), so there the button explains how to
// put the garden on the home screen, which opens it full screen
// (public/manifest.webmanifest).

type Doc = Document & { webkitFullscreenElement?: Element | null; webkitFullscreenEnabled?: boolean; webkitExitFullscreen?: () => Promise<void> };
type El = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };

const doc = document as Doc;
const TIP_MS = 6000;

const supported = () => !!(doc.fullscreenEnabled || doc.webkitFullscreenEnabled);
const active = () => !!(doc.fullscreenElement || doc.webkitFullscreenElement);

export function toggleFullscreen(): void {
  if (!supported()) {
    showTip('For full screen, tap Share and then “Add to Home Screen”.');
    return;
  }
  if (active()) void (doc.exitFullscreen?.() ?? doc.webkitExitFullscreen?.())?.catch(() => {});
  else {
    const el = document.documentElement as El;
    void (el.requestFullscreen?.({ navigationUI: 'hide' }) ?? el.webkitRequestFullscreen?.())?.catch(() => {});
  }
}

/** Wire up the button (and keep its icon in step, also when Esc leaves full screen). */
export function setupFullscreen(button: HTMLElement): void {
  const update = () => {
    button.classList.toggle('on', active());
    button.title = active() ? 'Leave full screen (F)' : 'Full screen (F)';
  };
  document.addEventListener('fullscreenchange', update);
  document.addEventListener('webkitfullscreenchange', update);
  update();
  button.addEventListener('pointerdown', (e) => e.stopPropagation());
  button.addEventListener('click', toggleFullscreen);
}

let tipTimer = 0;
function showTip(text: string): void {
  const tip = document.getElementById('tip');
  if (!tip) return;
  tip.textContent = text;
  tip.hidden = false;
  tip.classList.remove('fading');
  clearTimeout(tipTimer);
  tipTimer = window.setTimeout(() => {
    tip.classList.add('fading');
    tipTimer = window.setTimeout(() => (tip.hidden = true), 400);
  }, TIP_MS);
}

// The loading bar on the green screen before the garden shows (index.html).
// The page is busy building the garden in one go, so the bar is moved with a
// CSS transition on its scale, which the browser keeps animating meanwhile:
// each step says how far to creep, and how long that may take.

const el = () => document.getElementById('loading');

/** Head for `progress` (0..1) over `ms`, saying what is going on. */
export function loading(progress: number, ms = 400, text?: string): void {
  const root = el();
  const fill = root?.querySelector<HTMLElement>('.bar i');
  if (!root || !fill) return;
  fill.style.transition = `transform ${ms}ms steps(${Math.max(2, Math.round(ms / 60))})`;
  fill.style.transform = `scaleX(${Math.max(0.02, Math.min(1, progress))})`;
  root.setAttribute('aria-valuenow', String(Math.round(progress * 100)));
  if (text) root.querySelector('p')!.textContent = text;
}

/** All there: fill up and get out of the way. */
export function loaded(): void {
  const root = el();
  if (!root) return;
  loading(1, 150);
  setTimeout(() => {
    root.classList.add('done');
    setTimeout(() => root.remove(), 400);
  }, 150);
}

// The tab icon shows how many cats are in your garden right now (you included),
// as a badge on the cat face, so you can see visitors arrive from another tab.

const SIZE = 64;
let base: HTMLImageElement | null = null;
let count = 0;

const iconLink = () => document.querySelector<HTMLLinkElement>('link[rel="icon"]')!;

export function setCatCount(n: number): void {
  if (n === count) return;
  count = n;
  if (!base) {
    // the static cat icon from index.html, drawn under the badge
    base = new Image();
    base.onload = () => draw();
    base.src = iconLink().href;
  } else if (base.complete) draw();
}

function draw(): void {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.drawImage(base!, 0, 0, SIZE, SIZE);
  const label = count > 99 ? '99+' : String(count);
  const r = label.length > 1 ? 21 : 18;
  const cx = SIZE - r - 1, cy = SIZE - r - 1;
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fillStyle = '#e03030';
  g.fill();
  g.lineWidth = 4;
  g.strokeStyle = '#ffffff';
  g.stroke();
  g.fillStyle = '#ffffff';
  g.font = `bold ${label.length > 2 ? 17 : label.length > 1 ? 24 : 28}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(label, cx, cy + 2);
  const link = iconLink();
  link.type = 'image/png';
  link.href = c.toDataURL('image/png');
}

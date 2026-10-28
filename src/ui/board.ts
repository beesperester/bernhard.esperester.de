// The scoreboard in the corner, and the dialog for naming your cat.
import { NAME_AT, NAME_MAX, type Row } from '../game/Board.ts';
import { WOODS, buildPlank, rasterURL } from '../art/plank.ts';
import { CAT, buildCatSheet, frameIndex } from '../art/cat.ts';
import { Raster } from '../art/raster.ts';

const SHOWN = 8;

/** Each cat's face (head of its front-facing frame), by coat. */
const faces = new Map<number, string>();
function face(coat: number): string {
  let url = faces.get(coat);
  if (!url) {
    const sheet = buildCatSheet(coat), head = new Raster(CAT, 11), f = frameIndex('downStand');
    for (let y = 0; y < head.h; y++)
      for (let x = 0; x < CAT; x++) {
        const i = ((y + 1) * sheet.w + f * CAT + x) * 4;
        if (sheet.data[i + 3]) head.set(x, y, [sheet.data[i], sheet.data[i + 1], sheet.data[i + 2]]);
      }
    faces.set(coat, (url = rasterURL(head)));
  }
  return url;
}

/** Every name is painted on a wooden plank: a few oak ones to vary, golden pine for you. */
let planks: { oak: string[]; pine: string; walnut: string } | null = null;
function plankArt() {
  if (!planks) {
    planks = {
      oak: [11, 12, 13, 14].map((seed) => `url(${rasterURL(buildPlank(WOODS.oak, seed))})`),
      pine: `url(${rasterURL(buildPlank(WOODS.pine, 21))})`,
      walnut: `url(${rasterURL(buildPlank(WOODS.walnut, 31))})`,
    };
    document.querySelector<HTMLElement>('#board .title')!.style.borderImageSource = planks.walnut;
  }
  return planks;
}

export function renderBoard(rows: Row[], myId: string): void {
  const list = document.querySelector<HTMLOListElement>('#board ol')!;
  const art = plankArt();
  const top = rows.filter((r) => r.score > 0 || r.id === myId).slice(0, SHOWN);
  const me = rows.find((r) => r.id === myId);
  if (me && !top.includes(me)) top.push(me);
  // names come from other visitors: only ever set as text
  list.replaceChildren(...top.map((r) => {
    const li = document.createElement('li');
    li.className = r.id === myId ? 'me' : r.here ? '' : 'away';
    const rank = rows.indexOf(r);
    li.style.borderImageSource = r.id === myId ? art.pine : art.oak[rank % art.oak.length];
    const place = document.createElement('span');
    place.className = 'rank';
    place.textContent = String(rank + 1);
    const pic = document.createElement('img');
    pic.className = 'face';
    pic.alt = '';
    pic.src = face(r.coat);
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = r.name;
    const n = document.createElement('span');
    n.className = 'n';
    n.textContent = String(r.score);
    li.append(place, pic, name, n);
    if (!r.here) li.title = 'left the garden';
    return li;
  }));
}

/**
 * Ask for a name of the player's own. `free` says whether a name is still
 * available in the garden; `done` gets the new name, or null to keep the old one.
 */
export function askName(current: string, free: (name: string) => boolean, done: (name: string | null) => void): void {
  const dialog = document.getElementById('name-dialog')!;
  const form = dialog.querySelector('form')!;
  const input = form.querySelector('input')!;
  const error = form.querySelector<HTMLElement>('.error')!;
  const keep = form.querySelector<HTMLButtonElement>('.keep')!;
  form.querySelector<HTMLElement>('.count')!.textContent = String(NAME_AT);
  keep.textContent = `Keep “${current}”`;
  input.maxLength = NAME_MAX;
  input.value = current;
  error.textContent = '';
  dialog.hidden = false;
  input.focus();
  input.select();

  const close = (name: string | null) => {
    dialog.hidden = true;
    form.onsubmit = null;
    keep.onclick = null;
    done(name);
  };
  form.onsubmit = (e) => {
    e.preventDefault();
    const name = input.value.replace(/\s+/g, ' ').trim();
    if (name.length < 2) error.textContent = 'At least two letters, please.';
    else if (!/^[\p{L}\p{N} .'-]+$/u.test(name)) error.textContent = 'Letters, numbers, spaces and . \' - only.';
    else if (!free(name)) error.textContent = 'Another cat here already has that name.';
    else close(name);
  };
  keep.onclick = () => close(null);
}

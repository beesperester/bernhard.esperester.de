// The scoreboard in the corner, and the dialog for naming your cat.
import { NAME_AT, NAME_MAX, type Entry } from '../game/Board.ts';

const SHOWN = 8;

export function renderBoard(rows: (Entry & { here: boolean })[], myId: string): void {
  const list = document.querySelector<HTMLOListElement>('#board ol')!;
  const top = rows.filter((r) => r.score > 0 || r.id === myId).slice(0, SHOWN);
  const me = rows.find((r) => r.id === myId);
  if (me && !top.includes(me)) top.push(me);
  // names come from other visitors: only ever set as text
  list.replaceChildren(...top.map((r) => {
    const li = document.createElement('li');
    li.className = r.id === myId ? 'me' : r.here ? '' : 'away';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = `${rows.indexOf(r) + 1}. ${r.name}`;
    const n = document.createElement('span');
    n.className = 'n';
    n.textContent = String(r.score);
    li.append(name, n);
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

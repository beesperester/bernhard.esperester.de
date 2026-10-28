// One cat, one tab: two tabs of the same browser are the same cat, and both
// writing its chain of catches would tangle it (each adds its own block n, and
// the one read back next time stops where they differ). So only one tab at a
// time has the cat. Opening another asks first; playing there sends the cat
// over, and the tab it left stops (and offers to have it back).

const LOCK = 'cat-garden-cat';

function ask(text: string): Promise<void> {
  const dialog = document.getElementById('tab-dialog')!;
  const form = dialog.querySelector('form')!;
  dialog.querySelector('.say')!.textContent = text;
  dialog.hidden = false;
  return new Promise((resolve) => {
    form.onsubmit = (e) => {
      e.preventDefault();
      dialog.hidden = true;
      form.onsubmit = null;
      resolve();
    };
  });
}

/** Hold on to the cat for as long as the page is open; if another tab takes it over, stop here. */
function hold(steal: boolean): Promise<boolean> {
  return new Promise((got) => {
    navigator.locks
      .request(LOCK, steal ? { steal: true } : { ifAvailable: true }, (lock) => {
        got(!!lock);
        // (held until the page goes, or another tab takes it)
        return lock ? new Promise<void>(() => {}) : undefined;
      })
      // taken over by another tab: everything stops here (a fresh start asks to have it back)
      .catch(() => location.reload());
  });
}

/** Wait until this tab has the cat. */
export async function oneTab(): Promise<void> {
  // (no locks in this browser: nothing to be done)
  if (!navigator.locks) return;
  if (await hold(false)) return;
  await ask('Your cat is already in the garden, in another tab.');
  await hold(true);
}

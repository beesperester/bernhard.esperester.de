// The collar tag on the help sign: copy ours, or put on another cat's (net/collar.ts).
import { makeTag, readTag } from '../net/collar.ts';
import { Identity, identity } from '../net/identity.ts';
import { replaceChain, theChain } from '../net/chainStore.ts';
import { saveName } from '../game/Board.ts';

/** `who` says what our cat is called and looks like right now. */
export function setupCollar(who: () => { name: string; custom: boolean; coat: number }): void {
  const box = document.querySelector<HTMLElement>('#help-dialog .collar')!;
  const note = box.querySelector<HTMLElement>('.note')!;
  const wear = box.querySelector<HTMLElement>('.wear')!;
  const field = wear.querySelector('textarea')!;
  const say = (text: string) => (note.textContent = text);

  box.querySelector('.copy-tag')!.addEventListener('click', async () => {
    try {
      const code = await makeTag(identity(), theChain(), who());
      await navigator.clipboard.writeText(code);
      say(`Copied (${Math.ceil(code.length / 1024)} kB). Paste it into “Wear a collar tag” in the other browser.`);
    } catch {
      say("Couldn't copy the tag here, sorry.");
    }
  });
  box.querySelector('.wear-tag')!.addEventListener('click', () => {
    wear.hidden = !wear.hidden;
    say('');
    if (!wear.hidden) field.focus();
  });
  let sure = '';
  box.querySelector('.put-on')!.addEventListener('click', async () => {
    const code = field.value.trim();
    const worn = await readTag(code);
    if (!worn) return say("That isn't a collar tag (or not all of it).");
    if (worn.me.id === identity().id) return say("That's your cat's own tag.");
    // the cat living here now goes: ask once
    const ours = theChain().score;
    if (ours > 0 && sure !== code) {
      sure = code;
      return say(`${worn.name} (${worn.score}) takes the place of your cat here (${ours}), for good unless you have its tag. Press again to go ahead.`);
    }
    if (!(await Identity.adopt(await worn.me.secret(), true)) || !(await replaceChain(worn.blocks, worn.checks)))
      return say("Couldn't put it on here, sorry.");
    saveName(worn);
    try {
      localStorage.setItem('cat-coat', String(worn.coat));
      // (a cat with a name of its own isn't asked for one again)
      if (worn.custom) localStorage.setItem(`named-${worn.me.id}`, '1');
    } catch { /* storage unavailable */ }
    say(`Welcome back, ${worn.name}!`);
    setTimeout(() => location.reload(), 800);
  });
}

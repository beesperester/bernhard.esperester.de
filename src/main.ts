import Phaser from 'phaser';
import { Music } from './audio/music.ts';
import { sound } from './audio/sound.ts';
import { applyPixelUI } from './ui/pixel.ts';
import { setupFullscreen } from './ui/fullscreen.ts';
import { loading } from './ui/loading.ts';
import { oneTab } from './ui/oneTab.ts';
import { Identity, useIdentity, verify } from './net/identity.ts';
import { Chain } from './net/ledger.ts';
import { idbChainStore, useChain } from './net/chainStore.ts';
import { latestBeacon } from './net/beacon.ts';
import { startStamping } from './net/stamping.ts';
import { Net, useNet } from './net/net.ts';
import { plant } from './world/seed.ts';
import '@fontsource/pixelify-sans/latin-400.css';
import '@fontsource/pixelify-sans/latin-ext-400.css';
import '@fontsource/pixelify-sans/latin-700.css';
import '@fontsource/pixelify-sans/latin-ext-700.css';

applyPixelUI();
// (one tab at a time has the cat: oneTab.ts)
await oneTab();
loading(0.15, 600);
// which garden is this? the cats already here know its seed (with none here, it's a new one): start asking at once
const net = new Net();
useNet(net);
net.start();
// who we are: this browser's key pair (made on the first visit), and what our cat has eaten
const me = await Identity.load();
useIdentity(me);
const chain = new Chain(me.id, (l) => me.sign(l), idbChainStore, latestBeacon);
await chain.load(verify);
useChain(chain);
startStamping(chain);
// text drawn into the game (names, scores) needs the font ready; don't wait forever for it
await Promise.race([
  Promise.all([document.fonts.load('16px "Pixelify Sans"'), document.fonts.load('bold 16px "Pixelify Sans"')]),
  new Promise((r) => setTimeout(r, 2000)),
]).catch(() => {});

loading(0.2, 200, 'looking for other cats…');
plant(await net.seed((p) => loading(0.2 + 0.3 * p, 120, 'looking for other cats…')));

// laying out and building the garden takes a moment and keeps the page busy: let the bar creep along meanwhile
loading(0.6, 3000, 'growing the garden…');
// (after the bar is on screen; a tab opened in the background draws nothing, so don't wait for that)
await new Promise((r) => {
  requestAnimationFrame(() => requestAnimationFrame(r));
  setTimeout(r, 100);
});
// (only now: everything that asks about the map needs the seed)
const { GardenScene } = await import('./game/GardenScene.ts');
const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#2e6e24',
  pixelArt: true,
  roundPixels: true,
  scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
  input: { keyboard: { capture: [32, 37, 38, 39, 40] } },
  scene: [GardenScene],
});

// music and sounds start on the first key press or tap (browsers require a gesture);
// the note button mutes the music, the speaker button the sounds
const music = new Music();
const musicBtn = document.getElementById('music')!;
const soundBtn = document.getElementById('sound')!;
music.onChange((muted, track) => {
  musicBtn.classList.toggle('muted', muted);
  musicBtn.title = muted ? 'Music off' : `♪ ${track?.title ?? 'Music'}`;
});
sound.onChange((muted) => {
  soundBtn.classList.toggle('muted', muted);
  soundBtn.title = muted ? 'Sounds off' : 'Sounds on';
});
const unlock = () => {
  music.unlock();
  sound.unlock();
};
window.addEventListener('keydown', (e) => {
  // typing a name is not playing
  if (!(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) unlock();
});
// (Safari doesn't count a pointerdown as a gesture that may start sound: the
// end of a click or tap it does; unlocking twice does no harm)
for (const type of ['pointerdown', 'pointerup', 'touchend', 'click']) window.addEventListener(type, unlock);
for (const [btn, target] of [[musicBtn, music], [soundBtn, sound]] as const) {
  btn.addEventListener('pointerdown', (e) => e.stopPropagation());
  btn.addEventListener('click', () => {
    target.toggle();
    (target === music ? sound : music).unlock();
  });
}

setupFullscreen(document.getElementById('fullscreen')!);

// handy for poking at the game from the console during development
if (import.meta.env.DEV) Object.assign(window, { game, music, sound });

import Phaser from 'phaser';
import { GardenScene } from './game/GardenScene.ts';
import { Music } from './audio/music.ts';
import { sound } from './audio/sound.ts';
import { applyPixelUI } from './ui/pixel.ts';
import { setupFullscreen } from './ui/fullscreen.ts';
import { loading } from './ui/loading.ts';
import '@fontsource/pixelify-sans/latin-400.css';
import '@fontsource/pixelify-sans/latin-ext-400.css';
import '@fontsource/pixelify-sans/latin-700.css';
import '@fontsource/pixelify-sans/latin-ext-700.css';

applyPixelUI();
loading(0.15, 600);
// text drawn into the game (names, scores) needs the font ready; don't wait forever for it
await Promise.race([
  Promise.all([document.fonts.load('16px "Pixelify Sans"'), document.fonts.load('bold 16px "Pixelify Sans"')]),
  new Promise((r) => setTimeout(r, 2000)),
]).catch(() => {});

// building the garden takes a moment and keeps the page busy: let the bar creep along meanwhile
loading(0.6, 3000);
// (after the bar is on screen; a tab opened in the background draws nothing, so don't wait for that)
await new Promise((r) => {
  requestAnimationFrame(() => requestAnimationFrame(r));
  setTimeout(r, 100);
});
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
  if (!(e.target instanceof HTMLInputElement)) unlock();
});
window.addEventListener('pointerdown', unlock);
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

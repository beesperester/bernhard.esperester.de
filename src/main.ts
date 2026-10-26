import Phaser from 'phaser';
import { GardenScene } from './game/GardenScene.ts';
import { Music } from './audio/music.ts';

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

// background music: starts on the first key press or tap, M (or the note button) mutes
const music = new Music();
const button = document.getElementById('music')!;
music.onChange((muted, track) => {
  button.classList.toggle('muted', muted);
  button.title = muted ? 'Music off (M)' : `♪ ${track?.title ?? 'Music'} (M to mute)`;
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'm' || e.key === 'M') { if (!e.repeat) music.toggle(); }
  else music.unlock();
});
window.addEventListener('pointerdown', () => music.unlock());
button.addEventListener('pointerdown', (e) => e.stopPropagation());
button.addEventListener('click', () => music.toggle());

// handy for poking at the game from the console during development
if (import.meta.env.DEV) Object.assign(window, { game, music });

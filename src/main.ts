import Phaser from 'phaser';
import { GardenScene } from './game/GardenScene.ts';
import { Music } from './audio/music.ts';
import { sound } from './audio/sound.ts';

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
// M / the note button mutes the music, S / the speaker button the sounds
const music = new Music();
const musicBtn = document.getElementById('music')!;
const soundBtn = document.getElementById('sound')!;
music.onChange((muted, track) => {
  musicBtn.classList.toggle('muted', muted);
  musicBtn.title = muted ? 'Music off (M)' : `♪ ${track?.title ?? 'Music'} (M to mute)`;
});
sound.onChange((muted) => {
  soundBtn.classList.toggle('muted', muted);
  soundBtn.title = muted ? 'Sounds off (S)' : 'Sounds on (S to mute)';
});
const unlock = () => {
  music.unlock();
  sound.unlock();
};
window.addEventListener('keydown', (e) => {
  // typing a name is not playing
  if (e.target instanceof HTMLInputElement) return;
  const k = e.key.toLowerCase();
  if (k === 'm' || k === 's') {
    if (!e.repeat) (k === 'm' ? music : sound).toggle();
    if (k === 'm') sound.unlock();
    else music.unlock();
  } else unlock();
});
window.addEventListener('pointerdown', unlock);
for (const [btn, target] of [[musicBtn, music], [soundBtn, sound]] as const) {
  btn.addEventListener('pointerdown', (e) => e.stopPropagation());
  btn.addEventListener('click', () => {
    target.toggle();
    (target === music ? sound : music).unlock();
  });
}

// handy for poking at the game from the console during development
if (import.meta.env.DEV) Object.assign(window, { game, music, sound });

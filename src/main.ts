import Phaser from 'phaser';
import { GardenScene } from './game/GardenScene.ts';

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#2e6e24',
  pixelArt: true,
  roundPixels: true,
  scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
  input: { keyboard: { capture: [32, 37, 38, 39, 40] } },
  scene: [GardenScene],
});

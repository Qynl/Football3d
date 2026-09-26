import './ui/styles.css';
import { Game } from './game/game.ts';

const container = document.getElementById('app')!;
const game = new Game(container);
game.start();

// Hide the loader once the first frame has rendered.
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    document.getElementById('loading')?.classList.add('hidden');
    window.setTimeout(() => document.getElementById('loading')?.remove(), 500);
  });
});

// Kick the audio engine alive on the first gesture anywhere.
const wake = () => {
  game.audio.init();
  if (!game.audio.ready) return;
  game.audio.setVolumes(
    game.storage.data.settings.masterVolume,
    game.storage.data.settings.sfxVolume,
    game.storage.data.settings.musicVolume,
  );
  game.audio.startMusic('menu');
  window.removeEventListener('pointerdown', wake);
  window.removeEventListener('keydown', wake);
};
window.addEventListener('pointerdown', wake);
window.addEventListener('keydown', wake);

// Expose for debugging in the console.
(window as unknown as { KICKOFF: Game }).KICKOFF = game;

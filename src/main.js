import '@fontsource/cormorant-garamond/300.css';
import '@fontsource/cormorant-garamond/300-italic.css';
import '@fontsource/cormorant-garamond/400.css';
import '@fontsource/jost/300.css';
import '@fontsource/jost/400.css';
import '@fontsource/noto-sans-thai/thai-300.css';
import '@fontsource/noto-sans-thai/thai-400.css';
import '@fontsource/noto-serif-thai/thai-300.css';
import '@fontsource/noto-serif-thai/thai-400.css';
import './styles/ui.css';
import { Game } from './game/game.js';
import { t } from './core/i18n.js';

const bootEl = document.getElementById('boot');
const bootText = document.getElementById('boot-text');

async function start() {
  // wait for the UI fonts so the first frame never shows fallback type
  try { await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 2500))]); } catch { /* ignore */ }
  const game = new Game();
  window.__game = game; // handy for debugging in the console
  bootText.textContent = t('Loading');
  try {
    await game.boot((label) => { bootText.textContent = label; });
  } catch (err) {
    console.error(err);
    bootText.textContent = 'This browser could not start the game (WebGL is required).';
    return;
  }
  bootEl.classList.add('is-done');
  setTimeout(() => bootEl.remove(), 1400);
  // dev shortcut: ?play=<chapter> jumps straight into gameplay (no save slot is touched)
  const play = new URLSearchParams(location.search).get('play');
  if (import.meta.env.DEV && play != null) {
    game.ui.reset(null);
    game.state = 'loading';
    game.prepareChapter(Number(play) || 0);
    await game.enterPlay(false);
    return;
  }
  await game.ui.fade(0, 1800);
}
start();

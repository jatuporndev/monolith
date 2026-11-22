import { t } from '../../core/i18n.js';
import { h, Screen, hints } from '../core.js';
import { CREDITS } from '../../game/chapters.js';

/** Atmospheric loading: chapter art, a lore fragment, a hairline progress bar. */
export class LoadingScreen extends Screen {
  constructor(ui) {
    super(ui, 'loading');
    this.art = h('div.art');
    this.chap = h('div.chap'); this.name = h('div.name'); this.lore = h('div.lore');
    this.bar = h('i');
    this.statusText = h('span', t('Loading'));
    this.status = h('div.status', h('span.ring'), this.statusText);
    this.el.append(this.art, h('div.shade'), h('div.content', this.chap, this.name, this.lore), this.status, h('div.bar', this.bar));
  }
  enter({ chapter, art }) {
    this.art.style.backgroundImage = art ? `url(${art})` : '';
    this.chap.textContent = t('Chapter {n}', { n: chapter.numeral });
    this.name.textContent = chapter.title;
    this.lore.textContent = t(chapter.lore);
    this.setProgress(0);
    this.status.classList.remove('is-ready'); this.statusText.textContent = t('Loading');
    this.ready = null;
    super.enter();
  }
  setProgress(k) { this.bar.style.width = Math.round(k * 100) + '%'; }
  /** Resolves when the player presses a key (or after a while). */
  waitForPlayer() {
    this.status.classList.add('is-ready');
    this.statusText.textContent = t(this.ui.device === 'pad' ? 'Press A to continue' : 'Press any key to continue');
    return new Promise((res) => { this.ready = res; this.autoT = setTimeout(() => this.finish(), 12000); this.el.onclick = () => this.finish(); });
  }
  finish() { if (!this.ready) return; clearTimeout(this.autoT); const r = this.ready; this.ready = null; this.ui.sfx('uiConfirm'); r(); }
  onInput(e) { if (this.ready && (e.type === 'any' || e.type === 'confirm' || e.type === 'start')) this.finish(); }
}

export class CreditsScreen extends Screen {
  constructor(ui) {
    super(ui, 'credits');
    this.art = h('div.art');
    this.roll = h('div.roll', ...CREDITS.map((b) => h(`div.block${b.title ? '.title' : ''}${b.end ? '.end' : ''}`,
      b.role ? h('div.role', t(b.role)) : null, ...b.names.map((n) => h('div.who', t(n))))));
    this.el.append(this.art, this.roll, h('div.credits-foot', hints(ui, [['confirm', t('Faster')], ['back', t('Skip'), () => this.back()]])));
  }
  enter({ art, onDone } = {}) {
    this.onDone = onDone;
    this.art.style.backgroundImage = art ? `url(${art})` : '';
    this.y = 0; this.fast = false; this.done = false;
    super.enter();
    this.last = performance.now();
    cancelAnimationFrame(this.raf);
    const tick = (now) => {
      const dt = Math.min(0.25, (now - this.last) / 1000); this.last = now;
      this.y += dt * (this.fast ? 160 : 34);
      this.roll.style.transform = `translateY(${-this.y}px)`;
      const total = this.roll.offsetHeight + innerHeight * 0.5;
      if (this.y > total) { this.finish(); return; }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }
  onInput(e) {
    if (e.type === 'confirm') { this.fast = !this.fast; return; }
    if (e.type === 'back' || e.type === 'start') this.back();
  }
  exit() { cancelAnimationFrame(this.raf); super.exit(); }
  finish() { if (this.done) return; this.done = true; cancelAnimationFrame(this.raf); this.onDone?.(); }
  back() { this.ui.sfx('uiBack'); this.finish(); }
}

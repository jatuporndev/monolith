import { t } from '../core/i18n.js';
import { h, glyph } from './core.js';

const CIRC = 2 * Math.PI * 20;

/**
 * Gameplay HUD. Almost always empty: a contextual prompt, a thin stamina ring
 * while gripping, subtitles and quiet save notices. No health — ever.
 */
export class Hud {
  constructor(ui) {
    this.ui = ui;
    this.el = document.getElementById('hud');
    this.promptEl = h('div.prompt');
    this.climbEl = h('div.climb-hud', { html: `<svg viewBox="0 0 46 46"><circle class="bg" cx="23" cy="23" r="20"/><circle class="fg" cx="23" cy="23" r="20" stroke-dasharray="${CIRC}" stroke-dashoffset="0"/><circle class="grip" cx="23" cy="23" r="2"/></svg>` });
    this.ringFg = this.climbEl.querySelector('.fg');
    this.chapterEl = h('div.chapter-card-hud', h('div.n'), h('div.t'), h('div.r'));
    this.lockEl = h('div.lock-hint', t('Click to look around'));
    this.el.append(this.promptEl, this.climbEl, this.chapterEl, this.lockEl);
    this.toasts = document.getElementById('toasts');
    this.subs = document.getElementById('subtitles');
    this.subQueue = []; this.subTimer = null; this.curPrompt = null;
    this.stamina = 1;
    ui.onDevice(() => { const p = this.curPrompt; this.curPrompt = null; this.setPrompt(p); });
    const applySubs = () => {
      const s = ui.game.settings;
      this.subs.dataset.size = s.get('subtitleSize');
      this.subs.dataset.bg = s.get('subtitleBackground');
      this.subs.style.display = s.get('subtitles') ? '' : 'none';
    };
    applySubs();
    ui.game.bus.on('settings:changed', ({ key }) => {
      if (/^subtitle|speakerNames/.test(key)) applySubs();
      if (key === 'bindings') { const p = this.curPrompt; this.curPrompt = null; this.setPrompt(p); }
    });
  }

  show(on) { this.el.classList.toggle('is-hidden', !on); if (!on) this.setPrompt(null); }

  setPrompt(p) {
    const key = p ? p.action + '|' + p.label : null;
    if (key === (this.curPrompt ? this.curPrompt.action + '|' + this.curPrompt.label : null)) return;
    this.curPrompt = p;
    if (!p) { this.promptEl.classList.remove('is-on'); return; }
    this.promptEl.replaceChildren(glyph(this.ui, p.action), h('span', t(p.label)));
    this.promptEl.classList.toggle('hold', !!p.hold);
    // restart the fade-in for a new prompt
    this.promptEl.classList.remove('is-on'); void this.promptEl.offsetWidth; this.promptEl.classList.add('is-on');
  }

  setLockHint(on) { if (this.lockOn !== on) { this.lockOn = on; this.lockEl.classList.toggle('is-on', on); } }

  /** Shown while gripping and, after letting go, until stamina is full again — then a brief "ready" glow and fade. */
  setClimb({ visible, stamina, gripping, shaking }) {
    if (visible) { clearTimeout(this.readyT); this.readyT = null; this.climbEl.classList.remove('is-ready'); }
    else if (this.climbEl.classList.contains('is-on') && !this.readyT) {
      this.stamina = 1; this.ringFg.setAttribute('stroke-dashoffset', '0');
      this.climbEl.classList.add('is-ready');
      this.readyT = setTimeout(() => { this.climbEl.classList.remove('is-on', 'is-ready', 'is-recovering'); this.readyT = null; }, 650);
    }
    if (!visible) return;
    this.climbEl.classList.add('is-on');
    this.climbEl.classList.toggle('is-recovering', !gripping);
    this.stamina += (stamina - this.stamina) * 0.25;
    this.ringFg.setAttribute('stroke-dashoffset', String(CIRC * (1 - this.stamina)));
    this.climbEl.classList.toggle('is-low', stamina < 0.25);
    this.climbEl.classList.toggle('is-gripping', gripping);
    this.climbEl.classList.toggle('is-shaking', shaking);
  }

  chapterCard(numeral, title) {
    const [n, ttl] = this.chapterEl.children;
    n.textContent = t('Chapter {n}', { n: numeral }); ttl.textContent = title;
    this.chapterEl.classList.add('is-on');
    clearTimeout(this.cardT);
    this.cardT = setTimeout(() => this.chapterEl.classList.remove('is-on'), 4800);
  }
  hideChapterCard() { clearTimeout(this.cardT); this.chapterEl.classList.remove('is-on'); }

  /** Subtle notification. Returns { done(text) } for spinner toasts. */
  toast(text, { spinner = false, duration = 2600 } = {}) {
    const ring = h('span.ring');
    const label = h('span', text);
    const el = h('div.toast', spinner ? ring : null, label);
    this.toasts.append(el);
    requestAnimationFrame(() => el.classList.add('is-on'));
    const remove = (delay) => setTimeout(() => { el.classList.remove('is-on'); setTimeout(() => el.remove(), 600); }, delay);
    if (!spinner) remove(duration);
    return { done: (msg) => { if (msg) label.textContent = msg; el.classList.add('is-done'); remove(1600); } };
  }

  /** Queue subtitle lines: [{speaker, text}] */
  say(lines, { interrupt = false } = {}) {
    if (interrupt) this.clearSubs();
    this.subQueue.push(...lines);
    if (!this.subTimer) this.nextSub();
  }
  nextSub() {
    const line = this.subQueue.shift();
    if (!line) { this.subTimer = null; return; }
    const showName = this.ui.game.settings.get('speakerNames') && line.speaker;
    const text = t(line.text);
    const el = h(`div.sub-line${line.speaker ? '' : '.examine'}`, showName ? h('span.who', line.speaker) : null, text);
    if (line.speaker) this.ui.sfx('whisper');
    this.subs.replaceChildren(el);
    requestAnimationFrame(() => el.classList.add('is-on'));
    const dur = 2400 + text.length * 55;
    this.subTimer = setTimeout(() => {
      el.classList.remove('is-on');
      this.subTimer = setTimeout(() => this.nextSub(), 450);
    }, dur);
  }
  clearSubs() { clearTimeout(this.subTimer); this.subTimer = null; this.subQueue = []; this.subs.replaceChildren(); }
  /** Re-translate the few static HUD strings after a language change. */
  relocalize() { this.lockEl.textContent = t('Click to look around'); this.curPrompt = undefined; }
}

import { t, locale } from '../../core/i18n.js';
import { h, Screen, FocusNav, hints } from '../core.js';
import { CHAPTERS } from '../../game/chapters.js';
import { SLOT_COUNT } from '../../core/save.js';
import { formatPlaytime, formatDate } from '../../core/util.js';

export class ChaptersScreen extends Screen {
  constructor(ui) {
    super(ui, 'panel-screen');
    this.backdrop = h('div.chapter-backdrop');
    this.grid = h('div.chapters');
    this.desc = h('div.desc');
    this.progress = h('span.eyebrow');
    this.el.append(
      this.backdrop, h('div.scrim-full', { style: { background: 'rgba(8,7,6,0.5)' } }),
      h('div.panel-head', { style: { position: 'relative' } }, h('h2', t('Chapters')), this.progress),
      h('div.panel-body', { style: { position: 'relative' } }, this.grid),
      h('div.panel-foot', { style: { position: 'relative' } }, this.desc, hints(ui, [['confirm', t('Play'), () => this.nav.activate()], ['back', t('Back'), () => this.back()]])),
    );
    this.nav = new FocusNav(this.grid, { ui, cols: 3, onFocus: (el) => this.onFocus(el) });
  }
  enter() {
    const g = this.game, prof = g.saves.profile;
    const latest = g.saves.latest();
    const current = latest ? latest.chapter : 0;
    const done = prof.completed.length;
    this.progress.textContent = t('{done} of {total} complete', { done, total: CHAPTERS.length });
    this.grid.replaceChildren(...CHAPTERS.map((c) => {
      const unlocked = prof.unlocked.includes(c.id);
      const completed = prof.completed.includes(c.id);
      const state = t(completed ? 'Completed' : c.id === current && latest ? 'Current' : unlocked ? 'Unlocked' : 'Locked');
      const pct = completed ? 100 : c.id === current && latest ? 35 : 0;
      const card = h(`button.chapter-card${unlocked ? '' : '.is-locked'}`, { type: 'button', 'data-focus': true, tabindex: -1 },
        h('div.art', { style: { backgroundImage: g.chapterArt[c.id] ? `url(${g.chapterArt[c.id]})` : '' } }, h('span.state', state)),
        h('div.meta',
          h('div.num', h('span', t('Chapter {n}', { n: c.numeral })), h('span', completed ? '✓' : '')),
          h('div.name', unlocked ? c.title : t('Undiscovered')),
          h('div.progress-line', h('i', { style: { width: pct + '%' } }))));
      card.__chapter = c; card.__unlocked = unlocked;
      card.__desc = unlocked ? t(c.lore) : t('Continue your journey to reveal this chapter.');
      card.__activate = () => {
        if (!unlocked) { this.ui.sfx('uiError'); return; }
        this.ui.sfx('uiConfirm');
        this.game.requestChapter(c.id);
      };
      return card;
    }));
    super.enter();
    const idx = Math.max(0, CHAPTERS.findIndex((c) => c.id === current));
    this.nav.focus(idx, { sound: false });
  }
  onFocus(el) {
    this.desc.textContent = el.__desc;
    const art = el.__unlocked ? this.game.chapterArt[el.__chapter.id] : null;
    this.backdrop.classList.remove('is-on');
    if (art) { this.backdrop.style.backgroundImage = `url(${art})`; requestAnimationFrame(() => this.backdrop.classList.add('is-on')); }
  }
  back() { this.ui.sfx('uiBack'); this.ui.close(); }
}

/** Save slots. mode 'load' → load a slot; mode 'new' → choose a slot for a new game. */
export class LoadScreen extends Screen {
  constructor(ui) {
    super(ui, 'panel-screen');
    this.titleEl = h('h2');
    this.list = h('div.slots');
    this.desc = h('div.desc');
    this.hintBox = h('div');
    this.el.append(
      h('div.scrim-full'),
      h('div.panel-head', { style: { position: 'relative' } }, this.titleEl),
      h('div.panel-body', { style: { position: 'relative' } }, this.list),
      h('div.panel-foot', { style: { position: 'relative' } }, this.desc, this.hintBox),
    );
    this.nav = new FocusNav(this.list, { ui, onFocus: (el) => { this.desc.textContent = el.__desc || ''; } });
  }
  enter({ mode = 'load', chapter = 0 } = {}) {
    this.mode = mode; this.chapter = chapter;
    this.titleEl.textContent = t(mode === 'load' ? 'Load Game' : 'Choose a Slot');
    this.hintBox.replaceChildren(hints(this.ui, [
      ['confirm', t(mode === 'load' ? 'Load' : 'Select'), () => this.nav.activate()],
      mode === 'load' ? ['delete', t('Delete'), () => this.deleteCurrent()] : null,
      ['back', t('Back'), () => this.back()],
    ]));
    this.render();
    super.enter();
    const latest = this.game.saves.latest();
    this.nav.focus(mode === 'load' && latest ? latest.slot : Math.max(0, this.game.saves.firstEmptySlot()), { sound: false });
  }
  render() {
    const g = this.game, saves = g.saves.list();
    this.list.replaceChildren(...Array.from({ length: SLOT_COUNT }, (_, i) => {
      const s = saves[i];
      const c = s ? CHAPTERS[s.chapter] : null;
      const el = h(`button.slot${s ? '' : '.is-empty'}${!s && this.mode === 'load' ? '.is-disabled' : ''}`, { type: 'button', 'data-focus': true, tabindex: -1 },
        h('div.thumb', { style: { backgroundImage: s && g.chapterArt[s.chapter] ? `url(${g.chapterArt[s.chapter]})` : '' } }),
        h('div.info',
          h('div.t0', `${t('Slot {n}', { n: i + 1 })}${s && g.saves.profile.lastSlot === i ? `  ·  ${t('Last played')}` : ''}`),
          h('div.t1', s ? `${t('Chapter {n}', { n: c.numeral })} — ${c.title}` : t('Empty')),
          h('div.t2', s ? t('Last saved {date}', { date: formatDate(s.savedAt, locale()) }) : this.mode === 'new' ? t('Begin a new journey here') : '—')),
        h('div.side', s ? formatPlaytime(s.playtime || 0) : ''));
      el.__slot = i; el.__save = s;
      el.__desc = t(s ? (this.mode === 'load' ? 'Continue from the last shrine you rested at.' : 'This slot will be overwritten.') : (this.mode === 'new' ? 'An empty slot.' : ''));
      el.__activate = () => this.choose(i, s);
      return el;
    }));
  }
  choose(i, s) {
    const g = this.game;
    if (this.mode === 'load') { if (!s) return; this.ui.sfx('uiConfirm'); g.loadSlot(i); return; }
    const begin = () => g.startNew(i, this.chapter);
    if (s) {
      this.ui.open('confirm', { title: t('Overwrite Slot'), text: t('Slot {n} holds a journey in Chapter {c}. Replace it?', { n: i + 1, c: CHAPTERS[s.chapter].numeral }), yes: t('Overwrite'), no: t('Cancel'), onYes: begin });
    } else { this.ui.sfx('uiConfirm'); begin(); }
  }
  deleteCurrent() {
    const el = this.nav.current(); if (!el || !el.__save) return;
    const i = el.__slot;
    this.ui.open('confirm', {
      title: t('Delete Save'), text: t('Delete the journey in Slot {n}? This cannot be undone.', { n: i + 1 }), yes: t('Delete'), no: t('Cancel'),
      onYes: () => {
        this.game.saves.remove(i); this.render();
        // focus another occupied slot if any; otherwise go back
        const first = this.game.saves.list().findIndex(Boolean);
        if (first < 0) this.ui.close(); else this.nav.focus(first, { sound: false });
        this.ui.hud.toast(t('Save deleted'));
      },
    });
  }
  uncover() { super.uncover(); }
  onInput(e) { if (e.type === 'secondary' && this.mode === 'load') { this.deleteCurrent(); return; } super.onInput(e); }
  back() { this.ui.sfx('uiBack'); this.ui.close(); }
}

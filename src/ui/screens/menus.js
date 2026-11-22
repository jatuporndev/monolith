import { t, LANGUAGES } from '../../core/i18n.js';
import { h, Screen, FocusNav, hints } from '../core.js';
import { menuItem } from '../components.js';
import { CHAPTERS } from '../../game/chapters.js';
import { formatPlaytime } from '../../core/util.js';

export class TitleScreen extends Screen {
  constructor(ui) {
    super(ui, 'title-screen');
    this.el.append(
      h('div.scrim-full', { style: { background: 'rgba(8,7,6,0.35)', backdropFilter: 'none' } }),
      h('div', { style: { position: 'relative' } }, h('h1.title', 'MONOLITH'), h('div.subtitle', 'Echoes of the Colossus')),
      h('div.press-any', t('Press any key')),
    );
    this.el.addEventListener('click', () => this.go());
  }
  onInput(e) { if (e.type === 'any' || e.type === 'confirm' || e.type === 'start') this.go(); }
  go() {
    if (this.leaving) return; this.leaving = true;
    this.game.audio.start();
    this.game.audio.setMood('menu');
    this.ui.sfx('uiConfirm');
    this.ui.reset('main');
  }
}

export class MainMenu extends Screen {
  constructor(ui) {
    super(ui, 'main-menu');
    const g = this.game;
    this.items = {
      cont: menuItem(ui, t('Continue'), () => g.continueGame()),
      newg: menuItem(ui, t('New Game'), () => g.requestNewGame()),
      chap: menuItem(ui, t('Chapters'), () => ui.open('chapters')),
      load: menuItem(ui, t('Load Game'), () => ui.open('load', { mode: 'load' })),
      sett: menuItem(ui, t('Settings'), () => ui.open('settings')),
      cred: menuItem(ui, t('Credits'), () => g.showCredits()),
      exit: menuItem(ui, t('Exit Game'), () => ui.open('confirm', {
        title: t('Exit Game'), text: t('Leave the valley? Progress is saved at every shrine.'),
        yes: t('Exit'), no: t('Stay'), onYes: () => g.exitGame(),
      })),
    };
    const list = h('div.menu', Object.values(this.items));
    this.contSub = h('span.sub');
    this.items.cont.append(this.contSub);
    this.el.append(
      h('div.scrim-left'),
      h('div', { style: { position: 'relative' } },
        h('div.brand', h('h1.title', 'MONOLITH'), h('div.subtitle', 'Echoes of the Colossus'), h('div.rule')),
        list),
      h('div.menu-foot', h('span.version', 'v0.1 · Web Build'), hints(ui, [['confirm', t('Select'), () => this.nav.activate()]])),
    );
    this.nav = new FocusNav(list, { ui });
  }
  enter() {
    const latest = this.game.saves.latest();
    this.items.cont.setDisabled(!latest);
    this.contSub.textContent = latest ? `${CHAPTERS[latest.chapter]?.title ?? ''}  ·  ${formatPlaytime(latest.playtime || 0)}` : '';
    this.items.chap.setDisabled(this.game.saves.profile.unlocked.length === 0);
    super.enter();
    this.nav.reset();
  }
  uncover() { super.uncover(); this.enter(); }
  back() { /* root menu: nothing to go back to */ }
}

export class PauseMenu extends Screen {
  constructor(ui) {
    super(ui, 'pause');
    const g = this.game;
    const list = h('div.menu',
      menuItem(ui, t('Resume'), () => g.resume()),
      menuItem(ui, t('Restart from Checkpoint'), () => ui.open('confirm', {
        title: t('Restart from Checkpoint'), text: t('Return to the last shrine you rested at.'), yes: t('Restart'), no: t('Cancel'),
        onYes: () => g.restartCheckpoint(),
      })),
      menuItem(ui, t('Settings'), () => ui.open('settings')),
      menuItem(ui, t('Return to Main Menu'), () => ui.open('confirm', {
        title: t('Return to Main Menu'), text: t('Progress since the last shrine will be lost.'), yes: t('Return'), no: t('Cancel'),
        onYes: () => g.toMainMenu(),
      })),
    );
    this.chap = h('div.chap'); this.eyebrow = h('div.eyebrow'); this.time = h('div.time');
    this.el.append(
      h('div.scrim-full'), h('div.scrim-left'),
      h('div', { style: { position: 'relative' } }, h('div.where', this.eyebrow, this.chap, this.time), list),
      h('div.menu-foot', h('span.version', t('Paused')), hints(ui, [['confirm', t('Select'), () => this.nav.activate()], ['back', t('Resume'), () => g.resume()]])),
    );
    this.nav = new FocusNav(list, { ui });
  }
  enter() {
    const c = CHAPTERS[this.game.chapter];
    this.eyebrow.textContent = t('Chapter {n}', { n: c.numeral });
    this.chap.textContent = c.title;
    this.time.textContent = formatPlaytime(this.game.playtime);
    super.enter(); this.nav.reset();
  }
  onInput(e) { if (e.type === 'start') { this.game.resume(); return; } super.onInput(e); }
  back() { this.game.resume(); }
}

/** Generic confirm dialog (overlay). params: {title, text, yes, no, onYes, onNo} */
export class ConfirmDialog extends Screen {
  constructor(ui) {
    super(ui, 'dialog');
    this.overlay = true;
    this.titleEl = h('h3'); this.textEl = h('p');
    this.list = h('div.menu');
    this.el.append(h('div.scrim-deep'), h('div.dialog-box', this.titleEl, this.textEl, this.list));
    this.nav = new FocusNav(this.list, { ui, cols: 2 });
  }
  enter(p) {
    this.p = p;
    this.titleEl.textContent = p.title; this.textEl.textContent = p.text;
    this.list.replaceChildren(
      menuItem(this.ui, p.no || t('Cancel'), () => this.cancel(), { sound: 'uiBack' }),
      menuItem(this.ui, p.yes || t('Confirm'), () => { this.ui.close(); p.onYes?.(); }),
    );
    super.enter();
    this.nav.focus(p.defaultYes ? 1 : 0, { sound: false });
  }
  cancel() { this.ui.close(); this.p?.onNo?.(); }
  back() { this.ui.sfx('uiBack'); this.cancel(); }
}

export class DeathScreen extends Screen {
  constructor(ui) {
    super(ui, 'death');
    const g = this.game;
    this.line = h('div.line');
    const list = h('div.menu',
      menuItem(ui, t('Restart from Checkpoint'), () => g.restartCheckpoint()),
      menuItem(ui, t('Return to Main Menu'), () => g.toMainMenu()),
    );
    this.el.append(this.line, list);
    this.nav = new FocusNav(list, { ui });
  }
  enter({ source } = {}) {
    const lines = {
      fall: 'The ground does not forgive.',
      crushed: 'The weight of stone remembers you.',
      shockwave: 'The earth rose to meet you.',
      thrown: 'You could not hold on.',
    };
    this.line.textContent = t(lines[source] || 'The valley falls quiet.');
    super.enter(); this.nav.reset();
  }
  back() {}
}

export class ExitScreen extends Screen {
  constructor(ui) {
    super(ui, 'exit-screen');
    const list = h('div.menu', menuItem(ui, t('Return to Title'), () => location.reload()));
    list.style.alignItems = 'center';
    this.el.append(h('p', t('The valley will wait.')), h('div.eyebrow', t('You may now close this tab')), list);
    this.nav = new FocusNav(list, { ui });
  }
  enter() { super.enter(); this.nav.reset(); }
}

/** First launch only: pick Thai or English before the title appears. */
export class LanguageScreen extends Screen {
  constructor(ui) {
    super(ui, 'language-screen');
    const pick = (lang) => {
      if (this.leaving) return; this.leaving = true;
      this.game.settings.set('language', lang);
      this.ui.reset('title');
    };
    const list = h('div.menu', LANGUAGES.map((l) => menuItem(ui, l.label, () => pick(l.value))));
    this.el.append(
      h('div.scrim-full', { style: { background: 'rgba(8,7,6,0.45)' } }),
      h('div.lang-box',
        h('div.eyebrow', 'Choose your language'),
        h('div.eyebrow.th', 'เลือกภาษา'),
        h('div.rule'),
        list,
        h('div.lang-note', 'You can change this later in Settings · เปลี่ยนได้ภายหลังในการตั้งค่า')),
    );
    this.nav = new FocusNav(list, { ui });
  }
  enter() { super.enter(); this.nav.reset(); }
  back() {}
}

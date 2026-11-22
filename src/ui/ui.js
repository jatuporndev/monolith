import { h } from './core.js';
import { Hud } from './hud.js';

/**
 * Screen stack + routing of semantic input. Gameplay never touches the DOM;
 * it talks to the UI through the event bus and this manager's small API.
 */
export class UI {
  constructor(game) {
    this.game = game;
    this.root = document.getElementById('ui');
    this.layer = h('div.layer'); this.root.append(this.layer);
    this.fadeEl = document.getElementById('fade');
    this.stack = [];
    this.screens = {};
    this.deviceListeners = new Set();
    this.device = 'kbm';
    this.capturing = false;
    this.hud = new Hud(this);
    this.lastNavAt = 0;

    game.bus.on('ui:input', (e) => this.route(e));
    game.bus.on('input:device', (d) => this.setDevice(d));
    game.bus.on('settings:changed', ({ key }) => {
      if (key === 'uiScale') this.applyScale();
      if (key === 'inputDevice') this.setDevice(game.input.promptDevice(), true);
    });
    this.applyScale();
    // hide the cursor while a controller is driving the UI
    addEventListener('mousemove', () => document.body.classList.remove('hide-cursor'));
  }

  register(name, screen) { this.screens[name] = screen; return screen; }
  get top() { return this.stack[this.stack.length - 1]; }

  applyScale() {
    const s = this.game.settings.get('uiScale') / 100;
    document.documentElement.style.setProperty('--ui-scale', String(s));
  }
  setDevice(d, force) {
    if (this.device === d && !force) return;
    this.device = d;
    document.body.classList.toggle('hide-cursor', d === 'pad');
    for (const fn of this.deviceListeners) fn(d);
  }
  onDevice(fn) { this.deviceListeners.add(fn); return () => this.deviceListeners.delete(fn); }

  sfx(name) { this.game.audio.play(name); }

  route(e) {
    if (this.capturing) return;
    const top = this.top;
    if (!top || this.locked) return;
    top.onInput(e);
  }

  /** Push a screen. Non-overlay screens hide the one beneath. */
  open(name, params) {
    const s = this.screens[name];
    const prev = this.top;
    if (prev === s) { s.enter(params); return s; }
    if (prev && !s.overlay) prev.cover();
    this.stack.push(s);
    s.enter(params);
    this.briefLock();
    return s;
  }
  /** Pop the top screen and reveal the previous one. */
  close() {
    const s = this.stack.pop();
    s?.exit();
    const top = this.top;
    if (top) top.uncover();
    this.briefLock();
    return top;
  }
  /** Replace the whole stack with a single screen. */
  reset(name, params) {
    while (this.stack.length) this.stack.pop().exit();
    if (name) return this.open(name, params);
    return null;
  }
  briefLock() { this.locked = true; clearTimeout(this.lockT); this.lockT = setTimeout(() => { this.locked = false; }, 160); }

  /** Full-screen fade. Resolves when the fade finishes. */
  fade(to, ms = 900) {
    return new Promise((res) => {
      this.fadeEl.style.transitionDuration = ms + 'ms';
      // force style flush so the transition always runs
      void this.fadeEl.offsetWidth;
      this.fadeEl.style.opacity = to ? '1' : '0';
      setTimeout(res, ms + 30);
    });
  }

  /** Re-render values of every settings row (after preset changes, rebinding, …). */
  refreshRows() { for (const el of this.layer.querySelectorAll('.row')) el.refresh?.(); }
}

import { keyLabel, PAD_LABELS } from '../core/input.js';

/** Tiny hyperscript: h('div.a.b', {attrs}, ...children) */
export function h(tag, attrs, ...children) {
  if (attrs == null || typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs)) { if (attrs != null) children.unshift(attrs); attrs = {}; }
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

export const ICON = {
  left: '<svg viewBox="0 0 8 8"><path d="M5.5 0.5 2 4l3.5 3.5" fill="none" stroke="currentColor" stroke-width="1"/></svg>',
  right: '<svg viewBox="0 0 8 8"><path d="M2.5 0.5 6 4 2.5 7.5" fill="none" stroke="currentColor" stroke-width="1"/></svg>',
};

/** Keyboard / mouse / pad aware focus list. */
export class FocusNav {
  constructor(root, { cols = 1, onFocus, ui, wrap = true } = {}) {
    this.root = root; this.cols = cols; this.onFocus = onFocus; this.ui = ui; this.wrap = wrap;
    this.index = 0;
    root.addEventListener('mousemove', (e) => {
      const it = e.target.closest?.('[data-focus]');
      if (!it || !root.contains(it)) return;
      const list = this.items(); const i = list.indexOf(it);
      if (i >= 0 && i !== this.index) this.focus(i, { sound: true, scroll: false });
    });
    root.addEventListener('click', (e) => {
      const it = e.target.closest?.('[data-focus]');
      if (!it || !root.contains(it) || e.target.closest('.arrow, .slider')) return;
      const list = this.items(); const i = list.indexOf(it);
      if (i >= 0) { this.focus(i, { sound: false }); this.activate(); }
    });
  }
  items() { return [...this.root.querySelectorAll('[data-focus]')].filter((el) => !el.classList.contains('is-disabled') && el.offsetParent !== null); }
  current() { return this.items()[this.index]; }
  focus(i, { sound = true, scroll = true } = {}) {
    const list = this.items(); if (!list.length) return;
    i = Math.max(0, Math.min(list.length - 1, i));
    const prev = list[this.index];
    for (const el of this.root.querySelectorAll('.is-focused')) el.classList.remove('is-focused');
    this.index = i;
    const el = list[i]; el.classList.add('is-focused');
    if (scroll) el.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    if (sound && prev !== el) this.ui?.sfx('uiMove');
    this.onFocus?.(el);
  }
  focusEl(el) { const i = this.items().indexOf(el); if (i >= 0) this.focus(i, { sound: false }); }
  reset() { this.index = 0; this.focus(0, { sound: false, scroll: false }); }
  refresh() { const list = this.items(); if (!list.length) return; this.focus(Math.min(this.index, list.length - 1), { sound: false, scroll: false }); }
  move(dir) {
    const list = this.items(); if (!list.length) return false;
    const cur = list[this.index];
    if ((dir === 'left' || dir === 'right') && cur?.__adjust) { cur.__adjust(dir === 'left' ? -1 : 1); return true; }
    let step = 0;
    if (this.cols > 1) step = { left: -1, right: 1, up: -this.cols, down: this.cols }[dir];
    else step = { up: -1, down: 1 }[dir] || 0;
    if (!step) return false;
    let n = this.index + step;
    if (n < 0 || n >= list.length) { if (!this.wrap || this.cols > 1) return false; n = (n + list.length) % list.length; }
    this.focus(n);
    return true;
  }
  activate() {
    const cur = this.current(); if (!cur) return;
    if (cur.__activate) cur.__activate();
  }
}

/** Base class for every full-screen UI state. */
export class Screen {
  constructor(ui, cls) {
    this.ui = ui; this.game = ui.game;
    this.el = h(`section.screen.${cls}`);
    ui.layer.append(this.el);
    this.overlay = false;   // overlays keep the screen beneath visible
  }
  get visible() { return this.el.classList.contains('is-visible'); }
  enter() { this.el.classList.add('is-visible'); this.el.classList.remove('is-under'); this.nav?.refresh(); }
  exit() { this.el.classList.remove('is-visible'); }
  cover() { this.el.classList.add('is-under'); this.el.classList.remove('is-visible'); }
  uncover() { this.el.classList.remove('is-under'); this.el.classList.add('is-visible'); this.nav?.refresh(); }
  onInput(e) {
    if (!this.nav) { if (e.type === 'back') this.back(); return; }
    if (e.type === 'nav') this.nav.move(e.dir);
    else if (e.type === 'confirm') this.nav.activate();
    else if (e.type === 'back') this.back();
  }
  back() {}
}

/** Button glyph that follows the active input device. */
export function glyph(ui, action) {
  const dev = ui.device;
  if (dev === 'pad') {
    const label = PAD_LABELS[action] || action;
    return h(`span.glyph.pad${label.length > 1 ? '.wide' : ''}`, label);
  }
  const fixed = { confirm: 'Enter', back: 'Esc', tabs: 'Q / E', pause: 'Esc', delete: 'Del' };
  const code = fixed[action] ? null : ui.game.settings.get('bindings')[action];
  const text = fixed[action] || shortKey(code);
  return h('span.glyph', text);
}
export function shortKey(code) {
  const map = { Mouse0: 'LMB', Mouse1: 'MMB', Mouse2: 'RMB', Mouse3: 'M4', Mouse4: 'M5', ShiftLeft: 'Shift', ShiftRight: 'Shift', ControlLeft: 'Ctrl', ControlRight: 'Ctrl', AltLeft: 'Alt', AltRight: 'Alt', Space: 'Space' };
  return map[code] || keyLabel(code);
}

/** Footer hint strip: [[action, label, onClick], ...] — re-renders on device change. */
export function hints(ui, list) {
  const el = h('div.hints');
  const render = () => {
    el.replaceChildren(...list.filter(Boolean).map(([action, label, fn]) => {
      const it = h('span.hint', glyph(ui, action), label);
      if (fn) it.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
      return it;
    }));
  };
  render();
  ui.onDevice(render);
  return el;
}

import { t } from '../core/i18n.js';
import { h, ICON } from './core.js';
import { keyLabel } from '../core/input.js';
import { clamp } from '../core/util.js';

export function menuItem(ui, label, onSelect, { sub, disabled = false, sound = 'uiConfirm' } = {}) {
  const el = h(`button.menu-item${disabled ? '.is-disabled' : ''}`, { 'data-focus': true, type: 'button', tabindex: -1 }, h('span', label), sub ? h('span.sub', sub) : null);
  el.__activate = () => { if (el.classList.contains('is-disabled')) return; ui.sfx(sound); onSelect?.(); };
  el.setDisabled = (d) => el.classList.toggle('is-disabled', d);
  return el;
}

function rowShell(label, desc, extraCls = '') {
  const el = h(`div.row${extraCls}`, { 'data-focus': true, role: 'group' }, h('span.label', label));
  el.__desc = desc;
  return el;
}

/** Left/right cycling option. options: [{value,label}] or () => [...] */
export function selectRow(ui, { label, desc, options, get, set, wrap = false, enabled }) {
  const el = rowShell(label, desc);
  const text = h('span.text');
  const l = h('span.arrow', { html: ICON.left }), r = h('span.arrow', { html: ICON.right });
  el.append(h('span.value', l, text, r));
  const opts = () => (typeof options === 'function' ? options() : options);
  const idx = () => Math.max(0, opts().findIndex((o) => o.value === get()));
  el.refresh = () => {
    const o = opts(), i = idx();
    text.textContent = o[i]?.label ?? '—';
    l.classList.toggle('is-disabled', !wrap && i <= 0);
    r.classList.toggle('is-disabled', !wrap && i >= o.length - 1);
    const off = enabled && !enabled(); el.classList.toggle('is-disabled', !!off);
  };
  const bump = (arrow, cls) => { arrow.classList.add(cls); setTimeout(() => arrow.classList.remove(cls), 140); };
  el.__adjust = (dir) => {
    const o = opts(); let i = idx() + dir;
    if (wrap) i = (i + o.length) % o.length; else if (i < 0 || i >= o.length) { return; }
    set(o[i].value); ui.sfx('uiAdjust'); bump(dir < 0 ? l : r, dir < 0 ? 'bump-l' : 'bump-r'); ui.refreshRows();
  };
  el.__activate = () => { const o = opts(); const i = idx(); const n = i + 1 >= o.length ? 0 : i + 1; set(o[n].value); ui.sfx('uiAdjust'); bump(r, 'bump-r'); ui.refreshRows(); };
  l.addEventListener('click', (e) => { e.stopPropagation(); el.__adjust(-1); });
  r.addEventListener('click', (e) => { e.stopPropagation(); el.__adjust(1); });
  el.refresh();
  return el;
}

export function toggleRow(ui, { label, desc, get, set }) {
  return selectRow(ui, { label, desc, get, set, wrap: true, options: [{ value: false, label: t('Off') }, { value: true, label: t('On') }] });
}

export function sliderRow(ui, { label, desc, min = 0, max = 100, step = 5, get, set, format = (v) => String(v) }) {
  const el = rowShell(label, desc);
  const fill = h('span.fill'), knob = h('span.knob'), num = h('span.slider-num');
  const slider = h('span.slider', h('span.track'), fill, knob);
  el.append(h('span.value', slider, num));
  el.refresh = () => {
    const v = get(), k = (v - min) / (max - min);
    fill.style.width = k * 100 + '%'; knob.style.left = k * 100 + '%';
    num.textContent = format(v);
  };
  const setV = (v, sound = true) => {
    v = clamp(Math.round(v / step) * step, min, max);
    if (v === get()) return;
    set(v); el.refresh(); if (sound) ui.sfx('uiAdjust');
  };
  el.__adjust = (dir) => setV(get() + dir * step);
  el.__activate = () => {};
  const fromMouse = (e) => { const r = slider.getBoundingClientRect(); setV(min + clamp((e.clientX - r.left) / r.width, 0, 1) * (max - min)); };
  slider.addEventListener('mousedown', (e) => {
    e.stopPropagation(); fromMouse(e);
    const mm = (ev) => fromMouse(ev);
    const mu = () => { removeEventListener('mousemove', mm); removeEventListener('mouseup', mu); };
    addEventListener('mousemove', mm); addEventListener('mouseup', mu);
  });
  slider.addEventListener('click', (e) => e.stopPropagation());
  el.refresh();
  return el;
}

export function actionRow(ui, { label, desc, value = '', onActivate }) {
  const el = rowShell(label, desc, '.is-action');
  const v = h('span.value', value);
  el.append(v);
  el.__activate = () => { ui.sfx('uiConfirm'); onActivate?.(); };
  el.setValue = (t) => { v.textContent = t; };
  el.refresh = () => {};
  return el;
}

export function keybindRow(ui, { label, action, desc }) {
  const el = rowShell(label, desc);
  const text = h('span.text');
  el.append(h('span.value', text));
  el.refresh = () => { text.textContent = keyLabel(ui.game.settings.get('bindings')[action]); };
  el.__activate = () => {
    if (ui.capturing) return;
    ui.capturing = true;
    el.classList.add('is-binding'); text.textContent = t('Press a key');
    ui.sfx('uiConfirm');
    // defer so the confirming key/click is not captured
    setTimeout(() => ui.game.input.captureNext((code) => {
      el.classList.remove('is-binding');
      if (code && code !== 'Escape') { ui.game.settings.setBinding(action, code); ui.sfx('uiAdjust'); }
      else ui.sfx('uiBack');
      // keep the back event from the cancelling Escape from closing the screen
      setTimeout(() => { ui.capturing = false; }, 50);
      ui.refreshRows();
    }), 30);
  };
  el.refresh();
  return el;
}

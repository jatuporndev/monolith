import { t } from '../../core/i18n.js';
import { LANGUAGES } from '../../core/i18n.js';
import { h, Screen, FocusNav, hints } from '../core.js';
import { selectRow, toggleRow, sliderRow, actionRow, keybindRow } from '../components.js';
import { DEFAULT_SETTINGS } from '../../core/settings.js';

const TABS = [
  { id: 'graphics', label: 'Graphics' },
  { id: 'audio', label: 'Audio' },
  { id: 'controls', label: 'Controls' },
  { id: 'accessibility', label: 'Accessibility' },
];
const KEYS = {
  graphics: ['renderScale', 'displayMode', 'quality', 'shadows', 'antialias', 'postProcessing', 'vegetation', 'vsync', 'frameLimit'],
  audio: ['masterVolume', 'musicVolume', 'sfxVolume', 'ambientVolume'],
  controls: ['inputDevice', 'mouseSensitivity', 'cameraSensitivity', 'invertY', 'invertX', 'vibration', 'stickDeadzone', 'bindings'],
  accessibility: ['uiScale', 'subtitles', 'subtitleSize', 'subtitleBackground', 'speakerNames', 'cameraShake', 'motionBlur', 'screenEffects'],
};

export class SettingsScreen extends Screen {
  constructor(ui) {
    super(ui, 'panel-screen');
    this.tabIndex = 0;
    this.tabsEl = h('div.tabs');
    this.rowsEl = h('div.rows');
    this.desc = h('div.desc');
    this.el.append(
      h('div.scrim-full'),
      h('div.panel-head', { style: { position: 'relative' } }, h('h2', t('Settings')), this.tabsEl),
      h('div.panel-body', { style: { position: 'relative' } }, this.rowsEl),
      h('div.panel-foot', { style: { position: 'relative' } }, this.desc,
        hints(ui, [['tabs', t('Category'), () => this.switchTab(1)], ['delete', t('Reset'), () => this.askReset()], ['back', t('Back'), () => this.back()]])),
    );
    this.nav = new FocusNav(this.rowsEl, { ui, wrap: true, onFocus: (el) => { this.desc.textContent = el.__desc || ''; } });
    this.renderTabs();
    this.renderRows();
    ui.game.bus.on('settings:changed', () => { if (this.visible) ui.refreshRows(); });
  }

  renderTabs() {
    this.tabsEl.replaceChildren(
      ...TABS.map((tb, i) => {
        const b = h(`button.tab${i === this.tabIndex ? '.is-active' : ''}`, { type: 'button' }, t(tb.label));
        b.addEventListener('click', () => { this.tabIndex = i; this.renderTabs(); this.renderRows(); this.ui.sfx('uiMove'); });
        return b;
      }),
    );
  }

  switchTab(dir) {
    this.tabIndex = (this.tabIndex + dir + TABS.length) % TABS.length;
    this.ui.sfx('uiMove');
    this.renderTabs(); this.renderRows();
  }

  renderRows() {
    const ui = this.ui, g = this.game, s = g.settings;
    const get = (k) => () => s.get(k), set = (k) => (v) => s.set(k, v);
    const group = (label) => h('div.row-group', t(label));
    let rows = [];
    switch (TABS[this.tabIndex].id) {
      case 'graphics': rows = [
        group('Display'),
        selectRow(ui, { label: t('Resolution'), desc: t('Internal render resolution. Lower values improve performance.'), get: get('renderScale'), set: set('renderScale'),
          options: () => [0.5, 0.67, 0.75, 0.85, 1].map((v) => ({ value: v, label: `${g.renderer.resolutionLabel(v)}${v === 1 ? `  (${t('Native')})` : ''}` })) }),
        selectRow(ui, { label: t('Display Mode'), desc: t('Fullscreen hides the browser interface.'), get: () => g.isFullscreen() ? 'fullscreen' : 'windowed', set: (v) => g.setDisplayMode(v),
          options: [{ value: 'windowed', label: t('Windowed') }, { value: 'fullscreen', label: t('Fullscreen') }] }),
        selectRow(ui, { label: t('Quality Preset'), desc: t('Applies a balanced set of options. Changing any option below sets this to Custom.'), get: get('quality'), set: set('quality'),
          options: [{ value: 'low', label: t('Low') }, { value: 'medium', label: t('Medium') }, { value: 'high', label: t('High') }, { value: 'ultra', label: t('Ultra') }, { value: 'custom', label: t('Custom') }].filter((o) => o.value !== 'custom' || s.get('quality') === 'custom') }),
        group('Rendering'),
        selectRow(ui, { label: t('Shadows'), desc: t('Shadow resolution from the sun.'), get: get('shadows'), set: set('shadows'),
          options: [{ value: 'off', label: t('Off') }, { value: 'low', label: t('Low') }, { value: 'medium', label: t('Medium') }, { value: 'high', label: t('High') }] }),
        selectRow(ui, { label: t('Anti-Aliasing'), desc: t('Smooths jagged edges. MSAA is sharpest and most expensive.'), get: get('antialias'), set: set('antialias'),
          options: [{ value: 'off', label: t('Off') }, { value: 'fxaa', label: t('FXAA') }, { value: 'smaa', label: t('SMAA') }, { value: 'msaa', label: t('MSAA 4×') }] }),
        toggleRow(ui, { label: t('Post Processing'), desc: t('Film grade, grain and the condition effects. When off, a lighter fallback is used.'), get: get('postProcessing'), set: set('postProcessing') }),
        selectRow(ui, { label: t('Vegetation Density'), desc: t('Amount of grass drawn in the valley.'), get: get('vegetation'), set: set('vegetation'),
          options: [{ value: 0.3, label: t('Sparse') }, { value: 0.6, label: t('Medium') }, { value: 0.85, label: t('Dense') }, { value: 1, label: t('Lush') }] }),
        group('Frame Pacing'),
        toggleRow(ui, { label: t('VSync'), desc: t('Synchronise with the display refresh. Off renders as fast as the frame limit allows.'), get: get('vsync'), set: set('vsync') }),
        selectRow(ui, { label: t('Frame Rate Limit'), desc: t('Caps the frame rate to save power.'), get: get('frameLimit'), set: set('frameLimit'),
          options: [{ value: 30, label: t('30 FPS') }, { value: 60, label: t('60 FPS') }, { value: 120, label: t('120 FPS') }, { value: 144, label: t('144 FPS') }, { value: 0, label: t('Unlimited') }] }),
      ]; break;
      case 'audio': rows = [
        group('Volume'),
        sliderRow(ui, { label: t('Master Volume'), desc: t('Overall loudness.'), get: get('masterVolume'), set: set('masterVolume') }),
        sliderRow(ui, { label: t('Music'), desc: t('Score and menu music.'), get: get('musicVolume'), set: set('musicVolume') }),
        sliderRow(ui, { label: t('Sound Effects'), desc: t('Footsteps, the Colossus, the body’s breath and heartbeat, interface.'), get: get('sfxVolume'), set: set('sfxVolume') }),
        sliderRow(ui, { label: t('Ambience'), desc: t('Wind and the sound of the valley.'), get: get('ambientVolume'), set: set('ambientVolume') }),
      ]; break;
      case 'controls': rows = [
        group('Input'),
        selectRow(ui, { label: t('Button Prompts'), desc: t('Which device the on-screen prompts show. Auto follows the last device used.'), get: get('inputDevice'), set: set('inputDevice'),
          options: [{ value: 'auto', label: t('Automatic') }, { value: 'kbm', label: t('Keyboard & Mouse') }, { value: 'pad', label: t('Controller') }] }),
        group('Keyboard & Mouse'),
        sliderRow(ui, { label: t('Mouse Sensitivity'), desc: t('Camera speed for mouse movement.'), get: get('mouseSensitivity'), set: set('mouseSensitivity') }),
        keybindRow(ui, { label: t('Move Forward'), action: 'forward', desc: t('Select, then press a key or mouse button. Esc cancels.') }),
        keybindRow(ui, { label: t('Move Back'), action: 'back', desc: t('Select, then press a key or mouse button. Esc cancels.') }),
        keybindRow(ui, { label: t('Move Left'), action: 'left', desc: t('Select, then press a key or mouse button. Esc cancels.') }),
        keybindRow(ui, { label: t('Move Right'), action: 'right', desc: t('Select, then press a key or mouse button. Esc cancels.') }),
        keybindRow(ui, { label: t('Jump / Lunge'), action: 'jump', desc: t('Jump. While climbing, lunge upward at the cost of stamina.') }),
        keybindRow(ui, { label: t('Sprint'), action: 'sprint', desc: t('Hold to run.') }),
        keybindRow(ui, { label: t('Grip'), action: 'grip', desc: t('Hold to grab and hold on to moss and fur. Release to let go.') }),
        keybindRow(ui, { label: t('Interact'), action: 'interact', desc: t('Examine, rest at shrines, strike.') }),
        group('Controller'),
        sliderRow(ui, { label: t('Camera Sensitivity'), desc: t('Camera speed for the right stick.'), get: get('cameraSensitivity'), set: set('cameraSensitivity') }),
        sliderRow(ui, { label: t('Stick Deadzone'), desc: t('Ignore small stick movements.'), min: 5, max: 40, step: 1, get: get('stickDeadzone'), set: set('stickDeadzone'), format: (v) => v + '%' }),
        toggleRow(ui, { label: t('Vibration'), desc: t('Controller rumble on impacts.'), get: get('vibration'), set: set('vibration') }),
        actionRow(ui, { label: t('Controller Layout'), desc: t('Move: Left Stick · Camera: Right Stick · Jump: A · Grip: RT · Interact: X · Sprint: B · Pause: Start'), value: 'Standard' }),
        group('Camera'),
        toggleRow(ui, { label: t('Invert Vertical'), desc: t('Invert camera up/down.'), get: get('invertY'), set: set('invertY') }),
        toggleRow(ui, { label: t('Invert Horizontal'), desc: t('Invert camera left/right.'), get: get('invertX'), set: set('invertX') }),
      ]; break;
      case 'accessibility': rows = [
        group('Language'),
        selectRow(ui, { label: t('Language'), desc: t('Interface and subtitle language. Names stay in English.'), get: () => getLangSetting(s), set: set('language'), options: LANGUAGES }),
        group('Interface'),
        sliderRow(ui, { label: t('UI Scale'), desc: t('Size of all interface text.'), min: 80, max: 140, step: 5, get: get('uiScale'), set: set('uiScale'), format: (v) => v + '%' }),
        group('Subtitles'),
        toggleRow(ui, { label: t('Subtitles'), desc: t('Show spoken lines and examine text.'), get: get('subtitles'), set: set('subtitles') }),
        selectRow(ui, { label: t('Subtitle Size'), desc: t('Text size of subtitles.'), get: get('subtitleSize'), set: set('subtitleSize'), enabled: () => s.get('subtitles'),
          options: [{ value: 'small', label: t('Small') }, { value: 'medium', label: t('Medium') }, { value: 'large', label: t('Large') }, { value: 'xlarge', label: t('Extra Large') }] }),
        selectRow(ui, { label: t('Subtitle Background'), desc: t('A backing behind subtitle text improves contrast.'), get: get('subtitleBackground'), set: set('subtitleBackground'), enabled: () => s.get('subtitles'),
          options: [{ value: 'none', label: t('None') }, { value: 'soft', label: t('Soft') }, { value: 'solid', label: t('Solid') }] }),
        toggleRow(ui, { label: t('Speaker Names'), desc: t('Show who is speaking.'), get: get('speakerNames'), set: set('speakerNames') }),
        group('Comfort'),
        sliderRow(ui, { label: t('Camera Shake'), desc: t('Strength of camera shake from impacts and the Colossus.'), get: get('cameraShake'), set: set('cameraShake'), format: (v) => v + '%' }),
        toggleRow(ui, { label: t('Motion Blur'), desc: t('Blur when turning the camera quickly.'), get: get('motionBlur'), set: set('motionBlur') }),
        sliderRow(ui, { label: t('Screen Effects Intensity'), desc: t('Strength of vignette, desaturation and blur that show your condition. Audio cues remain.'), get: get('screenEffects'), set: set('screenEffects'), format: (v) => v + '%' }),
      ]; break;
    }
    this.rowsEl.replaceChildren(...rows);
    this.rowsEl.scrollTop = 0;
    if (this.visible) this.nav.reset();
  }

  askReset() {
    const tab = TABS[this.tabIndex];
    this.ui.open('confirm', {
      title: t('Reset {tab}', { tab: t(tab.label) }), text: t('Restore the default {tab} settings?', { tab: t(tab.label).toLowerCase() }), yes: t('Reset'), no: t('Cancel'),
      onYes: () => {
        const s = this.game.settings;
        for (const k of KEYS[tab.id]) {
          if (k === 'displayMode') { this.game.setDisplayMode('windowed'); continue; }
          if (k === 'quality') continue;
          s.resetCategory([k]);
        }
        if (tab.id === 'graphics') s.set('quality', DEFAULT_SETTINGS.quality);
        this.ui.refreshRows();
        this.ui.hud.toast(t('Defaults restored'));
      },
    });
  }

  enter() { super.enter(); this.renderRows(); this.nav.reset(); this.desc.textContent = this.nav.current()?.__desc || ''; }
  onInput(e) {
    if (e.type === 'tab') { this.switchTab(e.dir); return; }
    if (e.type === 'secondary') { this.askReset(); return; }
    super.onInput(e);
  }
  back() { this.ui.sfx('uiBack'); this.ui.close(); }
}

function getLangSetting(s) { return s.get('language') || 'en'; }

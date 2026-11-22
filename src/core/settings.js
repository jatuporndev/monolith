import { storage } from './storage.js';

export const DEFAULT_BINDINGS = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD',
  jump: 'Space', sprint: 'ShiftLeft', grip: 'Mouse0', interact: 'KeyE',
};

export const QUALITY_PRESETS = {
  low:    { shadows: 'off',    antialias: 'fxaa', postProcessing: true,  renderScale: 0.75, vegetation: 0.3 },
  medium: { shadows: 'low',    antialias: 'fxaa', postProcessing: true,  renderScale: 1,    vegetation: 0.6 },
  high:   { shadows: 'medium', antialias: 'smaa', postProcessing: true,  renderScale: 1,    vegetation: 0.85 },
  ultra:  { shadows: 'high',   antialias: 'msaa', postProcessing: true,  renderScale: 1,    vegetation: 1 },
};

export const DEFAULT_SETTINGS = {
  // graphics
  renderScale: 1, displayMode: 'windowed', quality: 'high',
  shadows: 'medium', antialias: 'smaa', postProcessing: true, vegetation: 0.85,
  vsync: true, frameLimit: 0, // 0 = unlimited
  // audio (0..100)
  masterVolume: 80, musicVolume: 60, sfxVolume: 80, ambientVolume: 70,
  // controls
  inputDevice: 'auto', bindings: { ...DEFAULT_BINDINGS },
  mouseSensitivity: 50, cameraSensitivity: 50, invertY: false, invertX: false,
  vibration: true, stickDeadzone: 15,
  // accessibility
  uiScale: 100, subtitles: true, subtitleSize: 'medium', subtitleBackground: 'soft', speakerNames: true,
  cameraShake: 100, motionBlur: false, screenEffects: 100,
  // null until the player picks one on first launch
  language: null,
};

const PRESET_KEYS = ['shadows', 'antialias', 'postProcessing', 'renderScale', 'vegetation'];
const KEY = 'monolith.settings.v1';

export class Settings {
  constructor(bus, store = storage) {
    this.bus = bus;
    this.store = store;
    const saved = store.get(KEY, {}) || {};
    this.values = { ...DEFAULT_SETTINGS, ...saved, bindings: { ...DEFAULT_BINDINGS, ...(saved.bindings || {}) } };
  }
  get(key) { return this.values[key]; }
  set(key, value) {
    if (this.values[key] === value) return;
    this.values[key] = value;
    if (key === 'quality' && QUALITY_PRESETS[value]) {
      for (const [k, v] of Object.entries(QUALITY_PRESETS[value])) { this.values[k] = v; this.bus?.emit('settings:changed', { key: k, value: v }); }
    } else if (PRESET_KEYS.includes(key) && this.values.quality !== 'custom') {
      const preset = QUALITY_PRESETS[this.values.quality];
      if (preset && preset[key] !== value) { this.values.quality = 'custom'; this.bus?.emit('settings:changed', { key: 'quality', value: 'custom' }); }
    }
    this.persist();
    this.bus?.emit('settings:changed', { key, value });
  }
  setBinding(action, code) {
    const b = { ...this.values.bindings };
    // swap if the code is already used by another action, so nothing ends up unbound silently
    const clash = Object.keys(b).find((a) => b[a] === code && a !== action);
    if (clash) b[clash] = b[action];
    b[action] = code;
    this.values.bindings = b;
    this.persist();
    this.bus?.emit('settings:changed', { key: 'bindings', value: b });
  }
  resetCategory(keys) {
    for (const k of keys) this.set(k, k === 'bindings' ? { ...DEFAULT_BINDINGS } : DEFAULT_SETTINGS[k]);
  }
  persist() { this.store.set(KEY, this.values); }
}

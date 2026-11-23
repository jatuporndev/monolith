import { clamp } from '../core/util.js';

/**
 * Fully procedural audio (no asset files): ambient wind, generative music,
 * body sounds (heartbeat / breathing), world and UI effects.
 *
 * Graph:
 *   ambient ─┐
 *   sfx(env)─┴─ worldBus ─ muffle(lowpass) ─┐
 *   music ───────────────────────────────────┼─ master ─ compressor ─ out
 *   body (heartbeat/breath) ─ sfxVol ────────┤
 *   ui ─ sfxVol ─────────────────────────────┘
 */
export class AudioEngine {
  constructor(bus, settings) {
    this.bus = bus; this.settings = settings;
    this.ctx = null; this.started = false;
    this.mood = 'silence';
    this.condition = 0; this.exertion = 0; this.muffle = 0;
    this.nextBeat = 0; this.nextBreath = 0; this.breathPhase = 0;
    this.nextNote = 0; this.noteIndex = 0;
    bus.on('settings:changed', ({ key }) => { if (/Volume$/.test(key)) this.applyVolumes(); });
    // browsers only allow sound after a gesture: any click or key will do, whichever screen we are on
    // (the ?play= shortcut and a loaded save both skip the title's "press any key")
    const wake = () => { if (!this.started) this.start(); else if (this.ctx?.state !== 'running') this.ctx.resume(); };
    window.addEventListener('pointerdown', wake, true);
    window.addEventListener('keydown', wake, true);
  }

  /** Must be called from a user gesture. */
  start() {
    if (this.started) { this.ctx?.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.started = true;
    const g = (v = 1) => { const n = ctx.createGain(); n.gain.value = v; return n; };

    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14; this.comp.ratio.value = 3;
    this.comp.connect(ctx.destination);
    this.master = g(); this.master.connect(this.comp);

    this.muffleFilter = ctx.createBiquadFilter();
    this.muffleFilter.type = 'lowpass'; this.muffleFilter.frequency.value = 20000; this.muffleFilter.Q.value = 0.4;
    this.muffleFilter.connect(this.master);
    this.worldBus = g(); this.worldBus.connect(this.muffleFilter);

    this.musicGain = g(); this.musicGain.connect(this.master);
    this.ambientGain = g(); this.ambientGain.connect(this.worldBus);
    this.sfxGain = g(); this.sfxGain.connect(this.worldBus);
    this.bodyGain = g(); this.bodyGain.connect(this.master);
    this.uiGain = g(); this.uiGain.connect(this.master);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(4.5, 2.6);
    this.reverbOut = g(0.55); this.reverb.connect(this.reverbOut); this.reverbOut.connect(this.musicGain);

    this.noise = this.makeNoise(3);
    this.applyVolumes();
    this.buildAmbient();
    this.buildMusic();
    // a mood chosen before the context existed was only remembered; apply it now
    const mood = this.mood; this.mood = null; this.setMood(mood);
  }

  applyVolumes() {
    if (!this.ctx) return;
    const s = this.settings, t = this.ctx.currentTime;
    const v = (k) => Math.pow(clamp(s.get(k) / 100, 0, 1), 1.6);
    this.master.gain.setTargetAtTime(v('masterVolume'), t, 0.05);
    this.musicGain.gain.setTargetAtTime(v('musicVolume') * 0.8, t, 0.05);
    this.ambientGain.gain.setTargetAtTime(v('ambientVolume'), t, 0.05);
    this.sfxGain.gain.setTargetAtTime(v('sfxVolume'), t, 0.05);
    this.bodyGain.gain.setTargetAtTime(v('sfxVolume'), t, 0.05);
    this.uiGain.gain.setTargetAtTime(v('sfxVolume') * 0.7, t, 0.05);
  }

  makeNoise(sec) {
    const len = this.ctx.sampleRate * sec, buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b = 0.985 * b + 0.015 * w * 6; d[i] = w * 0.35 + b * 0.65; }
    return buf;
  }
  makeImpulse(sec, decay) {
    const rate = this.ctx.sampleRate, len = rate * sec, buf = this.ctx.createBuffer(2, len, rate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }
  noiseSource(loop = false) {
    const s = this.ctx.createBufferSource(); s.buffer = this.noise; s.loop = loop;
    s.loopStart = 0; s.loopEnd = this.noise.duration;
    return s;
  }

  buildAmbient() {
    const ctx = this.ctx;
    // two wind layers with slowly wandering band-pass filters
    this.wind = [0, 1].map((i) => {
      const src = this.noiseSource(true);
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 300 + i * 500; bp.Q.value = 0.6 + i * 0.5;
      const gain = ctx.createGain(); gain.gain.value = 0;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.05 + i * 0.037;
      const lfoAmt = ctx.createGain(); lfoAmt.gain.value = 180 + i * 260;
      lfo.connect(lfoAmt); lfoAmt.connect(bp.frequency);
      src.connect(bp); bp.connect(gain); gain.connect(this.ambientGain);
      src.start(0, Math.random() * 2); lfo.start();
      return { gain, base: i === 0 ? 0.32 : 0.12 };
    });
    this.windLevel = 0;
  }

  setWind(level) {
    if (!this.ctx) return;
    this.windLevel = level;
    const k = level * (1 + (this.windBoost || 0) * 1.6);
    for (const w of this.wind) w.gain.gain.setTargetAtTime(w.base * k, this.ctx.currentTime, 1.5);
  }
  /** 0..1: how exposed the listener is (high on a giant) — the wind swells on top of the mood's level. */
  setWindBoost(b) {
    if (Math.abs(b - (this.windBoost || 0)) < 0.05) return;
    this.windBoost = b;
    this.setWind(this.windLevel);
  }

  buildMusic() {
    const ctx = this.ctx;
    this.padBus = ctx.createGain(); this.padBus.gain.value = 0;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 0.3;
    this.padFilter = lp;
    this.padBus.connect(lp); lp.connect(this.musicGain); lp.connect(this.reverb);
    // D – A – F – C (open, modal)
    this.padVoices = [73.42, 110, 174.61, 261.63, 146.83].map((f, i) => {
      const o = ctx.createOscillator(); o.type = i % 2 ? 'triangle' : 'sine'; o.frequency.value = f;
      o.detune.value = (i - 2) * 4;
      const vg = ctx.createGain(); vg.gain.value = 0.12 / (1 + i * 0.25);
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.03 + i * 0.011;
      const la = ctx.createGain(); la.gain.value = 0.05 / (1 + i * 0.25);
      lfo.connect(la); la.connect(vg.gain);
      o.connect(vg); vg.connect(this.padBus); o.start(); lfo.start();
      return { o, base: f };
    });
    this.pluckBus = ctx.createGain(); this.pluckBus.gain.value = 0;
    this.pluckBus.connect(this.musicGain); this.pluckBus.connect(this.reverb);
  }

  /** 'menu' | 'explore' | 'encounter' | 'ride' | 'silence' | 'credits' */
  setMood(mood) {
    if (!this.ctx || this.mood === mood) { this.mood = mood; return; }
    this.mood = mood;
    const t = this.ctx.currentTime;
    const cfg = {
      menu: { pad: 0.55, pluck: 0.5, cutoff: 1100, wind: 0.7, shift: 1 },
      credits: { pad: 0.6, pluck: 0.55, cutoff: 1300, wind: 0.4, shift: 1 },
      explore: { pad: 0.28, pluck: 0.18, cutoff: 800, wind: 1, shift: 1 },
      encounter: { pad: 0.6, pluck: 0.0, cutoff: 520, wind: 0.8, shift: 0.94387 },
      // on the giant: the pad opens and lifts a fourth, the plucks return as a quick rising figure
      ride: { pad: 0.7, pluck: 0.45, cutoff: 1500, wind: 1.1, shift: 1.33484 },
      silence: { pad: 0, pluck: 0, cutoff: 600, wind: 0.6, shift: 1 },
    }[mood] || { pad: 0, pluck: 0, cutoff: 600, wind: 0.5, shift: 1 };
    this.padBus.gain.setTargetAtTime(cfg.pad, t, 2.5);
    this.pluckBus.gain.setTargetAtTime(cfg.pluck, t, 2);
    this.padFilter.frequency.setTargetAtTime(cfg.cutoff, t, 2);
    for (const v of this.padVoices) v.o.frequency.setTargetAtTime(v.base * cfg.shift, t, 3);
    this.setWind(cfg.wind);
    this.baseCutoff = cfg.cutoff;
    this.setIntensity(this.intensity || 0, true);
  }

  /** 0..1 on top of the mood: a drone swells and the filter opens as the climber nears a mark. */
  setIntensity(k, force = false) {
    if (!this.ctx) return;
    k = clamp(k, 0, 1);
    if (!force && Math.abs(k - (this.intensity || 0)) < 0.03) return;
    this.intensity = k;
    const t = this.ctx.currentTime;
    if (!this.drone) {
      const g = this.ctx.createGain(); g.gain.value = 0; g.connect(this.musicGain); g.connect(this.reverb);
      const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900; f.Q.value = 4; f.connect(g);
      this.drone = { g, f, osc: [73.42, 110, 146.83].map((fr, i) => { const o = this.ctx.createOscillator(); o.type = i ? 'sawtooth' : 'triangle'; o.frequency.value = fr; o.detune.value = (i - 1) * 6; o.connect(f); o.start(); return o; }) };
    }
    const live = this.mood === 'ride' || this.mood === 'encounter';
    this.drone.g.gain.setTargetAtTime(live ? k * 0.07 : 0, t, 0.6);
    this.drone.f.frequency.setTargetAtTime(500 + k * 2200, t, 0.5);
    this.padFilter.frequency.setTargetAtTime((this.baseCutoff || 800) * (1 + k * 1.3), t, 0.8);
  }

  pluck(freq, when, vel = 0.2) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = freq;
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = freq * 2.001;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(vel, when + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 3.2);
    const g2 = ctx.createGain(); g2.gain.value = 0.25;
    o.connect(g); o2.connect(g2); g2.connect(g); g.connect(this.pluckBus);
    o.start(when); o2.start(when); o.stop(when + 3.3); o2.stop(when + 3.3);
  }

  tone(freq, dur, { type = 'sine', vol = 0.2, dest, attack = 0.005, when, glide } = {}) {
    const ctx = this.ctx; when = when ?? ctx.currentTime;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, when);
    if (glide) o.frequency.exponentialRampToValueAtTime(glide, when + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(vol, when + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    o.connect(g); g.connect(dest || this.out || this.sfxGain); o.start(when); o.stop(when + dur + 0.05);
  }
  noiseBurst(dur, { freq = 800, q = 1, vol = 0.3, type = 'bandpass', dest, attack = 0.005, when, sweep } = {}) {
    const ctx = this.ctx; when = when ?? ctx.currentTime;
    const s = this.noiseSource(); const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, when); f.Q.value = q;
    if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, when + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(vol, when + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    s.connect(f); f.connect(g); g.connect(dest || this.out || this.sfxGain);
    s.start(when, Math.random() * 2); s.stop(when + dur + 0.05);
  }

  /** A short voiced effort sound: buzz through a vowel formant, falling in pitch. */
  grunt(dur, f0, vol, fall = 0.7, when) {
    const ctx = this.ctx; when = when ?? ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f0, when); o.frequency.exponentialRampToValueAtTime(f0 * fall, when + dur);
    const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 620 + Math.random() * 120; f1.Q.value = 3;
    const f2 = ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 1150 + Math.random() * 200; f2.Q.value = 4;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(vol, when + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    o.connect(f1); o.connect(f2); f1.connect(g); f2.connect(g); g.connect(this.out || this.sfxGain);
    o.start(when); o.stop(when + dur + 0.05);
  }

  /** Where the ears are (the camera) and which way is right, for sounds played with a world position. */
  setListener(pos, right) { (this.ear ||= { x: 0, y: 0, z: 0, rx: 1, rz: 0 }); const e = this.ear; e.x = pos.x; e.y = pos.y; e.z = pos.z; e.rx = right.x; e.rz = right.z; }

  /** The slow dry complaint of something huge moving: a low buzz dragged through a narrow, wandering resonance. */
  creak(dur, f0, vol, when) {
    const ctx = this.ctx; when = when ?? ctx.currentTime;
    const o = ctx.createOscillator(), lf = ctx.createOscillator(), la = ctx.createGain(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = 'sawtooth'; o.frequency.setValueAtTime(f0, when); o.frequency.linearRampToValueAtTime(f0 * (1.25 + Math.random() * 0.4), when + dur);
    lf.frequency.value = 7 + Math.random() * 6; la.gain.value = f0 * 0.18; lf.connect(la); la.connect(o.frequency);
    f.type = 'bandpass'; f.Q.value = 7; f.frequency.setValueAtTime(380 + Math.random() * 200, when); f.frequency.linearRampToValueAtTime(700 + Math.random() * 500, when + dur);
    g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(vol, when + dur * 0.35); g.gain.linearRampToValueAtTime(0, when + dur);
    o.connect(f); f.connect(g); g.connect(this.out || this.sfxGain);
    o.start(when); lf.start(when); o.stop(when + dur + 0.05); lf.stop(when + dur + 0.05);
  }
  /** Loosened stones and grit skittering after a blow. */
  debris(n, span, vol, t) {
    for (let i = 0; i < n; i++) this.noiseBurst(0.05 + Math.random() * 0.1, { freq: 1300 + Math.random() * 2600, q: 2.5, vol: vol * (0.4 + Math.random() * 0.6), when: t + 0.1 + Math.random() * span });
  }

  /**
   * Named one-shot effects. opts.pos (a world point) places the sound: it fades with distance (opts.ref = the
   * distance at which it has dropped to half) and leans to the side it comes from.
   */
  play(name, opts = {}) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    this.out = null;
    if (opts.pos && this.ear) {
      const e = this.ear, dx = opts.pos.x - e.x, dy = opts.pos.y - e.y, dz = opts.pos.z - e.z, d = Math.hypot(dx, dy, dz), ref = opts.ref ?? 60;
      const g = this.ctx.createGain(), pan = this.ctx.createStereoPanner();
      g.gain.value = 1 / (1 + (d / ref) * (d / ref));
      pan.pan.value = Math.max(-0.75, Math.min(0.75, (dx * e.rx + dz * e.rz) / (d + 6)));
      g.connect(pan); pan.connect(this.sfxGain);
      this.out = g;
    }
    try { this.playRaw(name, opts); } finally { this.out = null; }
  }
  playRaw(name, opts) {
    const t = this.ctx.currentTime, ui = this.uiGain, v = opts.vol ?? 1;
    switch (name) {
      // ---- the weight of a giant. Every blow has a sub (felt), a body around 100 Hz (heard on any speaker),
      // the earth giving, a crack, and stones settling after.
      case 'giantStep':
        this.tone(44, 1.3, { vol: 0.5 * v, glide: 28, attack: 0.015 });
        this.tone(98, 0.5, { type: 'triangle', vol: 0.42 * v, glide: 52, attack: 0.008 });
        this.noiseBurst(0.7, { freq: 520, q: 0.5, vol: 0.34 * v, type: 'lowpass', sweep: 140, attack: 0.006 });
        this.tone(190, 0.22, { type: 'triangle', vol: 0.3 * v, glide: 96, attack: 0.004 });
        this.noiseBurst(0.38, { freq: 620, q: 0.6, vol: 0.5 * v, attack: 0.004 });
        this.noiseBurst(0.14, { freq: 1800, q: 0.7, vol: 0.3 * v, attack: 0.003 });
        this.debris(5, 0.6, 0.12 * v, t);
        this.noiseBurst(1.8, { freq: 190, q: 0.4, vol: 0.22 * v, type: 'lowpass', attack: 0.12, dest: this.reverb });
        break;
      case 'giantLift':   // a leg as tall as a tower leaving the ground: hide and sinew complain, air is pushed aside
        this.creak(1.3, 62, 0.14 * v); this.creak(0.9, 88, 0.08 * v, t + 0.5);
        this.noiseBurst(1.5, { freq: 240, q: 0.7, vol: 0.2 * v, sweep: 820, attack: 0.9 });
        break;
      case 'giantStomp':
        this.tone(36, 2.4, { vol: 0.75 * v, glide: 24, attack: 0.01 });
        this.tone(84, 0.9, { type: 'triangle', vol: 0.62 * v, glide: 40, attack: 0.006 });
        this.tone(168, 0.3, { type: 'triangle', vol: 0.25 * v, glide: 70, attack: 0.004 });
        this.noiseBurst(1.3, { freq: 950, q: 0.4, vol: 0.55 * v, type: 'lowpass', sweep: 120, attack: 0.004 });
        this.tone(230, 0.26, { type: 'sawtooth', vol: 0.2 * v, glide: 90, attack: 0.003 });
        this.noiseBurst(0.6, { freq: 700, q: 0.5, vol: 0.75 * v, attack: 0.003 });
        this.noiseBurst(0.14, { freq: 2600, q: 0.5, vol: 0.5 * v, type: 'highpass', attack: 0.002 });
        this.debris(12, 1.5, 0.18 * v, t);
        this.noiseBurst(3.2, { freq: 260, q: 0.4, vol: 0.3 * v, type: 'lowpass', attack: 0.2 });
        this.noiseBurst(3.4, { freq: 200, q: 0.4, vol: 0.4 * v, type: 'lowpass', attack: 0.1, dest: this.reverb });
        break;
      case 'giantCollapse':   // the whole body coming down
        this.playRaw('giantStomp', { vol: 1.25 * v });
        this.tone(52, 3.2, { vol: 0.5 * v, glide: 30, attack: 0.3, when: t + 0.15 });
        this.noiseBurst(4.5, { freq: 420, q: 0.4, vol: 0.34 * v, type: 'lowpass', attack: 0.5, sweep: 150 });
        this.debris(18, 3.5, 0.08 * v, t + 0.3);
        break;
      case 'giantCreak': this.creak(0.9 + Math.random() * 0.8, 55 + Math.random() * 30, 0.11 * v); break;
      case 'giantBreath':   // in through a chest the size of a hall, out as a long rough sigh
        this.noiseBurst(2.0, { freq: 380, q: 1.1, vol: 0.16 * v, sweep: 640, attack: 1.1 });
        this.noiseBurst(2.8, { freq: 520, q: 0.9, vol: 0.22 * v, sweep: 230, attack: 0.5, when: t + 2.3 });
        this.tone(64, 2.6, { type: 'triangle', vol: 0.05 * v, glide: 50, attack: 0.6, when: t + 2.3 });
        break;
      case 'giantSwing':   // a limb moving a great deal of air
        this.noiseBurst(0.9, { freq: 180, q: 0.8, vol: 0.2 * v, sweep: 620, attack: 0.4 }); break;
      case 'striderBreath':
        this.noiseBurst(0.9, { freq: 520, q: 1.0, vol: 0.11 * v, sweep: 820, attack: 0.5 });
        this.noiseBurst(1.1, { freq: 700, q: 0.8, vol: 0.17 * v, sweep: 300, attack: 0.15, when: t + 1.0 });
        break;
      case 'striderLand':   // the forehand coming back to earth
        this.tone(48, 1.2, { vol: 0.55 * v, glide: 30, attack: 0.01 });
        this.tone(105, 0.45, { type: 'triangle', vol: 0.45 * v, glide: 56, attack: 0.006 });
        this.noiseBurst(0.6, { freq: 700, q: 0.5, vol: 0.4 * v, type: 'lowpass', sweep: 160, attack: 0.004 });
        this.debris(6, 0.8, 0.06 * v, t);
        break;
      case 'uiMove': this.tone(1680, 0.06, { vol: 0.035, dest: ui }); break;
      case 'uiConfirm': this.tone(880, 0.35, { vol: 0.06, dest: ui }); this.tone(1320, 0.5, { vol: 0.04, dest: ui, when: t + 0.06 }); break;
      case 'uiBack': this.tone(660, 0.25, { vol: 0.05, dest: ui, glide: 520 }); break;
      case 'uiAdjust': this.tone(1240, 0.05, { vol: 0.03, dest: ui }); break;
      case 'uiError': this.tone(220, 0.2, { vol: 0.05, dest: ui, type: 'triangle' }); break;
      case 'save': [523.25, 659.25, 783.99].forEach((f, i) => this.tone(f, 1.6, { vol: 0.03, dest: ui, when: t + i * 0.12, attack: 0.05 })); break;
      case 'step': this.noiseBurst(0.09, { freq: 500 + Math.random() * 300, q: 0.8, vol: 0.05 * (opts.vol ?? 1) }); break;
      case 'land': this.noiseBurst(0.25, { freq: 300, q: 0.6, vol: 0.18 * (opts.vol ?? 1), type: 'lowpass' }); this.tone(70, 0.25, { vol: 0.15 * (opts.vol ?? 1) }); break;
      case 'jump': this.noiseBurst(0.12, { freq: 900, q: 0.6, vol: 0.05 }); break;
      case 'grip': this.noiseBurst(0.18, { freq: 1500, q: 0.7, vol: 0.08, sweep: 700 }); break;
      case 'climb': this.noiseBurst(0.12, { freq: 1200 + Math.random() * 500, q: 1, vol: 0.035 }); break;
      case 'impact':
        this.noiseBurst(0.5, { freq: 180, q: 0.5, vol: 0.45 * (opts.vol ?? 1), type: 'lowpass' });
        this.tone(55, 0.6, { vol: 0.4 * (opts.vol ?? 1), glide: 35 });
        this.tone(112, 0.35, { type: 'triangle', vol: 0.3 * v, glide: 60, attack: 0.006 });
        this.noiseBurst(0.4, { freq: 780, q: 0.5, vol: 0.28 * v, type: 'lowpass', sweep: 200, attack: 0.004 });
        this.debris(3, 0.5, 0.05 * v, t); break;
      // the wanderer's body: a voiced grunt (buzz through a vowel formant) over a breath of noise
      case 'hurt': this.grunt(0.22, 150 + Math.random() * 25, 0.07 * (opts.vol ?? 1)); this.noiseBurst(0.12, { freq: 260, q: 0.6, vol: 0.12 * (opts.vol ?? 1), type: 'lowpass' }); break;
      case 'hurtHeavy':
        this.grunt(0.42, 135 + Math.random() * 20, 0.1 * (opts.vol ?? 1), 0.62);
        this.noiseBurst(0.35, { freq: 140, q: 0.5, vol: 0.4 * (opts.vol ?? 1), type: 'lowpass' }); this.tone(48, 0.5, { vol: 0.35 * (opts.vol ?? 1), glide: 30 });
        this.tone(3900, 1.6, { vol: 0.012 * (opts.vol ?? 1), attack: 0.05, when: t + 0.05 }); break;   // the ears ring
      case 'bodyFall':
        this.noiseBurst(0.3, { freq: 220, q: 0.5, vol: 0.38 * (opts.vol ?? 1), type: 'lowpass' }); this.tone(62, 0.3, { vol: 0.25 * (opts.vol ?? 1), glide: 40 });
        this.noiseBurst(0.5, { freq: 1800, q: 0.5, vol: 0.05 * (opts.vol ?? 1), when: t + 0.06, sweep: 700 });             // grit and cloth
        this.grunt(0.3, 120, 0.05 * (opts.vol ?? 1), 0.7, t + 0.04); break;
      case 'getUp': this.noiseBurst(0.6, { freq: 1300, q: 0.6, vol: 0.05, sweep: 600, attack: 0.1 }); this.grunt(0.5, 128, 0.035, 0.85, t + 0.1); break;
      case 'gripStrain': this.grunt(0.35 + Math.random() * 0.2, 160 + Math.random() * 30, 0.045 * (opts.vol ?? 1), 0.9); this.noiseBurst(0.25, { freq: 2400, q: 0.8, vol: 0.03, sweep: 1500 }); break;
      case 'gripSlip': this.noiseBurst(0.35, { freq: 2600, q: 0.9, vol: 0.09, sweep: 900 }); this.grunt(0.25, 190, 0.06, 0.55); break;
      case 'colossusStep': this.playRaw('giantStep', opts); break;
      case 'colossusGroan': {
        const ctx = this.ctx, o = ctx.createOscillator(), lf = ctx.createOscillator(), la = ctx.createGain();
        const f = ctx.createBiquadFilter(), g = ctx.createGain();
        o.type = 'sawtooth'; o.frequency.setValueAtTime(62, t); o.frequency.linearRampToValueAtTime(48, t + 3.5);
        lf.frequency.value = 5.5; la.gain.value = 2.5; lf.connect(la); la.connect(o.frequency);
        f.type = 'lowpass'; f.frequency.setValueAtTime(240, t); f.frequency.linearRampToValueAtTime(480, t + 1.2); f.frequency.linearRampToValueAtTime(160, t + 3.6); f.Q.value = 4;
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.32 * (opts.vol ?? 1), t + 0.9); g.gain.linearRampToValueAtTime(0, t + 3.8);
        o.connect(f); f.connect(g); g.connect(this.out || this.sfxGain); g.connect(this.reverb);
        o.start(t); lf.start(t); o.stop(t + 4); lf.stop(t + 4);
        // the voice above the rumble: a second throat an octave up, and the breath that carries it
        this.tone(124, 3.4, { type: 'sawtooth', vol: 0.05 * v, glide: 92, attack: 0.9 });
        this.noiseBurst(3.4, { freq: 520, q: 1.2, vol: 0.09 * v, sweep: 300, attack: 0.9 });
        this.creak(1.6, 70, 0.05 * v, t + 0.2);
        break;
      }
      case 'hoof': // a hard, short clop: stone on turf
        this.tone(62, 0.35, { vol: 0.32 * (opts.vol ?? 1), glide: 44, attack: 0.005 });
        this.tone(128, 0.16, { type: 'triangle', vol: 0.26 * v, glide: 74, attack: 0.004 });
        this.noiseBurst(0.09, { freq: 900, q: 0.8, vol: 0.3 * v, attack: 0.002 });
        this.noiseBurst(0.05, { freq: 1900, q: 0.8, vol: 0.2 * v, attack: 0.002 });
        this.noiseBurst(0.22, { freq: 420, q: 0.7, vol: 0.22 * (opts.vol ?? 1), type: 'lowpass', attack: 0.005 }); break;
      case 'striderSnort': this.noiseBurst(0.7, { freq: 700, q: 0.5, vol: 0.32, sweep: 260, attack: 0.04 }); this.tone(92, 0.6, { vol: 0.12, glide: 70 }); break;
      case 'striderCall': { // a hollow bray, higher and rougher than the Warden's groan, falling away
        const ctx = this.ctx, o = ctx.createOscillator(), o2 = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
        o.type = 'sawtooth'; o2.type = 'square';
        o.frequency.setValueAtTime(150, t); o.frequency.linearRampToValueAtTime(170, t + 0.35); o.frequency.exponentialRampToValueAtTime(78, t + 2.4);
        o2.frequency.setValueAtTime(151.5, t); o2.frequency.linearRampToValueAtTime(171, t + 0.35); o2.frequency.exponentialRampToValueAtTime(79, t + 2.4);
        f.type = 'bandpass'; f.frequency.setValueAtTime(520, t); f.frequency.linearRampToValueAtTime(900, t + 0.4); f.frequency.linearRampToValueAtTime(300, t + 2.4); f.Q.value = 2.5;
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.22 * (opts.vol ?? 1), t + 0.25); g.gain.linearRampToValueAtTime(0, t + 2.6);
        o.connect(f); o2.connect(f); f.connect(g); g.connect(this.out || this.sfxGain); g.connect(this.reverb);
        o.start(t); o2.start(t); o.stop(t + 2.7); o2.stop(t + 2.7);
        break;
      }
      case 'shake': this.noiseBurst(1.4, { freq: 90, q: 0.3, vol: 0.4, type: 'lowpass', attack: 0.2 }); this.noiseBurst(1.5, { freq: 620, q: 0.6, vol: 0.2, sweep: 260, attack: 0.25 }); this.creak(1.2, 66, 0.1); this.creak(0.9, 90, 0.07, t + 0.7); break;
      case 'rumble': this.noiseBurst(2.5, { freq: 140, q: 0.3, vol: 0.4, type: 'lowpass', attack: 0.6 }); this.noiseBurst(2.6, { freq: 360, q: 0.5, vol: 0.2, attack: 0.6, sweep: 180 }); this.debris(8, 2.2, 0.06, t); break;
      case 'rockHit': this.noiseBurst(0.6, { freq: 400, q: 0.4, vol: 0.4, type: 'lowpass' }); this.tone(80, 0.4, { vol: 0.25, glide: 50 }); this.noiseBurst(0.14, { freq: 1700, q: 0.6, vol: 0.24, attack: 0.002 }); this.debris(5, 0.9, 0.07, t); break;
      case 'strikeWindup': // cloth & breath as the arm draws back
        this.noiseBurst(0.28, { freq: 900, q: 0.8, vol: 0.09, attack: 0.12 }); break;
      case 'strikeCharge': // a rising hum in the blade
        this.tone(220, 1.1, { vol: 0.035, type: 'triangle', glide: 440, attack: 0.5 });
        this.tone(330, 1.1, { vol: 0.02, glide: 660, attack: 0.7 }); break;
      case 'strikeWhiff': this.noiseBurst(0.2, { freq: 1400, q: 0.7, vol: 0.1 }); break;
      case 'strikePull': // the blade grinds back out of the stone
        this.noiseBurst(0.35, { freq: 1800, q: 3, vol: 0.06, attack: 0.05 }); this.tone(1400, 0.3, { vol: 0.02, glide: 900 }); break;
      case 'strike':
      case 'strikeHeavy': {
        const h = name === 'strikeHeavy' ? 1.5 : 1;
        this.noiseBurst(0.12, { freq: 3000, q: 1.2, vol: 0.18 * h });                     // bite of the edge
        this.noiseBurst(0.5, { freq: 260, q: 0.6, vol: 0.32 * h, type: 'lowpass' });     // crunch of stone
        this.tone(68, 0.7 * h, { vol: 0.34 * h, glide: 38 });                             // body thud
        this.tone(1900, 1.1, { vol: 0.06, type: 'triangle', glide: 1700, when: t + 0.04 }); // sigil ring
        this.tone(2870, 0.8, { vol: 0.035, when: t + 0.04 });
        if (h > 1) this.tone(98, 1.6, { vol: 0.12, glide: 55, when: t + 0.05 });
        break;
      }
      case 'sigil': this.tone(392, 4, { vol: 0.08, attack: 0.8 }); this.tone(587.33, 4, { vol: 0.05, attack: 1.2 }); break;
      case 'whisper':
        this.noiseBurst(1.6, { freq: 2600, q: 3, vol: 0.05, attack: 0.4, dest: ui });
        this.tone(293.66, 2.6, { vol: 0.035, attack: 0.6, dest: ui }); break;
      case 'checkpoint': [293.66, 440, 587.33].forEach((f, i) => this.tone(f, 3, { vol: 0.05, dest: ui, when: t + i * 0.25, attack: 0.3 })); break;
      case 'death': this.tone(110, 5, { vol: 0.12, attack: 1, glide: 82 }); this.tone(164.8, 5, { vol: 0.07, attack: 1.4, glide: 123 }); break;
    }
  }

  /** After a heavy blow the world goes dull for a moment (ears ringing): extra muffle that fades. */
  ring(k = 1) { this.ringK = Math.max(this.ringK || 0, k); }
  /** Body state feeds heartbeat / breathing / muffling. condition 0..1, exertion 0..1 */
  setBody(condition, exertion, muffle) { this.condition = condition; this.exertion = exertion; this.muffle = muffle; }
  setBodyActive(on) { this.bodyActive = on; }

  update(dt) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    // muffle the world when near death
    this.ringK = Math.max(0, (this.ringK || 0) - dt * 0.45);
    const cutoff = 20000 * Math.pow(1 - clamp(Math.max(this.muffle, this.ringK * 0.75), 0, 1) * 0.97, 3) + 250;
    this.muffleFilter.frequency.setTargetAtTime(cutoff, t, this.ringK > 0.5 ? 0.04 : 0.25);

    // generative plucks
    if (this.pluckBus.gain.value > 0.01 && t >= this.nextNote) {
      const scale = [293.66, 349.23, 392, 440, 523.25, 587.33, 698.46];
      const pattern = [0, 4, 2, 5, 1, 4, 3, 6];
      const i = pattern[this.noteIndex++ % pattern.length];
      this.pluck(scale[i] * (Math.random() < 0.25 ? 0.5 : 1), t + 0.02, 0.06 + Math.random() * 0.05);
      const urgent = this.mood === 'ride' ? 0.35 + 0.65 * (1 - (this.intensity || 0)) : 1;
      if (this.mood === 'ride') this.pluck(scale[(i + 2) % scale.length] * 2, t + 0.14, 0.03 + (this.intensity || 0) * 0.04);
      this.nextNote = t + (1.6 + Math.random() * 2.6) * urgent;
    }

    if (!this.bodyActive) return;
    const c = this.condition;
    // heartbeat audible from "critical" onward
    const hbLevel = clamp((c - 0.4) / 0.45, 0, 1);
    if (hbLevel > 0.02 && t >= this.nextBeat) {
      const bpm = 64 + hbLevel * 70;
      const v = 0.25 + hbLevel * 0.55;
      this.tone(52, 0.18, { vol: v, dest: this.bodyGain, attack: 0.01 });
      this.tone(47, 0.2, { vol: v * 0.7, dest: this.bodyGain, attack: 0.01, when: t + 0.22 });
      this.nextBeat = t + 60 / bpm;
    }
    // breathing: heavier with injury and exertion; becomes weak near death
    const breathLevel = clamp(Math.max((c - 0.18) * 1.4, this.exertion * 0.7), 0, 1);
    if (breathLevel > 0.05 && t >= this.nextBreath) {
      const weak = clamp((c - 0.8) / 0.2, 0, 1);
      const rate = 0.32 + breathLevel * 0.45 - weak * 0.25;
      const dur = 1 / rate;
      const v = (0.05 + breathLevel * 0.12) * (1 - weak * 0.55);
      this.noiseBurst(dur * 0.38, { freq: 1100, q: 0.8, vol: v, attack: dur * 0.2, dest: this.bodyGain });
      this.noiseBurst(dur * 0.45, { freq: 700, q: 0.7, vol: v * 1.1, attack: 0.05, dest: this.bodyGain, when: t + dur * 0.45 });
      this.nextBreath = t + dur;
    }
  }

  suspendWorld(on) {
    // used on pause: soften world, keep UI
    if (!this.ctx) return;
    this.worldBus.gain.setTargetAtTime(on ? 0.25 : 1, this.ctx.currentTime, 0.2);
    this.bodyGain.gain.setTargetAtTime(on ? 0 : Math.pow(this.settings.get('sfxVolume') / 100, 1.6), this.ctx.currentTime, 0.2);
  }
}

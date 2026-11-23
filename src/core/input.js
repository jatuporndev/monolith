import { clamp } from './util.js';

const PAD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
const PAD_ACTIONS = { jump: [PAD.A], interact: [PAD.X], grip: [PAD.RT, PAD.RB], sprint: [PAD.B, PAD.L3] };

export const KEY_LABELS = {
  Space: 'Space', ShiftLeft: 'Left Shift', ShiftRight: 'Right Shift', ControlLeft: 'Left Ctrl', ControlRight: 'Right Ctrl',
  AltLeft: 'Left Alt', AltRight: 'Right Alt', Mouse0: 'Left Mouse', Mouse1: 'Middle Mouse', Mouse2: 'Right Mouse',
  Mouse3: 'Mouse 4', Mouse4: 'Mouse 5', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Enter: 'Enter', Tab: 'Tab', CapsLock: 'Caps Lock', Backquote: 'Tilde',
};
export function keyLabel(code) {
  if (!code) return '—';
  if (KEY_LABELS[code]) return KEY_LABELS[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  return code;
}
export const PAD_LABELS = { jump: 'A', interact: 'X', grip: 'RT', sprint: 'B', confirm: 'A', back: 'B', pause: 'Start', tabs: 'LB / RB', delete: 'X' };

/**
 * Unified keyboard / mouse / gamepad input.
 * - Gameplay reads actions each frame (held / wasPressed / move / look).
 * - UI receives semantic navigation events on the bus (`ui:input`).
 */
export class Input {
  constructor(bus, settings, canvas) {
    this.bus = bus; this.settings = settings; this.canvas = canvas;
    this.keys = new Set(); this.pressedQueue = new Set(); this.pressed = new Set();
    this.mouseDX = 0; this.mouseDY = 0;
    this.mode = 'ui';             // 'ui' | 'game'
    this.device = 'kbm';
    this.padPrev = []; this.padRepeat = {}; this.pad = null; this.padAxes = null;
    this.capture = null;
    this.locked = false;

    addEventListener('keydown', (e) => this.onKey(e, true));
    addEventListener('keyup', (e) => this.onKey(e, false));
    addEventListener('mousedown', (e) => this.onMouse(e, true));
    addEventListener('mouseup', (e) => this.onMouse(e, false));
    addEventListener('mousemove', (e) => {
      if (this.locked) { this.mouseDX += e.movementX; this.mouseDY += e.movementY; }
      if (Math.abs(e.movementX) + Math.abs(e.movementY) > 2) this.setDevice('kbm');
    });
    addEventListener('blur', () => { this.keys.clear(); });
    addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      this.bus.emit('input:pointerlock', this.locked);
    });
  }

  setMode(mode) {
    this.mode = mode;
    this.keys.clear();
    this.mouseDX = this.mouseDY = 0;
    if (mode === 'game') this.lockPointer(); else this.unlockPointer();
  }
  lockPointer() {
    if (document.pointerLockElement !== this.canvas) {
      try { const p = this.canvas.requestPointerLock?.(); p?.catch?.(() => {}); } catch { /* needs a gesture */ }
    }
  }
  unlockPointer() { if (document.pointerLockElement) document.exitPointerLock?.(); }

  setDevice(d) {
    if (this.device === d) return;
    this.device = d;
    this.bus.emit('input:device', this.promptDevice());
  }
  /** Which glyph set prompts should use, honouring the user setting. */
  promptDevice() {
    const pref = this.settings.get('inputDevice');
    return pref === 'auto' ? this.device : pref;
  }

  /** Capture the next key / mouse button for rebinding. cb(code|null) — null means cancelled. */
  captureNext(cb) { this.capture = cb; this.captureStarted = performance.now(); }

  onKey(e, down) {
    const code = e.code;
    if (down) this.setDevice('kbm');
    if (this.capture && down) {
      e.preventDefault();
      const cb = this.capture; this.capture = null;
      cb(code === 'Escape' ? null : code);
      return;
    }
    if (down) {
      if (!e.repeat) { this.keys.add(code); this.pressedQueue.add(code); }
    } else this.keys.delete(code);

    if (!down) return;
    if (code === 'Tab' || code === 'Space' || code.startsWith('Arrow') || code === 'Backspace') e.preventDefault();
    if (this.mode === 'ui') {
      const map = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right' };
      if (map[code]) this.ui({ type: 'nav', dir: map[code], repeat: e.repeat });
      else if ((code === 'Enter' || code === 'Space' || code === 'NumpadEnter') && !e.repeat) this.ui({ type: 'confirm' });
      else if ((code === 'Escape' || code === 'Backspace') && !e.repeat) this.ui({ type: 'back' });
      else if (code === 'KeyQ' && !e.repeat) this.ui({ type: 'tab', dir: -1 });
      else if (code === 'KeyE' && !e.repeat) this.ui({ type: 'tab', dir: 1 });
      else if ((code === 'Delete' || code === 'KeyX') && !e.repeat) this.ui({ type: 'secondary' });
      if (!e.repeat) this.ui({ type: 'any', code });
    } else if (code === 'Escape' || code === 'KeyP') {
      if (!e.repeat) this.bus.emit('game:pauseRequest');
    }
  }
  onMouse(e, down) {
    const code = 'Mouse' + e.button;
    this.setDevice('kbm');
    if (this.capture && down) {
      // ignore the click that started the capture
      if (performance.now() - (this.captureStarted || 0) < 250) return;
      e.preventDefault();
      const cb = this.capture; this.capture = null; cb(code); return;
    }
    if (down) {
      if (this.mode === 'game' && !this.locked) { this.lockPointer(); return; }
      this.keys.add(code); this.pressedQueue.add(code);
    } else this.keys.delete(code);
  }

  ui(evt) { this.bus.emit('ui:input', evt); }

  /** Call once per frame before gameplay reads input. */
  update(dt) {
    this.pressed = this.pressedQueue; this.pressedQueue = new Set();
    this.pollPad(dt);
  }
  consumeMouse() { const d = [this.mouseDX, this.mouseDY]; this.mouseDX = 0; this.mouseDY = 0; return d; }

  pollPad(dt) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad = null;
    for (const p of pads) if (p && p.connected) { pad = p; break; }
    this.pad = pad;
    if (!pad) { this.padAxes = null; return; }
    const btn = pad.buttons.map((b) => b.pressed || b.value > 0.5);
    const prev = this.padPrev;
    const edge = (i) => btn[i] && !prev[i];
    const dz = this.settings.get('stickDeadzone') / 100;
    const ax = (i) => { const v = pad.axes[i] || 0; return Math.abs(v) < dz ? 0 : (v - Math.sign(v) * dz) / (1 - dz); };
    this.padAxes = { lx: ax(0), ly: ax(1), rx: ax(2), ry: ax(3) };
    const anyEdge = btn.some((b, i) => b && !prev[i]);
    const a = this.padAxes;
    if (anyEdge || Math.abs(a.lx) + Math.abs(a.ly) + Math.abs(a.rx) + Math.abs(a.ry) > 0.3) this.setDevice('pad');

    if (this.capture && anyEdge) { const cb = this.capture; this.capture = null; cb(null); }
    else if (this.mode === 'ui') {
      const dirs = {
        up: btn[PAD.UP] || a.ly < -0.6, down: btn[PAD.DOWN] || a.ly > 0.6,
        left: btn[PAD.LEFT] || a.lx < -0.6, right: btn[PAD.RIGHT] || a.lx > 0.6,
      };
      for (const [dir, on] of Object.entries(dirs)) {
        const r = this.padRepeat[dir] ?? -1;
        if (on) {
          if (r < 0) { this.ui({ type: 'nav', dir }); this.padRepeat[dir] = 0.42; }
          else { this.padRepeat[dir] = r - dt; if (this.padRepeat[dir] <= 0) { this.ui({ type: 'nav', dir, repeat: true }); this.padRepeat[dir] = 0.09; } }
        } else this.padRepeat[dir] = -1;
      }
      if (edge(PAD.A)) this.ui({ type: 'confirm' });
      if (edge(PAD.B)) this.ui({ type: 'back' });
      if (edge(PAD.START)) this.ui({ type: 'start' });
      if (edge(PAD.LB)) this.ui({ type: 'tab', dir: -1 });
      if (edge(PAD.RB)) this.ui({ type: 'tab', dir: 1 });
      if (edge(PAD.X)) this.ui({ type: 'secondary' });
      if (anyEdge) this.ui({ type: 'any', code: 'Pad' });
    } else {
      if (edge(PAD.START)) this.bus.emit('game:pauseRequest');
      for (const [action, ids] of Object.entries(PAD_ACTIONS)) if (ids.some(edge)) this.pressed.add('pad:' + action);
    }
    this.padPrev = btn;
  }

  // ---- gameplay queries -------------------------------------------------
  held(action) {
    if (this.mode !== 'game' || this.frozen) return false;
    const code = this.settings.get('bindings')[action];
    if (code && this.keys.has(code)) return true;
    const ids = PAD_ACTIONS[action];
    return !!(ids && this.pad && ids.some((i) => this.pad.buttons[i]?.pressed || this.pad.buttons[i]?.value > 0.5));
  }
  wasPressed(action) {
    if (this.mode !== 'game' || this.frozen) return false;
    const code = this.settings.get('bindings')[action];
    return !!((code && this.pressed.has(code)) || this.pressed.has('pad:' + action));
  }
  /** Movement vector in [-1,1]² (x right, y forward). */
  move() {
    if (this.mode !== 'game' || this.frozen) return { x: 0, y: 0 };
    const b = this.settings.get('bindings');
    let x = (this.keys.has(b.right) ? 1 : 0) - (this.keys.has(b.left) ? 1 : 0);
    let y = (this.keys.has(b.forward) ? 1 : 0) - (this.keys.has(b.back) ? 1 : 0);
    if (this.padAxes) { x += this.padAxes.lx; y -= this.padAxes.ly; }
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    return { x: clamp(x, -1, 1), y: clamp(y, -1, 1) };
  }
  /** Camera look delta (radians) for this frame. */
  look(dt) {
    const [dx, dy] = this.consumeMouse();
    if (this.mode !== 'game' || this.frozen) return { yaw: 0, pitch: 0 };
    const ms = 0.0006 + (this.settings.get('mouseSensitivity') / 100) * 0.0045;
    let yaw = -dx * ms, pitch = -dy * ms;
    if (this.padAxes) {
      const cs = 1.2 + (this.settings.get('cameraSensitivity') / 100) * 4.2;
      const curve = (v) => Math.sign(v) * v * v;
      yaw -= curve(this.padAxes.rx) * cs * dt;
      pitch -= curve(this.padAxes.ry) * cs * dt;
    }
    if (this.settings.get('invertX')) yaw = -yaw;
    if (this.settings.get('invertY')) pitch = -pitch;
    return { yaw, pitch };
  }
  rumble(strength = 0.5, ms = 200) {
    if (!this.settings.get('vibration') || !this.pad?.vibrationActuator) return;
    try { this.pad.vibrationActuator.playEffect('dual-rumble', { duration: ms, strongMagnitude: strength, weakMagnitude: strength * 0.6 }); } catch { /* unsupported */ }
  }
}

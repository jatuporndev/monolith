import { describe, it, expect } from 'vitest';
import { Health } from '../src/game/health.js';
import { Settings, DEFAULT_BINDINGS } from '../src/core/settings.js';
import { SaveSystem } from '../src/core/save.js';
import { EventBus } from '../src/core/events.js';

const memStore = () => { const m = new Map(); return { get: (k, f) => (m.has(k) ? structuredClone(m.get(k)) : f), set: (k, v) => m.set(k, structuredClone(v)), remove: (k) => m.delete(k) }; };
const step = (h, sec, dt = 1 / 60) => { for (let t = 0; t < sec; t += dt) h.update(dt); };

describe('Health', () => {
  it('starts healthy', () => { const h = new Health(); expect(h.stage).toBe('healthy'); expect(h.condition).toBe(0); });
  it('accumulates damage within the combo window', () => {
    const a = new Health(); a.damage(10); step(a, 1); const d2 = a.damage(10);
    const b = new Health(); b.damage(10); step(b, 8); const d3 = b.damage(10);
    expect(d2).toBeGreaterThan(d3);
  });
  it('progresses through stages and dies', () => {
    const h = new Health();
    h.damage(30); expect(h.stage).toBe('injured');
    h.damage(20); expect(['critical', 'nearDeath']).toContain(h.stage);
    h.damage(40); expect(h.dead).toBe(true); expect(h.stage).toBe('dead');
  });
  it('recovers gradually after a delay, never instantly', () => {
    const h = new Health(); h.damage(50); const hp0 = h.hp;
    step(h, 5); expect(h.hp).toBe(hp0);              // still inside delay
    step(h, 1.5); expect(h.hp).toBeGreaterThan(hp0); expect(h.hp).toBeLessThan(hp0 + 5);
    step(h, 30); expect(h.hp).toBe(100); expect(h.stage).toBe('healthy');
  });
  it('dead does not recover', () => { const h = new Health(); h.kill(); step(h, 30); expect(h.hp).toBe(0); });
  it('impairs movement and stamina regen as condition worsens', () => {
    const h = new Health(); h.damage(85); step(h, 4);
    expect(h.moveFactor).toBeLessThan(0.8); expect(h.staminaRegenFactor).toBeLessThan(1);
  });
});

describe('Settings', () => {
  it('applies quality presets and flips to custom on manual change', () => {
    const s = new Settings(new EventBus(), memStore());
    s.set('quality', 'low'); expect(s.get('shadows')).toBe('off');
    s.set('shadows', 'high'); expect(s.get('quality')).toBe('custom');
  });
  it('swaps clashing key bindings', () => {
    const s = new Settings(new EventBus(), memStore());
    s.setBinding('jump', 'KeyW');
    expect(s.get('bindings').jump).toBe('KeyW');
    expect(s.get('bindings').forward).toBe(DEFAULT_BINDINGS.jump);
  });
  it('persists', () => {
    const st = memStore(); new Settings(null, st).set('masterVolume', 12);
    expect(new Settings(null, st).get('masterVolume')).toBe(12);
  });
});

describe('SaveSystem', () => {
  it('writes, lists, finds latest and removes', async () => {
    const st = memStore(); const s = new SaveSystem(new EventBus(), st);
    expect(s.hasAny()).toBe(false);
    s.write(0, { chapter: 0, playtime: 10 });
    await new Promise((r) => setTimeout(r, 5));
    s.write(2, { chapter: 1, playtime: 50, completed: [0] });
    expect(s.latest().slot).toBe(2);
    expect(s.profile.unlocked).toContain(1);
    expect(s.profile.completed).toContain(0);
    expect(s.firstEmptySlot()).toBe(1);
    s.remove(2); expect(s.read(2)).toBe(null);
  });
});

import { clamp, damp } from '../core/util.js';

/**
 * Invisible health. Never rendered as a number or bar — consumers read `condition`
 * (0 healthy … 1 dead) and the derived stage to drive post-fx, audio and movement.
 */
export const STAGES = ['healthy', 'injured', 'critical', 'nearDeath', 'dead'];

export const HEALTH_TUNING = {
  max: 100,
  comboWindow: 6,      // seconds: hits inside this window accumulate
  comboStep: 0.3,      // each consecutive hit inside the window deals +30%
  comboMax: 2.2,
  recoveryDelay: 6,    // seconds without damage before recovery begins
  recoveryRamp: 5,     // seconds for recovery to reach full rate
  recoveryRate: 7,     // hp/second at full rate
  thresholds: { injured: 72, critical: 45, nearDeath: 20 },
};

export class Health {
  constructor(tuning = HEALTH_TUNING) {
    this.t = tuning;
    this.reset();
  }
  reset() {
    this.hp = this.t.max;
    this.sinceHit = Infinity;
    this.combo = 0;
    this.dead = false;
    this.smoothed = 0;     // eased condition for visuals so nothing pops
    this.hitPulse = 0;     // short impulse after each hit (0..1)
  }
  /** @returns {number} actual damage applied */
  damage(amount, source = 'generic') {
    if (this.dead || amount <= 0) return 0;
    this.combo = this.sinceHit < this.t.comboWindow ? this.combo + 1 : 0;
    const mult = Math.min(1 + this.combo * this.t.comboStep, this.t.comboMax);
    const applied = amount * mult;
    this.hp = clamp(this.hp - applied, 0, this.t.max);
    this.sinceHit = 0;
    this.hitPulse = clamp(0.35 + applied / 40, 0, 1);
    this.lastSource = source;
    if (this.hp <= 0) this.dead = true;
    return applied;
  }
  kill(source = 'generic') { this.damage(this.t.max * 10, source); }
  update(dt) {
    this.sinceHit += dt;
    this.hitPulse = Math.max(0, this.hitPulse - dt * 1.6);
    if (!this.dead && this.sinceHit > this.t.recoveryDelay && this.hp < this.t.max) {
      const ramp = clamp((this.sinceHit - this.t.recoveryDelay) / this.t.recoveryRamp, 0, 1);
      this.hp = Math.min(this.t.max, this.hp + this.t.recoveryRate * ramp * ramp * dt);
    }
    this.smoothed = damp(this.smoothed, this.condition, 2.2, dt);
  }
  /** 0 = untouched, 1 = dead */
  get condition() { return 1 - this.hp / this.t.max; }
  get stage() {
    if (this.dead) return 'dead';
    const th = this.t.thresholds;
    if (this.hp <= th.nearDeath) return 'nearDeath';
    if (this.hp <= th.critical) return 'critical';
    if (this.hp <= th.injured) return 'injured';
    return 'healthy';
  }
  get recovering() { return !this.dead && this.sinceHit > this.t.recoveryDelay && this.hp < this.t.max; }
  /** Movement speed multiplier (1 healthy → 0.55 near death). */
  get moveFactor() { return 1 - 0.5 * Math.pow(clamp(this.smoothed, 0, 1), 1.4); }
  /** Stamina regeneration multiplier. */
  get staminaRegenFactor() { return 1 - 0.65 * clamp((this.smoothed - 0.25) / 0.6, 0, 1); }
}

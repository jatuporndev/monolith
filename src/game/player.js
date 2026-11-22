import * as THREE from 'three';
import { clamp, damp, lerp } from '../core/util.js';
import { Health } from './health.js';
import { closestClimbable, attachmentWorld, bestClimbStep } from './climb.js';
import { buildCharacter } from './character/build.js';
import { Animator } from './character/animator.js';

const UP = new THREE.Vector3(0, 1, 0);
const tmpP = new THREE.Vector3(), tmpN = new THREE.Vector3(), tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpC = new THREE.Vector3();

/** Stab timing (seconds). Hold Interact during the wind-up to charge a heavier blow. */
export const STRIKE = { windup: 0.24, chargeTime: 1.0, thrust: 0.075, embed: 0.32, recover: 0.38, chargeDrain: 9 };

export const PLAYER_TUNING = {
  walk: 4.4, sprint: 7.6, accel: 10, airControl: 2.2, gravity: 22, jump: 7.4,
  radius: 0.36, height: 1.75,
  climbSpeed: 1.45, reach: 1.15,
  staminaMax: 100, drainHang: 2.2, drainMove: 2.75, drainShakeMult: 3.2, lungeCost: 14,
  leapCharge: 0.5, leapMin: 3.3, leapMax: 6.4, leapChargeDrain: 5,
  regenGround: 30, regenRest: 6, airReach: 1.5,
  safeFall: 8, fallDamagePerM: 8.5, stumbleFall: 4.2,
};

export class Player {
  constructor(world, bus, audio) {
    this.world = world; this.bus = bus; this.audio = audio;
    this.t = PLAYER_TUNING;
    this.health = new Health();
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3();
    this.yaw = Math.PI; this.state = 'ground';
    this.stamina = this.t.staminaMax;
    this.att = null; this.gripCooldown = 0; this.peakY = 0;
    this.anim = { phase: 0, speed: 0, climbMove: 0, death: 0, breath: 0, hunch: 0, land: 0 };
    this.prompt = null; this.nearWeak = null; this.immune = 0; this.stepTimer = 0;
    this.exertion = 0;
    this.strike = { phase: 'none', t: 0, charge: 0, wp: null };
    this.leap = { phase: 'none', t: 0, charge: 0, v: 0, dir: new THREE.Vector3(), from: null, air: 0 };
    this.buildModel();
  }

  // ---------------------------------------------------------------- model
  /** Skinned, rigged character (see character/build.js); all motion comes from character/animator.js. */
  buildModel() {
    const m = this.model = buildCharacter();
    this.root = m.root; this.blade = m.blade; this.bladeGlow = m.bladeGlow;
    this.rig = new Animator(m, this.world);
    this.rig.onStep = (vol, moving) => { if (this.state === 'ground') this.audio.play('step', { vol: moving ? vol : vol * 0.5 }); };
  }

  // ---------------------------------------------------------------- lifecycle
  spawn(pos, yaw) {
    this.pos.copy(pos); this.vel.set(0, 0, 0); this.yaw = yaw;
    this.state = 'ground'; this.att = null; this.stamina = this.t.staminaMax;
    this.health.reset(); this.peakY = pos.y; this.immune = 1.0; this.thrown = this.tumble = false;
    this.recover = null; this.stagger = null; this.knock = null; this.cancelStrike?.(); this.leap.phase = 'none';
    this.rig.reset(pos, yaw);
    this.syncModel(0);
  }

  get gripping() { return this.state === 'climb'; }
  get onColossus() { return this.state === 'climb' && !this.att?.obj.userData.climb.static; }

  /**
   * A blow lands. How hard it was (tier 0 light … 3 critical) and where it came from decide the body's answer:
   * a flinch, a stumble that takes the legs for a moment, or a knockdown that throws the body and makes it
   * get up again. On a giant a hand slips but the grip holds unless the blow is crushing.
   */
  damage(amount, source, push) {
    if (this.immune > 0 || this.state === 'dead' || this.state === 'cinematic') return 0;
    const applied = this.health.damage(amount, source);
    let tier = applied >= 36 ? 3 : applied >= 20 ? 2 : applied >= 9.5 ? 1 : 0;
    if (tier >= 1 && tier < 3 && this.health.hp < 22) tier++;            // a body already near its end goes down easier
    const dir = new THREE.Vector3();
    if (push) dir.set(push.x, 0, push.z);
    if (dir.lengthSq() < 1e-4) dir.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); // unseen source: struck from the front
    dir.normalize();
    const hit = { tier, dir, source, amount: applied, force: push ? push.length() : 0 };
    if (this.state === 'climb') {
      if (push && amount >= 30) { this.release(true); this.vel.copy(push); this.state = 'air'; this.peakY = this.pos.y; this.knock = hit; this.faceHit(hit); }
      this.rig.onHit(hit, this.state === 'climb');
    } else if (source !== 'fall') {
      const knock = tier >= 2 || (source === 'shockwave' && applied >= 12);
      this.stagger = null;
      if (knock) {
        this.knock = hit; this.recover = null; this.faceHit(hit);
        if (push) { this.vel.copy(push).multiplyScalar(tier >= 3 ? 1.12 : 1); if (this.vel.y < 2.5) this.vel.y = 2.5; this.state = 'air'; this.peakY = this.pos.y; }
        else this.knockDown(hit);
      } else {
        // flinch or stumble: the legs are taken for a moment and the push carries the body
        this.stagger = { t: 0, dur: tier ? 0.62 : 0.24, tier };
        if (push) { this.vel.x += push.x * (tier ? 0.75 : 0.35); this.vel.z += push.z * (tier ? 0.75 : 0.35); }
      }
      this.rig.onHit(hit, false);
    }
    if (source !== 'fall') this.audio.play(tier >= 2 ? 'hurtHeavy' : 'hurt', { vol: 0.6 + tier * 0.2 });
    this.bus.emit('player:hit', { amount: applied, source, condition: this.health.condition, tier, dir });
    if (this.health.dead) this.die(source);
    return applied;
  }
  /** Fall away from the blow: face its source (fall on the back), or away from it when struck from behind (fall forward). */
  faceHit(hit) {
    hit.prone = hit.dir.x * Math.sin(this.yaw) + hit.dir.z * Math.cos(this.yaw) > 0.35;
    this.yaw = hit.prone ? Math.atan2(hit.dir.x, hit.dir.z) : Math.atan2(-hit.dir.x, -hit.dir.z);
  }
  /** Down on the ground: lie there a moment (longer the harder the blow), then get up in stages. */
  knockDown(hit, fall = 0) {
    const crit = hit.tier >= 3 || fall > 14;
    const lie = crit ? 1.25 : hit.tier >= 2 ? 0.7 : 0.4, up = crit ? 1.75 : 1.35;
    this.recover = { t: 0, kind: 'knock', lie, up, dur: lie + up, prone: !!hit.prone, sev: crit ? 1 : 0.6, hold: 1 };
    this.knock = null; this.stagger = null;
    this.vel.x *= 0.2; this.vel.z *= 0.2;
    this.audio.play('bodyFall', { vol: crit ? 1.2 : 0.9 });
    this.bus.emit('player:knockdown', { pos: this.pos.clone(), tier: hit.tier, crit });
    this.rig.onKnock(this.recover);
  }

  die(source) {
    if (this.state === 'dead') return;
    this.release();
    this.state = 'dead';
    this.bus.emit('player:died', { source });
  }

  release(fromShake = false, stepOff = false) {
    if (this.state !== 'climb') return;
    const vel = new THREE.Vector3();
    if (this.att) {
      // inherit the surface velocity so falls from a moving colossus feel physical
      const n = new THREE.Vector3(); const p = new THREE.Vector3();
      attachmentWorld(this.att, p, n);
      if (this.lastAttWorld) vel.copy(p).sub(this.lastAttWorld).divideScalar(Math.max(this.lastDt || 0.016, 0.008));
      vel.clampLength(0, 14);
      vel.addScaledVector(n, fromShake ? 4 : 1.2);
      if (n.y > 0.7 && !this.att.obj.userData.climb.static) {
        // off the top of a giant: tumble over its side, clear of the body, never straight down through it.
        // The fur is narrower than the stone under it, so the roll has to carry well past the patch's rim.
        const h = this.att.obj.userData.climb.half, l = this.att.local;
        const dx = h.x - Math.abs(l.x), dz = h.z - Math.abs(l.z);
        const out = dx < dz * 1.6 ? new THREE.Vector3(Math.sign(l.x) || (Math.random() < 0.5 ? -1 : 1), 0, 0) : new THREE.Vector3(0, 0, Math.sign(l.z) || 1);
        out.transformDirection(this.att.obj.matrixWorld).setY(0).normalize();
        const along = vel.dot(out);
        vel.addScaledVector(out, Math.max(0, 5.2 - along));
        vel.y = Math.max(vel.y, 2.6);
        this.tumble = true;
      }
    }
    this.att = null; this.state = 'air'; this.vel.copy(vel); this.peakY = this.pos.y; this.leap.phase = 'none';
    this.gripCooldown = 0.35;
    this.rig.onRelease(fromShake || this.tumble || this.stamina <= 0);
    this.bus.emit('player:release');
  }

  /**
   * Flung off a warden (its mark just broke and it rears). Nothing can be caught on the way down:
   * hands find no hold until the feet find the ground, and the landing is broken by the tumble.
   */
  throwOff(out) {
    if (this.state !== 'climb') return;
    this.thrown = true;
    this.release(true);
    this.vel.set(out.x * 6.5, 6, out.z * 6.5);
    this.rig.onRelease(true);
  }

  // ---------------------------------------------------------------- update
  update(dt, input, camYaw, colossus) {
    this.lastDt = dt;
    this.health.update(dt);
    this.immune = Math.max(0, this.immune - dt);
    this.gripCooldown = Math.max(0, this.gripCooldown - dt);
    this.prompt = null; this.nearWeak = null;
    if (this.state === 'dead' || this.state === 'cinematic') { this.syncModel(dt); return; }

    const climbables = colossus ? this.world.climbables.concat(colossus.climbables) : this.world.climbables;
    // planted while stabbing: the climber braces instead of shuffling
    const mv = this.strike.phase !== 'none' ? new THREE.Vector2() : input.move();
    const moveFactor = this.health.moveFactor;
    const gripHeld = input.held('grip');

    if (this.state === 'climb') this.updateClimb(dt, input, mv, camYaw, climbables, colossus, gripHeld, moveFactor);
    else this.updateMove(dt, input, mv, camYaw, climbables, colossus, gripHeld, moveFactor);
    if (this.state !== 'climb' && this.strike.phase !== 'none') this.cancelStrike();

    // exertion for breathing audio
    const exert = this.state === 'climb' ? 0.4 + (1 - this.stamina / 100) * 0.6 : (this.anim.speed > 6 ? 0.5 : 0);
    this.exertion = damp(this.exertion, exert, 1.2, dt);
    this.syncModel(dt);
  }

  updateMove(dt, input, mv, camYaw, climbables, colossus, gripHeld, moveFactor) {
    const t = this.t;
    const fwd = tmpA.set(-Math.sin(camYaw), 0, -Math.cos(camYaw));
    const right = tmpB.set(Math.cos(camYaw), 0, -Math.sin(camYaw));
    const wish = tmpC.set(0, 0, 0).addScaledVector(fwd, mv.y).addScaledVector(right, mv.x);
    const mag = this.wishMag = Math.min(1, wish.length());
    // after a heavy landing the body has to gather itself before it can move again
    let ctrl = 1, slide = 1;
    if (this.recover) {
      const r = this.recover; r.t += dt;
      if (r.kind === 'knock') { ctrl = clamp((r.t - r.lie - r.up * 0.62) / (r.up * 0.38), 0, 1); if (r.t > r.lie + r.up * 0.3 && !r.said) { r.said = true; this.audio.play('getUp'); } }
      else ctrl = clamp((r.t / r.dur - r.hold * 0.8) / (1 - r.hold * 0.8), 0, 1);
      if (r.t >= r.dur) this.recover = null;
    }
    if (this.stagger) { const s = this.stagger; s.t += dt; const u = s.t / s.dur; ctrl = Math.min(ctrl, 0.15 + 0.85 * u * u); slide = 0.3 + 0.7 * u; if (u >= 1) this.stagger = null; }
    this.ctrl = ctrl;
    const sprint = input.held('sprint') && this.state === 'ground' && ctrl >= 1;
    const speed = (sprint ? t.sprint : t.walk) * moveFactor * mag * ctrl;
    if (mag > 0.05) wish.normalize();
    const grounded = this.state === 'ground';
    const accel = (grounded ? (mag > 0.05 ? t.accel * 0.8 : t.accel * 1.15) : t.airControl) * slide * (this.recover?.kind === 'knock' ? 0.6 : 1);
    const lp = this.leap; lp.air = grounded ? 0 : Math.max(0, lp.air - dt);
    if (lp.air <= 0) { // a leap through the air keeps its own momentum
      this.vel.x = damp(this.vel.x, wish.x * speed, accel, dt);
      this.vel.z = damp(this.vel.z, wish.z * speed, accel, dt);
    }
    if (mag > 0.05 && grounded && ctrl > 0.3) {
      const target = Math.atan2(wish.x, wish.z);
      let d = target - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      // quick to answer from a standstill, a wider arc at a run
      const hsNow = Math.hypot(this.vel.x, this.vel.z);
      this.yaw += d * (1 - Math.exp(-dt * (13 - Math.min(5, hsNow * 0.75))));
    }
    if (grounded && ctrl > 0.6 && input.wasPressed('jump')) {
      this.vel.y = t.jump * (0.75 + 0.25 * moveFactor); this.state = 'air'; this.peakY = this.pos.y;
      this.audio.play('jump');
    }
    // stamina recovers on the ground
    if (grounded) this.stamina = Math.min(t.staminaMax, this.stamina + t.regenGround * this.health.staminaRegenFactor * dt);

    this.vel.y -= t.gravity * dt;
    this.pos.addScaledVector(this.vel, dt);
    this.world.resolveCollisions(this.pos, t.radius, t.height);
    if (colossus) colossus.pushOut(this.pos, t.radius);

    if (this.state === 'air' && colossus && this.vel.y < 0 && !this.thrown && this.landOnGiant(colossus, dt)) return;
    const gy = this.world.groundAt(this.pos.x, this.pos.z, this.pos.y);
    if (this.state === 'air') {
      this.peakY = Math.max(this.peakY, this.pos.y);
      if (this.pos.y <= gy && this.vel.y <= 0) this.land(gy);
    } else {
      if (this.pos.y - gy > 0.45) { this.state = 'air'; this.peakY = this.pos.y; }
      else { this.pos.y = gy; this.vel.y = 0; }
    }
    this.anim.speed = Math.hypot(this.vel.x, this.vel.z);

    // grip: grab any climbable surface within reach
    const chest = tmpP.copy(this.pos).add(new THREE.Vector3(0, 1.3, 0));
    const near = closestClimbable(lp.air > 0 && lp.from ? climbables.filter((o) => o !== lp.from) : climbables, chest, 2.4);
    if (near && this.gripCooldown <= 0 && !this.thrown && !this.knock && ctrl > 0.8) {
      const dy = near.world.y - this.pos.y;
      const falling = this.state === 'air' && lp.air <= 0;
      const reachable = lp.air > 0 ? near.dist < t.reach * 1.25 && dy > -0.4 && dy < 2.8
        : falling ? near.dist < t.airReach && dy > -0.3 && dy < 2.6
        : near.dist < t.reach && dy > 0.2 && dy < 2.5;
      if (reachable && gripHeld && this.stamina > 5) {
        // snatching a hold on the way down: the faster the fall, the harder the arms are wrenched
        const speed = falling ? -this.vel.y : 0, cost = Math.max(0, speed - 3) * 2.6;
        if (cost > 0 && this.stamina - cost < 2) {
          // too fast to hold: the fingers close on the coat and are torn open (heard and seen), keep trying lower down
          this.stamina = Math.max(0, this.stamina - 6); this.gripCooldown = 0.18; this.vel.y *= 0.85;
          this.audio.play('gripSlip'); this.bus.emit('player:gripSlip', { hand: 0 });
        } else {
          this.stamina -= cost; this.attach(near);
          if (falling) { this.rig.onCatch(clamp(speed / 10, 0.35, 1)); if (speed > 6) this.audio.play('gripStrain'); }
        }
      }
      // only promise a grab that holding Grab will actually make (one more half-step at most)
      else if (near.dist < t.reach + 0.15 && dy > 0.2 && dy < 2.5 && this.state === 'ground') this.prompt = { action: 'grip', label: 'Grab' };
    }
    // world interactables
    if (this.state === 'ground' && !this.prompt) {
      let best = null, bd = Infinity;
      for (const it of this.world.interactables) {
        const d = it.pos.distanceTo(tmpA.copy(this.pos).setY(it.pos.y));
        if (d < it.radius && Math.abs(it.pos.y - this.pos.y) < 3 && d < bd) { best = it; bd = d; }
      }
      if (best) {
        this.prompt = { action: 'interact', label: best.label, target: best };
        if (input.wasPressed('interact')) this.bus.emit('world:interact', best);
      }
    }
  }

  /**
   * Falling onto a broad top of a giant (a shelf, the shoulders, a crown): the feet find it and the body stays
   * there, crouched, instead of passing through. A long drop still hurts.
   */
  landOnGiant(colossus, dt) {
    const v = this._lv || (this._lv = new THREE.Vector3()), q = this._lq || (this._lq = new THREE.Vector3());
    for (const obj of colossus.climbables) {
      const c = obj.userData.climb; if (!c || c.disabled || c.static) continue;
      obj.updateMatrixWorld();
      // its top must face the sky
      q.set(0, 1, 0).transformDirection(obj.matrixWorld); if (q.y < 0.75) continue;
      const h = c.half;
      obj.worldToLocal(v.copy(this.pos));
      if (Math.abs(v.x) > h.x - 0.05 || Math.abs(v.z) > h.z - 0.05 || v.y > h.y + 0.02) continue;
      obj.worldToLocal(q.copy(this.pos).addScaledVector(this.vel, -dt));
      if (q.y < h.y - 0.05 || v.y < h.y - 0.6) continue;                 // came down onto it from above this frame
      const top = v.set(v.x, h.y, v.z), world = obj.localToWorld(top.clone());
      const fall = this.peakY - world.y;
      this.state = 'climb'; this.att = { obj, local: top.clone(), normalLocal: new THREE.Vector3(0, 1, 0) };
      this.vel.set(0, 0, 0); this.lastAttWorld = world; this.leap.phase = 'none'; this.leap.air = 0;
      this.rig.onCatch(clamp(fall / 6, 0.4, 1));
      this.audio.play('land', { vol: clamp(fall / 8, 0.25, 1.2) });
      if (fall > this.t.safeFall) this.damage((fall - this.t.safeFall) * this.t.fallDamagePerM, 'fall');
      this.knock = null;
      this.bus.emit('player:landed', { fall, onGiant: true });
      return true;
    }
    return false;
  }

  land(gy) {
    // a tumble off a giant is a roll, not a drop: it spends part of the height
    const rolled = this.thrown || this.tumble;
    const fall = (this.peakY - gy) * (rolled ? 0.7 : 1);
    this.thrown = false; this.tumble = false;
    this.pos.y = gy; this.vel.y = 0; this.state = 'ground';
    this.rig.onLand(fall);
    const knock = this.knock;
    // knocked flying, or a fall so hard the legs fold: the body goes down and has to get up again
    if (knock || fall > this.t.safeFall + 3.5) {
      this.knockDown(knock || { tier: fall > 14 ? 3 : 2, prone: false, dir: new THREE.Vector3() }, fall);
      this.bus.emit('camera:shake', { amount: clamp(fall / 16, 0.3, 0.9), duration: 0.4 });
    } else if (fall > this.t.stumbleFall) { const hard = fall > this.t.safeFall; this.recover = { t: 0, dur: hard ? 1.7 : 0.75, hold: hard ? 0.45 : 0.3, sev: hard ? 1 : 0 }; this.vel.x *= 0.35; this.vel.z *= 0.35; }
    this.audio.play('land', { vol: clamp(fall / 8, 0.25, 1.2) });
    if (fall > this.t.safeFall) {
      const dmg = (fall - this.t.safeFall) * this.t.fallDamagePerM;
      this.damage(dmg, 'fall');
      this.bus.emit('camera:shake', { amount: clamp(fall / 20, 0.2, 1), duration: 0.4 });
    }
    this.bus.emit('player:landed', { fall });
  }

  attach(near) {
    this.state = 'climb';
    this.att = { obj: near.obj, local: near.local.clone(), normalLocal: near.normalLocal.clone() };
    this.vel.set(0, 0, 0);
    this.lastAttWorld = near.world.clone();
    this.audio.play('grip');
    this.bus.emit('player:grip', { colossus: !near.obj.userData.climb.static });
  }

  updateClimb(dt, input, mv, camYaw, climbables, colossus, gripHeld, moveFactor) {
    const t = this.t;
    const alive = !!(this.att && this.att.obj.parent && !this.att.obj.userData.climb.disabled);
    const P = new THREE.Vector3(), N = new THREE.Vector3();
    if (alive) attachmentWorld(this.att, P, N);
    const isStatic = alive && !!this.att.obj.userData.climb.static;
    const shaking = alive && colossus && !isStatic ? colossus.shakeIntensity : 0;
    // on the broad top of the giant (shoulders, crown) the climber can let go and stay crouched there;
    // only a shake demands a grip again. Stepping past the rim is how one drops off on purpose.
    const standing = alive && !gripHeld && !isStatic && N.y > 0.7 && shaking < 0.3;
    if ((!gripHeld && !standing) || this.stamina <= 0 || !alive) {
      if (this.stamina <= 0) this.bus.emit('player:gripLost');
      this.release();
      return;
    }
    this.shakeAmt = shaking; this.climbMoving = false; this.handsFree = standing;
    // tangent frame
    let up, right;
    if (Math.abs(N.y) < 0.7) {
      up = UP.clone().addScaledVector(N, -N.y).normalize();
      right = new THREE.Vector3().crossVectors(N.clone().negate(), up).normalize();
    } else {
      up = new THREE.Vector3(-Math.sin(camYaw), 0, -Math.cos(camYaw)).addScaledVector(N, 0).normalize();
      up.addScaledVector(N, -up.dot(N)).normalize();
      right = new THREE.Vector3().crossVectors(up, N).normalize();
    }
    // holding a ridden warden by the horns: sideways input turns the beast instead of moving the climber
    if (colossus?.reins && Math.abs(mv.x) > 0.1 && colossus.reins(this.att, mv)) mv = new THREE.Vector2(0, Math.abs(mv.y) > 0.5 ? mv.y : 0);
    let moving = Math.hypot(mv.x, mv.y) > 0.1;
    let step = t.climbSpeed * moveFactor * (shaking > 0.3 ? 0.25 : 1) * dt;
    // leap: hold Jump to coil against the surface, release to spring along it.
    // The longer the hold, the further the leap; past the edge of a hold the body really leaves the surface.
    const lp = this.leap; let leaping = false;
    if (lp.phase === 'none' && input.wasPressed('jump') && this.stamina > t.lungeCost * 0.5 && shaking < 0.3 && this.strike.phase === 'none') { lp.phase = 'charge'; lp.t = 0; lp.charge = 0; lp.dir.copy(up); lp.aimT = 1; }
    if (lp.phase === 'charge') {
      lp.t += dt; lp.charge = Math.min(1, lp.t / t.leapCharge);
      // the stick aims the leap; letting go of it a moment before the button still counts
      if (moving) { lp.dir.set(0, 0, 0).addScaledVector(right, mv.x).addScaledVector(up, mv.y).normalize(); lp.aimT = 0; }
      else { lp.aimT = (lp.aimT || 0) + dt; if (lp.aimT > 0.18) lp.dir.copy(up); }
      this.stamina -= t.leapChargeDrain * dt; moving = false;
      if (!input.held('jump') || lp.t > 1.5 || this.stamina < 6 || shaking > 0.5) {
        lp.phase = 'fly'; lp.t = 0;
        lp.v = lerp(t.leapMin, t.leapMax, lp.charge) * (0.6 + 0.4 * moveFactor) * (1 - 0.18 * Math.abs(lp.dir.dot(right)));
        this.stamina -= t.lungeCost * (0.45 + 0.55 * lp.charge);
        this.audio.play('jump'); this.rig.onLeap(lp.charge);
      }
    }
    if (lp.phase === 'fly') { leaping = true; moving = true; lp.t += dt; step = lp.v * dt; }
    if (moving) {
      const dir = leaping ? lp.dir.clone() : new THREE.Vector3().addScaledVector(right, mv.x).addScaledVector(up, mv.y).normalize();
      let blocked = false; const P0 = P.clone();
      // sub-step so lunges and fast moves still follow the surface around edges
      const steps = Math.max(1, Math.ceil(step / 0.15));
      for (let i = 0; i < steps; i++) {
        attachmentWorld(this.att, P, N);
        const cand = P.clone().addScaledVector(dir, step / steps);
        const best = bestClimbStep(climbables, cand, P, dir, 0.75);
        if (!best) { blocked = true; break; }
        // mantle onto the top of static walls when pushing up past their top edge
        const sc = this.att.obj.userData.climb;
        if (sc.static && (leaping ? dir.y > 0.5 : mv.y > 0.3) && Math.abs(N.y) < 0.5 && this.att.local.y >= sc.half.y - 0.08) {
          const top = P.clone().addScaledVector(N, -0.9); top.y += 0.6;
          const gy = this.world.groundAt(top.x, top.z, P.y + 0.6);
          if (gy > P.y - 0.5) { lp.phase = 'none'; this.mantle(new THREE.Vector3(P.x, gy, P.z), N); return; }
        }
        this.att = { obj: best.obj, local: best.local.clone(), normalLocal: best.normalLocal.clone() };
        // re-project the direction onto the new face
        dir.addScaledVector(best.normal, -dir.dot(best.normal)).normalize();
      }
      if (standing && !leaping) { // hands free on top: walking past the rim steps off it
        attachmentWorld(this.att, P, N);
        // only at the true rim: a hole in the coat (around a sigil) stops the feet, it is not an edge to fall from
        const h = this.att.obj.userData.climb.half, l = this.att.local;
        const atRim = Math.abs(l.x) > h.x - 0.3 || Math.abs(l.z) > h.z - 0.3;
        if (atRim && (blocked || P.distanceTo(P0) < step * 0.35)) { this.release(false, true); this.vel.addScaledVector(dir, 1.5); this.vel.y = Math.min(this.vel.y, 1.2); this.gripCooldown = 0.3; return; }
      }
      this.climbMoving = true; (this.climbDir || (this.climbDir = new THREE.Vector3())).copy(dir);
      this.climbRate = t.climbSpeed * moveFactor * (shaking > 0.3 ? 0.25 : 1);
      if (leaping) {
        lp.dir.copy(dir);
        attachmentWorld(this.att, P, N);
        if (P.distanceTo(P0) < step * 0.35) blocked = true; // pinned at the rim of the hold
        // gravity and the drag of the surface bleed the leap off; upward leaps die quickest
        lp.v -= Math.max(5, 8.5 + 7.8 * dir.y) * dt;
        // ran out of surface while still travelling: a true jump through the air — but only toward something
        // that can be caught, so a leap never throws the climber off into nothing
        if (blocked && lp.v > 2.4 && Math.abs(N.y) < 0.7) {
          const from = this.att.obj, v0 = dir.clone().multiplyScalar(lp.v).addScaledVector(N, 0.6);
          const others = climbables.filter((o) => o !== from), probe = new THREE.Vector3();
          let hit = null, tt = 0;
          for (let k = 2; k <= 8 && !hit; k++) { tt = k * 0.1; probe.copy(P).addScaledVector(v0, tt); probe.y -= 0.5 * t.gravity * tt * tt; hit = closestClimbable(others, probe, 1.1); }
          if (hit) {
            // aim the jump so the chest arrives within reach of that hold (a small correction to the natural arc)
            const aim = hit.world.clone().addScaledVector(hit.normal, 0.45), chest = this.pos.clone(); chest.y += 1.3;
            const v = aim.sub(chest).divideScalar(tt); v.y += 0.5 * t.gravity * tt;
            if (v.length() < lp.v * 1.5 + 3.5) {
              this.release();
              this.vel.copy(v); this.gripCooldown = Math.max(0.08, tt - 0.12); lp.from = from; lp.air = tt + 0.5;
              this.rig.onLeapAir();
              return;
            }
          }
        }
        if (blocked || lp.v <= 0.7) { lp.phase = 'none'; this.audio.play('grip'); this.rig.onCatch(clamp(lp.t * 2.2, 0.3, 1)); }
      }
      if (!leaping && Math.random() < dt * 3) this.audio.play('climb');
    }
    attachmentWorld(this.att, P, N);
    // stamina
    const resting = N.y > 0.7 && !moving && shaking < 0.1;
    if (resting) this.stamina = Math.min(t.staminaMax, this.stamina + t.regenRest * this.health.staminaRegenFactor * dt);
    else this.stamina -= (t.drainHang + (moving ? t.drainMove : 0)) * (1 + shaking * (t.drainShakeMult - 1)) * dt;
    this.stamina = clamp(this.stamina, 0, t.staminaMax);
    // holding on through a thrash: effort sounds; once the arms are failing, hands start tearing loose one at a
    // time (heard and seen) before the grip finally goes — the fall never comes without warning
    if (shaking > 0.2) {
      this.strainT = (this.strainT ?? 0.3) - dt;
      if (this.strainT <= 0) { this.strainT = 1.0 + Math.random() * 0.9 - shaking * 0.3; this.audio.play('gripStrain', { vol: 0.5 + shaking * 0.6 }); }
      if (shaking > 0.6 && this.stamina < 40) {
        this.slipT = (this.slipT ?? 0) - dt;
        if (this.slipT <= 0) {
          this.slipT = 0.6 + (this.stamina / 40) * 1.0;
          this.slipHand = 1 - (this.slipHand || 0);
          this.rig.slip[this.slipHand] = Math.max(this.rig.slip[this.slipHand], 0.4 + (1 - this.stamina / 40) * 0.3);
          this.audio.play('gripSlip'); this.bus.emit('player:gripSlip', { stamina: this.stamina });
        }
      }
    } else { this.strainT = 0.3; this.slipT = 0; }

    // body placement relative to the grip point
    const vertical = 1 - clamp(N.y, 0, 1);
    this.pos.copy(P).addScaledVector(N, 0.32 * vertical + 0.02).add(new THREE.Vector3(0, -1.28 * vertical, 0));
    if (vertical > 0.5) this.yaw = Math.atan2(-N.x, -N.z);
    else if (moving) this.yaw = Math.atan2(up.x * mv.y + right.x * mv.x, up.z * mv.y + right.z * mv.x);
    this.climbNormal = N.clone();
    this.lastAttWorld = P.clone();

    // prompts: weak points while gripping the colossus
    if (colossus && !isStatic) {
      const wp = colossus.weakPointNear(P, 2.6);
      if (wp) {
        this.nearWeak = wp;
        this.prompt = { action: 'interact', label: 'Strike' };
        if (input.wasPressed('interact') && this.strike.phase === 'none' && lp.phase === 'none' && shaking < 0.4) this.beginStrike(wp);
      }
    }
    if (this.strike.phase !== 'none') { this.updateStrike(dt, input, colossus); this.prompt = this.strike.phase === 'charge' ? { action: 'interact', label: 'Strike', hold: true } : null; }
    if (lp.phase === 'charge') this.prompt = null;
    else if (!this.prompt && this.strike.phase === 'none' && !standing) this.prompt = { action: 'grip', label: 'Release', hold: true };
  }

  // ---------------------------------------------------------------- stab
  beginStrike(wp) {
    Object.assign(this.strike, { phase: 'windup', t: 0, charge: 0, wp, aim: -1.6 });
    this.aimAt(wp);
    this.audio.play('strikeWindup');
  }
  /** windup → (charge while held) → thrust → impact → embed → recover */
  updateStrike(dt, input, colossus) {
    const st = this.strike, S = STRIKE;
    st.t += dt;
    if (st.phase === 'windup' && st.t >= S.windup) {
      st.t = 0;
      if (input.held('interact')) { st.phase = 'charge'; this.audio.play('strikeCharge'); } else st.phase = 'thrust';
    } else if (st.phase === 'charge') {
      st.charge = Math.min(1, st.charge + dt / S.chargeTime);
      this.aimAt(st.wp);
      this.stamina = Math.max(6, this.stamina - S.chargeDrain * dt);
      if (!input.held('interact') || this.stamina <= 8) { st.phase = 'thrust'; st.t = 0; this.audio.stop?.('strikeCharge'); }
    } else if (st.phase === 'thrust' && st.t >= S.thrust) {
      st.phase = 'embed'; st.t = 0;
      const power = st.charge >= 0.95 ? 2 : 1;
      const wp = st.wp && !st.wp.destroyed && colossus?.weakPointNear(this.lastAttWorld || this.pos, 3.2) === st.wp ? st.wp : null;
      const at = new THREE.Vector3(); this.blade.getWorldPosition(at);
      if (wp) colossus.strike(wp, power);
      else this.audio.play('strikeWhiff');
      this.bus.emit('player:strikeImpact', { hit: !!wp, power, charge: st.charge, pos: wp ? wp.mesh.getWorldPosition(new THREE.Vector3()) : at });
    } else if (st.phase === 'embed' && st.t >= S.embed) {
      st.phase = 'recover'; st.t = 0;
      if (st.wp) this.audio.play('strikePull');
    } else if (st.phase === 'recover' && st.t >= S.recover) {
      st.phase = 'none'; st.t = 0; st.charge = 0; st.wp = null;
    }
  }
  /** Upper-arm angle that points the blade at the sigil (shoulder → mark). */
  aimAt(wp) {
    if (!wp) return;
    const m = wp.mesh.getWorldPosition(new THREE.Vector3());
    const dy = m.y - (this.pos.y + 1.45);
    this.strike.aim = clamp(-(Math.PI / 2 + Math.atan2(dy, 0.75)), -2.75, -0.9);
  }
  cancelStrike() { Object.assign(this.strike, { phase: 'none', t: 0, charge: 0, wp: null }); this.audio.stop?.('strikeCharge'); }
  /** Pose blend for the right arm & torso: returns {w, arm, elbow, twist, lean, shake}. */
  strikePose() {
    const st = this.strike, S = STRIKE;
    const ease = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
    // raised: blade drawn back over the shoulder; driven: arm locked straight into the surface
    const RAISED = { arm: -3.05, elbow: -1.55, twist: -0.45, lean: -0.12 };
    const DRIVEN = { arm: st.aim ?? -1.45, elbow: -0.05, twist: 0.3, lean: 0.22 };
    const mix = (a, b, k) => ({ arm: a.arm + (b.arm - a.arm) * k, elbow: a.elbow + (b.elbow - a.elbow) * k, twist: a.twist + (b.twist - a.twist) * k, lean: a.lean + (b.lean - a.lean) * k });
    switch (st.phase) {
      case 'windup': return { w: ease(st.t / S.windup), ...RAISED, shake: 0 };
      case 'charge': { const c = st.charge; return { w: 1, ...mix(RAISED, { arm: -3.25, elbow: -1.8, twist: -0.6, lean: -0.2 }, ease(c)), shake: c }; }
      case 'thrust': return { w: 1, ...mix(RAISED, DRIVEN, Math.pow(Math.min(1, st.t / S.thrust), 0.6)), shake: 0 };
      case 'embed': { const push = Math.sin(Math.min(1, st.t / S.embed) * Math.PI) * 0.12; return { w: 1, ...DRIVEN, lean: DRIVEN.lean + push, shake: 0 }; }
      case 'recover': return { w: 1 - ease(st.t / S.recover), ...DRIVEN, shake: 0 };
      default: return null;
    }
  }

  mantle(topPoint, prevN) {
    this.att = null; this.state = 'ground';
    this.pos.copy(topPoint).addScaledVector(new THREE.Vector3(-prevN.x, 0, -prevN.z).normalize(), 0.9);
    this.pos.y = this.world.groundAt(this.pos.x, this.pos.z, topPoint.y + 0.2);
    this.vel.set(0, 0, 0); this.peakY = this.pos.y; this.gripCooldown = 0.6;
    this.rig.onMantle(); this.recover = { t: 0, dur: 0.6, hold: 0.3, sev: 0 };
    this.audio.play('land', { vol: 0.4 });
    this.bus.emit('player:mantle');
  }

  // ---------------------------------------------------------------- animation
  syncModel(dt) {
    this.rig.update(dt, this);
    const charging = this.state === 'climb' && this.strike.phase === 'charge';
    this.bladeGlow.emissiveIntensity = charging ? 0.15 + this.strike.charge * 1.4 : Math.max(0, this.bladeGlow.emissiveIntensity - 0.05);
  }
}

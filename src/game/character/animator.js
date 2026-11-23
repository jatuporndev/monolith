import * as THREE from 'three';
import { clamp, damp, lerp, smoothstep as ss } from '../../core/util.js';
import { DIM } from './build.js';
import { Cloth } from './cloth.js';

/**
 * Procedural animation for the wanderer.
 *
 *   state poses (ground / air / climb / death)  →  weighted blend  →  FK on the skeleton
 *   →  two-bone IK for feet (locked to the ground) and hands (locked to holds)
 *   →  secondary motion (springs, cloak, scarf, hair)
 *
 * Bone rotations are Euler angles in a shared reference frame: limbs hang down −Y,
 * −x swings a limb forward, +x bends a knee, −x bends an elbow, +x pitches the trunk forward.
 */
const TAU = Math.PI * 2, UP = new THREE.Vector3(0, 1, 0);
const LH = 0, RH = 1, LF = 2, RF = 3;
const V = () => new THREE.Vector3(), Q = () => new THREE.Quaternion();
const t1 = V(), t2 = V(), t3 = V(), t4 = V(), t5 = V();
const A = V(), D = V(), BEND = V(), KD = V(), K = V(), LD = V(), X = V(), Y = V(), Z = V();
const QP = Q(), QU = Q(), QL = Q(), QT = Q(), qa = Q();
const M4 = new THREE.Matrix4(), INV = new THREE.Matrix4(), EUL = new THREE.Euler();
const ease = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };

// get-up keys (bone → [x, y, z]; hp = hip offset). Supine: on the back, knees drawn; prone: face down.
const SUP_LIE = { hp: [0, -0.8, -0.2], b: {
  hips: [-1.42, 0, 0.06], spine: [0.08, 0, 0.02], chest: [0.12, 0, 0], neck: [0.3, 0, 0], head: [0.22, 0.15, 0],
  upperArmL: [0.2, 0, 0.75], foreArmL: [-0.55, 0, 0], handL: [0, 0, 0], upperArmR: [-0.3, 0, -0.6], foreArmR: [-0.7, 0, 0], handR: [0, 0, 0],
  thighL: [-0.55, 0, 0.12], shinL: [0.95, 0, 0], footL: [0.35, 0, 0], thighR: [-0.15, 0, -0.1], shinR: [0.3, 0, 0], footR: [0.5, 0, 0] } };
const SUP_SIT = { hp: [0, -0.74, -0.1], b: {
  hips: [-0.55, 0, 0], spine: [0.35, 0, 0], chest: [0.28, 0, 0], neck: [0.1, 0, 0], head: [-0.05, 0, 0],
  upperArmL: [0.75, 0, 0.3], foreArmL: [-0.15, 0, 0], handL: [-0.6, 0, 0], upperArmR: [0.75, 0, -0.3], foreArmR: [-0.15, 0, 0], handR: [-0.6, 0, 0],
  thighL: [-1.35, 0, 0.12], shinL: [1.75, 0, 0], footL: [0.3, 0, 0], thighR: [-0.95, 0, -0.18], shinR: [1.2, 0, 0], footR: [0.4, 0, 0] } };
const KNEEL = { hp: [0, -0.5, 0.02], b: {
  hips: [0.12, 0.15, 0], spine: [0.38, 0, 0], chest: [0.22, 0, 0], neck: [-0.05, 0, 0], head: [-0.2, 0, 0],
  upperArmL: [-0.65, 0, 0.2], foreArmL: [-0.85, 0, 0], handL: [0.3, 0, 0], upperArmR: [-0.25, 0, -0.35], foreArmR: [-0.25, 0, 0], handR: [0.3, 0, 0],
  thighL: [-1.5, 0, 0.1], shinL: [1.55, 0, 0], footL: [-0.05, 0, 0], thighR: [0.3, 0, -0.08], shinR: [1.85, 0, 0], footR: [0.65, 0, 0] } };
const RISE = { hp: [0, -0.16, 0], b: {
  hips: [0.3, 0.05, 0], spine: [0.3, 0, 0], chest: [0.16, 0, 0], neck: [-0.05, 0, 0], head: [-0.18, 0, 0],
  upperArmL: [-0.4, 0, 0.2], foreArmL: [-0.6, 0, 0], handL: [0.1, 0, 0], upperArmR: [-0.1, 0, -0.25], foreArmR: [-0.4, 0, 0], handR: [0.1, 0, 0],
  thighL: [-0.75, 0, 0.08], shinL: [0.85, 0, 0], footL: [0.1, 0, 0], thighR: [-0.2, 0, -0.08], shinR: [0.6, 0, 0], footR: [0.25, 0, 0] } };
const PRO_LIE = { hp: [0, -0.82, 0.22], b: {
  hips: [1.45, 0, 0.05], spine: [0.04, 0, 0.05], chest: [0.06, 0.1, 0.04], neck: [-0.2, 0.45, 0], head: [-0.15, 0.65, 0.1],
  upperArmL: [-2.3, 0, 0.6], foreArmL: [-1.1, 0, 0], handL: [0, 0, 0], upperArmR: [-0.5, 0, -0.5], foreArmR: [-0.9, 0, 0], handR: [0, 0, 0],
  thighL: [0.05, 0, 0.14], shinL: [0.2, 0, 0], footL: [0.9, 0, 0], thighR: [-0.4, 0, -0.25], shinR: [0.9, 0, 0], footR: [0.9, 0, 0] } };
const PRO_PUSH = { hp: [0, -0.58, 0.12], b: {
  hips: [1.0, 0, 0], spine: [0.25, 0, 0], chest: [0.15, 0, 0], neck: [-0.3, 0, 0], head: [-0.35, 0, 0],
  upperArmL: [-1.35, 0, 0.15], foreArmL: [-0.15, 0, 0], handL: [1.2, 0, 0], upperArmR: [-1.35, 0, -0.15], foreArmR: [-0.15, 0, 0], handR: [1.2, 0, 0],
  thighL: [-1.25, 0, 0.12], shinL: [1.9, 0, 0], footL: [0.7, 0, 0], thighR: [-1.25, 0, -0.12], shinR: [1.9, 0, 0], footR: [0.7, 0, 0] } };
const KNOCK_SUPINE = [SUP_LIE, SUP_SIT, KNEEL, RISE];
const KNOCK_PRONE = [PRO_LIE, PRO_PUSH, KNEEL, RISE];

class Pose {
  constructor(n) {
    this.e = new Float32Array(n * 3); this.hp = new Float32Array(3);
    this.ik = new Float32Array(12); this.pole = new Float32Array(12); this.ikw = new Float32Array(4);
    this.eq = new Float32Array(16); this.curl = new Float32Array(2); this.toe = new Float32Array(2);
  }
  clear() { this.e.fill(0); this.hp.fill(0); this.ik.fill(0); this.pole.fill(0); this.ikw.fill(0); this.eq.fill(0); this.curl.fill(0); this.toe.fill(0); }
}

/** Analytic two-bone IK. sign +1 = leg (joint points at the pole, bends with +x), −1 = arm. */
function solveLimb(upper, lower, end, l1, l2, target, pole, sign, w, endQ) {
  upper.getWorldPosition(A); upper.parent.getWorldQuaternion(QP);
  D.copy(target).sub(A); let dist = D.length();
  if (dist < 1e-4) return;
  D.divideScalar(dist); dist = clamp(dist, Math.abs(l1 - l2) + 0.03, (l1 + l2) * 0.999);
  BEND.copy(pole).addScaledVector(D, -pole.dot(D));
  if (BEND.lengthSq() < 1e-6) BEND.set(0.3, 0.2, 1).addScaledVector(D, -D.dot(BEND));
  BEND.normalize();
  const cosA = clamp((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
  KD.copy(D).multiplyScalar(cosA).addScaledVector(BEND, sinA);
  K.copy(A).addScaledVector(KD, l1);
  LD.copy(A).addScaledVector(D, dist).sub(K).normalize();
  X.crossVectors(BEND, D).multiplyScalar(sign).normalize();
  Y.copy(KD).negate(); Z.crossVectors(X, Y);
  QU.setFromRotationMatrix(M4.makeBasis(X, Y, Z));
  Y.copy(LD).negate(); Z.crossVectors(X, Y);
  QL.setFromRotationMatrix(M4.makeBasis(X, Y, Z));
  QT.copy(QP).invert().multiply(QU); upper.quaternion.slerp(QT, w);
  QT.copy(QU).invert().multiply(QL); lower.quaternion.slerp(QT, w);
  if (endQ) { QU.copy(QP).multiply(upper.quaternion).multiply(lower.quaternion); QT.copy(QU).invert().multiply(endQ); end.quaternion.slerp(QT, w); }
}

export class Animator {
  constructor(model, world) {
    this.m = model; this.world = world; this.b = model.bones;
    const n = model.list.length; this.n = n;
    this.idx = {}; model.list.forEach((bone, i) => { this.idx[bone.name] = i; });
    this.b.hips.rotation.order = 'YXZ';
    this.pG = new Pose(n); this.pA = new Pose(n); this.pC = new Pose(n); this.pD = new Pose(n); this.pK = new Pose(n); this.out = new Pose(n);
    this.w = { G: 1, A: 0, C: 0, D: 0, K: 0 };
    // hit reactions: a stiff torso spring (recoil / whiplash), arms thrown up to guard, the knockdown layer
    this.fl = { x: 0, z: 0, vx: 0, vz: 0 }; this.guard = 0; this.knockAir = 0; this.slip = [0, 0]; this.strain = 0;
    this.time = 0; this.phase = 0; this.breath = 0; this.prevState = 'ground';
    this.vpos = V(); this.vyaw = 0; this.offset = V(); this.lastV = V(); this.mantleT = 9;
    this.vel = V(); this.velS = V(); this.accS = V(); this.speed = 0; this.accF = 0; this.accL = 0; this.turn = 0; this.moving = false;
    this.fwd = V(); this.left = V();
    this.feet = [0, 1].map((i) => ({ side: i ? -1 : 1, pos: V(), cur: V(), from: V(), target: V(), yaw: 0, fromYaw: 0, planted: true, u: 1, dur: 0.24, sp: 0.5, pitch: 0, lift: 0.06, cool: 0 }));
    this.land = { x: 0, v: 0 }; this.lurch = { x: 0, z: 0, vx: 0, vz: 0 }; this.drop = 0;
    this.down = 0; this.cond = 0; this.airT = 0; this.fallT = 0; this.flail = 0; this.dead = 0; this.strikeW = 0;
    // climbing
    this.cN = V().set(0, 0, 1); this.cU = V().set(0, 1, 0); this.cR = V(); this.cP = V(); this.cDir = V();
    this.limbs = [0, 1, 2, 3].map(() => ({ obj: null, local: V(), toObj: null, toLocal: V(), world: V(), t: 1, dur: 0.2, lift: 0.08, delay: 0 }));
    this.pair = 0; this.swing = V(); this.swingV = V(); this.lag = V(); this.climbIdle = 0; this.reach = 0;
    this.coil = 0; this.fly = 0; this.catchT = 9; this.catchF = 0; this.leapKick = 9; this.leapPow = 0;
    this.onStep = null;
    // cloth
    const c = model.col, tmp = new THREE.Color();
    this.cape = new Cloth({ cols: 9, rows: 8, width: 0.45, flare: 1.3, length: 0.52, material: model.materials.cloth,
      colorFn: (u, v, out) => { out.copy(v > 0.84 && v < 0.93 ? c.cloakBand : c.cloak).multiplyScalar(0.86 + 0.14 * Math.sin(u * 23 + v * 9) * Math.sin(v * 17 + u * 5)); } });
    this.scarf = new Cloth({ cols: 2, rows: 7, width: 0.075, flare: 0.8, length: 0.4, material: model.materials.cloth,
      colorFn: (u, v, out) => { out.copy(c.scarf).multiplyScalar(0.85 + 0.2 * Math.sin(v * 21)); tmp.copy(out); } });
    model.root.add(this.cape.mesh, this.scarf.mesh);
    this.capePinsL = []; this.capePins = [];
    for (let k = 0; k < 9; k++) { const a = (k / 8 - 0.5) * 2 * 1.28; this.capePinsL.push(V().set(-0.203 * Math.sin(a) / Math.sin(1.28), 0.165 - 0.035 * (1 - Math.cos(a)), -0.012 - 0.108 * Math.cos(a))); this.capePins.push(V()); }
    this.scarfPinsL = [V().set(0.028, 0.275, -0.088), V().set(0.088, 0.268, -0.062)]; this.scarfPins = [V(), V()];
    this.spheres = new Float32Array(11 * 4); this.wind = V(); this.plane = { n: V(), d: 0 };
    this.tail = V(); this.tailPrev = V(); this.tailInit = false;
  }

  set(p, name, x, y, z) { const i = this.idx[name] * 3; p.e[i] = x; p.e[i + 1] = y; p.e[i + 2] = z; }
  add(p, name, x, y, z) { const i = this.idx[name] * 3; p.e[i] += x; p.e[i + 1] += y; p.e[i + 2] += z; }
  mix(p, name, x, y, z, k) { const i = this.idx[name] * 3; p.e[i] += (x - p.e[i]) * k; p.e[i + 1] += (y - p.e[i + 1]) * k; p.e[i + 2] += (z - p.e[i + 2]) * k; }
  ikSet(p, limb, pos, w, pole, q) {
    p.ik[limb * 3] = pos.x; p.ik[limb * 3 + 1] = pos.y; p.ik[limb * 3 + 2] = pos.z; p.ikw[limb] = w;
    p.pole[limb * 3] = pole.x; p.pole[limb * 3 + 1] = pole.y; p.pole[limb * 3 + 2] = pole.z;
    if (q) { p.eq[limb * 4] = q.x; p.eq[limb * 4 + 1] = q.y; p.eq[limb * 4 + 2] = q.z; p.eq[limb * 4 + 3] = q.w; }
  }

  // ------------------------------------------------------------------ lifecycle & events
  reset(pos, yaw) {
    this.vpos.copy(pos); this.lastV.copy(pos); this.vyaw = yaw; this.offset.set(0, 0, 0);
    this.w.G = 1; this.w.A = this.w.C = this.w.D = 0; this.dead = 0; this.down = 0; this.prevState = 'ground';
    this.vel.set(0, 0, 0); this.velS.set(0, 0, 0); this.accS.set(0, 0, 0); this.speed = 0; this.moving = false;
    this.land.x = this.land.v = 0; this.lurch.x = this.lurch.z = this.lurch.vx = this.lurch.vz = 0; this.drop = 0; this.flail = 0;
    this.frame(yaw);
    for (const f of this.feet) { this.home(f, f.pos); f.pos.y = this.ground(f.pos, pos.y); f.cur.copy(f.pos); f.yaw = yaw + f.side * 0.15; f.planted = true; f.u = 1; f.pitch = 0; }
    this.cape.fresh = this.scarf.fresh = true; this.tailInit = false;
  }
  frame(yaw) { this.fwd.set(Math.sin(yaw), 0, Math.cos(yaw)); this.left.set(Math.cos(yaw), 0, -Math.sin(yaw)); }
  home(f, out) { return out.copy(this.vpos).addScaledVector(this.left, f.side * 0.1).addScaledVector(this.fwd, f.side > 0 ? 0.035 : -0.04); }
  ground(p, feetY) { return this.world.groundAt(p.x, p.z, feetY + 0.55) + this.offset.y; }

  onLand(fall) {
    this.land.v += clamp(fall * 4.5 + 3, 3, 32);
    for (const f of this.feet) { // feet take the ground where they actually are
      this.b[f.side > 0 ? 'footL' : 'footR'].getWorldPosition(f.pos);
      f.pos.y = this.ground(f.pos, this.vpos.y); f.cur.copy(f.pos); f.planted = true; f.u = 1; f.yaw = this.vyaw + f.side * 0.12; f.cool = 0.12;
    }
  }
  onRelease(lost) { this.flail = lost ? 1 : 0.25; if (lost) this.lurch.vx -= 5; }
  onMantle() { this.pendingMantle = true; }
  onLeap(charge) { this.leapKick = 0; this.leapPow = charge; }
  onLeapAir() { this.flail = 0; this.reachAir = 0.9; }
  onCatch(force) { this.catchT = 0; this.catchF = force; this.pendingCatch = true; }
  /**
   * A blow: the torso recoils away from where it came from (struck in front → back and head whip back;
   * from behind → pitched forward; from a side → bent away), the arms come up to guard on anything above light,
   * and on a giant the hand on the struck side is torn from its hold for a moment.
   */
  onHit(hit, climbing) {
    const tier = hit.tier ?? 1, k = [2.4, 4.4, 6.8, 8.5][tier];
    const along = hit.dir.dot(this.fwd), side = hit.dir.dot(this.left);
    this.fl.vx += along * k * 1.7; this.fl.vz += -side * k * 1.7;
    this.lurch.vx += clamp(along * k, -7, 7); this.lurch.vz += clamp(-side * k, -7, 7);
    if (tier >= 1) this.guard = Math.min(1, this.guard + 0.55 + tier * 0.2);
    if (climbing) {
      this.swingV.addScaledVector(hit.dir, 1.4 + tier * 0.9);
      if (tier >= 1) { const i = side > 0 ? LH : RH; this.slip[i] = Math.max(this.slip[i], 0.35 + tier * 0.15); }
    }
  }
  onKnock() { this.knockAir = 0; }

  // ------------------------------------------------------------------ update
  update(dt, pl) {
    const b = this.b, w = this.w, st = pl.state;
    this.time += dt; const t = this.time;
    this.cond = pl.health.smoothed;
    this.breath += dt * (1.5 + pl.exertion * 3.2 + this.cond * 2.2);

    // teleports (grab, mantle) are absorbed into a decaying visual offset so the body travels there
    if ((st === 'climb' && this.prevState !== 'climb') || this.pendingMantle) {
      this.offset.copy(this.vpos).sub(pl.pos).clampLength(0, 2.6);
      if (this.pendingMantle) this.mantleT = 0;
      if (st === 'climb') this.initHolds = true;
      this.pendingMantle = false;
    }
    this.mantleT += dt;
    const o = this.offset, mant = this.mantleT < 0.75;
    o.y = damp(o.y, 0, mant ? 7 : 13, dt);
    const kxz = mant ? (this.mantleT < 0.2 ? 0 : 8) : 13;
    o.x = damp(o.x, 0, kxz, dt); o.z = damp(o.z, 0, kxz, dt);
    this.vpos.copy(pl.pos).add(o);

    // facing
    let dy = pl.yaw - this.vyaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    const turnStep = dy * (1 - Math.exp(-(st === 'climb' ? 9 : 15) * dt));
    this.vyaw += turnStep;
    this.frame(this.vyaw);
    if (dt > 1e-5) {
      this.turn = damp(this.turn, turnStep / dt, 10, dt);
      // motion actually travelled — drives the gait, so feet never skate against a wall
      t1.copy(this.vpos).sub(this.lastV).divideScalar(dt); t1.y = 0;
      if (t1.lengthSq() > 400) t1.set(0, 0, 0);
      this.vel.copy(t1);
      t2.copy(this.velS); this.velS.lerp(t1, 1 - Math.exp(-14 * dt));
      t2.subVectors(this.velS, t2).divideScalar(dt);
      this.accS.lerp(t2, 1 - Math.exp(-7 * dt));
      this.speed = this.velS.length();
      this.accF = this.accS.dot(this.fwd); this.accL = this.accS.dot(this.left);
    }
    this.lastV.copy(this.vpos);

    // state weights
    if (st === 'dead') this.dead = Math.min(1, this.dead + dt / 1.25);
    else if (pl.sleepTarget != null) {
      // lying down to sleep is slow and heavy; getting up is quicker
      const to = pl.sleepTarget, k = to > this.dead ? dt / 3.4 : dt / 2.0;
      this.dead = to > this.dead ? Math.min(to, this.dead + k) : Math.max(to, this.dead - k);
    } else this.dead = 0;
    this.sleeping = st !== 'dead' && pl.sleepTarget != null;
    const tgt = st === 'climb' ? 'C' : st === 'air' ? 'A' : 'G';
    const onGround = st !== 'climb' && st !== 'air';
    w.G = damp(w.G, tgt === 'G' ? 1 : 0, tgt === 'G' ? 16 : 11, dt);
    w.A = damp(w.A, tgt === 'A' ? 1 : 0, tgt === 'A' ? 11 : 16, dt);
    w.C = damp(w.C, tgt === 'C' ? 1 : 0, tgt === 'C' ? 9 : 13, dt);
    const sum = w.G + w.A + w.C || 1; w.G /= sum; w.A /= sum; w.C /= sum;
    w.D = ease(this.dead);
    this.reachAir = Math.max(0, (this.reachAir || 0) - dt);
    if (st === 'air') { this.airT += dt; this.fallT = pl.vel.y < -1 ? this.fallT + dt : 0; } else { this.airT = 0; this.fallT = 0; this.flail = damp(this.flail, 0, 3, dt); }

    // springs: landing compression and stagger
    const L = this.land, lw = 11;
    L.v += (-lw * lw * L.x - 2 * 0.72 * lw * L.v) * dt; L.x = clamp(L.x + L.v * dt, -0.15, 1.1);
    const lu = this.lurch, uw = 8;
    lu.vx += (-uw * uw * lu.x - 2 * 0.45 * uw * lu.vx) * dt; lu.x = clamp(lu.x + lu.vx * dt, -0.8, 0.8);
    lu.vz += (-uw * uw * lu.z - 2 * 0.45 * uw * lu.vz) * dt; lu.z = clamp(lu.z + lu.vz * dt, -0.8, 0.8);
    const fl = this.fl, fw = 12;
    fl.vx += (-fw * fw * fl.x - 2 * 0.38 * fw * fl.vx) * dt; fl.x = clamp(fl.x + fl.vx * dt, -0.75, 0.75);
    fl.vz += (-fw * fw * fl.z - 2 * 0.38 * fw * fl.vz) * dt; fl.z = clamp(fl.z + fl.vz * dt, -0.75, 0.75);
    this.guard = Math.max(0, this.guard - dt * 1.5);
    for (let i = 0; i < 2; i++) this.slip[i] = Math.max(0, this.slip[i] - dt);
    // knocked down: lying, then getting up in stages; the layer fades out as the legs take the weight again
    const kr = pl.recover && pl.recover.kind === 'knock' ? pl.recover : null;
    let wk = 0;
    if (kr && onGround) { const end = kr.lie + kr.up * 0.82; wk = kr.t < end ? 1 : 1 - ease((kr.t - end) / (kr.up * 0.18)); }
    w.K = wk > w.K ? damp(w.K, wk, 13, dt) : wk;
    this.knockAir = pl.knock && st === 'air' ? Math.min(1, this.knockAir + dt * 4) : damp(this.knockAir, 0, 8, dt);
    this.knockProne = pl.knock ? !!pl.knock.prone : this.knockProne;
    // hard landings: crouch to the ground, then push back up
    const rc = pl.recover; let q = 0;
    if (rc && onGround) { const k = rc.t / rc.dur; q = k < 0.14 ? ease(k / 0.14) : k < rc.hold ? 1 : 1 - ease((k - rc.hold) / (1 - rc.hold)); this.sev = rc.sev; }
    if (mant) q = Math.max(q, (1 - ease(this.mantleT / 0.7)) * 0.75);
    this.down = damp(this.down, q, 18, dt);

    // poses
    this.wish = st === 'ground' ? (pl.wishMag || 0) : 1;
    this.updateFeet(dt, onGround && w.D < 0.5);
    this.pG.clear(); this.poseGround(pl, this.pG);
    this.pA.clear(); if (w.A > 0.001) this.poseAir(pl, this.pA);
    this.pC.clear(); if (st === 'climb') { this.updateClimb(dt, pl); this.poseClimb(pl, this.pC); this.hadClimb = true; } else if (w.C > 0.001 && this.hadClimb) this.poseClimb(pl, this.pC, true); else this.hadClimb = false;
    if (w.D > 0) { this.pD.clear(); if (this.sleeping) this.poseSleep(this.pD); else this.poseDead(this.pD); }
    if (w.K > 0.001 && kr) { this.pK.clear(); this.poseKnock(this.pK, kr); }
    else if (w.K > 0.001 && this.lastKr) { this.pK.clear(); this.poseKnock(this.pK, this.lastKr); }
    if (kr) this.lastKr = kr;
    this.hitLayer(this.pG, 1); this.hitLayer(this.pA, 0.7); this.hitLayer(this.pC, 0.45);
    this.blend(); this.apply(dt, pl);
    this.secondary(dt, pl);
    this.prevState = st;
  }

  // ------------------------------------------------------------------ gait & foot locking
  updateFeet(dt, active) {
    const sp = this.speed, base = this.vpos;
    const moving = active && sp > (this.moving ? 0.4 : 0.7) && (this.wish > 0.05 || sp > 2.6); // stick released: gather the feet
    const walkStride = 0.5 + 0.55 * sp, runStride = 0.8 + 0.47 * sp - 0.004 * sp * sp;
    const rg = this.rg = ss(1.7, 3.6, sp);
    const stride = lerp(walkStride, runStride, rg), T = stride / Math.max(sp, 0.4);
    const duty = this.duty = lerp(0.62, clamp((0.5 + 0.09 * sp) / stride, 0.2, 0.6), rg);
    if (moving) {
      if (!this.moving) { // step off with the trailing foot
        t1.copy(this.velS).normalize();
        const d0 = t2.copy(this.feet[0].pos).sub(base).dot(t1), d1 = t2.copy(this.feet[1].pos).sub(base).dot(t1);
        this.phase = d0 < d1 ? duty : (duty + 0.5) % 1;
      }
      this.phase = (this.phase + (sp * dt) / stride) % 1;
    }
    this.moving = moving;
    const lat = lerp(0.085, 0.05, rg), other = (f) => this.feet[f.side > 0 ? 1 : 0];
    for (const f of this.feet) {
      const i = f.side > 0 ? 0 : 1;
      f.cool -= dt;
      if (!active) { f.planted = false; f.u = 1; this.home(f, f.cur); f.pos.copy(f.cur); continue; }
      if (moving) {
        const ph = (this.phase + i * 0.5) % 1;
        if (ph < duty) {
          if (!f.planted) this.plant(f, true);
          f.sp = ph / duty;
          const late = Math.max(0, (f.sp - 0.55) / 0.45), early = Math.max(0, 1 - f.sp / 0.16);
          f.pitch = late * late * (0.6 + 0.35 * rg) - early * 0.26 * (1 - rg);
        } else {
          const u = (ph - duty) / (1 - duty);
          if (f.planted) { f.planted = false; f.from.copy(f.pos); f.fromYaw = f.yaw; }
          f.u = u; f.dur = (1 - duty) * T;
          const tTD = (1 - u) * (1 - duty) * T;
          f.target.copy(base).addScaledVector(this.velS, tTD + duty * T * 0.46).addScaledVector(this.left, f.side * lat);
          f.target.y = this.ground(f.target, base.y);
          this.swingFoot(f, dt, lerp(0.075, 0.25, rg) + 0.08 * ss(5, 7.5, sp), rg, this.vyaw + f.side * 0.07);
        }
      } else if (!f.planted) {
        f.u += dt / Math.max(f.dur, 0.16); this.home(f, f.target); f.target.y = this.ground(f.target, base.y);
        this.swingFoot(f, dt, f.lift, 0, this.vyaw + f.side * 0.15);
        if (f.u >= 1) this.plant(f, false);
      } else {
        f.pitch = damp(f.pitch, 0, 12, dt);
        this.home(f, t1); t1.y = f.pos.y;
        let dyaw = this.vyaw + f.side * 0.15 - f.yaw; dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
        const err = t1.distanceTo(f.pos) + Math.abs(dyaw) * 0.22, o2 = other(f);
        if (err > 0.13 && o2.planted && f.cool <= 0) { // settle / turn-in-place step
          t2.copy(o2.pos); this.home(o2, t3); const err2 = t3.setY(t2.y).distanceTo(t2);
          if (err >= err2 || err > 0.3) { f.planted = false; f.from.copy(f.pos); f.fromYaw = f.yaw; f.u = 0; f.dur = err > 0.4 ? 0.19 : 0.23; f.lift = 0.05 + Math.min(0.07, err * 0.2); }
        }
      }
      if (f.planted) f.cur.copy(f.pos);
    }
  }
  swingFoot(f, dt, lift, rg, yaw) {
    const u = clamp(f.u, 0, 1), e = ease(u);
    t5.copy(f.from).lerp(f.target, e);
    t5.y = lerp(f.from.y, f.target.y, e) + lift * Math.sin(Math.PI * Math.pow(u, 0.8));
    f.cur.lerp(t5, 1 - Math.exp(-45 * dt)); f.pos.copy(f.cur);
    let dyaw = yaw - f.fromYaw; dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw)); f.yaw = f.fromYaw + dyaw * e;
    f.pitch = (0.55 + 0.6 * rg) * (1 - u) * (1 - u) - (0.3 - 0.22 * rg) * u * u; f.sp = 0.5;
  }
  plant(f, moving) {
    f.planted = true; f.pos.copy(moving ? f.cur : f.target); f.pos.y = this.ground(f.pos, this.vpos.y); f.cur.copy(f.pos); f.u = 1; f.cool = moving ? 0.1 : 0.04;
    if (this.onStep && this.w.G > 0.6) this.onStep(clamp(0.35 + this.speed / 8, 0.3, 1.2), moving);
  }
  /** Ankle position + foot orientation for a foot contact point (pivot on the ball or the heel). */
  footIK(f, p, limb) {
    const th = f.pitch, fy = f.yaw, fx = Math.sin(fy), fz = Math.cos(fy);
    let along, up;
    if (th >= 0) { along = DIM.ball - DIM.ball * Math.cos(th) + DIM.ankle * Math.sin(th); up = DIM.ankle * Math.cos(th) + DIM.ball * Math.sin(th); }
    else { const a = -th; along = -DIM.heel + DIM.heel * Math.cos(a) - DIM.ankle * Math.sin(a); up = DIM.ankle * Math.cos(a) + DIM.heel * Math.sin(a); }
    let slope = 0;
    if (f.planted) slope = clamp(Math.atan2(this.world.heightAt(f.cur.x + fx * 0.12, f.cur.z + fz * 0.12) - this.world.heightAt(f.cur.x - fx * 0.08, f.cur.z - fz * 0.08), 0.2), -0.45, 0.45) * (Math.abs(this.world.heightAt(f.cur.x, f.cur.z) + this.offset.y - f.cur.y) < 0.1 ? 1 : 0);
    t1.set(f.cur.x + fx * along, f.cur.y + up, f.cur.z + fz * along);
    t2.set(fx, 0, fz).addScaledVector(this.left, f.side * 0.16).addScaledVector(this.fwd, 0.5); t2.y = 0.05;
    qa.setFromEuler(EUL.set(th - slope, fy, 0, 'YXZ'));
    this.ikSet(p, limb, t1, 1, t2, qa);
    p.toe[limb - 2] = f.planted && th > 0 ? -th * 0.9 : 0;
  }

  // ------------------------------------------------------------------ ground
  poseGround(pl, p) {
    const sp = this.speed, rg = this.rg, mv = ss(0.15, 1.1, sp), idle = 1 - mv, c = this.cond, t = this.time;
    const sprint = ss(4.9, 7.4, sp), ph = this.phase * TAU, s1 = Math.sin(ph), sQ = -Math.cos(ph);
    const br = Math.sin(this.breath), ex = pl.exertion, Ld = Math.max(0, this.land.x), q = this.down, sev = this.sev || 0;
    const ws = (Math.sin(t * 0.29) + 0.5 * Math.sin(t * 0.17 + 1.3)) / 1.5, look = Math.sin(t * 0.21 + 2) * Math.sin(t * 0.13), nod = Math.sin(t * 0.37 + 0.5);
    const lean = mv * (0.03 + 0.021 * sp) + clamp(this.accF * 0.016, -0.17, 0.17) + c * 0.1;
    const bank = clamp(this.accL * 0.016, -0.24, 0.24) + clamp(this.turn * 0.02, -0.1, 0.1) * mv;
    const tw = mv * (0.1 + 0.08 * rg) * sQ, roll = mv * (0.05 - 0.02 * rg) * s1;
    const limp = c > 0.4 ? ss(0.4, 0.8, c) * mv : 0, stR = Math.max(0, -s1);
    const lx = this.lurch.x, lz = this.lurch.z;

    this.set(p, 'hips', lean * 0.5 + Ld * 0.22 + lx * 0.35, tw, roll - bank * 0.6 - idle * ws * 0.035 + limp * stR * 0.08 + lz * 0.3);
    const d2 = this.duty * 0.5;
    const bob = mv * (lerp(0.018 * Math.cos(2 * (ph - 0.3 * TAU)), -0.036 * Math.cos(2 * (ph - d2 * TAU)), rg));
    p.hp[0] = mv * 0.022 * (1 - rg) * s1 + idle * ws * 0.024 + limp * stR * -0.02;
    p.hp[1] = -0.012 - 0.03 * rg - 0.02 * sprint - c * 0.03 + bob - Ld * 0.36 - limp * stR * 0.045;
    p.hp[2] = -lean * 0.04;
    this.set(p, 'spine', lean * 0.3 + c * 0.17 + Ld * 0.3 + lx * 0.3 + 0.012 * br, -tw * 0.55, -roll * 0.5 - bank * 0.25 + idle * ws * 0.04 + lz * 0.3);
    this.set(p, 'chest', lean * 0.2 + c * 0.15 + Ld * 0.12 - (0.02 + ex * 0.03) * br, -tw * 1.5 + idle * look * 0.07, -roll * 0.65 - bank * 0.25 - idle * ws * 0.015);
    this.set(p, 'neck', -lean * 0.22 + c * 0.12 + 0.01 * br, tw * 0.5 + idle * look * 0.12, 0.2 * bank);
    this.set(p, 'head', -lean * 0.42 + c * 0.14 - Ld * 0.18 + idle * nod * 0.04 - lx * 0.2, tw * 0.5 + idle * look * 0.2 + clamp(this.turn * 0.09, -0.42, 0.42) * mv, roll * 0.3 + 0.15 * bank);

    const sw = mv * (0.36 + 0.34 * rg + 0.2 * sprint), aph = ph - 0.28;
    for (const s of [1, -1]) {
      const S = s > 0 ? 'L' : 'R', sn = -Math.cos(aph) * s, fw = Math.max(0, sn);
      const flex = -sw * sn * (sn > 0 ? 1 : 0.8) + 0.05 * idle - 0.06 - 0.06 * rg + Ld * 0.5 + idle * 0.015 * Math.sin(t * 0.7 + s);
      const elbow = -(0.3 + 1.05 * rg + 0.15 * sprint + sw * 0.5 * fw + Ld * 0.35 + idle * 0.02 * br);
      this.set(p, 'upperArm' + S, flex, -s * (0.1 + 0.25 * rg), s * (0.1 + 0.07 * rg + Ld * 0.3 + (0.01 + ex * 0.015) * br + Math.abs(lz) * 0.5 + Math.abs(lx) * 0.35));
      this.set(p, 'foreArm' + S, elbow, 0, 0);
      this.set(p, 'hand' + S, 0.06, 0, -s * 0.06);
      this.set(p, 'clav' + S, 0, -sn * 0.08 * mv, s * (0.02 + ex * 0.02) * br + s * 0.04 * rg);
      p.curl[s > 0 ? 0 : 1] = 0.42 + 0.6 * rg + 0.03 * br;
    }
    // injured: one arm guards the ribs, the body curls around it
    const guard = ss(0.38, 0.72, c);
    if (guard > 0) { this.mix(p, 'upperArmL', -0.42, 0.75, -0.2, guard); this.mix(p, 'foreArmL', -1.75, 0, 0, guard); this.mix(p, 'handL', 0.2, 0, -0.3, guard); this.add(p, 'spine', 0, 0, -0.06 * guard); this.add(p, 'chest', 0, 0.08 * guard, -0.05 * guard); }

    this.footIK(this.feet[0], p, LF); this.footIK(this.feet[1], p, RF);

    // crouch to the ground and rise (hard landing, mantle, collapse)
    if (q > 0.001) {
      p.hp[1] -= q * lerp(0.4, 0.5, sev) * (1 - Ld * 0.5); p.hp[2] -= q * 0.07;
      this.add(p, 'hips', q * lerp(0.5, 0.72, sev), 0, 0); this.add(p, 'spine', q * 0.3, 0, 0); this.add(p, 'chest', q * 0.2, 0, 0);
      this.add(p, 'neck', -q * 0.25, 0, 0); this.add(p, 'head', -q * lerp(0.45, 0.2, sev), 0, 0);
      for (const s of [1, -1]) {
        const limb = s > 0 ? LH : RH, S = s > 0 ? 'L' : 'R', use = s < 0 || sev > 0.5;
        if (use) {
          t1.copy(this.vpos).addScaledVector(this.fwd, 0.4).addScaledVector(this.left, s * 0.19); t1.y = this.world.groundAt(t1.x, t1.z, this.vpos.y + 0.4) + this.offset.y + 0.04;
          t2.copy(this.fwd).multiplyScalar(-0.7).addScaledVector(this.left, s * 0.8).addScaledVector(UP, 0.5);
          X.copy(UP).multiplyScalar(s); Y.copy(this.fwd).negate(); Z.crossVectors(X, Y);
          qa.setFromRotationMatrix(M4.makeBasis(X, Y, Z));
          this.ikSet(p, limb, t1, ease(q * 1.25), t2, qa); p.curl[limb] = lerp(p.curl[limb], 0.1, q);
        } else { this.mix(p, 'upperArm' + S, 0.75, 0, s * 0.55, q); this.mix(p, 'foreArm' + S, -0.5, 0, 0, q); }
      }
      for (const f of this.feet) { const limb = f.side > 0 ? LF : RF; p.pole[limb * 3] += this.left.x * f.side * q * 0.6; p.pole[limb * 3 + 2] += this.left.z * f.side * q * 0.6; }
    }
  }

  // ------------------------------------------------------------------ air
  poseAir(pl, p) {
    const vy = pl.vel.y, fall = ss(1.2, -3.5, vy), t = this.time;
    const fl = Math.min(1.5, 0.3 * fall + ss(0.35, 1.2, this.fallT) + this.flail), wob = Math.sin(t * 10.5), wob2 = Math.cos(t * 8.3);
    const lx = this.lurch.x;
    this.set(p, 'hips', lerp(-0.08, 0.16, fall) + lx * 0.5, 0, wob2 * 0.06 * fl);
    p.hp[1] = -0.02;
    this.set(p, 'spine', lerp(-0.1, 0.07, fall) + lx * 0.2, 0, 0); this.set(p, 'chest', lerp(-0.08, 0.05, fall), wob * 0.08 * fl, 0);
    this.set(p, 'head', lerp(-0.1, 0.2, fall), 0, 0);
    this.set(p, 'thighL', lerp(-1.0, -0.62, fall) + fl * 0.3 * wob, 0, 0.1); this.set(p, 'shinL', lerp(1.35, 0.95, fall) + fl * 0.25 * wob2, 0, 0); this.set(p, 'footL', 0.35, 0, 0);
    this.set(p, 'thighR', lerp(0.3, -0.22, fall) - fl * 0.3 * wob, 0, -0.14); this.set(p, 'shinR', lerp(0.55, 0.6, fall) - fl * 0.2 * wob2, 0, 0); this.set(p, 'footR', 0.45, 0, 0);
    // knocked flying: the body is folded around the blow and tips away from it, limbs thrown after it
    const ka = ease(this.knockAir);
    if (ka > 0.001) {
      const sgn = this.knockProne ? 1 : -1;
      this.add(p, 'hips', sgn * 0.95 * ka, 0, 0); this.add(p, 'spine', -sgn * 0.25 * ka, 0, 0); this.add(p, 'chest', -sgn * 0.2 * ka, 0, 0); this.add(p, 'head', -sgn * 0.35 * ka, 0, 0);
      p.hp[1] -= 0.1 * ka;
    }
    const ra = this.reachAir > 0 ? Math.min(1, this.reachAir * 3) : 0;
    for (const s of [1, -1]) {
      const S = s > 0 ? 'L' : 'R';
      this.set(p, 'upperArm' + S, lerp(lerp(-1.25, -0.75, fall), -2.3, ra) + fl * 0.45 * wob * s, 0, s * (lerp(0.35, 1.25, fall) + fl * 0.25 * wob2 * s));
      this.set(p, 'foreArm' + S, lerp(-1.0, -0.7, fall) - fl * 0.25 * (0.5 + 0.5 * wob * s), 0, 0);
      p.curl[s > 0 ? 0 : 1] = 0.25;
    }
  }

  // ------------------------------------------------------------------ death
  poseDead(p) {
    this.set(p, 'hips', 1.47, 0, 0.05); p.hp[1] = -0.82; p.hp[2] = 0.25;
    this.set(p, 'spine', 0.04, 0, 0.06); this.set(p, 'chest', 0.05, 0.1, 0.05); this.set(p, 'neck', -0.1, 0.5, 0); this.set(p, 'head', -0.12, 0.7, 0.1);
    this.set(p, 'upperArmL', -2.5, 0, 0.55); this.set(p, 'foreArmL', -1.25, 0, 0); this.set(p, 'upperArmR', -0.25, 0, -0.5); this.set(p, 'foreArmR', -0.35, 0, 0);
    this.set(p, 'thighL', 0.08, 0, 0.14); this.set(p, 'shinL', 0.12, 0, 0); this.set(p, 'footL', 0.9, 0, 0);
    this.set(p, 'thighR', -0.32, 0, -0.3); this.set(p, 'shinR', 0.75, 0, 0); this.set(p, 'footR', 0.9, 0, 0);
    p.curl[0] = p.curl[1] = 0.3;
  }

  /** Asleep on the ground: on one side, knees drawn up, an arm for a pillow. */
  poseSleep(p) {
    this.set(p, 'hips', 0.2, 0, 1.42); p.hp[1] = -0.74; p.hp[2] = 0.05;
    this.set(p, 'spine', 0.2, 0, 0.02); this.set(p, 'chest', 0.16, 0, 0.02); this.set(p, 'neck', 0.12, 0, -0.12); this.set(p, 'head', 0.08, 0.1, -0.22);
    this.set(p, 'upperArmL', -1.35, 0, 0.25); this.set(p, 'foreArmL', -1.7, 0, 0); this.set(p, 'upperArmR', -0.9, 0, -0.15); this.set(p, 'foreArmR', -1.3, 0, 0);
    this.set(p, 'thighL', -1.2, 0, 0.04); this.set(p, 'shinL', 1.65, 0, 0); this.set(p, 'footL', 0.45, 0, 0);
    this.set(p, 'thighR', -0.95, 0, -0.04); this.set(p, 'shinR', 1.45, 0, 0); this.set(p, 'footR', 0.45, 0, 0);
    p.curl[0] = p.curl[1] = 0.55;
  }

  // ------------------------------------------------------------------ hit reactions
  /** Recoil + guard on top of a state pose (k scales it: full on foot, less while hanging on). */
  hitLayer(p, k) {
    const fx = this.fl.x * k, fz = this.fl.z * k, g = ease(this.guard) * k;
    if (Math.abs(fx) + Math.abs(fz) > 0.002) {
      this.add(p, 'spine', fx * 0.45, 0, fz * 0.45); this.add(p, 'chest', fx * 0.55, fz * 0.3, fz * 0.35);
      this.add(p, 'neck', fx * 0.35, 0, fz * 0.2); this.add(p, 'head', fx * 0.7, -fz * 0.4, fz * 0.5);
      for (const s of [1, -1]) this.add(p, 'upperArm' + (s > 0 ? 'L' : 'R'), fx * 0.9, 0, s * (Math.abs(fx) * 0.8 + Math.abs(fz) * 0.6));
    }
    if (g > 0.002) {
      // forearms thrown up across the face, shoulders hunched, chin tucked
      for (const s of [1, -1]) {
        const S = s > 0 ? 'L' : 'R';
        this.mix(p, 'upperArm' + S, -1.25, s * 0.65, s * 0.25, g); this.mix(p, 'foreArm' + S, -2.05, 0, 0, g); this.mix(p, 'hand' + S, 0.35, 0, -s * 0.2, g);
        this.add(p, 'clav' + S, 0, 0, s * 0.12 * g);
        const limb = s > 0 ? LH : RH; p.ikw[limb] *= 1 - g; p.curl[limb] = lerp(p.curl[limb], 0.9, g);
      }
      this.add(p, 'chest', 0.12 * g, 0, 0); this.add(p, 'head', 0.18 * g, 0, 0);
    }
  }

  /**
   * Knocked down, then up again: [lie] → sit up / push up → one knee → rise.
   * Each key is bone Euler angles + hip offset; keys are eased into one another along the get-up.
   */
  poseKnock(p, r) {
    const t = r.t, prone = r.prone, crit = r.sev > 0.8, tm = this.time;
    const K = prone ? KNOCK_PRONE : KNOCK_SUPINE;
    let a, b, u;
    if (t < r.lie) { a = b = K[0]; u = 0; }
    else {
      const x = clamp((t - r.lie) / r.up, 0, 1) * (K.length - 1);
      const i = Math.min(K.length - 2, Math.floor(x)); a = K[i]; b = K[i + 1]; u = ease(x - i);
    }
    for (const name in a.b) { const A0 = a.b[name], B0 = b.b[name] || A0; this.set(p, name, lerp(A0[0], B0[0], u), lerp(A0[1], B0[1], u), lerp(A0[2], B0[2], u)); }
    for (let i = 0; i < 3; i++) p.hp[i] = lerp(a.hp[i], b.hp[i], u);
    // the ground arriving: a short bounce and settle; then a stunned stir while lying there
    const lt = t;
    if (lt < 0.35) p.hp[1] += Math.sin(lt / 0.35 * Math.PI) * Math.exp(-lt * 6) * 0.09;
    if (t < r.lie) {
      const stir = Math.min(1, t / 0.4) * (crit ? 0.6 : 1);
      this.add(p, 'head', 0.08 * Math.sin(tm * 2.1) * stir, 0.25 * Math.sin(tm * 1.3) * stir, 0);
      this.add(p, 'upperArmR', -0.25 * (0.5 + 0.5 * Math.sin(tm * 2.6)) * stir, 0, 0); this.add(p, 'foreArmR', -0.3 * stir, 0, 0);
      this.add(p, 'thighL', -0.2 * (0.5 + 0.5 * Math.sin(tm * 1.7 + 1)) * stir, 0, 0); this.add(p, 'shinL', 0.35 * (0.5 + 0.5 * Math.sin(tm * 1.7 + 1)) * stir, 0, 0);
      p.hp[1] += 0.012 * Math.sin(this.breath * 1.6);   // heaving breath
    }
    p.curl[0] = p.curl[1] = 0.55;
  }

  // ------------------------------------------------------------------ climbing
  holdWorld(l, out) { out.copy(l.local); if (l.obj) l.obj.localToWorld(out); return out; }
  limbHome(i, out, lead) {
    const kf = this.kf, hand = i < 2, s = i === LH || i === LF ? 1 : -1;
    const along = hand ? 0.5 + (s > 0 ? 0.05 : 0) : lerp(-0.8, -0.58, kf) + (s < 0 ? 0.1 : 0);
    out.copy(this.cP).addScaledVector(this.cU, along).addScaledVector(this.cR, -s * (hand ? 0.2 : 0.15));
    if (lead) out.addScaledVector(this.cDir, lead);
    return out;
  }
  startStep(i, dur, lift, lead, delay = 0, obj) {
    const l = this.limbs[i];
    this.holdWorld(l, t4);                      // current place becomes the start of the reach
    l.obj = null; l.local.copy(t4);
    this.limbHome(i, t5, lead);
    l.toObj = obj; l.toLocal.copy(t5); if (obj) obj.worldToLocal(l.toLocal);
    l.t = 0; l.dur = dur; l.lift = lift; l.delay = delay;
  }
  updateClimb(dt, pl) {
    const N = pl.climbNormal || UP, P = pl.lastAttWorld, obj = pl.att && pl.att.obj;
    if (!P || !obj) return;
    const k = this.initHolds ? 1 : 1 - Math.exp(-16 * dt);
    this.cN.lerp(N, k).normalize(); this.cP.copy(P);
    this.frame(pl.yaw);
    if (Math.abs(this.cN.y) < 0.7) t1.copy(UP).addScaledVector(this.cN, -this.cN.y); else t1.copy(this.fwd).addScaledVector(this.cN, -this.fwd.dot(this.cN));
    this.cU.lerp(t1.normalize(), k).normalize(); this.cR.crossVectors(this.cU, this.cN).normalize();
    this.frame(this.vyaw);
    this.kf = clamp(this.cN.y, 0, 1);
    const moving = pl.climbMoving && pl.climbDir;
    if (moving) this.cDir.lerp(pl.climbDir, 1 - Math.exp(-12 * dt)); else this.cDir.multiplyScalar(Math.exp(-10 * dt));
    this.climbIdle = moving ? 0 : this.climbIdle + dt;
    // leap: coil while the jump is held, let go of the surface in flight, snatch a new hold on arrival
    const lp = pl.leap, flying = lp.phase === 'fly';
    this.coil = damp(this.coil, lp.phase === 'charge' ? ease(lp.charge) * 0.75 + 0.25 : 0, lp.phase === 'charge' ? 14 : 22, dt);
    this.fly = damp(this.fly, flying ? 1 : 0, flying ? 26 : 16, dt);
    this.catchT += dt; this.leapKick += dt;
    if (lp.phase !== 'none') { this.cDir.lerp(lp.dir, 1 - Math.exp(-14 * dt)); this.climbIdle = 0; }

    if (this.initHolds) { // first grab: hands and feet fly to their holds
      for (let i = 0; i < 4; i++) { const l = this.limbs[i]; l.obj = null; this.b[['handL', 'handR', 'footL', 'footR'][i]].getWorldPosition(l.local); this.startStep(i, i < 2 ? 0.16 : 0.26, 0.05, 0, i < 2 ? 0 : 0.05, obj); }
      this.initHolds = false; this.swing.set(0, 0, 0); this.swingV.set(0, 0, 0);
    }
    if (this.pendingCatch) { for (let i = 0; i < 4; i++) { const l = this.limbs[i]; l.obj = null; this.b[['handL', 'handR', 'footL', 'footR'][i]].getWorldPosition(l.local); } for (let i = 0; i < 4; i++) this.startStep(i, i < 2 ? 0.1 : 0.2, 0.05, 0, i < 2 ? (i ? 0.03 : 0) : 0.06, obj); this.pendingCatch = false; }

    let busy = false, worst = -1, worstErr = 0;
    for (let i = 0; i < 4; i++) {
      const l = this.limbs[i];
      if (l.t < 1) {
        if (l.delay > 0) l.delay -= dt; else l.t += dt / l.dur;
        t1.copy(l.toLocal); if (l.toObj) l.toObj.localToWorld(t1);
        if (l.t >= 1) { l.t = 1; l.obj = l.toObj; l.local.copy(l.toLocal); l.world.copy(t1); if (i < 2 && this.onGrab) this.onGrab(); }
        else { const e = ease(l.t); l.world.copy(l.local).lerp(t1, e).addScaledVector(this.cN, l.lift * Math.sin(Math.PI * l.t)); }
        busy = true;
      } else {
        this.holdWorld(l, l.world);
        const err = this.limbHome(i, t1, moving ? 0.1 : 0).distanceTo(l.world);
        if (err > worstErr) { worstErr = err; worst = i; }
        if (!flying && (err > 1.1 || (l.obj && (!l.obj.parent || l.obj.userData.climb?.disabled)))) { this.startStep(i, 0.14, 0.05, 0, 0, obj); busy = true; }
      }
    }
    // climb in diagonal pairs: a hand reaches, the opposite foot follows
    const thr = moving ? 0.24 : (this.climbIdle > 0.25 ? 0.1 : 0.3);
    if (!busy && worst >= 0 && worstErr > thr && pl.strike.phase === 'none' && lp.phase === 'none') {
      const a = worst === LH || worst === RF ? [LH, RF] : [RH, LF];
      const fast = clamp(0.26 / Math.max(0.6, pl.climbRate || 1), 0.15, 0.26), lead = moving ? 0.3 : 0;
      this.startStep(a[0], fast, 0.07, lead, 0, obj); this.startStep(a[1], fast * 1.1, 0.06, lead, fast * 0.45, obj);
      this.reach = a[0] === LH ? 1 : -1;
    }
    // the body swings from the hands when the surface heaves
    const sh = pl.shakeAmt || 0;
    t1.copy(this.cP).sub(this.lag);
    if (t1.lengthSq() > 4) { this.lag.copy(this.cP); this.swing.set(0, 0, 0); this.swingV.set(0, 0, 0); t1.set(0, 0, 0); }
    t2.copy(t1).divideScalar(Math.max(dt, 1e-3)); this.lag.copy(this.cP);
    t3.copy(t2).sub(this.surfV || t2); (this.surfV || (this.surfV = V())).copy(t2);
    // a strong grip holds the body in to the surface: stiffer and better damped with stamina, looser when spent
    const stm = clamp(pl.stamina / pl.t.staminaMax, 0, 1), vio = ss(0.65, 0.95, sh);
    const om = 7.5 + 3.5 * stm * (1 - vio * 0.6);
    this.swingV.addScaledVector(t3, -0.42).addScaledVector(this.swing, -om * om * dt).multiplyScalar(Math.exp(-(sh > 0.2 ? 2.2 + 1.6 * stm : 4.5) * dt));
    this.swing.addScaledVector(this.swingV, dt).clampLength(0, 0.3 + 0.22 * vio * (1 - 0.4 * stm));
    // effort level for the struggle layer: rises fast, settles slowly (the body stays tense for a beat)
    const want = sh > 0.05 ? clamp(sh * (1.15 - 0.45 * stm), 0, 1) : 0;
    this.strain = want > this.strain ? damp(this.strain, want, 6, dt) : damp(this.strain, want, 1.4, dt);
    // the shake ending: haul the body back in against the surface for a moment
    if (this.prevSh > 0.55 && sh < 0.4) this.pullIn = 1;
    this.prevSh = sh; this.pullIn = Math.max(0, (this.pullIn || 0) - dt * 1.3);
    // let go on a broad top (shoulders, crown, the shelf over the hips): rise off the hands and stand braced
    // and walk about up there on their feet
    const stand = pl.handsFree && this.kf > 0.8 && lp.phase === 'none' && pl.strike.phase === 'none' && sh < 0.3;
    this.upright = damp(this.upright || 0, stand ? 1 : 0, stand ? (moving ? 6 : 3.2) : 8, dt);
    const walking = stand && pl.climbMoving;
    this.topWalk = damp(this.topWalk || 0, walking ? clamp((pl.climbRate || 0) / 2.7, 0, 1.4) : 0, 9, dt);
    if (walking) this.topPh = ((this.topPh || 0) + dt * (pl.climbRate || 0) / 1.25) % 1;
    // thrown off balance (feet sliding, nothing held): arms out wide, the body pitched about
    this.teeterW = damp(this.teeterW || 0, pl.teeter ? 1 : 0, pl.teeter ? 10 : 5, dt);
  }

  poseClimb(pl, p, fading) {
    const kf = this.kf || 0, wall = 1 - kf, N = this.cN, U = this.cU, R = this.cR, t = this.time;
    const sh = fading ? 0 : (pl.shakeAmt || 0), tired = fading ? 0 : ss(0.3, 0.05, pl.stamina / pl.t.staminaMax), br = Math.sin(this.breath);
    const over = clamp(-N.y, 0, 1);
    // how far the hands are ahead of the body along the climb direction → pull-up / reach
    t1.set(0, 0, 0); for (let i = 0; i < 2; i++) t1.add(this.limbs[i].world); t1.multiplyScalar(0.5).sub(this.cP);
    const handsUp = t1.dot(U) - 0.5, handsSide = t1.dot(R);
    const sw = this.swing, swOut = sw.dot(N), swSide = sw.dot(R), swUp = sw.dot(U);
    const hang = ss(0.4, 2.5, this.climbIdle) * wall;
    const tr = tired * Math.sin(t * 31) * 0.012 + sh * Math.sin(t * 23) * 0.02;
    const coil = fading ? 0 : this.coil, fly = fading ? 0 : this.fly;
    const ct = this.catchT, sag = ct < 0.45 ? Math.sin(Math.min(1, ct / 0.45) * Math.PI) * Math.exp(-ct * 3) * (this.catchF || 0) : 0;   // weight arriving on the arms
    const kick = this.leapKick < 0.16 ? 1 - this.leapKick / 0.16 : 0;                                                              // legs driving off
    const cu = this.cDir.dot(U), cr = this.cDir.dot(R);
    const stepping = Math.max(this.limbs[0].t < 1 ? Math.sin(this.limbs[0].t * Math.PI) : 0, 0) - Math.max(this.limbs[1].t < 1 ? Math.sin(this.limbs[1].t * Math.PI) : 0, 0);

    const pitch = kf * 1.02 - over * 0.5 - swOut * 1.3 * wall + coil * 0.16 * wall + fly * 0.06 * wall;
    this.set(p, 'hips', pitch + tr + coil * Math.sin(t * 37) * 0.008 * pl.leap.charge, -handsSide * 0.5 * (1 - fly) + stepping * 0.12, swSide * 1.6 - stepping * 0.07 + (coil * 0.12 - fly * 0.3) * cr);
    p.hp[0] = swSide * -0.5 + handsSide * -0.12 * (1 - fly) + coil * cr * 0.08;
    p.hp[1] = lerp(-0.03, -0.5, kf) - hang * 0.07 + handsUp * 0.22 * (1 - fly) + swUp * 0.4 - tired * 0.04 + (0.006 + pl.exertion * 0.006) * br
      + (-coil * 0.24 * cu + fly * 0.1 + kick * 0.08 - sag * 0.17) * wall - coil * 0.06 * kf;
    p.hp[2] = lerp(0.085, -0.2, kf) - hang * 0.05 - swOut * 0.5 - over * 0.1 + (coil * 0.05 - fly * 0.05 - sag * 0.05) * wall;
    this.set(p, 'spine', -0.1 * wall + 0.05 * kf + 0.012 * br + coil * 0.22 - fly * 0.05 + sag * 0.2, stepping * 0.1, -swSide * 0.5 + stepping * 0.05 - fly * 0.2 * cr);
    this.set(p, 'chest', -0.1 * wall - (0.02 + pl.exertion * 0.025) * br + coil * 0.14 - fly * 0.04 + sag * 0.12, stepping * 0.2, -swSide * 0.4 - fly * 0.15 * cr);
    const lookSide = clamp(-this.cDir.dot(R) * 0.6, -0.6, 0.6), lookUp = clamp(this.cDir.dot(U), -1, 1);
    this.set(p, 'neck', -0.12 * wall - kf * 0.4, lookSide * 0.4, 0);
    this.set(p, 'head', -0.2 * wall - kf * 0.5 - lookUp * 0.2 * wall + hang * 0.12 + tired * 0.2, lookSide * 0.6, swSide * 0.5);
    // the struggle. light: fists clench, the body tucks in to the hide. medium: the feet lose the surface and the
    // body rides the heave. violent: hauled out on straight arms, twisting, legs kicking for a hold, head down.
    const SG = fading ? 0 : this.strain, lt = ss(0.05, 0.35, SG), md = ss(0.3, 0.65, SG), vl = ss(0.6, 0.95, SG);
    const pin = fading ? 0 : ease(this.pullIn || 0), stm = clamp(pl.stamina / pl.t.staminaMax, 0, 1);
    if (lt + pin > 0.001) {
      p.hp[2] += (0.07 * lt * (1 - vl) + 0.09 * pin) * wall; p.hp[1] += 0.05 * pin * wall;
      this.add(p, 'spine', 0.08 * lt + 0.1 * pin, 0, 0); this.add(p, 'chest', 0.1 * lt, 0, 0);
      this.add(p, 'neck', -0.1 * lt, 0, 0); this.add(p, 'head', -0.12 * lt + 0.35 * vl, 0, 0);
      this.add(p, 'clavL', 0, 0, 0.15 * lt); this.add(p, 'clavR', 0, 0, -0.15 * lt);
    }
    if (vl > 0.001) {
      p.hp[2] -= 0.2 * vl * wall; p.hp[1] -= 0.07 * vl * wall;
      this.add(p, 'hips', Math.sin(t * 4.1) * 0.12 * vl, Math.sin(t * 2.7) * 0.28 * vl, 0);
      this.add(p, 'spine', -0.12 * vl, -Math.sin(t * 2.7) * 0.12 * vl, 0);
    }
    this.legFree = Math.max(md * 0.75 * (1 - 0.55 * stm), vl);
    this.kickAmt = md * 0.22 + vl * 0.55;

    for (const s of [1, -1]) {
      const S = s > 0 ? 'L' : 'R', hi = s > 0 ? LH : RH, fi = s > 0 ? LF : RF, hl = this.limbs[hi], fl = this.limbs[fi];
      // FK fallbacks (used when a limb lets go): arms overhead, legs trailing
      this.set(p, 'upperArm' + S, -2.6 * wall - 1.3 * kf - fly * 0.12 * wall, 0, s * (0.2 + fly * 0.12) + fly * cr * 0.35); this.set(p, 'foreArm' + S, -0.5 + fly * 0.3, 0, 0); this.set(p, 'clav' + S, 0, 0, s * 0.22 * wall);
      const kk = fading ? 0 : this.kickAmt || 0, kp = t * 6.3 + s * 1.9;   // alternating kicks for a foothold
      this.set(p, 'thigh' + S, -0.25 + swOut * 1.2 + Math.sin(kp) * kk - kk * 0.35 + fly * (0.42 + s * 0.12 - kick * 0.2), 0, s * 0.12 + swSide * 1.2 - fly * cr * 0.3); this.set(p, 'shin' + S, 0.5 + kk * (0.4 + 0.5 * Math.sin(kp + 1.2)) - fly * (0.3 - s * 0.15) * (1 - kick), 0, 0); this.set(p, 'foot' + S, 0.5 + fly * 0.35, 0, 0);
      // hand on its hold
      t1.copy(hl.world).addScaledVector(U, -0.07).addScaledVector(N, 0.04);
      t2.copy(U).multiplyScalar(-0.9).addScaledVector(R, -s * 0.75).addScaledVector(N, 0.55);
      X.copy(N).multiplyScalar(s); Y.copy(U).negate(); Z.crossVectors(X, Y);
      qa.setFromRotationMatrix(M4.makeBasis(X, Y, Z));
      this.ikSet(p, hi, t1, 1 - fly, t2, qa);
      p.curl[hi] = fly > 0.5 ? 0.3 : hl.t < 1 ? lerp(0.15, 1.0, Math.abs(hl.t - 0.5) * 2 > 0.7 ? 1 : 0.2) : 1.05 + 0.3 * lt;
      // a hand torn loose: it flails out to the side, then claws its way back onto the hold as the slip fades
      const sl = fading ? 0 : ss(0, 0.22, this.slip[hi]);
      if (sl > 0.001) {
        p.ikw[hi] *= 1 - sl; p.curl[hi] = lerp(p.curl[hi], 0.35 + 0.4 * Math.sin(t * 13 + s), sl);
        this.add(p, 'upperArm' + S, (0.9 + Math.sin(t * 8 + s) * 0.35) * sl, 0, s * (0.75 + Math.sin(t * 6.5) * 0.2) * sl); this.add(p, 'foreArm' + S, -0.5 * sl, 0, 0);
      }
      // foot braced on the surface; legs come off and trail when the giant thrashes or under an overhang
      const brace = (1 - (fading ? 0 : this.legFree || 0)) * (1 - ss(0.25, 0.7, over));
      t1.copy(fl.world).addScaledVector(N, lerp(0.085, 0.07, kf));
      t2.copy(N).multiplyScalar(lerp(1, -0.8, kf)).addScaledVector(R, -s * lerp(0.85, 0.25, kf)).addScaledVector(U, lerp(0.35, 0.6, kf));
      Z.copy(N).multiplyScalar(-0.5).addScaledVector(U, lerp(0.85, -0.85, kf)).normalize(); X.copy(R).negate(); Y.crossVectors(Z, X).normalize(); X.crossVectors(Y, Z);
      qa.setFromRotationMatrix(M4.makeBasis(X, Y, Z));
      this.ikSet(p, fi, t1, brace * (1 - fly), t2, qa);
    }
    // standing on the giant: knees soft, weight low, arms loose and a little out for balance as it walks
    const up = fading ? 0 : ease(clamp(this.upright || 0, 0, 1));
    if (up > 0.001) {
      const sway = Math.sin(t * 1.3) * 0.04;
      p.hp[0] = lerp(p.hp[0], sway * 0.3, up); p.hp[1] = lerp(p.hp[1], -0.09 + 0.006 * br, up); p.hp[2] = lerp(p.hp[2], 0.0, up);
      this.mix(p, 'hips', 0.1, 0, sway, up); this.mix(p, 'spine', 0.04 + 0.01 * br, 0, -sway * 0.5, up); this.mix(p, 'chest', -0.02 - 0.015 * br, 0, 0, up);
      this.mix(p, 'neck', 0.04, Math.sin(t * 0.37) * 0.25, 0, up); this.mix(p, 'head', 0.06, Math.sin(t * 0.37 + 0.4) * 0.35, 0, up);
      for (const s of [1, -1]) {
        const S = s > 0 ? 'L' : 'R';
        this.mix(p, 'clav' + S, 0, 0, 0, up); this.mix(p, 'upperArm' + S, 0.12, 0, s * (0.22 + sway * s), up); this.mix(p, 'foreArm' + S, -0.35, 0, 0, up);
        this.mix(p, 'thigh' + S, -0.2, 0, s * 0.1, up); this.mix(p, 'shin' + S, 0.32, 0, 0, up); this.mix(p, 'foot' + S, -0.12, 0, 0, up);
      }
      // walking about on its top: a short, careful stride with the knees kept soft, arms swinging low
      const wk = (fading ? 0 : this.topWalk || 0) * up;
      if (wk > 0.001) {
        const ph = (this.topPh || 0) * Math.PI * 2, s1 = Math.sin(ph), c1 = Math.cos(ph);
        p.hp[1] += (-0.035 + 0.03 * Math.abs(c1)) * wk;
        this.add(p, 'hips', 0.05 * wk, s1 * 0.12 * wk, 0); this.add(p, 'spine', 0.04 * wk, -s1 * 0.1 * wk, 0); this.add(p, 'chest', 0, -s1 * 0.08 * wk, 0);
        for (const s of [1, -1]) {
          const S = s > 0 ? 'L' : 'R', sw = s1 * s, lift = Math.max(0, -c1 * s);
          this.add(p, 'thigh' + S, -0.5 * sw * wk - 0.25 * lift * wk, 0, 0);
          this.add(p, 'shin' + S, 0.75 * lift * wk + 0.1 * wk, 0, 0);
          this.add(p, 'foot' + S, -0.2 * lift * wk, 0, 0);
          this.add(p, 'upperArm' + S, 0.35 * sw * wk, 0, 0); this.add(p, 'foreArm' + S, -0.15 * wk, 0, 0);
        }
      }
      for (let l = 0; l < 4; l++) p.ikw[l] *= 1 - up;
      p.curl[0] = lerp(p.curl[0], 0.45, up); p.curl[1] = lerp(p.curl[1], 0.45, up);
    }
    // off balance on its top with nothing held: crouched low, arms flung out, the body pitched about by the heave
    const tw = fading ? 0 : this.teeterW || 0;
    if (tw > 0.001) {
      const a = Math.sin(t * 5.3), b = Math.sin(t * 3.7 + 1);
      p.hp[1] = lerp(p.hp[1], -0.2 + 0.03 * a, tw); p.hp[2] = lerp(p.hp[2], 0, tw); p.hp[0] = lerp(p.hp[0], 0.08 * b, tw);
      this.mix(p, 'hips', 0.35 + 0.1 * a, 0.25 * b, 0.2 * b, tw); this.mix(p, 'spine', 0.2, -0.15 * b, -0.15 * a, tw); this.mix(p, 'chest', 0.1, 0, 0, tw);
      this.mix(p, 'head', -0.2, 0.3 * b, 0, tw);
      for (const s of [1, -1]) {
        const S = s > 0 ? 'L' : 'R';
        this.mix(p, 'upperArm' + S, -0.6 + 0.4 * a * s, 0, s * (1.0 + 0.3 * b * s), tw); this.mix(p, 'foreArm' + S, -0.4, 0, 0, tw);
        this.mix(p, 'thigh' + S, -0.9 + 0.2 * a * s, 0, s * 0.25, tw); this.mix(p, 'shin' + S, 1.2, 0, 0, tw); this.mix(p, 'foot' + S, -0.3, 0, 0, tw);
      }
      for (let l = 0; l < 4; l++) p.ikw[l] *= 1 - tw;
    }
    // the blow: the right arm leaves the wall
    const spz = fading ? null : pl.strikePose();
    this.strikeW = spz ? spz.w : 0;
    if (spz) {
      const j = spz.shake ? Math.sin(t * 50) * 0.035 * spz.shake : 0, k = spz.w;
      this.mix(p, 'upperArmR', spz.arm + j + pitch * 0.4, 0, -0.25, k); this.mix(p, 'foreArmR', spz.elbow, 0, 0, k); this.mix(p, 'handR', 1.15, 0, 0, k);
      this.add(p, 'chest', spz.lean * k * 0.6, spz.twist * k * 0.7, 0); this.add(p, 'spine', spz.lean * k * 0.4, spz.twist * k * 0.3, 0);
      p.ikw[RH] *= 1 - k; p.curl[RH] = lerp(p.curl[RH], 1.25, k);
    }
    if (fading) p.ikw.fill(0); // let go: the arms sweep down from overhead instead of clinging to old holds
  }

  // ------------------------------------------------------------------ blend → skeleton
  blend() {
    const o = this.out, w = this.w, live = 1 - w.D, kk = w.K * live, rest = live * (1 - w.K);
    const src = [[this.pG, w.G * rest], [this.pA, w.A * rest], [this.pC, w.C * rest], [this.pK, kk], [this.pD, w.D]];
    o.clear();
    for (const [p, k] of src) {
      if (k <= 0.0005) continue;
      for (let i = 0; i < o.e.length; i++) o.e[i] += p.e[i] * k;
      for (let i = 0; i < 3; i++) o.hp[i] += p.hp[i] * k;
      for (let i = 0; i < 2; i++) { o.curl[i] += p.curl[i] * k; o.toe[i] += p.toe[i] * k; }
      for (let l = 0; l < 4; l++) {
        const kk = k * p.ikw[l]; if (kk <= 0) continue;
        o.ikw[l] += kk;
        for (let a = 0; a < 3; a++) { o.ik[l * 3 + a] += p.ik[l * 3 + a] * kk; o.pole[l * 3 + a] += p.pole[l * 3 + a] * kk; }
        const d = o.eq[l * 4] * p.eq[l * 4] + o.eq[l * 4 + 1] * p.eq[l * 4 + 1] + o.eq[l * 4 + 2] * p.eq[l * 4 + 2] + o.eq[l * 4 + 3] * p.eq[l * 4 + 3], sg = d < 0 ? -kk : kk;
        for (let a = 0; a < 4; a++) o.eq[l * 4 + a] += p.eq[l * 4 + a] * sg;
      }
    }
  }

  apply(dt, pl) {
    const o = this.out, b = this.b, list = this.m.list, root = this.m.root;
    root.position.copy(this.vpos); root.rotation.set(0, this.vyaw, 0);
    for (let i = 0; i < this.n; i++) list[i].rotation.set(o.e[i * 3], o.e[i * 3 + 1], o.e[i * 3 + 2]);
    // fingers and thumbs
    for (const s of [1, -1]) {
      const S = s > 0 ? 'L' : 'R', c = o.curl[s > 0 ? 0 : 1];
      b['fingersA' + S].rotation.set(0, 0, -s * c * 1.15); b['fingersB' + S].rotation.set(0, 0, -s * c * 1.2);
      b['thumbA' + S].rotation.set(0, -s * (0.15 + c * 0.5), -s * c * 0.35); b['thumbB' + S].rotation.set(0, 0, -s * c * 0.6);
      b['toe' + S].rotation.x += o.toe[s > 0 ? 0 : 1];
    }
    // keep planted legs from over-stretching: the pelvis sinks just enough (this is what makes the stride bob)
    let drop = 0;
    const hipY = this.vpos.y + DIM.hipJointY + o.hp[1], maxLen = (DIM.thigh + DIM.shin) * 0.992;
    for (const l of [LF, RF]) {
      if (o.ikw[l] < 0.5 || this.w.C > 0.3) continue;
      const k = 1 / o.ikw[l], s = l === LF ? 1 : -1;
      const hx = this.vpos.x + this.left.x * s * DIM.hipJointX + this.fwd.x * o.hp[2], hz = this.vpos.z + this.left.z * s * DIM.hipJointX + this.fwd.z * o.hp[2];
      const dx = o.ik[l * 3] * k - hx, dz = o.ik[l * 3 + 2] * k - hz, hd2 = dx * dx + dz * dz, ay = o.ik[l * 3 + 1] * k;
      const reach = hd2 < maxLen * maxLen ? Math.sqrt(maxLen * maxLen - hd2) : 0;
      const f = this.feet[l - 2];
      if (f.planted || this.down > 0.05) drop = Math.max(drop, hipY - (ay + reach));
    }
    this.drop = damp(this.drop, clamp(drop, 0, 0.3), drop > this.drop ? 40 : 14, dt || 0.016);
    b.hips.position.set(o.hp[0], DIM.hipY + o.hp[1] - this.drop, o.hp[2]);
    root.updateMatrixWorld(true);

    const lim = [[b.upperArmL, b.foreArmL, b.handL, DIM.upperArm, DIM.foreArm, -1], [b.upperArmR, b.foreArmR, b.handR, DIM.upperArm, DIM.foreArm, -1],
      [b.thighL, b.shinL, b.footL, DIM.thigh, DIM.shin, 1], [b.thighR, b.shinR, b.footR, DIM.thigh, DIM.shin, 1]];
    for (let l = 0; l < 4; l++) {
      const wk = o.ikw[l]; if (wk < 0.004) continue;
      const k = 1 / wk, L = lim[l];
      t1.set(o.ik[l * 3] * k, o.ik[l * 3 + 1] * k, o.ik[l * 3 + 2] * k);
      t2.set(o.pole[l * 3], o.pole[l * 3 + 1], o.pole[l * 3 + 2]);
      qa.set(o.eq[l * 4], o.eq[l * 4 + 1], o.eq[l * 4 + 2], o.eq[l * 4 + 3]);
      const hasQ = qa.lengthSq() > 1e-6; if (hasQ) qa.normalize();
      solveLimb(L[0], L[1], L[2], L[3], L[4], t1, t2, L[5], Math.min(1, wk), hasQ ? qa : null);
    }
    // blade: sheathed at the hip, in the fist for the blow
    const armed = pl.strike && pl.strike.phase !== 'none';
    const want = armed ? this.m.grip : this.m.sheath;
    if (this.m.blade.parent !== want) want.add(this.m.blade);
    root.updateMatrixWorld(true);
  }

  // ------------------------------------------------------------------ cloak, scarf, hair
  secondary(dt, pl) {
    const b = this.b, t = this.time, root = this.m.root;
    const gust = 0.55 + 0.45 * Math.sin(t * 0.43) * Math.sin(t * 0.17 + 1) + 0.25 * Math.sin(t * 2.3);
    this.wind.set(2.6 * gust, 0.5 * Math.sin(t * 1.3), 1.5 * gust + Math.sin(t * 3.1) * 0.6);
    const sph = this.spheres; let k = 0;
    const put = (bone, x, y, z, r) => { t1.set(x, y, z).applyMatrix4(bone.matrixWorld); sph[k++] = t1.x; sph[k++] = t1.y; sph[k++] = t1.z; sph[k++] = r; };
    put(b.chest, 0, 0.035, 0.005, 0.138); put(b.spine, 0, 0.06, 0, 0.138); put(b.hips, 0, 0.04, -0.01, 0.158); put(b.hips, 0, -0.1, -0.02, 0.165);
    put(b.thighL, 0, -0.14, 0, 0.1); put(b.thighR, 0, -0.14, 0, 0.1); put(b.thighL, 0, -0.32, 0, 0.085); put(b.thighR, 0, -0.32, 0, 0.085);
    put(b.shinL, 0, -0.1, -0.01, 0.075); put(b.shinR, 0, -0.1, -0.01, 0.075); put(b.head, 0, 0.07, 0, 0.11);
    for (let i = 0; i < 9; i++) this.capePins[i].copy(this.capePinsL[i]).applyMatrix4(b.chest.matrixWorld);
    for (let i = 0; i < 2; i++) this.scarfPins[i].copy(this.scarfPinsL[i]).applyMatrix4(b.chest.matrixWorld);
    const gy = this.vpos.y + 0.03;
    let plane = null;
    if (pl.state === 'climb') { plane = this.plane; plane.n.copy(this.cN); plane.d = this.cN.dot(this.cP) + 0.03; }
    this.cape.step(dt, this.capePins, sph, this.wind, gy, plane);
    this.scarf.step(dt, this.scarfPins, sph, t2.copy(this.wind).multiplyScalar(2.4), gy, plane);
    INV.copy(root.matrixWorld).invert();
    this.cape.write(INV); this.scarf.write(INV);

    // tail of hair: a weighted point on a string, then the bones follow it
    b.hairA.quaternion.identity(); b.hairB.quaternion.identity();
    b.hairA.updateWorldMatrix(true, false);
    t1.setFromMatrixPosition(b.hairA.matrixWorld);
    t2.copy(b.hairB.userData.rest).multiplyScalar(1.6).applyMatrix4(b.hairA.matrixWorld); // rest position of the tip
    if (!this.tailInit || this.tail.distanceToSquared(t2) > 1) { this.tail.copy(t2); this.tailPrev.copy(t2); this.tailInit = true; }
    if (dt > 0) {
      t3.copy(this.tail).sub(this.tailPrev).multiplyScalar(0.9); this.tailPrev.copy(this.tail);
      this.tail.add(t3); this.tail.y -= 9.8 * dt * dt * 0.6; this.tail.lerp(t2, 1 - Math.exp(-16 * dt));
      t3.copy(this.tail).sub(t1).setLength(0.11); this.tail.copy(t1).add(t3);
    }
    b.head.getWorldQuaternion(QP);
    t3.copy(this.tail).sub(t1).normalize().applyQuaternion(QP.invert());
    t4.copy(b.hairB.userData.rest).normalize();
    b.hairA.quaternion.setFromUnitVectors(t4, t3);
    b.hairB.quaternion.identity().slerp(b.hairA.quaternion, 0.7);
  }
}

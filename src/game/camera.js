import * as THREE from 'three';
import { clamp, damp, smoothstep } from '../core/util.js';

const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), tmp3 = new THREE.Vector3();

const BASE_DIST = 4.7;

/** Third-person orbit camera with collision, framing and trauma-based shake. */
export class CameraRig {
  constructor(camera, world, settings, bus) {
    this.camera = camera; this.world = world; this.settings = settings;
    this.yaw = 0; this.pitch = 0.24; this.dist = BASE_DIST; this.targetDist = BASE_DIST;
    this.colDist = BASE_DIST; this.idleLook = 0; this.fov = camera.fov; this.baseFov = camera.fov;
    this.focus = new THREE.Vector3();
    this.trauma = 0; this.shakeTime = 0;
    this.mode = 'follow';
    this.cine = { pos: new THREE.Vector3(), look: new THREE.Vector3(), curLook: new THREE.Vector3(), speed: 1 };
    bus.on('camera:shake', ({ amount = 0.5 }) => this.addTrauma(amount));
    bus.on('colossus:footfall', ({ pos, strength }) => {
      const d = pos.distanceTo(this.camera.position);
      this.addTrauma(clamp(strength * (1 - d / 80), 0, 1) * 0.6);
    });
  }
  addTrauma(a) { this.trauma = clamp(this.trauma + a, 0, 1); }

  snapBehind(playerPos, camYaw) {
    this.yaw = camYaw; this.pitch = 0.22; this.dist = this.targetDist = this.colDist = BASE_DIST; this.idleLook = 0;
    this.focus.copy(playerPos).add(new THREE.Vector3(0, 1.45, 0));
    this.mode = 'follow';
    this.place(1);
  }

  setCinematic(pos, look, speed = 1, snap = false) {
    this.mode = 'cinematic';
    if (this.camera.fov !== this.baseFov) { this.fov = this.camera.fov = this.baseFov; this.camera.updateProjectionMatrix(); }
    this.cine.pos.copy(pos); this.cine.look.copy(look); this.cine.speed = speed;
    if (snap) { this.camera.position.copy(pos); this.cine.curLook.copy(look); this.camera.lookAt(look); }
  }

  update(dt, look, player, colossus) {
    this.shakeTime += dt;
    if (this.mode === 'cinematic') {
      const k = 1 - Math.exp(-this.cine.speed * dt);
      this.camera.position.lerp(this.cine.pos, k);
      this.cine.curLook.lerp(this.cine.look, k);
      this.camera.lookAt(this.cine.curLook);
      this.applyShake(dt);
      return;
    }
    this.yaw += look.yaw; this.pitch = clamp(this.pitch - look.pitch, -1.25, 1.2);
    const hs = Math.hypot(player.vel.x, player.vel.z);
    this.idleLook = Math.abs(look.yaw) + Math.abs(look.pitch) > 1e-4 ? 0 : this.idleLook + dt;
    // left alone, the camera drifts round behind the direction of travel — never when running toward it
    if (player.state === 'ground' && this.idleLook > 1.1 && hs > 1.5) {
      let d = Math.atan2(-player.vel.x, -player.vel.z) - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      if (Math.abs(d) < 2.3) this.yaw += d * Math.min(1, dt * 0.9 * smoothstep(1.1, 2.6, this.idleLook) * smoothstep(1.5, 4, hs));
    }
    // climbing a body: ease the camera out to the open side of the surface so it never sits inside the
    // Colossus — firmer during a stab, so the blow is always framed
    if (player.state === 'climb' && player.climbNormal && Math.abs(look.yaw) < 0.002) {
      const n = player.climbNormal, hl = Math.hypot(n.x, n.z);
      if (hl > 0.3) {
        const want = Math.atan2(n.x, n.z) + (player.strike?.phase !== 'none' ? 0.55 : 0);
        let d = want - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
        const striking = player.strike && player.strike.phase !== 'none';
        if (Math.abs(d) > 1.0 || striking) this.yaw += d * Math.min(1, dt * (striking ? 3.5 : 1.6));
      }
    }
    // framing distance by context
    let want = BASE_DIST + 0.7 * smoothstep(5, 7.4, hs);
    if (player.state === 'climb') want = player.onColossus ? 10 : 6.5;
    if (player.state === 'climb' && player.strike && player.strike.phase !== 'none') want = 6; // lean in for the blow
    else if (colossus && colossus.awakened && colossus.alive) want = 8;
    if (player.state === 'dead') want = 7;
    this.targetDist = want;
    this.dist = damp(this.dist, this.targetDist, 1.6, dt);
    const fy = player.state === 'climb' ? 1.0 : 1.45;
    // follow the body as drawn (it eases through grabs and mantles), looking a little ahead of a run
    tmp.copy(player.rig ? player.rig.vpos : player.pos); tmp.y += fy;
    if (player.state === 'ground') { tmp.x += clamp(player.vel.x * 0.1, -0.6, 0.6); tmp.z += clamp(player.vel.z * 0.1, -0.6, 0.6); }
    this.focus.x = damp(this.focus.x, tmp.x, 9, dt);
    this.focus.z = damp(this.focus.z, tmp.z, 9, dt);
    this.focus.y = damp(this.focus.y, tmp.y, player.state === 'air' ? 4 : 8, dt);
    const fov = this.baseFov + 4 * smoothstep(5, 7.4, hs);
    this.fov = damp(this.fov, fov, 3, dt);
    if (Math.abs(this.camera.fov - this.fov) > 0.02) { this.camera.fov = this.fov; this.camera.updateProjectionMatrix(); }
    this.place(dt);
    this.applyShake(dt);
  }

  place(dt = 1) {
    // The orbit position never dips below POS_MIN; pitching further only tilts the aim upward,
    // so looking up keeps the player low in frame with the sky and the Colossus above.
    const POS_MIN = -0.28;
    const posPitch = Math.max(this.pitch, POS_MIN);
    const cp = Math.cos(posPitch), sp = Math.sin(posPitch);
    const dir = tmp2.set(Math.sin(this.yaw) * cp, sp, Math.cos(this.yaw) * cp);
    // march towards the desired spot and stop before solid geometry
    let d = this.dist;
    const steps = 12;
    for (let i = 1; i <= steps; i++) {
      const s = (i / steps) * this.dist;
      const p = tmp.copy(this.focus).addScaledVector(dir, s);
      if (this.insideSolid(p)) { d = Math.max(0.8, s - 0.4); break; }
    }
    // pull in at once when something is in the way, ease back out afterwards
    this.colDist = d < this.colDist ? damp(this.colDist, d, 30, dt) : damp(this.colDist, d, 2.5, dt);
    if (dt >= 1) this.colDist = d;
    d = Math.min(d, this.colDist);
    const pos = tmp.copy(this.focus).addScaledVector(dir, d);
    const gh = this.world.heightAt(pos.x, pos.z) + 0.4;
    if (pos.y < gh) pos.y = gh;
    this.camera.position.copy(pos);
    const extra = posPitch - this.pitch; // how far past the floor of the orbit we are looking up
    if (extra > 0.001) {
      const f = tmp3.copy(this.focus).sub(pos);
      const hz = Math.hypot(f.x, f.z) || 1e-4;
      const elev = Math.min(1.2, Math.atan2(f.y, hz) + extra * 0.9);
      const look = tmp3.set(f.x / hz * Math.cos(elev), Math.sin(elev), f.z / hz * Math.cos(elev)).add(pos);
      this.camera.lookAt(look);
    } else this.camera.lookAt(this.focus);
  }

  insideSolid(p) {
    for (const c of this.world.colliders) {
      const dx = p.x - c.c.x, dz = p.z - c.c.z, dy = p.y - c.c.y;
      if (Math.abs(dy) > c.h.y + 0.2) continue;
      const lx = dx * c.cos + dz * c.sin, lz = -dx * c.sin + dz * c.cos;
      if (Math.abs(lx) < c.h.x + 0.2 && Math.abs(lz) < c.h.z + 0.2) return true;
    }
    return false;
  }

  applyShake(dt) {
    const scale = this.settings.get('cameraShake') / 100;
    this.trauma = Math.max(0, this.trauma - dt * 0.9);
    this.kick = Math.max(0, (this.kick || 0) - dt * 5);
    if (this.hitV) { // damped spring of the directional jolt
      const w = 14, o = this.hitO, v = this.hitV;
      v.addScaledVector(o, -w * w * dt).multiplyScalar(Math.exp(-2 * 0.55 * w * dt)); o.addScaledVector(v, dt).clampLength(0, 0.6);
      this.rollV += (-w * w * this.roll) * dt; this.rollV *= Math.exp(-2 * 0.5 * w * dt); this.roll = clamp(this.roll + this.rollV * dt, -0.08, 0.08);
      this.camera.position.add(o); this.camera.rotation.z += this.roll;
    }
    if (this.kick > 0) this.camera.rotation.z += Math.sin(this.kick * Math.PI) * 0.025 * scale;
    const s = this.trauma * this.trauma * scale;
    if (s <= 0.0001) return;
    const t = this.shakeTime * 22;
    this.camera.rotation.z += (Math.sin(t * 1.3) + Math.sin(t * 2.1)) * 0.012 * s;
    this.camera.position.x += Math.sin(t * 1.7) * 0.18 * s;
    this.camera.position.y += Math.sin(t * 2.3 + 1) * 0.18 * s;
  }

  /**
   * A directional jolt: the view is shoved the way a blow travelled (dir, world) and springs back,
   * with a roll toward the side it came from. Scaled by the Camera Shake accessibility setting.
   */
  hit(dir, strength = 0.5) {
    if (!dir) return;
    const s = this.settings.get('cameraShake') / 100;
    if (!this.hitV) { this.hitV = new THREE.Vector3(); this.hitO = new THREE.Vector3(); this.rollV = 0; this.roll = 0; }
    this.hitV.addScaledVector(dir, 3.2 * strength * s);
    // right of the view → roll one way, left → the other
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    this.rollV += -(dir.x * rx + dir.z * rz) * 0.5 * strength * s;
  }
  /** Extra continuous shake (e.g. while the colossus thrashes). */
  rumble(amount) { this.trauma = Math.max(this.trauma, amount); }
  /** A sharp push toward the subject plus trauma — the camera "feels" a blow. */
  punch(zoom, trauma) { this.dist = Math.max(1.6, this.dist - zoom); this.kick = 1; this.addTrauma(trauma); }
}

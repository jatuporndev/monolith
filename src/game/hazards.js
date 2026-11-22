import * as THREE from 'three';
import { stoneTexture } from './textures.js';

/**
 * Falling masonry from the ruined tower beside the causeway.
 * Telegraphed by sound, trembling and a growing shadow on the deck — never by UI.
 */
export class RockFall {
  constructor(world, bus, audio) {
    this.world = world; this.bus = bus; this.audio = audio;
    this.active = false; this.timer = 2; this.rocks = [];
    const mat = new THREE.MeshStandardMaterial({ color: 0x7a756c, map: stoneTexture(77), roughness: 1, flatShading: true });
    const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthWrite: false });
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1.25, 0), mat);
      m.castShadow = true; m.visible = false; world.scene.add(m);
      const sh = new THREE.Mesh(new THREE.CircleGeometry(1.6, 24), shadowMat.clone());
      sh.rotation.x = -Math.PI / 2; sh.visible = false; world.scene.add(sh);
      this.rocks.push({ m, sh, state: 'idle', vel: new THREE.Vector3(), t: 0, target: new THREE.Vector3() });
    }
  }
  reset() { this.timer = 2; for (const r of this.rocks) { r.state = 'idle'; r.m.visible = false; r.sh.visible = false; } }

  update(dt, player, enabled) {
    const cw = this.world.causeway;
    const inZone = enabled && player.state !== 'dead' && player.pos.z < cw.hazardZ[1] + 6 && player.pos.z > cw.hazardZ[0] - 4 && Math.abs(player.pos.x) < 4 && player.pos.y > -2;
    if (inZone) {
      this.timer -= dt;
      if (this.timer <= 0) { this.spawn(player); this.timer = 3.2 + Math.random() * 1.8; }
    } else this.timer = Math.min(this.timer, 1.5);

    for (const r of this.rocks) {
      if (r.state === 'warn') {
        r.t += dt;
        r.sh.material.opacity = Math.min(0.45, r.t * 0.3); r.sh.scale.setScalar(0.3 + r.t * 0.6);
        if (r.t > 1.1) { r.state = 'fall'; r.m.visible = true; r.m.position.set(r.target.x + 4, r.target.y + 26, r.target.z); r.vel.set(-4 / 1.55, 0, 0); }
      } else if (r.state === 'fall') {
        r.vel.y -= 22 * dt; r.m.position.addScaledVector(r.vel, dt);
        r.m.rotation.x += dt * 3; r.m.rotation.z += dt * 2;
        const k = 1 - Math.min(1, (r.m.position.y - r.target.y) / 26);
        r.sh.material.opacity = 0.45 + k * 0.25; r.sh.scale.setScalar(0.9 + k * 0.4);
        if (r.m.position.y <= r.target.y + 1.1) this.impact(r, player);
      } else if (r.state === 'rest') {
        r.t += dt;
        r.sh.material.opacity = Math.max(0, r.sh.material.opacity - dt);
        if (r.t > 6) { r.m.position.y -= dt * 0.5; }
        if (r.t > 9) { r.state = 'idle'; r.m.visible = false; r.sh.visible = false; }
      }
    }
  }

  spawn(player) {
    const r = this.rocks.find((x) => x.state === 'idle' || (x.state === 'rest' && x.t > 3));
    if (!r) return;
    // aim at where the player is heading
    const lead = player.vel.clone().setY(0).multiplyScalar(1.1);
    r.target.set(Math.max(-2.2, Math.min(2.2, player.pos.x + lead.x)), this.world.causeway.deckTop, player.pos.z + lead.z);
    r.state = 'warn'; r.t = 0; r.sh.visible = true; r.sh.position.copy(r.target).setY(r.target.y + 0.03);
    r.m.visible = false;
    this.audio.play('rumble');
    this.bus.emit('camera:shake', { amount: 0.2 });
  }

  impact(r, player) {
    r.state = 'rest'; r.t = 0; r.m.position.y = r.target.y + 1.0;
    this.audio.play('rockHit');
    this.bus.emit('camera:shake', { amount: 0.45 });
    const d = Math.hypot(player.pos.x - r.target.x, player.pos.z - r.target.z);
    if (d < 2.5 && player.pos.y < r.target.y + 2.5) {
      const away = new THREE.Vector3(player.pos.x - r.target.x, 0, player.pos.z - r.target.z).normalize();
      player.damage(46, 'crushed', away.multiplyScalar(5).setY(4));
    } else if (d < 5) player.damage(8, 'debris');
  }
}

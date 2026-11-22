import * as THREE from 'three';
import { softDotTexture } from './textures.js';

/**
 * World-contact effects shared by everything heavy: dust puffs where bodies and feet meet the ground,
 * and grit / pebbles kicked loose. One pooled Points cloud for dust and one for debris keep it cheap.
 * Usage: fx.dust(pos, strength) · fx.debris(pos, strength) — strength ~0.3 (a body falling) … 3 (a giant's stomp).
 */
export class ImpactFx {
  constructor(scene, { dust = 0xc9bea4, grit = 0x6e6552 } = {}) {
    const dot = softDotTexture();
    this.d = this.pool(scene, 260, new THREE.PointsMaterial({ map: dot, size: 1, color: dust, transparent: true, opacity: 0.5, depthWrite: false, sizeAttenuation: true, vertexColors: false }), true);
    this.g = this.pool(scene, 160, new THREE.PointsMaterial({ map: dot, size: 0.14, color: grit, transparent: true, opacity: 0.95, depthWrite: false }), false);
  }
  pool(scene, n, mat, sized) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3).fill(-9999), 3));
    if (sized) {
      geo.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(n), 1));
      geo.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(n), 1));
      mat.onBeforeCompile = (sh) => {
        sh.vertexShader = 'attribute float aSize; attribute float aAlpha; varying float vA;\n' + sh.vertexShader.replace('gl_PointSize = size;', 'gl_PointSize = size * aSize; vA = aAlpha;');
        sh.fragmentShader = 'varying float vA;\n' + sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vA;');
      };
    }
    const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; scene.add(pts);
    return { pts, n, i: 0, vel: new Float32Array(n * 3), life: new Float32Array(n), max: new Float32Array(n), size: new Float32Array(n), live: 0 };
  }
  /** A ground-hugging ring of dust that rolls out and rises. */
  dust(pos, strength = 1, { spread = 1, up = 1 } = {}) {
    const P = this.d, count = Math.min(90, Math.round(10 + strength * 22));
    const at = P.pts.geometry.attributes.position;
    for (let k = 0; k < count; k++) {
      const i = P.i; P.i = (P.i + 1) % P.n;
      const a = Math.random() * Math.PI * 2, r = (0.2 + Math.random() * 0.6) * Math.sqrt(strength) * spread;
      at.setXYZ(i, pos.x + Math.cos(a) * r, pos.y + 0.1 + Math.random() * 0.2 * strength, pos.z + Math.sin(a) * r);
      const sp = (1.2 + Math.random() * 2.2) * Math.sqrt(strength) * spread;
      P.vel[i * 3] = Math.cos(a) * sp; P.vel[i * 3 + 1] = (0.3 + Math.random() * 0.9) * up * Math.sqrt(strength); P.vel[i * 3 + 2] = Math.sin(a) * sp;
      P.max[i] = P.life[i] = 1.4 + Math.random() * 1.4 + strength * 0.4;
      P.size[i] = (0.8 + Math.random() * 1.2) * (0.6 + strength * 0.55);
    }
    at.needsUpdate = true; P.live = Math.max(P.live, 4.5);
  }
  /** Grit and small stones thrown up, falling back under gravity. */
  debris(pos, strength = 1) {
    const P = this.g, count = Math.min(60, Math.round(6 + strength * 14));
    const at = P.pts.geometry.attributes.position;
    for (let k = 0; k < count; k++) {
      const i = P.i; P.i = (P.i + 1) % P.n;
      const a = Math.random() * Math.PI * 2, r = Math.random() * 0.8 * Math.sqrt(strength);
      at.setXYZ(i, pos.x + Math.cos(a) * r, pos.y + 0.1, pos.z + Math.sin(a) * r);
      const sp = (0.8 + Math.random() * 2.5) * Math.sqrt(strength);
      P.vel[i * 3] = Math.cos(a) * sp; P.vel[i * 3 + 1] = 2 + Math.random() * 4 * Math.sqrt(strength); P.vel[i * 3 + 2] = Math.sin(a) * sp;
      P.max[i] = P.life[i] = 1.2 + Math.random();
    }
    at.needsUpdate = true; P.live = Math.max(P.live, 2.5);
  }
  update(dt, groundAt) {
    this.step(this.d, dt, false, groundAt);
    this.step(this.g, dt, true, groundAt);
  }
  step(P, dt, heavy, groundAt) {
    if (P.live <= 0) return;
    P.live -= dt;
    const at = P.pts.geometry.attributes.position, v = P.vel, sz = P.pts.geometry.attributes.aSize, al = P.pts.geometry.attributes.aAlpha;
    const drag = Math.exp(-dt * (heavy ? 0.4 : 2.4));
    for (let i = 0; i < P.n; i++) {
      if (P.life[i] <= 0) continue;
      P.life[i] -= dt;
      if (P.life[i] <= 0) { at.setXYZ(i, 0, -9999, 0); continue; }
      v[i * 3] *= drag; v[i * 3 + 2] *= drag;
      v[i * 3 + 1] = heavy ? v[i * 3 + 1] - 16 * dt : v[i * 3 + 1] * drag + 0.15 * dt;
      let x = at.getX(i) + v[i * 3] * dt, y = at.getY(i) + v[i * 3 + 1] * dt, z = at.getZ(i) + v[i * 3 + 2] * dt;
      if (heavy && groundAt) { const g = groundAt(x, z); if (y < g + 0.05) { y = g + 0.05; v[i * 3 + 1] *= -0.25; v[i * 3] *= 0.5; v[i * 3 + 2] *= 0.5; } }
      at.setXYZ(i, x, y, z);
      if (sz) { const u = 1 - P.life[i] / P.max[i]; sz.setX(i, P.size[i] * (1 + u * 2.2)); al.setX(i, Math.min(1, u * 8) * (1 - u) * (1 - u)); }
    }
    at.needsUpdate = true; if (sz) { sz.needsUpdate = true; al.needsUpdate = true; }
  }
}

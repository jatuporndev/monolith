import * as THREE from 'three';
import { mulberry32 } from '../core/util.js';
import { chiseledBox } from './shapes.js';
import { softDotTexture } from './textures.js';

const GRAV = 14;

/**
 * Small stone likenesses of the wardens, standing either side of the plaza path. Each is built from its
 * warden's own body, so it reads as that creature at a glance. When a warden falls, its effigy breaks
 * apart where it stands, and a thread of light-motes drifts from the rubble toward the one still waiting.
 */
export class Effigies {
  constructor(world, audio) {
    this.world = world; this.audio = audio;
    this.list = [];
    this.stoneMat = new THREE.MeshStandardMaterial({ color: 0x9c968a, map: world.tex.stone, roughness: 0.97 });
    this.dot = softDotTexture();
  }

  /** spec: { id, boss, x, z, yaw, scale, plinth: [w, h, d] } */
  add(spec) {
    const w = this.world, y = w.heightAt(spec.x, spec.z), [pw, ph, pd] = spec.plinth;
    const plinth = new THREE.Mesh(chiseledBox(pw, ph, pd, { radius: 0.12, seg: 2, amp: 0.04, seed: spec.x + spec.z }), w.mat.stoneDark);
    plinth.position.set(spec.x, y + ph / 2 - 0.1, spec.z); plinth.rotation.y = spec.yaw;
    plinth.castShadow = plinth.receiveShadow = true; w.scene.add(plinth);
    w.addCollider(plinth.position, new THREE.Vector3(pw / 2, ph / 2, pd / 2), spec.yaw);
    const top = y + ph - 0.1;
    const e = { ...spec, top, plinth, statue: null, pieces: [], state: 'standing', motes: null, moteK: 0 };
    e.statue = this.carve(spec.boss.root, spec.scale);
    e.statue.position.set(spec.x, top, spec.z); e.statue.rotation.y = spec.yaw;
    w.scene.add(e.statue);
    e.statue.updateMatrixWorld(true);
    // remember where every piece stands, so a reload can rebuild it whole
    e.statue.traverse((m) => { if (m.isMesh) e.pieces.push({ m, parent: m.parent, pos: m.position.clone(), quat: m.quaternion.clone(), scale: m.scale.clone() }); });
    this.list.push(e);
    return e;
  }

  /** A stone copy of a warden's body: same pieces, no fur, no light, one weathered material. */
  carve(root, scale) {
    const g = root.clone(true);
    g.position.set(0, 0, 0); g.rotation.set(0, 0, 0); g.scale.setScalar(1);
    const drop = [];
    g.traverse((o) => {
      if (o.isLight || o.isPoints) { drop.push(o); return; }
      if (!o.isMesh) return;
      const m = o.material;
      if (m.transparent || m.alphaTest > 0 || m.blending === THREE.AdditiveBlending || m.isMeshBasicMaterial) { drop.push(o); return; }
      if (o.isSkinnedMesh) {
        // a cloned skin still follows the living warden's bones: carve it as a plain statue in its rest pose instead
        const s = new THREE.Mesh(o.geometry, this.stoneMat); s.position.copy(o.position); s.quaternion.copy(o.quaternion);
        s.castShadow = s.receiveShadow = true; o.parent.add(s); drop.push(o); return;
      }
      o.material = this.stoneMat;
      o.castShadow = true; o.receiveShadow = true;
      o.userData = {};                                  // never a climbable
    });
    for (const o of drop) o.parent?.remove(o);
    // sit the lowest point on the plinth
    const outer = new THREE.Group(); outer.add(g);
    g.scale.setScalar(scale); g.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(g);
    g.position.y = -box.min.y;
    return outer;
  }

  get(id) { return this.list.find((e) => e.id === id); }

  /** Rebuild whole (standing) or lay it out as rubble at once (fallen). */
  setState(id, state) {
    const e = this.get(id); if (!e) return;
    this.restore(e);
    if (state === 'fallen') { this.breakApart(e, false); for (let i = 0; i < 400; i++) this.stepPieces(e, 1 / 60); this.settle(e); }
    if (state !== 'fallen') this.setMotes(e, false);
  }

  restore(e) {
    this.clearColliders(e);
    for (const p of e.pieces) { p.parent.add(p.m); p.m.position.copy(p.pos); p.m.quaternion.copy(p.quat); p.m.scale.copy(p.scale); }
    e.statue.updateMatrixWorld(true);
    e.state = 'standing'; e.flying = null;
  }

  /** Break it where it stands; live = with sound and dust, returns seconds until it has settled. */
  crumble(id, guideTo) {
    const e = this.get(id); if (!e || e.state !== 'standing') return 0;
    this.breakApart(e, true);
    this.audio.play('rumble'); setTimeout(() => this.audio.play('impact', { vol: 0.7 }), 600);
    if (guideTo) this.setMotes(e, true, guideTo);
    return 3;
  }

  breakApart(e, live) {
    const rnd = mulberry32(e.x * 13 + e.z * 7 + 3), scene = this.world.scene;
    e.state = 'falling'; e.flying = [];
    const c = new THREE.Vector3(e.x, e.top, e.z);
    for (const p of e.pieces) {
      const m = p.m;
      scene.attach(m);                                   // keep the world transform it had on the statue
      const out = new THREE.Vector3(m.position.x - c.x, 0, m.position.z - c.z);
      if (out.lengthSq() < 1e-4) out.set(rnd() - 0.5, 0, rnd() - 0.5);
      out.normalize();
      const h = m.position.y - e.top;
      // the top goes first: higher pieces wait less and topple further
      e.flying.push({ m, delay: live ? Math.max(0, 0.9 - h * 0.25) + rnd() * 0.35 : 0,
        v: out.multiplyScalar(0.6 + rnd() * 1.6 + h * 0.25).setY(rnd() * 1.2),
        w: new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(5), rest: false,
        r: Math.max(0.05, new THREE.Box3().setFromObject(m).getSize(new THREE.Vector3()).y * 0.3) });
    }
    if (live) e.dustT = 0;
  }

  stepPieces(e, dt) {
    if (!e.flying) return true;
    let moving = false;
    const q = new THREE.Quaternion(), ax = new THREE.Vector3();
    for (const f of e.flying) {
      if (f.rest) continue;
      if (f.delay > 0) { f.delay -= dt; moving = true; f.m.position.x += (Math.random() - 0.5) * 0.004; continue; }
      f.v.y -= GRAV * dt;
      f.m.position.addScaledVector(f.v, dt);
      const wl = f.w.length();
      if (wl > 1e-3) { q.setFromAxisAngle(ax.copy(f.w).divideScalar(wl), wl * dt); f.m.quaternion.premultiply(q); }
      // floor: the plinth top under the statue, the paving around it
      const onPlinth = Math.abs(f.m.position.x - e.x) < e.plinth[0] * 0.5 && Math.abs(f.m.position.z - e.z) < e.plinth[2] * 0.5;
      const floor = (onPlinth ? e.top : this.world.heightAt(f.m.position.x, f.m.position.z)) + f.r;
      if (f.m.position.y < floor) {
        f.m.position.y = floor;
        if (f.v.y < -1.5) { f.v.y *= -0.25; f.v.x *= 0.5; f.v.z *= 0.5; f.w.multiplyScalar(0.5); }
        else { f.v.set(0, 0, 0); f.w.set(0, 0, 0); f.rest = true; }
      }
      moving = true;
    }
    return !moving;
  }

  /** Settled rubble is solid: each sizeable piece gets a collider (removed again if the effigy is rebuilt). */
  settle(e) {
    e.state = 'fallen'; e.flying = null;
    this.clearColliders(e);
    const box = new THREE.Box3(), size = new THREE.Vector3(), c = new THREE.Vector3();
    for (const p of e.pieces) {
      box.setFromObject(p.m); box.getSize(size); box.getCenter(c);
      if (Math.max(size.x, size.z) < 0.45 || size.y < 0.25) continue;
      const col = { c: c.clone(), h: new THREE.Vector3(size.x * 0.4, size.y * 0.5, size.z * 0.4), cos: 1, sin: 0 };
      this.world.colliders.push(col); e.cols.push(col);
    }
  }

  clearColliders(e) {
    if (!e.cols) { e.cols = []; return; }
    const set = new Set(e.cols);
    this.world.colliders = this.world.colliders.filter((k) => !set.has(k));
    e.cols = [];
  }

  /** A slow thread of motes from the rubble toward the next warden. */
  setMotes(e, on, to) {
    if (!on) { if (e.motes) e.motes.visible = false; e.moteOn = false; return; }
    if (!e.motes) {
      const N = 70, g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
      e.motes = new THREE.Points(g, new THREE.PointsMaterial({ map: this.dot, size: 0.5, color: 0xffe2b0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      e.motes.frustumCulled = false;
      e.moteS = Float32Array.from({ length: N }, (_, i) => i / N);
      this.world.scene.add(e.motes);
    }
    e.motes.visible = true; e.moteOn = true;
    const a = new THREE.Vector3(e.x, e.top + 1.2, e.z), b = to.clone(); b.y += 4;
    const mid = a.clone().lerp(b, 0.35); mid.y = Math.max(a.y, b.y) + 9;
    e.curve = new THREE.QuadraticBezierCurve3(a, mid, b);
  }

  /** The thread fades as the player walks along it, and is gone once the next warden wakes. */
  update(dt, t, focus) {
    for (const e of this.list) {
      if (e.state === 'falling' && this.stepPieces(e, dt)) this.settle(e);
      if (!e.motes) continue;
      const want = e.moteOn ? 1 : 0;
      e.moteK += (want - e.moteK) * Math.min(1, dt * 0.6);
      e.motes.material.opacity = e.moteK * 0.85;
      if (e.moteK < 0.01) { e.motes.visible = e.moteOn; continue; }
      const pos = e.motes.geometry.attributes.position, p = new THREE.Vector3();
      for (let i = 0; i < e.moteS.length; i++) {
        e.moteS[i] = (e.moteS[i] + dt * 0.018) % 1;
        const s = e.moteS[i];
        e.curve.getPoint(s, p);
        p.x += Math.sin(t * 0.7 + i * 1.7) * 0.8; p.y += Math.sin(t * 0.9 + i * 2.3) * 0.5; p.z += Math.cos(t * 0.6 + i * 1.3) * 0.8;
        pos.setXYZ(i, p.x, p.y, p.z);
      }
      pos.needsUpdate = true;
      e.motes.material.size = 0.45 + 0.1 * Math.sin(t * 2);
    }
  }
}

import * as THREE from 'three';
import { lerp } from '../core/util.js';
import { softDotTexture } from './textures.js';
import { chiseledBox, furCards, strandTexture } from './shapes.js';

/**
 * Pieces every warden is built from: the living-fur strand material, grippable fur patches,
 * sigil weak points, and the dust / shockwave / light-mote effects. Each warden supplies its own
 * body, behaviour and palette; this file keeps their shared rules identical.
 */

let strandId = 0;

/** Uniforms driving one warden's coat (time, wind, body-lag spring, thrash). */
export function furUniforms() {
  return { uTime: { value: 0 }, uWind: { value: new THREE.Vector3() }, uLag: { value: new THREE.Vector3() }, uShake: { value: 0 },
    uTouch: { value: Array.from({ length: TOUCH }, () => new THREE.Vector4(0, -9999, 0, 0)) } };
}

const TOUCH = 10;
/**
 * What a climber does to the coat: the locks under each hand and foot are pressed flat and parted, the body
 * drags a furrow through them, and the trail it leaves springs back over a second or two.
 * Points are kept in the warden's own space, so the furrow rides along when the giant moves.
 */
export class FurTouch {
  constructor(fu, root) { this.fu = fu; this.root = root; this.trail = []; this.last = new THREE.Vector3(); this.tmp = new THREE.Vector3(); }
  /** limbs: world points of hands/feet (or null when nobody is on the coat); body: world chest point. */
  update(dt, limbs, body) {
    const v = this.fu.uTouch.value, tr = this.trail;
    for (const p of tr) p.w -= dt * 0.7;
    while (tr.length && tr[0].w <= 0) tr.shift();
    let n = 0;
    if (limbs) {
      for (const l of limbs) v[n++].set(l.x, l.y, l.z, 1);
      v[n++].set(body.x, body.y, body.z, 0.8);
      const loc = this.root.worldToLocal(this.tmp.copy(body));
      if (!tr.length || loc.distanceToSquared(this.last) > 0.1) { tr.push({ p: loc.clone(), w: 0.75 }); this.last.copy(loc); if (tr.length > TOUCH - 5) tr.shift(); }
    }
    for (let i = tr.length - 1; i >= 0 && n < TOUCH; i--) { const w = this.root.localToWorld(this.tmp.copy(tr[i].p)); v[n++].set(w.x, w.y, w.z, Math.max(0, tr[i].w)); }
    for (; n < TOUCH; n++) v[n].set(0, -9999, 0, 0);
  }
}

/**
 * Hanging locks: every lock hangs from its root, trails the body's motion, stirs in the wind and whips
 * when the warden thrashes; soft normals and ragged tips keep the cards from reading as planks.
 */
export function strandMaterial(fu, { color = 0xc2b494, seed = 4, hue = 36, lum = 18, sat = 1 } = {}) {
  const strands = new THREE.MeshStandardMaterial({ color, map: strandTexture(seed, hue, lum, sat), alphaTest: 0.42, side: THREE.DoubleSide, roughness: 1 });
  strands.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, fu);
    sh.vertexShader = 'attribute vec3 aFur;\nuniform float uTime, uShake; uniform vec3 uWind, uLag; uniform vec4 uTouch[10];\nvarying float vTip; varying float vLock; varying float vRoot; varying float vPress;\n' + sh.vertexShader
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nobjectNormal = normalize(objectNormal * 0.55 + vec3(0.0, 0.75, 0.0));')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vTip = aFur.x; vLock = aFur.y; vRoot = aFur.x * aFur.z;
        float bend = aFur.x * aFur.x * aFur.z;
        vec3 wpos = (modelMatrix * vec4(position, 1.0)).xyz;
        float gust = sin(uTime * 1.3 + wpos.x * 0.35 + wpos.z * 0.28 + aFur.y) * 0.6 + sin(uTime * 2.9 + wpos.y * 0.8 + aFur.y * 2.0) * 0.4;
        float flutter = sin(uTime * 6.0 + aFur.y * 3.0 + wpos.y * 2.0) * aFur.x;
        vec3 off = uWind * (0.16 + 0.13 * gust + 0.03 * flutter) + uLag * (0.75 + 0.35 * sin(aFur.y * 1.7))
          + vec3(sin(uTime * 21.0 + aFur.y * 5.0), sin(uTime * 17.0 + aFur.y * 2.0) * 0.5, cos(uTime * 19.0 + aFur.y * 3.0)) * uShake * 0.22;
        off += vec3(sin(uTime * 1.1 + aFur.y * 4.0), 0.0, cos(uTime * 0.9 + aFur.y * 2.3)) * 0.05;   // every lock idles on its own
        off.y -= length(off.xz) * 0.35;                       // a lock that swings out also lifts less than it travels
        // a climber's hands, feet and body press the locks flat and part them; the furrow springs back slowly
        vec3 press = vec3(0.0); vPress = 0.0;
        for (int i = 0; i < 10; i++) {
          vec3 dd = wpos - uTouch[i].xyz; float dl = length(dd);
          float nr = (1.0 - smoothstep(0.1, 0.62, dl)) * uTouch[i].w;
          if (nr > 0.001) { press += (dd / (dl + 0.05) * 0.34 + vec3(0.0, -0.26, 0.0)) * nr; vPress = max(vPress, nr); }
        }
        // each lock answers on its own beat, so a tug runs through the coat instead of moving it as one sheet
        float own = 0.75 + 0.5 * fract(aFur.y * 5.3);
        transformed += (transpose(mat3(modelMatrix)) * (off * own)) * bend;
        transformed += (transpose(mat3(modelMatrix)) * press) * aFur.x * min(aFur.z, 1.4) * 0.9;`);
    sh.fragmentShader = 'varying float vTip; varying float vLock; varying float vRoot; varying float vPress;\n' + sh.fragmentShader
      // locks are lit the same from both sides (their soft normal already leans to the sky)
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n#ifdef DOUBLE_SIDED\nnormal *= faceDirection;\n#endif')
      .replace('#include <map_fragment>', `#include <map_fragment>
        // every strand ends at its own length, so tips are ragged instead of a ruled line
        float strand = fract(sin(floor(vMapUv.x * 70.0) * 12.9898 + vLock * 7.0) * 43758.5453);
        float clump = fract(sin(floor(vMapUv.x * 9.0) * 78.233 + vLock * 3.0) * 12543.123);
        float cut = 0.45 + 0.3 * clump + 0.25 * strand;
        diffuseColor.a *= 1.0 - smoothstep(cut - 0.12, cut + 0.04, vTip);
        diffuseColor.rgb *= mix(0.62, 1.2, smoothstep(0.0, 0.6, vRoot)) * (0.82 + 0.36 * fract(vLock * 3.7)) * (1.0 - 0.28 * vPress);`);
  };
  // one program per warden: a cached program would skip onBeforeCompile and leave this coat's uniforms unbound
  const key = 'wardenStrands' + (++strandId);
  strands.customProgramCacheKey = () => key;
  return strands;
}

/**
 * A grippable patch of coat: a pillowed hide box plus layered locks.
 * face: which local face is the outward (grippable) one — '-z' | '+z' | '+y'.
 */
export function furPatch({ w, h, d, face = '-z', hide, strands, climbables, seed = 1, holes = [], len }) {
  const side = face === '+y' || face === '+z' ? 1 : -1, axis = face === '+y' ? 'y' : 'z';
  const geo = chiseledBox(w, h, d, { radius: Math.min(d, w, h) * 0.45, amp: 0.06, seed, seg: 7 });
  { // corners pulled in so no hard rectangle shows through the coat
    const p = geo.attributes.position, A = w / 2, B = axis === 'z' ? h / 2 : d / 2;
    for (let i = 0; i < p.count; i++) {
      const a = p.getX(i) / A, bRaw = axis === 'z' ? p.getY(i) : p.getZ(i), b = bRaw / B;
      const ka = Math.sqrt(Math.max(0.2, 1 - 0.5 * Math.min(1, b * b))), kb = Math.sqrt(Math.max(0.2, 1 - 0.5 * Math.min(1, a * a)));
      p.setX(i, p.getX(i) * lerp(1, ka, 0.55) * 0.97);
      if (axis === 'z') p.setY(i, bRaw * lerp(1, kb, 0.55) * 0.97); else p.setZ(i, bRaw * lerp(1, kb, 0.55) * 0.97);
    }
    geo.computeVertexNormals();
  }
  const m = new THREE.Mesh(geo, hide); m.castShadow = true; m.receiveShadow = true;
  m.userData.climb = { half: new THREE.Vector3(w / 2, h / 2, d / 2), static: false, side };
  climbables.push(m);
  const cards = new THREE.Mesh(furCards(w, h, d, { side, axis, len: len ?? (axis === 'y' ? 1.2 : 1.0), seed: seed + 101, holes }), strands);
  cards.receiveShadow = true; m.add(cards);
  return m;
}

/** Fur trails the body on a loose spring, so it swings through when the warden stops, turns or bucks. */
export class FurLag {
  constructor(fu) { this.fu = fu; this.lag = new THREE.Vector3(); this.vel = new THREE.Vector3(); this.prev = new THREE.Vector3(); this.init = false; this.tmp = new THREE.Vector3(); }
  jolt(dy) { this.vel.y += dy; }
  update(dt, t, anchor, shake) {
    const u = this.fu; u.uTime.value = t; u.uShake.value = shake;
    const gust = 0.6 + 0.4 * Math.sin(t * 0.43) * Math.sin(t * 0.17 + 1);
    u.uWind.value.set(0.8 * gust, 0, 0.6 * gust);
    if (!this.init || anchor.distanceToSquared(this.prev) > 25) { this.lag.copy(anchor); this.vel.set(0, 0, 0); this.init = true; }
    this.prev.copy(anchor);
    const h = Math.min(dt, 0.033), om = 5.5;
    this.vel.addScaledVector(this.tmp.copy(anchor).sub(this.lag), om * om * h).multiplyScalar(Math.exp(-3.2 * h));
    this.lag.addScaledVector(this.vel, h);
    u.uLag.value.copy(this.lag).sub(anchor).clampLength(0, 0.9);
  }
}

let _sigilTex = null;
/** The carved ring-and-cross every warden bears on its weak points. */
export function sigilTexture() {
  if (_sigilTex) return _sigilTex;
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
  x.strokeStyle = 'rgba(255,240,210,0.95)'; x.lineWidth = 3; x.lineCap = 'round';
  x.beginPath(); x.arc(64, 64, 44, 0, Math.PI * 2); x.stroke();
  x.lineWidth = 2; x.beginPath(); x.arc(64, 64, 30, 0.4, Math.PI * 2 - 0.4); x.stroke();
  x.beginPath(); x.moveTo(64, 26); x.lineTo(64, 102); x.moveTo(40, 52); x.lineTo(88, 52); x.moveTo(46, 80); x.lineTo(82, 80); x.stroke();
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, 'rgba(255,230,190,0.5)'); g.addColorStop(1, 'rgba(255,230,190,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  _sigilTex = new THREE.CanvasTexture(c); _sigilTex.colorSpace = THREE.SRGBColorSpace;
  return _sigilTex;
}

/** A weak point: a faint carved sigil that brightens as the climber nears and flares when struck. */
export function makeSigil(parent, pos, rot, id, tint = 0xfff0d0) {
  const mat = new THREE.MeshBasicMaterial({ map: sigilTexture(), transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending, color: tint });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), mat);
  m.position.copy(pos); m.rotation.copy(rot); parent.add(m);
  const light = new THREE.PointLight(0xffe0a8, 0, 7, 2); light.position.copy(pos); parent.add(light);
  return { id, mesh: m, mat, light, hits: 0, destroyed: false, flash: 0 };
}

/** Shockwave ring, dust burst and the light-motes a struck sigil bleeds. */
export class BossFx {
  constructor(scene, { dust = 0xcabfa6, spark = 0xffd08a } = {}) {
    const dot = softDotTexture();
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.6, 48), new THREE.MeshBasicMaterial({ color: 0xd8ccb2, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    this.ring.rotation.x = -Math.PI / 2; scene.add(this.ring);
    this.dustCount = 120;
    const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.dustCount * 3), 3));
    this.dust = new THREE.Points(dg, new THREE.PointsMaterial({ map: dot, size: 2.2, color: dust, transparent: true, opacity: 0, depthWrite: false }));
    this.dust.frustumCulled = false; this.dustVel = new Float32Array(this.dustCount * 3); scene.add(this.dust);
    this.sparkCount = 90;
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.sparkCount * 3), 3));
    this.sparks = new THREE.Points(sg, new THREE.PointsMaterial({ map: dot, size: 0.15, color: spark, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.sparks.frustumCulled = false; this.sparkVel = new Float32Array(this.sparkCount * 3); this.sparkLife = 0; scene.add(this.sparks);
  }
  shockwave(center, { ring = true, spread = 1 } = {}) {
    if (ring) { this.ring.position.copy(center).setY(center.y + 0.15); this.ringT = 0; }
    const pos = this.dust.geometry.attributes.position;
    for (let i = 0; i < this.dustCount; i++) {
      const a = Math.random() * Math.PI * 2, r = 1 + Math.random() * 2;
      pos.setXYZ(i, center.x + Math.cos(a) * r, center.y + 0.5 + Math.random(), center.z + Math.sin(a) * r);
      this.dustVel[i * 3] = Math.cos(a) * (4 + Math.random() * 6) * spread; this.dustVel[i * 3 + 1] = 1 + Math.random() * 3; this.dustVel[i * 3 + 2] = Math.sin(a) * (4 + Math.random() * 6) * spread;
    }
    pos.needsUpdate = true; this.dustT = 0;
  }
  burst(wp, power) {
    const c = new THREE.Vector3(), n = new THREE.Vector3(0, 0, 1);
    wp.mesh.getWorldPosition(c); n.applyQuaternion(wp.mesh.getWorldQuaternion(new THREE.Quaternion()));
    const pos = this.sparks.geometry.attributes.position, v = this.sparkVel, sp = 4 + power * 3;
    for (let i = 0; i < this.sparkCount; i++) {
      pos.setXYZ(i, c.x + (Math.random() - 0.5) * 0.4, c.y + (Math.random() - 0.5) * 0.4, c.z + (Math.random() - 0.5) * 0.4);
      const r = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(1.4).add(n).normalize().multiplyScalar(sp * (0.4 + Math.random()));
      v[i * 3] = r.x; v[i * 3 + 1] = r.y + 1.5; v[i * 3 + 2] = r.z;
    }
    pos.needsUpdate = true;
    this.sparkLife = 1; this.sparks.material.size = 0.12 + power * 0.05;
  }
  update(dt) {
    if (this.ringT !== undefined && this.ringT < 1.4) {
      this.ringT += dt; const k = this.ringT / 1.4;
      this.ring.scale.setScalar(1 + k * 9); this.ring.material.opacity = (1 - k) * 0.35;
    } else this.ring.material.opacity = 0;
    if (this.dustT !== undefined && this.dustT < 3) {
      this.dustT += dt;
      const pos = this.dust.geometry.attributes.position, v = this.dustVel;
      for (let i = 0; i < this.dustCount; i++) {
        v[i * 3] *= 1 - dt * 1.5; v[i * 3 + 2] *= 1 - dt * 1.5; v[i * 3 + 1] -= dt * 0.8;
        pos.setXYZ(i, pos.getX(i) + v[i * 3] * dt, pos.getY(i) + Math.max(-0.2, v[i * 3 + 1]) * dt, pos.getZ(i) + v[i * 3 + 2] * dt);
      }
      pos.needsUpdate = true;
      this.dust.material.opacity = 0.45 * (1 - this.dustT / 3);
    } else this.dust.material.opacity = 0;
    if (this.sparkLife > 0) {
      this.sparkLife = Math.max(0, this.sparkLife - dt * 1.1);
      const pos = this.sparks.geometry.attributes.position, v = this.sparkVel, drag = Math.exp(-dt * 2.2);
      for (let i = 0; i < this.sparkCount; i++) {
        v[i * 3] *= drag; v[i * 3 + 1] = v[i * 3 + 1] * drag - 3.5 * dt; v[i * 3 + 2] *= drag;
        pos.setXYZ(i, pos.getX(i) + v[i * 3] * dt, pos.getY(i) + v[i * 3 + 1] * dt, pos.getZ(i) + v[i * 3 + 2] * dt);
      }
      pos.needsUpdate = true;
      this.sparks.material.opacity = Math.pow(this.sparkLife, 1.5);
    }
  }
}

export function repeatTex(t, n) { t.repeat.set(n, n); return t; }

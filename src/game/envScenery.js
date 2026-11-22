import * as THREE from 'three';
import { mulberry32 } from '../core/util.js';
import { chiseledBox, mergeGeometries } from './shapes.js';

/**
 * Far scenery and small life: nothing here collides or affects play.
 *  - layered mountain silhouettes beyond the valley rim
 *  - colossal ruins in the haze: a broken aqueduct, leaning towers, a kneeling giant of stone
 *  - a few birds wheeling over the basin, and wind-borne pollen / leaves around the camera
 */

const flat = (g) => { const n = g.index ? g.toNonIndexed() : g; n.deleteAttribute('uv'); return n; };

export function buildMountains(scene, center) {
  const rnd = mulberry32(4242);
  const layers = [
    { R: 560, depth: 190, base: 95, amp: 150, col: 0x55564c },
    { R: 860, depth: 260, base: 170, amp: 260, col: 0x5a5c56 },
    { R: 1240, depth: 320, base: 250, amp: 420, col: 0x626664 },
  ];
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
  const parts = [];
  for (const L of layers) {
    const N = 220, rows = 4;
    const harm = Array.from({ length: 22 }, (_, k) => ({ f: 2 + k * (1 + Math.floor(rnd() * 2)), a: 1 / Math.pow(k + 1.5, 0.85), p: rnd() * 6.283 }));
    const ridge = (th) => { let s = 0, t = 0; for (const h of harm) { s += h.a * (1 - Math.abs(Math.sin(h.f * th * 0.5 + h.p))); t += h.a; } return s / t; };
    const pos = [], col = [], idx = [];
    const c = new THREE.Color(L.col), cc = new THREE.Color();
    for (let i = 0; i <= N; i++) {
      const th = (i / N) * Math.PI * 2, r0 = ridge(th), h = L.base + Math.pow(r0, 1.7) * L.amp * 1.6;
      const sx = Math.sin(th), cz = Math.cos(th), wob = (ridge(th * 3.1 + 1) - 0.5) * L.depth * 0.35;
      const prof = [[-L.depth, -60], [-L.depth * 0.42 + wob, h * 0.5], [0, h], [L.depth * 0.5, h * 0.55]];
      for (let j = 0; j < rows; j++) {
        const [dr, y] = prof[j];
        pos.push(center.x + sx * (L.R + dr), y, center.y + cz * (L.R + dr));
        const shade = 0.82 + r0 * 0.3 + (j === 2 ? 0.08 : 0) + (rnd() - 0.5) * 0.06;
        cc.copy(c).multiplyScalar(shade); col.push(cc.r, cc.g, cc.b);
      }
    }
    for (let i = 0; i < N; i++) for (let j = 0; j < rows - 1; j++) {
      const a = i * rows + j, b = a + rows;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx); g.computeVertexNormals();
    parts.push(g);
  }
  const mesh = new THREE.Mesh(mergeGeometries(parts), mat);
  mesh.frustumCulled = false; mesh.matrixAutoUpdate = false;
  scene.add(mesh);
  return mesh;
}

/** Colossal ruins far outside the playable valley. `mat` is a weathered-stone material at giant scale. */
export function buildFarRuins(scene, mat, heightAt) {
  const rnd = mulberry32(777);
  const parts = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
  const put = (g, x, y, z, ry = 0, rx = 0, rz = 0) => { g = flat(g); g.applyMatrix4(m.compose(p.set(x, y, z), q.setFromEuler(e.set(rx, ry, rz, 'YXZ')), s)); parts.push(g); };
  const stone = (w, h, d, seed, o = {}) => chiseledBox(w, h, d, { radius: Math.min(w, h, d) * 0.06, seg: 2, amp: Math.min(w, d) * 0.03, freq: 0.05, seed, ...o });

  // --- aqueduct: a line of giant arches marching across the north-east, half fallen
  {
    const bayW = 54, deckY = 186, open = 38, spring = 126, thick = 15, baseY = 92;
    // one outline: two piers running down into the hills, joined by a round arch and the deck above
    const shape = new THREE.Shape();
    shape.moveTo(-bayW / 2, -baseY); shape.lineTo(-open / 2, -baseY); shape.lineTo(-open / 2, spring);
    shape.absarc(0, spring, open / 2, Math.PI, 0, true);
    shape.lineTo(open / 2, -baseY); shape.lineTo(bayW / 2, -baseY); shape.lineTo(bayW / 2, deckY); shape.lineTo(-bayW / 2, deckY); shape.closePath();
    const bay = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false, curveSegments: 10 });
    bay.translate(0, 0, -thick / 2);
    const A = new THREE.Vector2(120, -372), B = new THREE.Vector2(470, -96);
    const dir = B.clone().sub(A), len = dir.length(), n = Math.floor(len / bayW); dir.normalize();
    const yaw = Math.atan2(-dir.y, dir.x);
    const gone = new Set([3, 4, 7]);
    for (let i = 0; i < n; i++) {
      const cx = A.x + dir.x * (i + 0.5) * bayW, cz = A.y + dir.y * (i + 0.5) * bayW;
      if (!gone.has(i)) { put(bay.clone(), cx, baseY, cz, yaw); put(stone(bayW + 3, 7, thick + 5, i), cx, baseY + deckY + 3, cz, yaw); continue; }
      // a lone broken pier where the span fell
      const ph = 190 + rnd() * 80;
      put(stone((bayW - open) * 0.9, ph, thick, 20 + i, { taper: [1, 0.82] }), cx - dir.x * bayW * 0.5, ph / 2 + 10, cz - dir.y * bayW * 0.5, yaw, 0, (rnd() - 0.5) * 0.06);
    }
  }
  // --- towers: leaning, broken-topped spires on the ridges
  const towers = [[-285, -292, 30, 235, 0.3], [-430, 230, 26, 190, 1.1], [318, 286, 28, 170, 2.0], [-170, 452, 34, 250, 0.7], [520, 150, 30, 260, 2.6], [-640, -330, 44, 400, 0.2], [80, -640, 40, 360, 1.5]];
  towers.forEach(([x, z, w, h, yaw], i) => {
    const y0 = heightAt(x, z) - 25, lean = (rnd() - 0.5) * 0.07;
    put(stone(w, h, w * 0.9, 40 + i, { taper: [1.12, 0.78] }), x, y0 + h / 2, z, yaw, lean, lean * 0.6);
    put(stone(w * 1.18, h * 0.05, w * 1.08, 50 + i), x, y0 + h * 0.66, z, yaw, lean, lean * 0.6);            // string course
    put(stone(w * 0.5, h * 0.16, w * 0.55, 60 + i, { taper: [1, 0.6] }), x + w * 0.12, y0 + h * 1.06, z - w * 0.1, yaw + 0.4, 0.05, 0.12); // surviving shard of the top
  });
  // --- the kneeling giant: the wardens' statue, a hundred times over, bowed toward the valley
  {
    const S = 24, gx = -505, gz = 12, gy = heightAt(gx, gz) + 4, yaw = Math.PI / 2;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const add = (w, h, d, px, py, pz, rx = 0, rz = 0, seed = 1) => {
      const lx = px * S, lz = pz * S;
      put(stone(w * S, h * S, d * S, 80 + seed), gx + lx * cy + lz * sy, gy + py * S, gz - lx * sy + lz * cy, yaw, rx, rz);
    };
    add(5, 1, 4, 0, 0.5, 0, 0, 0, 1);
    add(1.4, 3.4, 1.2, -0.9, 2.6, 0.3, 0.1, 0, 2);
    add(1.4, 1.2, 3, 0.9, 1.6, 0.2, 0, 0, 3);
    add(2.8, 3.8, 1.8, 0, 5.4, -0.2, -0.18, 0, 4);
    add(1.4, 1.6, 1.5, 0, 7.6, 0.5, 0.5, 0, 5);
    add(0.8, 3.6, 0.8, -1.8, 4.6, 0.6, -0.5, 0.1, 6);
    add(0.8, 3.6, 0.8, 1.8, 4.6, 0.6, -0.5, -0.1, 7);
    add(0.5, 0.3, 4.5, 0, 3.6, 1.8, 0.25, 0, 8);
  }
  const mesh = new THREE.Mesh(mergeGeometries(parts), mat);
  mesh.frustumCulled = false; mesh.matrixAutoUpdate = false;
  scene.add(mesh);
  return mesh;
}

/** A handful of birds circling high over the basin. Returns an update(t) function. */
export function buildBirds(scene, time) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.3, 0, 0, -0.28, -1, 0, -0.12, 0, 0, 0.3, 1, 0, -0.12, 0, 0, -0.28], 3));
  const mat = new THREE.MeshBasicMaterial({ color: 0x2b2a27, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = time;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      float ph = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.23;
      float flap = sin(uTime * 5.5 + ph) * smoothstep(-0.2, 0.5, sin(uTime * 0.35 + ph));   // flap, then glide
      transformed.y += abs(position.x) * (0.18 + flap * 0.55);`);
  };
  mat.customProgramCacheKey = () => 'envBird';
  const N = 9, im = new THREE.InstancedMesh(g, mat, N);
  im.frustumCulled = false;
  const rnd = mulberry32(55);
  const birds = Array.from({ length: N }, (_, i) => ({ r: 38 + rnd() * 70, h: 62 + rnd() * 46, sp: (0.05 + rnd() * 0.035) * (i % 3 === 0 ? -1 : 1), ph: rnd() * 6.28, cx: i < 6 ? 0 : 40, cz: i < 6 ? -95 : 70, s: 0.9 + rnd() * 0.5 }));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
  scene.add(im);
  return (t) => {
    for (let i = 0; i < N; i++) {
      const b = birds[i], a = b.ph + t * b.sp;
      p.set(b.cx + Math.sin(a) * b.r, b.h + Math.sin(a * 2.3 + i) * 5, b.cz + Math.cos(a) * b.r);
      q.setFromEuler(e.set(0, a + (b.sp > 0 ? Math.PI / 2 : -Math.PI / 2), b.sp > 0 ? -0.3 : 0.3, 'YXZ'));
      m.compose(p, q, s.setScalar(b.s)); im.setMatrixAt(i, m);
    }
    im.instanceMatrix.needsUpdate = true;
  };
}

/**
 * Wind-borne particles in a box that follows the camera but stays anchored in the world (positions wrap),
 * so walking through them never drags them along.
 */
export function buildDrift(scene, tex, time, { count, box, size, color, opacity, wind, fall = 0, additive = false, seed = 5 }) {
  const rnd = mulberry32(seed);
  const pos = new Float32Array(count * 3), sd = new Float32Array(count);
  for (let i = 0; i < count; i++) { pos[i * 3] = rnd(); pos[i * 3 + 1] = rnd(); pos[i * 3 + 2] = rnd(); sd[i] = rnd(); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(sd, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: { uTime: time, uFocus: { value: new THREE.Vector3() }, uBox: { value: box }, uSize: { value: size }, uColor: { value: new THREE.Color(color) },
      uOpacity: { value: opacity }, uWind: { value: wind }, uFall: { value: fall }, uPx: { value: 800 }, tDot: { value: tex } },
    vertexShader: /* glsl */`
      uniform float uTime, uSize, uFall, uPx; uniform vec3 uFocus, uBox, uWind; attribute float aSeed; varying float vA;
      void main(){
        vec3 p = position * uBox + uWind * uTime * (0.5 + aSeed);
        p.y -= uFall * uTime * (0.5 + aSeed);
        p.x += sin(uTime * 0.7 + aSeed * 40.0) * 0.5; p.z += cos(uTime * 0.53 + aSeed * 31.0) * 0.5; p.y += sin(uTime * 0.9 + aSeed * 17.0) * 0.2;
        p = mod(p - uFocus + uBox * 0.5, uBox) - uBox * 0.5 + uFocus;
        vec3 d = abs(p - uFocus) / (uBox * 0.5);
        vec4 mv = viewMatrix * vec4(p, 1.0);
        vA = (1.0 - smoothstep(0.7, 1.0, max(d.x, max(d.y, d.z)))) * smoothstep(0.3, 1.5, -mv.z) * (0.5 + 0.5 * sin(uTime * (0.6 + aSeed) + aSeed * 50.0) * 0.6 + 0.3);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uSize * (0.5 + aSeed) * uPx * projectionMatrix[1][1] / max(-mv.z, 0.1);
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D tDot; uniform vec3 uColor; uniform float uOpacity; varying float vA;
      void main(){ float a = texture2D(tDot, gl_PointCoord).a * vA * uOpacity; if (a < 0.004) discard; gl_FragColor = vec4(uColor, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  scene.add(pts);
  return mat.uniforms;
}

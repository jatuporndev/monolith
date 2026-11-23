import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../core/util.js';

/** Cheap smooth 3D value-ish noise from sines — position based, so shared seams stay closed. */
export function noise3(x, y, z, seed = 0) {
  return (
    Math.sin(x * 1.7 + seed * 1.3 + Math.sin(z * 1.1 + seed)) * 0.5 +
    Math.sin(y * 2.3 - seed * 0.7 + Math.sin(x * 0.9)) * 0.3 +
    Math.sin(z * 2.9 + y * 1.3 + seed * 2.1) * 0.2
  );
}

/**
 * A box with rounded, chipped edges — reads as hewn stone instead of a primitive.
 * taper: [bottomScale, topScale] applied to x/z along y. amp: displacement in metres.
 */
export function chiseledBox(w, h, d, { radius = 0.25, seg = 3, amp = 0.08, freq = 1.2, seed = 1, taper = null, bulge = 0 } = {}) {
  const r = Math.min(radius, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001);
  let g = new RoundedBoxGeometry(w, h, d, seg, r);
  g.deleteAttribute('normal');
  g = mergeVertices(g, 1e-4);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k = (v.y + h / 2) / h; // 0 bottom → 1 top
    if (taper) { const s = taper[0] + (taper[1] - taper[0]) * k; v.x *= s; v.z *= s; }
    if (bulge) { const b = 1 + bulge * Math.sin(k * Math.PI); v.x *= b; v.z *= b; }
    const n = noise3(v.x * freq, v.y * freq, v.z * freq, seed) + noise3(v.x * freq * 3.1, v.y * freq * 3.1, v.z * freq * 3.1, seed + 5) * 0.35;
    const len = v.length() || 1;
    v.addScaledVector(v.clone().divideScalar(len), n * amp);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/** Lumpy rounded blob (rocks, bushes, canopy). */
export function blob(radius = 1, detail = 2, amp = 0.18, seed = 1, squash = 1) {
  let g = new THREE.IcosahedronGeometry(radius, detail);
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  g = mergeVertices(g, 1e-4);
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = noise3(v.x * 1.9, v.y * 1.9, v.z * 1.9, seed) + noise3(v.x * 4.3, v.y * 4.3, v.z * 4.3, seed + 3) * 0.4;
    v.multiplyScalar(1 + n * amp); v.y *= squash;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/** Alpha strand texture for shaggy fur cards. */
export function strandTexture(seed = 4, hue = 40, lum = 18, sat = 1) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const x = c.getContext('2d'); const rnd = mulberry32(seed);
  x.lineCap = 'round';
  for (let i = 0; i < 700; i++) {
    const sx = rnd() * 256, len = 120 + rnd() * 136, sway = (rnd() - 0.5) * 40;
    const l = lum + rnd() * 30;
    x.strokeStyle = `hsla(${hue + rnd() * 20}, ${(18 + rnd() * 18) * sat}%, ${l}%, ${0.75 + rnd() * 0.25})`;
    x.lineWidth = 1.5 + rnd() * 3.5;
    x.beginPath(); x.moveTo(sx, 0); x.quadraticCurveTo(sx + sway * 0.3, len * 0.5, sx + sway, len); x.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}

/**
 * Layered fur cards that hang off the outward face of a fur slab.
 * The slab's outward face is local -z when side=-1 (fur on backs/undersides).
 */
export function furCards(w, h, d, { side = -1, rows = 0, len = 1.1, seed = 1, axis = 'z', holes = [] } = {}) {
  const rnd = mulberry32(seed * 977 + 13);
  const parts = [];
  const mk = (cw, cl, x, y, z, tilt, yaw = 0) => {
    const g = new THREE.PlaneGeometry(cw, cl, 2, 5); g.translate(0, -cl / 2, 0);
    // droop outward along the length; aFur = (0 root → 1 tip, per-lock phase, lock length) drives the sway shader
    const p = g.attributes.position, fur = new Float32Array(p.count * 3), phase = (parts.length * 2.399) % 6.283;
    for (let i = 0; i < p.count; i++) {
      const t = -p.getY(i) / cl; p.setZ(i, p.getZ(i) + t * t * 0.25);
      p.setX(i, p.getX(i) * (1 - t * t * 0.35) + Math.sin(t * 4 + phase) * 0.07 * t * cw);   // locks narrow toward the tip and wander a little
      fur[i * 3] = t; fur[i * 3 + 1] = phase; fur[i * 3 + 2] = cl;
    }
    g.setAttribute('aFur', new THREE.BufferAttribute(fur, 3));
    g.rotateX(tilt); g.rotateY(yaw); g.translate(x, y, z);
    parts.push(g);
  };
  if (axis === 'y') {
    // horizontal slab (shoulders / crown): a ragged mane spilling over all four rims, short tufts standing on top
    const rimX = Math.max(3, Math.round(w / 0.5)), rimZ = Math.max(3, Math.round(d / 0.5));
    for (let i = 0; i < rimX; i++) for (const sz of [-1, 1]) {
      const x = -w / 2 + (i + rnd()) * (w / rimX);
      mk(0.55 + rnd() * 0.6, len * (0.55 + rnd() * 0.95), x, h / 2 - rnd() * 0.1, sz * (d / 2 + 0.02 - rnd() * 0.25), -0.12 - rnd() * 0.6, (sz < 0 ? Math.PI : 0) + (rnd() - 0.5) * 0.9);
    }
    for (let i = 0; i < rimZ; i++) for (const sx of [-1, 1]) {
      const z = -d / 2 + (i + rnd()) * (d / rimZ);
      mk(0.55 + rnd() * 0.6, len * (0.55 + rnd() * 0.95), sx * (w / 2 + 0.02 - rnd() * 0.25), h / 2 - rnd() * 0.1, z, -0.12 - rnd() * 0.6, sx * Math.PI / 2 + (rnd() - 0.5) * 0.9);
    }
    const tufts = Math.round(w * d * 2.6);
    for (let i = 0; i < tufts; i++) {
      const x = (rnd() - 0.5) * w * 0.96, z = (rnd() - 0.5) * d * 0.96;
      if (holes.some((o) => Math.hypot(x - o.x, z - o.y) < o.r)) continue;
      mk(0.3 + rnd() * 0.35, 0.28 + rnd() * 0.4, x, h / 2 - 0.03, z, Math.PI - 0.35 - rnd() * 0.75, rnd() * 6.283);
    }
  } else {
    const z = side * (d / 2 + 0.02);
    const nRows = rows || Math.max(1, Math.round(h / 0.6));
    for (let r = 0; r < nRows; r++) {
      const y = h / 2 - (r / nRows) * h - 0.1;
      const n = Math.max(2, Math.round(w / 0.5));
      for (let i = 0; i < n; i++) {
        const x = -w / 2 + (i + 0.5) * (w / n) + (rnd() - 0.5) * 0.4;
        const l = len * (0.75 + rnd() * 1.0) * (r === nRows - 1 ? 1.35 : 1);
        // keep a clearing around weak points so the sigil is never hidden under fur
        if (holes.some((o) => Math.abs(x - o.x) < o.r && y > o.y - o.r && y - l < o.y + o.r)) continue;
        mk(w / n * (1.5 + rnd() * 0.9), l, x, y + (rnd() - 0.5) * 0.55, z + side * rnd() * 0.1, -0.06 - rnd() * 0.3, (side < 0 ? Math.PI : 0) + (rnd() - 0.5) * 0.9);
      }
    }
    // ragged rim: locks spill past every edge at their own length and angle, so the coat never ends on a ruled line
    const base = side < 0 ? Math.PI : 0, turn = side < 0 ? -1 : 1;
    const rimY = Math.max(3, Math.round(h / 0.4));
    for (const sx of [-1, 1]) for (let i = 0; i < rimY; i++) {
      const y = h / 2 - (i + rnd()) * (h / rimY);
      mk(0.45 + rnd() * 0.55, len * (0.6 + rnd() * 1.0), sx * (w / 2 + rnd() * 0.16), y, z * (0.15 + rnd() * 0.85), -0.12 - rnd() * 0.4, base + sx * turn * (0.5 + rnd() * 0.9));
    }
    const rimT = Math.max(3, Math.round(w / 0.4));
    for (let i = 0; i < rimT; i++) { // crest: short locks arching up and over the top edge
      const x = -w / 2 + (i + rnd()) * (w / rimT);
      mk(0.45 + rnd() * 0.5, len * (0.4 + rnd() * 0.55), x, h / 2 + rnd() * 0.08, z * (0.3 + rnd() * 0.7), -0.7 - rnd() * 1.25, base + (rnd() - 0.5) * 1.0);
    }
    for (let i = 0; i < rimT; i++) { // hem: long uneven locks trailing below
      const x = -w / 2 + (i + rnd()) * (w / rimT);
      if (rnd() < 0.35) continue;
      mk(0.4 + rnd() * 0.5, len * (1.1 + rnd() * 1.3), x, -h / 2 + rnd() * 0.45, z + side * rnd() * 0.08, -0.04 - rnd() * 0.2, base + (rnd() - 0.5) * 0.8);
    }
  }
  const g = mergeGeometries(parts.map((p) => p.toNonIndexed()));
  g.computeVertexNormals();
  return g;
}

export { mergeGeometries };

import * as THREE from 'three';

/**
 * Sculpted creature bodies.
 *
 * A warden's body is described as a set of soft primitives (round cones, ellipsoids, rounded boxes, carved-out
 * pockets), each one fastened to a joint (any Object3D of the existing rig). They are blended into ONE signed
 * distance field with smooth unions, weathered with ridged noise (cracks, pitting, erosion), polygonised with
 * surface nets, and the resulting mesh is skinned to the rig: every vertex follows the joints whose primitives
 * it was made from, so a knee bends as one surface instead of two boxes meeting at a seam.
 *
 * Colour comes from per-primitive material tags blended across the surface, plus cavity occlusion, moss/lichen
 * on up-facing surfaces, and stains; the stone grain and glowing veins are projected triplanar in bind space,
 * so the texture stays fixed to the skin as it moves.
 */

// ------------------------------------------------------------------ noise
const PERM = new Uint8Array(512);
{ let s = 1337; const p = [...Array(256).keys()]; for (let i = 255; i > 0; i--) { s = (s * 16807) % 2147483647; const j = s % (i + 1); [p[i], p[j]] = [p[j], p[i]]; } for (let i = 0; i < 512; i++) PERM[i] = p[i & 255]; }
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const G = new Float32Array(256 * 3);
for (let i = 0; i < 256; i++) { const a = PERM[i] / 256 * Math.PI * 2, z = (PERM[i + 37] / 128) - 1, r = Math.sqrt(1 - z * z); G[i * 3] = r * Math.cos(a); G[i * 3 + 1] = r * Math.sin(a); G[i * 3 + 2] = z; }
function grad(h, x, y, z) { const i = h * 3; return G[i] * x + G[i + 1] * y + G[i + 2] * z; }
/** Gradient noise, about −1…1. */
export function pnoise(x, y, z) {
  const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
  x -= X; y -= Y; z -= Z;
  const xi = X & 255, yi = Y & 255, zi = Z & 255, u = fade(x), v = fade(y), w = fade(z);
  const A = PERM[xi] + yi, AA = PERM[A] + zi, AB = PERM[A + 1] + zi, B = PERM[xi + 1] + yi, BA = PERM[B] + zi, BB = PERM[B + 1] + zi;
  const l = (a, b, t) => a + (b - a) * t;
  return 1.6 * l(
    l(l(grad(PERM[AA], x, y, z), grad(PERM[BA], x - 1, y, z), u), l(grad(PERM[AB], x, y - 1, z), grad(PERM[BB], x - 1, y - 1, z), u), v),
    l(l(grad(PERM[AA + 1], x, y, z - 1), grad(PERM[BA + 1], x - 1, y, z - 1), u), l(grad(PERM[AB + 1], x, y - 1, z - 1), grad(PERM[BB + 1], x - 1, y - 1, z - 1), u), v), w);
}

/** Cellular noise: distance to the nearest cell border (F2 − F1), for the seams between fused stones. */
const H3 = (i, j, k, o) => { let h = (i * 374761393 + j * 668265263 + k * 2147483647 + o * 1274126177) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
export function cellEdge(x, y, z) {
  const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
  let f1 = 1e9, f2 = 1e9;
  for (let k = -1; k <= 1; k++) for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = X + i, cy = Y + j, cz = Z + k;
    const dx = cx + H3(cx, cy, cz, 1) - x, dy = cy + H3(cx, cy, cz, 2) - y, dz = cz + H3(cx, cy, cz, 3) - z;
    const d = dx * dx + dy * dy + dz * dz;
    if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
  }
  return Math.sqrt(f2) - Math.sqrt(f1);
}

// ------------------------------------------------------------------ primitives
const smin = (a, b, k) => { if (k <= 0) return Math.min(a, b); const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
const smax = (a, b, k) => -smin(-a, -b, k);

function sdRoundCone(px, py, pz, P) {
  // iq: round cone between a (r1) and b (r2)
  const bx = P.bx - P.ax, by = P.by - P.ay, bz = P.bz - P.az;
  const l2 = bx * bx + by * by + bz * bz, rr = P.r1 - P.r2, a2 = l2 - rr * rr, il2 = 1 / l2;
  const qx = px - P.ax, qy = py - P.ay, qz = pz - P.az;
  const y = qx * bx + qy * by + qz * bz, z = y - l2;
  const cx = qx * l2 - bx * y, cy = qy * l2 - by * y, cz = qz * l2 - bz * y;
  const x2 = cx * cx + cy * cy + cz * cz, y2 = y * y * l2, z2 = z * z * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - P.r2;
  if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - P.r1;
  return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - P.r1;
}
function local(px, py, pz, P, out) {
  const dx = px - P.cx, dy = py - P.cy, dz = pz - P.cz, m = P.inv; // inv: world→local rotation (row-major 3x3)
  out[0] = m[0] * dx + m[1] * dy + m[2] * dz; out[1] = m[3] * dx + m[4] * dy + m[5] * dz; out[2] = m[6] * dx + m[7] * dy + m[8] * dz;
}
const LQ = [0, 0, 0];
function sdEllipsoid(px, py, pz, P) {
  local(px, py, pz, P, LQ);
  const x = LQ[0] / P.rx, y = LQ[1] / P.ry, z = LQ[2] / P.rz;
  const k0 = Math.sqrt(x * x + y * y + z * z);
  const x2 = LQ[0] / (P.rx * P.rx), y2 = LQ[1] / (P.ry * P.ry), z2 = LQ[2] / (P.rz * P.rz);
  const k1 = Math.sqrt(x2 * x2 + y2 * y2 + z2 * z2) || 1e-6;
  return k0 * (k0 - 1) / k1;
}
function sdRBox(px, py, pz, P) {
  local(px, py, pz, P, LQ);
  const qx = Math.abs(LQ[0]) - P.hx + P.r, qy = Math.abs(LQ[1]) - P.hy + P.r, qz = Math.abs(LQ[2]) - P.hz + P.r;
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
  return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, qy, qz), 0) - P.r;
}
const SD = { cone: sdRoundCone, ell: sdEllipsoid, box: sdRBox };
const NONE = [];

const _m = new THREE.Matrix4(), _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3();

export class Sculpt {
  /** root: the object the mesh is attached to (its space is the mesh space). */
  constructor(root) { this.root = root; this.prims = []; }
  /** Bone-local point → root space at rest. */
  toRoot(bone, x, y, z) {
    _m.copy(this.rootInv).multiply(bone.matrixWorld);
    return _v.set(x, y, z).applyMatrix4(_m).clone();
  }
  prep() { this.root.updateMatrixWorld(true); this.rootInv = this.root.matrixWorld.clone().invert(); }
  /**
   * Make the parts fastened to these joints a separate limb: it blends smoothly only with itself (and with
   * primitives marked `join: <its id>`), and meets the rest of the body with a hard edge. Without this, a limb
   * hanging close to the body melts into it and the skin stretches into webbing when the limb swings away.
   * Call before adding primitives. Returns the limb's id.
   */
  limb(bones) { this.limbs ??= new Map(); const id = (this.nLimb = (this.nLimb || 0) + 1); for (const b of bones) this.limbs.set(b, id); return id; }
  add(P) { P.k ??= 0.6; P.tag ??= 0; P.rough ??= 1; P.g ??= this.limbs?.get(P.bone) ?? 0; this.prims.push(P); return P; }
  /** Tapered limb between two bone-local points. */
  cone(bone, a, b, r1, r2 = r1, o = {}) {
    if (!this.rootInv) this.prep();
    const A = this.toRoot(bone, ...a), B = this.toRoot(bone, ...b);
    return this.add({ type: 'cone', bone, ax: A.x, ay: A.y, az: A.z, bx: B.x, by: B.y, bz: B.z, r1, r2, ...o, bb: [Math.min(A.x, B.x) - Math.max(r1, r2), Math.min(A.y, B.y) - Math.max(r1, r2), Math.min(A.z, B.z) - Math.max(r1, r2), Math.max(A.x, B.x) + Math.max(r1, r2), Math.max(A.y, B.y) + Math.max(r1, r2), Math.max(A.z, B.z) + Math.max(r1, r2)] });
  }
  orient(bone, c, rot, P) {
    if (!this.rootInv) this.prep();
    _m.copy(this.rootInv).multiply(bone.matrixWorld);
    const C = _v.set(...c).applyMatrix4(_m);
    _m.decompose(_s, _q, _s); const q = _q.clone().multiply(new THREE.Quaternion().setFromEuler(_e.set(...(rot || [0, 0, 0]))));
    const inv = new THREE.Matrix4().makeRotationFromQuaternion(q.invert()).elements; // column-major
    P.cx = C.x; P.cy = C.y; P.cz = C.z;
    P.inv = [inv[0], inv[4], inv[8], inv[1], inv[5], inv[9], inv[2], inv[6], inv[10]];
    return P;
  }
  ell(bone, c, r, o = {}) {
    const P = this.orient(bone, c, o.rot, { type: 'ell', bone, rx: r[0], ry: r[1], rz: r[2], ...o });
    const m = Math.max(...r); P.bb = [P.cx - m, P.cy - m, P.cz - m, P.cx + m, P.cy + m, P.cz + m];
    return this.add(P);
  }
  box(bone, c, h, r, o = {}) {
    const P = this.orient(bone, c, o.rot, { type: 'box', bone, hx: h[0], hy: h[1], hz: h[2], r, ...o });
    const m = Math.hypot(...h); P.bb = [P.cx - m, P.cy - m, P.cz - m, P.cx + m, P.cy + m, P.cz + m];
    return this.add(P);
  }

  /** Field without surface detail (also used for weights). */
  base(x, y, z, ds) {
    let d = 1e9;
    const pr = this.prims, A = this.acc;
    // only the primitives whose reach covers this point (see accel) can shape the surface here
    const ix = Math.floor((x - A.o[0]) / A.cs), iy = Math.floor((y - A.o[1]) / A.cs), iz = Math.floor((z - A.o[2]) / A.cs);
    const list = ix < 0 || iy < 0 || iz < 0 || ix >= A.n[0] || iy >= A.n[1] || iz >= A.n[2] ? NONE : A.cells[ix + A.n[0] * (iy + A.n[1] * iz)] || NONE;
    this.near = list;
    const ng = this.nLimb || 0, dg = this.dg || (this.dg = new Float64Array(ng + 1));
    if (ng) dg.fill(1e9);
    for (let q = 0; q < list.length; q++) {
      const i = list[q], P = pr[i];
      if (P.sub) continue;
      const di = SD[P.type](x, y, z, P);
      if (ds) ds[i] = di;
      if (!ng) { d = smin(d, di, P.k); continue; }
      dg[P.g] = smin(dg[P.g], di, P.k);
      if (P.join !== undefined) dg[P.join] = smin(dg[P.join], di, P.k);
    }
    // limbs meet the body (and each other) with only a narrow fillet
    if (ng) for (let gi = 0; gi <= ng; gi++) d = smin(d, dg[gi], 0.12);
    if (d > 8) return 8;
    for (let q = 0; q < list.length; q++) {
      const i = list[q], P = pr[i]; if (!P.sub) continue;
      const di = SD[P.type](x, y, z, P); if (ds) ds[i] = di;
      d = smax(d, -di, P.k);
    }
    return d;
  }
  /** Coarse grid of "which primitives matter here", so the field never walks the whole body. */
  accel(lo, hi) {
    const cs = 1.1, pad = 2.6, o = [lo[0] - pad, lo[1] - pad, lo[2] - pad];
    const n = [0, 1, 2].map((a) => Math.ceil((hi[a] - lo[a] + pad * 2) / cs) + 1), cells = new Array(n[0] * n[1] * n[2]);
    this.prims.forEach((P, i) => {
      const m = P.k + 1.4, r = [0, 1, 2].map((a) => [Math.max(0, Math.floor((P.bb[a] - m - o[a]) / cs)), Math.min(n[a] - 1, Math.floor((P.bb[a + 3] + m - o[a]) / cs))]);
      for (let k = r[2][0]; k <= r[2][1]; k++) for (let j = r[1][0]; j <= r[1][1]; j++) for (let ii = r[0][0]; ii <= r[0][1]; ii++) (cells[ii + n[0] * (j + n[1] * k)] ||= []).push(i);
    });
    this.acc = { o, cs, n, cells };
  }
  /** Weathered field: ridged cracks, pitting and broad erosion, scaled by the roughness of what is near. */
  field(x, y, z) {
    const d = this.base(x, y, z, this.dsR);
    if (d > 1.2 || d < -1.2) return d;
    const D = this.detail, f = D.freq;
    const rough = this.roughOf(d);
    // broad erosion + fine pitting
    const n1 = pnoise(x * f, y * f, z * f), n2 = pnoise(x * f * 3.1 + 11, y * f * 3.1, z * f * 3.1) * 0.35;
    // seams between fused blocks of stone (cellular), each block slightly proud of its neighbours: a body built like a ruin
    let seam = 0, block = 0;
    if (D.cell) {
      const cs = 1 / D.cell, e = cellEdge(x * cs, y * cs * 0.8, z * cs);
      seam = Math.max(0, 1 - e / D.seamW); seam *= seam;
      block = pnoise(Math.floor(x * cs) * 7.1, Math.floor(y * cs * 0.8) * 3.3, Math.floor(z * cs) * 5.7) * 0.5 + 0.5;
    }
    const crack = 1 - Math.abs(pnoise(x * f * 0.9 + 5, y * f * 1.6, z * f * 0.9 + 3));   // ridged: thin fissures
    return d - (n1 * D.amp + n2 * D.amp) * rough + (Math.pow(crack, 12) * D.crack + seam * (D.seam || 0) - block * (D.block || 0)) * rough;
  }

  /**
   * Polygonise, colour, weight and skin. Returns a SkinnedMesh attached to root.
   * opts: voxel (m), detail {freq, amp, crack}, palette [THREE.Color per tag], moss {color, amount, tag?}, material
   */
  build(opts) {
    const { voxel = 0.25, detail = { freq: 0.9, amp: 0.1, crack: 0.12 }, palette, moss = null, stain = 0.15, material, seedShift = 0, paint = null } = opts;
    this.detail = detail; const t0 = performance.now();
    if (!this.rootInv) this.prep();
    const pr = this.prims;
    // bounds
    const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
    for (const P of pr) { if (P.sub) continue; for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], P.bb[a]); hi[a] = Math.max(hi[a], P.bb[a + 3]); } }
    const pad = 0.8; for (let a = 0; a < 3; a++) { lo[a] -= pad; hi[a] += pad; }
    this.accel(lo, hi);
    const h = voxel, nx = Math.ceil((hi[0] - lo[0]) / h) + 1, ny = Math.ceil((hi[1] - lo[1]) / h) + 1, nz = Math.ceil((hi[2] - lo[2]) / h) + 1;
    // roughness per point: blended from nearby primitives' `rough`
    const dsTmp = new Float32Array(pr.length);
    this.dsR = dsTmp;
    this.roughOf = (d0) => {
      const list = this.near; let sw = 0, sr = 0;
      for (let q = 0; q < list.length; q++) { const i = list[q]; if (pr[i].sub) continue; const w = Math.exp(-(dsTmp[i] - d0) / 0.35); sw += w; sr += w * pr[i].rough; }
      return sw > 0 ? sr / sw : 1;
    };
    // sample (coarse rough lookup would be cheaper; the field only does it near the surface)
    const F = new Float32Array(nx * ny * nz);
    const idx = (i, j, k) => i + nx * (j + ny * k);
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      F[idx(i, j, k)] = this.field(lo[0] + i * h, lo[1] + j * h, lo[2] + k * h);
    }
    // surface nets: one vertex per sign-changing cell
    const cellV = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
    const cidx = (i, j, k) => i + (nx - 1) * (j + (ny - 1) * k);
    const pos = [];
    const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
    const co = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
    const cv = new Float32Array(8);
    for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      let mask = 0;
      for (let c = 0; c < 8; c++) { cv[c] = F[idx(i + co[c][0], j + co[c][1], k + co[c][2])]; if (cv[c] < 0) mask |= 1 << c; }
      if (mask === 0 || mask === 255) continue;
      let sx = 0, sy = 0, sz = 0, n = 0;
      for (const [a, b] of E) {
        const va = cv[a], vb = cv[b]; if ((va < 0) === (vb < 0)) continue;
        const t = va / (va - vb);
        sx += co[a][0] + (co[b][0] - co[a][0]) * t; sy += co[a][1] + (co[b][1] - co[a][1]) * t; sz += co[a][2] + (co[b][2] - co[a][2]) * t; n++;
      }
      cellV[cidx(i, j, k)] = pos.length / 3;
      pos.push(lo[0] + (i + sx / n) * h, lo[1] + (j + sy / n) * h, lo[2] + (k + sz / n) * h);
    }
    const index = [];
    const quad = (a, b, c, d, flip) => { if (a < 0 || b < 0 || c < 0 || d < 0) return; if (flip) index.push(a, c, b, a, d, c); else index.push(a, b, c, a, c, d); };
    for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
      const v0 = F[idx(i, j, k)] < 0;
      if (i < nx - 1 && (F[idx(i + 1, j, k)] < 0) !== v0) quad(cellV[cidx(i, j - 1, k - 1)], cellV[cidx(i, j, k - 1)], cellV[cidx(i, j, k)], cellV[cidx(i, j - 1, k)], !v0);
      if (j < ny - 1 && (F[idx(i, j + 1, k)] < 0) !== v0) quad(cellV[cidx(i - 1, j, k - 1)], cellV[cidx(i - 1, j, k)], cellV[cidx(i, j, k)], cellV[cidx(i, j, k - 1)], !v0);
      if (k < nz - 1 && (F[idx(i, j, k + 1)] < 0) !== v0) quad(cellV[cidx(i - 1, j - 1, k)], cellV[cidx(i, j - 1, k)], cellV[cidx(i, j, k)], cellV[cidx(i - 1, j, k)], !v0);
    }
    // project onto the surface, gradient normals, colour, weights
    const nv = pos.length / 3, nrm = new Float32Array(nv * 3), col = new Float32Array(nv * 3), skI = new Uint16Array(nv * 4), skW = new Float32Array(nv * 4);
    const bones = [...new Set(pr.map((P) => P.bone))], boneIx = new Map(bones.map((b, i) => [b, i]));
    const e = h * 0.35, ds = new Float32Array(pr.length), bw = new Float32Array(bones.length), tw = new Float32Array(palette.length);
    const c = new THREE.Color(), tmpC = new THREE.Color();
    for (let v = 0; v < nv; v++) {
      let x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
      {
        const f = this.field(x, y, z);
        let gx = this.field(x + e, y, z) - this.field(x - e, y, z), gy = this.field(x, y + e, z) - this.field(x, y - e, z), gz = this.field(x, y, z + e) - this.field(x, y, z - e);
        const gl = Math.hypot(gx, gy, gz) || 1; gx /= gl; gy /= gl; gz /= gl;
        const step = Math.max(-h * 0.5, Math.min(h * 0.5, f));
        x -= gx * step; y -= gy * step; z -= gz * step;
        nrm[v * 3] = gx; nrm[v * 3 + 1] = gy; nrm[v * 3 + 2] = gz;
      }
      pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z;
      const nX = nrm[v * 3], nY = nrm[v * 3 + 1], nZ = nrm[v * 3 + 2];
      // weights by proximity to each primitive (pockets don't carry bones)
      const d0 = this.base(x, y, z, ds), list = this.near;
      bw.fill(0); tw.fill(0);
      for (let q = 0; q < list.length; q++) {
        const i = list[q], P = pr[i];
        // a pocket colours only its own walls; a solid weighs by how close it is to being the surface here
        const w = P.sub ? Math.exp(-Math.abs(ds[i]) / 0.18) : Math.exp(-Math.max(0, ds[i] - d0) / 0.38);
        if (!P.sub) bw[boneIx.get(P.bone)] += w * (P.wt ?? 1);
        tw[P.tag] += w * (P.sub ? 2.5 : 1);
      }
      const order = [...bw.keys()].sort((a, b) => bw[b] - bw[a]).slice(0, 4);
      let s = 0; for (const o of order) s += bw[o];
      for (let q = 0; q < 4; q++) { const o = order[q]; skI[v * 4 + q] = o ?? 0; skW[v * 4 + q] = o !== undefined ? bw[o] / s : 0; }
      // colour: tag blend · cavity · stains · moss
      let ts = 0; c.setRGB(0, 0, 0);
      for (let t = 0; t < tw.length; t++) { if (tw[t] <= 0) continue; tmpC.copy(palette[t]).multiplyScalar(tw[t]); c.add(tmpC); ts += tw[t]; }
      c.multiplyScalar(1 / ts);
      if (paint) { for (let t = 0; t < tw.length; t++) tw[t] /= ts; paint(c, x, y, z, nY, tw); }   // markings: stripes, mottling, dust
      const probe = 1.3, occ = Math.max(0, Math.min(1, this.field(x + nX * probe, y + nY * probe, z + nZ * probe) / probe));
      const near = Math.max(0, Math.min(1, this.field(x + nX * 0.3, y + nY * 0.3, z + nZ * 0.3) / 0.3));   // tight creases and seams
      const cav = (0.62 + 0.38 * occ) * (0.55 + 0.45 * near);
      const st = pnoise(x * 0.35 + seedShift, y * 0.9, z * 0.35) * stain;            // weathering stains, streaky downward
      c.multiplyScalar(cav * (1 + st));
      if (nY < -0.3) c.multiplyScalar(0.82 + 0.18 * (1 + nY));                       // undersides darker
      if (moss) {
        const mk = Math.max(0, Math.min(1, (nY - 0.45) * 2.5)) * Math.max(0, Math.min(1, 0.35 + pnoise(x * 0.45, y * 0.45 + 7, z * 0.45) * 1.6)) * moss.amount;
        const mc = Math.max(0, Math.min(1, (0.45 - near) * 2)) * moss.amount * 0.5;     // and deep in the seams
        c.lerp(moss.color, Math.min(1, mk + mc));
      }
      col[v * 3] = c.r; col[v * 3 + 1] = c.g; col[v * 3 + 2] = c.b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('skinIndex', new THREE.BufferAttribute(skI, 4));
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(skW, 4));
    geo.setIndex(nv > 65535 ? new THREE.Uint32BufferAttribute(index, 1) : new THREE.Uint16BufferAttribute(index, 1));
    geo.computeBoundingSphere();
    const mesh = new THREE.SkinnedMesh(geo, material);
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
    this.root.add(mesh);
    this.root.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton(bones), mesh.matrixWorld);
    this.stats = { verts: nv, tris: index.length / 3, grid: [nx, ny, nz], ms: Math.round(performance.now() - t0) };
    return mesh;
  }
}

/**
 * Stone-skin material: vertex colour × triplanar grain, with glowing veins (emissive) projected the same way.
 * Projection is in bind space, so the grain rides the skin.
 */
let matId = 0;
export function sculptMaterial({ grain, veins = null, scale = 0.22, emissive = 0x000000, emissiveIntensity = 0, roughness = 0.92, grainAmt = 0.75, bump = 0 }) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness, metalness: 0, emissive, emissiveIntensity });
  grain.wrapS = grain.wrapT = THREE.RepeatWrapping; if (veins) veins.wrapS = veins.wrapT = THREE.RepeatWrapping;
  const u = { uGrain: { value: grain }, uVeins: { value: veins || grain }, uScale: { value: scale }, uGrainAmt: { value: grainAmt }, uHasVeins: { value: veins ? 1 : 0 }, uBump: { value: bump } };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = 'varying vec3 vBP; varying vec3 vBN;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvBP = position; vBN = normal;');
    sh.fragmentShader = 'uniform sampler2D uGrain; uniform sampler2D uVeins; uniform float uScale; uniform float uGrainAmt; uniform float uHasVeins; uniform float uBump; varying vec3 vBP; varying vec3 vBN; float sculptH;\n'
      + 'vec4 tri(sampler2D t, vec3 p, vec3 n){ vec3 w = pow(abs(n), vec3(4.0)); w /= (w.x + w.y + w.z + 1e-5); return texture2D(t, p.yz) * w.x + texture2D(t, p.xz + 0.37) * w.y + texture2D(t, p.xy + 0.71) * w.z; }\n'
      + sh.fragmentShader
        .replace('#include <map_fragment>', `#include <map_fragment>
          vec3 bn = normalize(vBN);
          vec4 gr = tri(uGrain, vBP * uScale, bn) * 0.65 + tri(uGrain, vBP * uScale * 3.1, bn) * 0.35;
          diffuseColor.rgb *= mix(vec3(1.0), gr.rgb * 1.55, uGrainAmt);
          sculptH = gr.r;`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          if (uBump > 0.0) {   // creases and scale rims catch the light: bump straight from the grain's height
            vec2 dH = vec2(dFdx(sculptH), dFdy(sculptH)) * uBump;
            vec3 sX = dFdx(-vViewPosition), sY = dFdy(-vViewPosition);
            vec3 r1 = cross(sY, normal), r2 = cross(normal, sX); float det = dot(sX, r1);
            normal = normalize(abs(det) * normal - sign(det) * (dH.x * r1 + dH.y * r2));
          }`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          if (uHasVeins > 0.5) totalEmissiveRadiance *= tri(uVeins, vBP * uScale * 0.8, normalize(vBN)).rgb; else totalEmissiveRadiance *= 0.0;`);
  };
  const key = 'sculptStone' + (++matId);   // one program per material: a shared one would skip this material's uniforms
  mat.customProgramCacheKey = () => key;
  return mat;
}

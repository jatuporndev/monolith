import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mulberry32, smoothstep as ss, lerp } from '../../core/util.js';

/**
 * The wanderer: one continuous skinned mesh on a humanoid skeleton, built in code.
 *
 * Conventions
 *   - model faces +Z, +X is the character's LEFT, Y up, feet at y = 0, 1.75 m tall
 *   - every limb bone points down its own −Y; identity rotation = limb hanging straight down
 *   - arms are bound in an A-pose (ARM_BIND) so shoulders deform evenly up and down
 */
export const ARM_BIND = 0.5;
export const DIM = {
  hipY: 0.95, hipJointX: 0.09, hipJointY: 0.90, thigh: 0.41, shin: 0.41, ankle: 0.08,
  shoulderX: 0.165, shoulderY: 1.42, upperArm: 0.28, foreArm: 0.25, ball: 0.105, heel: 0.06,
};

const SIDES = [['L', 1], ['R', -1]];

function makeSkeleton() {
  const bones = {}, list = [];
  const add = (name, parent, x, y, z) => {
    const b = new THREE.Bone(); b.name = name; b.position.set(x, y, z);
    if (parent) bones[parent].add(b);
    b.userData.index = list.length; b.userData.rest = b.position.clone();
    bones[name] = b; list.push(b); return b;
  };
  add('hips', null, 0, 0.95, 0);
  add('spine', 'hips', 0, 0.12, 0);
  add('chest', 'spine', 0, 0.15, 0);
  add('neck', 'chest', 0, 0.245, -0.012);
  add('head', 'neck', 0, 0.085, 0.012);
  add('hairA', 'head', 0, 0.012, -0.094);
  add('hairB', 'hairA', 0, -0.065, -0.022);
  for (const [S, s] of SIDES) {
    add('clav' + S, 'chest', s * 0.03, 0.21, 0);
    add('upperArm' + S, 'clav' + S, s * 0.135, -0.01, -0.005).rotation.z = s * ARM_BIND;
    add('foreArm' + S, 'upperArm' + S, 0, -0.28, 0);
    add('hand' + S, 'foreArm' + S, 0, -0.25, 0);
    add('fingersA' + S, 'hand' + S, 0, -0.088, 0);
    add('fingersB' + S, 'fingersA' + S, 0, -0.036, 0);
    add('thumbA' + S, 'hand' + S, -s * 0.006, -0.03, 0.03);
    add('thumbB' + S, 'thumbA' + S, -s * 0.009, -0.024, 0.02);
    add('thigh' + S, 'hips', s * 0.09, -0.05, 0);
    add('shin' + S, 'thigh' + S, 0, -0.41, 0);
    add('foot' + S, 'shin' + S, 0, -0.41, 0);
    add('toe' + S, 'foot' + S, 0, -0.06, 0.105);
  }
  return { bones, list };
}

// ------------------------------------------------------------------ mesh builder
const WHITE = new THREE.Color(1, 1, 1);
const _v = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _n = new THREE.Vector3();

class Builder {
  constructor(bones) { this.bones = bones; this.P = []; this.UV = []; this.C = []; this.SI = []; this.SW = []; this.idx = {}; this.seams = []; }

  vert(p, u, v, col, w) {
    const i = this.P.length / 3;
    this.P.push(p.x, p.y, p.z); this.UV.push(u, v); this.C.push(col.r, col.g, col.b);
    const pairs = [];
    for (let k = 0; k < w.length; k += 2) if (w[k + 1] > 0.002) pairs.push([this.bones[w[k]].userData.index, w[k + 1]]);
    pairs.sort((x, y) => y[1] - x[1]); if (pairs.length > 4) pairs.length = 4;
    let sum = 0; for (const q of pairs) sum += q[1];
    for (let k = 0; k < 4; k++) { this.SI.push(pairs[k] ? pairs[k][0] : 0); this.SW.push(pairs[k] ? pairs[k][1] / sum : 0); }
    return i;
  }
  tri(mat, a, b, c) { (this.idx[mat] || (this.idx[mat] = [])).push(a, b, c); }

  /**
   * Skin a tube through a list of rings. ring: { c:[x,y,z], rx, rz, rzb?, w?, col? }
   * opts: mat, seg, matrix, w(v,ring,theta) per-vertex weights, colFn(v,theta,ring), disp(v,theta,ringIndex),
   *       frame 'y' (ring in XZ, default) | 'z' (ring in XY, uses rx/ry), e (superellipse), warp (denser at the front),
   *       capA / capB, tile (texture size in metres)
   */
  loft(rings, o) {
    const seg = o.seg || 12, M = o.matrix, e = o.e || 1, warp = o.warp || 0, tile = o.tile || 0.16;
    let mean = 0; for (const r of rings) mean += (r.rx + (r.rz ?? r.ry)) * 0.5; mean /= rings.length;
    const uRep = Math.max(1, Math.round((Math.PI * 2 * mean) / tile));
    const rows = []; let vAcc = 0, prev = null;
    rings.forEach((r, ri) => {
      const c = r.c;
      if (prev) vAcc += Math.hypot(c[0] - prev[0], c[1] - prev[1], c[2] - prev[2]); prev = c;
      const row = [];
      for (let j = 0; j <= seg; j++) {
        let th = (j / seg) * Math.PI * 2; th -= warp * Math.sin(th);
        const sn = Math.sin(th), cs = Math.cos(th);
        const px = Math.sign(sn) * Math.pow(Math.abs(sn), e), pz = Math.sign(cs) * Math.pow(Math.abs(cs), e);
        if (o.frame === 'z') _v.set(c[0] + r.rx * pz, c[1] + r.ry * px, c[2]);
        else _v.set(c[0] + r.rx * px, c[1], c[2] + (pz >= 0 ? r.rz : (r.rzb ?? r.rz)) * pz);
        if (o.disp) o.disp(_v, th, ri, r);
        const w = r.w || o.w(_v, r, th);
        const col = o.colFn ? o.colFn(_v, th, ri) : (r.col || o.col || WHITE);
        if (M) _v.applyMatrix4(M);
        row.push(this.vert(_v, (j / seg) * uRep, vAcc / tile, col, w));
      }
      this.seams.push(row[0], row[seg]);
      rows.push(row);
    });
    // make sure faces point outward whatever direction the rings were listed in
    let flip = false;
    for (let i = 0; i < rings.length - 1; i++) {
      const q = Math.floor(seg / 4);
      this.get(rows[i][q], _a); this.get(rows[i][q + 1], _b); this.get(rows[i + 1][q], _c);
      _n.copy(_b).sub(_a).cross(_c.sub(_a));
      if (_n.lengthSq() < 1e-12) continue;
      _v.set(...rings[i].c); if (M) _v.applyMatrix4(M);
      flip = _n.dot(_a.sub(_v)) < 0; break;
    }
    const tri = (a, b, c) => (flip ? this.tri(o.mat, a, c, b) : this.tri(o.mat, a, b, c));
    for (let i = 0; i < rows.length - 1; i++) for (let j = 0; j < seg; j++) {
      const a = rows[i][j], b = rows[i][j + 1], c = rows[i + 1][j], d = rows[i + 1][j + 1];
      tri(a, b, c); tri(b, d, c);
    }
    const cap = (ri, start) => {
      const r = rings[ri]; _v.set(...r.c);
      const w = r.w || o.w(_v, r, 0), col = o.colFn ? o.colFn(_v, 0, ri) : (r.col || o.col || WHITE);
      if (M) _v.applyMatrix4(M);
      const cen = this.vert(_v, 0.5, 0.5, col, w);
      for (let j = 0; j < seg; j++) { if (start) tri(cen, rows[ri][j + 1], rows[ri][j]); else tri(cen, rows[ri][j], rows[ri][j + 1]); }
    };
    if (o.capA) cap(0, true);
    if (o.capB) cap(rings.length - 1, false);
    return rows;
  }
  get(i, out) { return out.set(this.P[i * 3], this.P[i * 3 + 1], this.P[i * 3 + 2]); }

  /** Rigid prop: any geometry, one weight set. */
  add(geo, matrix, mat, col, w) {
    const g = geo.index ? geo : geo.clone(); const p = g.attributes.position, uv = g.attributes.uv;
    const base = this.P.length / 3;
    for (let i = 0; i < p.count; i++) { _v.fromBufferAttribute(p, i).applyMatrix4(matrix); this.vert(_v, uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0, col, w); }
    const ix = g.index;
    const det = matrix.determinant() < 0;
    if (ix) for (let i = 0; i < ix.count; i += 3) { const a = base + ix.getX(i), b = base + ix.getX(i + 1), c = base + ix.getX(i + 2); if (det) this.tri(mat, a, c, b); else this.tri(mat, a, b, c); }
    else for (let i = 0; i < p.count; i += 3) { if (det) this.tri(mat, base + i, base + i + 2, base + i + 1); else this.tri(mat, base + i, base + i + 1, base + i + 2); }
  }

  build(matOrder) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.UV, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.C, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.SI, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.SW, 4));
    const index = []; let start = 0;
    matOrder.forEach((name, mi) => { const a = this.idx[name] || []; for (const i of a) index.push(i); g.addGroup(start, a.length, mi); start += a.length; });
    g.setIndex(index);
    g.computeVertexNormals();
    const n = g.attributes.normal;
    for (let k = 0; k < this.seams.length; k += 2) {
      const a = this.seams[k], b = this.seams[k + 1];
      _n.set(n.getX(a) + n.getX(b), n.getY(a) + n.getY(b), n.getZ(a) + n.getZ(b)).normalize();
      n.setXYZ(a, _n.x, _n.y, _n.z); n.setXYZ(b, _n.x, _n.y, _n.z);
    }
    g.computeBoundingSphere(); g.boundingSphere.radius = 3;
    return g;
  }
}

/** Catmull-Rom resample of a table of numeric rows. */
function resample(rows, n) {
  const out = [], last = rows.length - 1;
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * last, k = Math.min(last - 1, Math.floor(t)), f = t - k;
    const p0 = rows[Math.max(k - 1, 0)], p1 = rows[k], p2 = rows[k + 1], p3 = rows[Math.min(k + 2, last)];
    out.push(p1.map((_, c) => 0.5 * ((2 * p1[c]) + (-p0[c] + p2[c]) * f + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * f * f + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * f * f * f)));
  }
  return out;
}
function sample(rows, y) { // linear lookup by first column (descending)
  for (let i = 0; i < rows.length - 1; i++) if (y <= rows[i][0] && y >= rows[i + 1][0]) { const f = (rows[i][0] - y) / (rows[i][0] - rows[i + 1][0]); return rows[i].map((v, c) => lerp(v, rows[i + 1][c], f)); }
  return y > rows[0][0] ? rows[0] : rows[rows.length - 1];
}

// ------------------------------------------------------------------ textures
function canvasTex(size, draw, repeat = 1) {
  const c = document.createElement('canvas'); c.width = c.height = size; draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); t.anisotropy = 4; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function weaveTexture(seed) {
  const rnd = mulberry32(seed);
  return canvasTex(256, (x, s) => {
    x.fillStyle = '#c9c9c9'; x.fillRect(0, 0, s, s);
    for (let i = 0; i < s; i += 2) { // warp and weft threads of uneven thickness
      x.fillStyle = `rgba(${rnd() < 0.5 ? '255,255,255' : '0,0,0'},${0.02 + rnd() * 0.06})`; x.fillRect(i, 0, 1, s);
      x.fillStyle = `rgba(${rnd() < 0.5 ? '255,255,255' : '0,0,0'},${0.02 + rnd() * 0.075})`; x.fillRect(0, i, s, 1);
    }
    for (let i = 0; i < 2600; i++) { x.fillStyle = `rgba(0,0,0,${rnd() * 0.12})`; x.fillRect(rnd() * s, rnd() * s, 2, 2); }
    for (let i = 0; i < 26; i++) { // soft stains and wear, wrapped so the tile stays seamless
      const px = rnd() * s, py = rnd() * s, r = 14 + rnd() * 40, dark = rnd() < 0.6;
      for (const ox of [-s, 0, s]) for (const oy of [-s, 0, s]) {
        const g = x.createRadialGradient(px + ox, py + oy, 0, px + ox, py + oy, r);
        g.addColorStop(0, dark ? 'rgba(40,30,20,0.13)' : 'rgba(255,250,235,0.1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        x.fillStyle = g; x.fillRect(px + ox - r, py + oy - r, r * 2, r * 2);
      }
    }
  });
}
function leatherTexture(seed) {
  const rnd = mulberry32(seed);
  return canvasTex(256, (x, s) => {
    x.fillStyle = '#bdbdbd'; x.fillRect(0, 0, s, s);
    for (let i = 0; i < 1500; i++) { const l = rnd() < 0.5 ? 255 : 0; x.fillStyle = `rgba(${l},${l},${l},${rnd() * 0.09})`; x.beginPath(); x.arc(rnd() * s, rnd() * s, 1 + rnd() * 5, 0, 6.3); x.fill(); }
    x.strokeStyle = 'rgba(0,0,0,0.16)'; x.lineWidth = 1;
    for (let i = 0; i < 70; i++) { let px = rnd() * s, py = rnd() * s; x.beginPath(); x.moveTo(px, py); for (let k = 0; k < 5; k++) { px += (rnd() - 0.5) * 26; py += (rnd() - 0.5) * 26; x.lineTo(px, py); } x.stroke(); }
  });
}
function hairTexture(seed) {
  const rnd = mulberry32(seed);
  return canvasTex(256, (x, s) => {
    x.fillStyle = '#9a9a9a'; x.fillRect(0, 0, s, s);
    for (let i = 0; i < 900; i++) { const l = rnd() < 0.45 ? 255 : 0; x.strokeStyle = `rgba(${l},${l},${l},${0.06 + rnd() * 0.2})`; x.lineWidth = 0.6 + rnd() * 1.8; const px = rnd() * s; x.beginPath(); x.moveTo(px, 0); x.bezierCurveTo(px + (rnd() - 0.5) * 14, s * 0.3, px + (rnd() - 0.5) * 14, s * 0.7, px, s); x.stroke(); }
  });
}

// ------------------------------------------------------------------ the character
const TORSO = [ // y, rx, z front, z back
  [1.490, 0.047, 0.048, 0.058], [1.468, 0.060, 0.055, 0.066], [1.448, 0.098, 0.066, 0.080], [1.428, 0.138, 0.081, 0.091],
  [1.400, 0.156, 0.095, 0.099], [1.350, 0.158, 0.109, 0.103], [1.290, 0.154, 0.115, 0.101], [1.220, 0.143, 0.109, 0.095],
  [1.150, 0.132, 0.100, 0.089], [1.090, 0.126, 0.094, 0.086], [1.040, 0.129, 0.095, 0.090], [0.980, 0.144, 0.099, 0.104],
  [0.920, 0.157, 0.102, 0.113], [0.860, 0.165, 0.104, 0.115], [0.790, 0.171, 0.108, 0.113], [0.725, 0.177, 0.112, 0.114], [0.690, 0.181, 0.115, 0.116],
];
const HEAD = [ // head-local y, rx, z front, z back
  [-0.050, 0.010, 0.076, 0.046], [-0.045, 0.024, 0.086, 0.022], [-0.033, 0.038, 0.093, -0.012], [-0.016, 0.050, 0.098, -0.040],
  [0.002, 0.060, 0.100, -0.060], [0.025, 0.070, 0.100, -0.076], [0.050, 0.074, 0.098, -0.088], [0.075, 0.076, 0.099, -0.095],
  [0.100, 0.0765, 0.098, -0.098], [0.125, 0.074, 0.092, -0.097], [0.148, 0.068, 0.080, -0.090], [0.168, 0.055, 0.060, -0.074],
  [0.182, 0.036, 0.036, -0.050], [0.190, 0.012, 0.012, -0.020],
];

/** Skin weights for anything draped on the trunk, by height (and side, for the skirt and shoulders). */
function trunkWeights(v) {
  const y = v.y, ax = Math.abs(v.x), S = v.x >= 0 ? 'L' : 'R';
  const up1 = ss(0.98, 1.09, y), up2 = ss(1.14, 1.27, y), up3 = ss(1.455, 1.505, y);
  let hips = 1 - up1, spine = up1 * (1 - up2), chest = up2 * (1 - up3);
  const neck = up2 * up3;
  const sk = ss(0.93, 0.74, y) * 0.78; // skirt follows the thighs
  const l = Math.min(1, Math.max(0, 0.5 + v.x / 0.11)), tl = sk * l * hips, tr = sk * (1 - l) * hips;
  hips *= 1 - sk;
  const sh = ss(0.105, 0.17, ax) * ss(1.33, 1.40, y) * (1 - up3);
  const cl = chest * sh * 0.5; chest -= cl;
  return ['hips', hips, 'spine', spine, 'chest', chest, 'neck', neck, 'thighL', tl, 'thighR', tr, 'clav' + S, cl];
}

export function buildCharacter() {
  const { bones, list } = makeSkeleton();
  bones.hips.updateMatrixWorld(true);
  const B = new Builder(bones);
  const rnd = mulberry32(77);
  const C = (hex) => new THREE.Color(hex);
  const col = {
    tunic: C(0xa8987a), tunicIn: C(0x5e5444), trousers: C(0x4e463b), cloak: C(0x4b4a40), cloakBand: C(0x8a5a3a), scarf: C(0x8c4a32),
    leather: C(0x6a4d36), boot: C(0x4a392c), sole: C(0x2c2420), skin: C(0xc69c7c), skinDark: C(0xb38a6c), hair: C(0x2e241c), eye: C(0x1c1612), metal: C(0xd6d0c4),
  };
  const shade = (base, k) => base.clone().multiplyScalar(k);
  const tmpC = new THREE.Color();
  const cloth = (base, f = 7) => (v) => tmpC.copy(base).multiplyScalar(0.9 + 0.1 * Math.sin(v.x * f * 9 + v.y * f * 13 + v.z * f * 7) * Math.sin(v.y * f * 5 + 1.3)).clone();

  // ---------------- trunk: tunic with a short skirt
  const torso = resample(TORSO, 30);
  B.loft(torso.map(([y, rx, zf, zb]) => ({ c: [0, y, (zf - zb) / 2], rx, rz: (zf + zb) / 2 })), {
    mat: 'cloth', seg: 28, e: 0.88, w: trunkWeights,
    colFn: (v) => tmpC.copy(col.tunic).multiplyScalar((0.88 + 0.12 * Math.sin(v.y * 31 + Math.sin(v.x * 23 + v.z * 17) * 1.6)) * (v.y < 0.74 ? 0.82 : 1) * lerp(0.86, 1, ss(0.95, 1.2, v.y))).clone(),
    disp: (v, th) => { // folds gathered by the belt, flare in the skirt
      const fold = Math.sin(th * 9 + v.y * 6) * 0.004 * (ss(1.2, 1.06, v.y) * ss(0.7, 1.0, v.y) + ss(0.98, 0.7, v.y) * 1.6);
      v.x *= 1 + fold / 0.14; v.z *= 1 + fold / 0.1;
      if (v.y < 0.75) v.y += Math.sin(th * 3 + 0.7) * 0.005;
    },
  });
  // hips under the skirt
  B.loft([[1.0, 0.118, 0.085], [0.93, 0.146, 0.098], [0.86, 0.15, 0.098], [0.80, 0.11, 0.07], [0.775, 0.03, 0.03]].map(([y, rx, rz]) => ({ c: [0, y, -0.006], rx, rz })), { mat: 'cloth', seg: 16, w: () => ['hips', 1], col: col.trousers, capB: true });

  // ---------------- legs: trousers into wrapped boots
  for (const [S, s] of SIDES) {
    const X = s * 0.09;
    const leg = resample([[0.945, 0.066, 0.080, 0.086], [0.90, 0.074, 0.090, 0.095], [0.82, 0.078, 0.089, 0.088], [0.72, 0.074, 0.083, 0.078], [0.62, 0.065, 0.073, 0.068], [0.54, 0.057, 0.063, 0.059],
      [0.49, 0.054, 0.062, 0.053], [0.44, 0.050, 0.050, 0.059], [0.38, 0.050, 0.046, 0.066], [0.31, 0.046, 0.044, 0.056], [0.27, 0.043, 0.043, 0.048]], 22);
    B.loft(leg.map(([y, rx, zf, zb]) => ({ c: [X - s * 0.012 * ss(0.78, 0.92, y), y, (zf - zb) / 2], rx, rz: (zf + zb) / 2 })), {
      mat: 'cloth', seg: 14, capA: true,
      w: (v) => { const t = ss(0.965, 0.86, v.y), k = ss(0.535, 0.445, v.y); return ['hips', 1 - t, 'thigh' + S, t * (1 - k), 'shin' + S, t * k]; },
      colFn: (v) => tmpC.copy(col.trousers).multiplyScalar(0.88 + 0.12 * Math.sin(v.y * 43 + Math.sin(v.x * 40 + v.z * 31) * 1.4)).clone(),
      disp: (v, th) => { const k = Math.sin(th * 5 + v.y * 22) * 0.003 * (1 + ss(0.6, 0.45, v.y) * ss(0.3, 0.45, v.y) * 1.5); v.x += Math.sin(th) * k; v.z += Math.cos(th) * k; },
    });
    // boot shaft with a folded cuff and bindings
    const shaft = [[0.322, 0.050, 0.050, 0.060], [0.330, 0.057, 0.056, 0.066], [0.300, 0.058, 0.056, 0.067], [0.285, 0.051, 0.050, 0.060], [0.22, 0.047, 0.047, 0.053], [0.15, 0.042, 0.044, 0.045], [0.10, 0.041, 0.047, 0.041], [0.055, 0.043, 0.055, 0.047], [0.02, 0.043, 0.06, 0.05]];
    B.loft(shaft.map(([y, rx, zf, zb]) => ({ c: [X, y, (zf - zb) / 2], rx, rz: (zf + zb) / 2 })), {
      mat: 'leather', seg: 14, capA: true,
      w: (v) => { const k = ss(0.135, 0.06, v.y); return ['shin' + S, 1 - k, 'foot' + S, k]; },
      colFn: (v) => tmpC.copy(col.boot).multiplyScalar(v.y > 0.283 ? 1.18 : (Math.abs(((v.y * 100) % 5) - 2.5) < 0.6 && v.y > 0.1 && v.y < 0.27 ? 0.72 : 1)).clone(),
    });
    // foot
    const foot = [[-0.074, 0.02, 0.02, 0.028], [-0.058, 0.036, 0.037, 0.039], [-0.02, 0.043, 0.05, 0.052], [0.03, 0.046, 0.044, 0.046], [0.08, 0.049, 0.034, 0.036], [0.12, 0.048, 0.027, 0.029], [0.155, 0.04, 0.022, 0.024], [0.178, 0.024, 0.014, 0.017]];
    B.loft(resample(foot, 12).map(([z, rx, ry, cy]) => ({ c: [X, cy, z], rx, ry })), {
      mat: 'leather', seg: 14, frame: 'z', capA: true, capB: true,
      w: (v) => { const k = ss(0.09, 0.13, v.z); return ['foot' + S, 1 - k, 'toe' + S, k]; },
      disp: (v) => { if (v.y < 0.004) v.y = 0.004; },
      colFn: (v) => (v.y < 0.014 ? col.sole : col.boot),
    });
  }

  // ---------------- neck and head
  B.loft([[1.43, 0.052, 0.054], [1.48, 0.048, 0.05], [1.52, 0.045, 0.048], [1.565, 0.046, 0.05]].map(([y, rx, rz]) => ({ c: [0, y, -0.014 + (y - 1.43) * 0.14], rx, rz })), {
    mat: 'skin', seg: 14, col: col.skinDark, w: (v) => { const a = ss(1.44, 1.5, v.y), b = ss(1.5, 1.57, v.y); return ['chest', 1 - a, 'neck', a * (1 - b * 0.7), 'head', a * b * 0.7]; },
  });
  const headM = bones.head.matrixWorld.clone();
  const gauss = (x, y, cx, cy, sx, sy) => Math.exp(-(((x - cx) ** 2) / (2 * sx * sx) + ((y - cy) ** 2) / (2 * sy * sy)));
  const head = resample(HEAD, 30);
  const hw = ['head', 1];
  B.loft(head.map(([y, rx, zf, zb]) => ({ c: [0, y, (zf + zb) / 2], rx, rz: (zf - zb) / 2, w: hw })), {
    mat: 'skin', seg: 40, warp: 0.55, matrix: headM, capA: true, capB: true,
    disp: (v) => {
      if (v.z < 0.02) return;
      const x = v.x, y = v.y;
      let d = 0.02 * gauss(x, y, 0, 0.021, 0.0105, 0.013) + 0.009 * gauss(x, y, 0, 0.044, 0.007, 0.02);            // nose
      d -= 0.0095 * (gauss(x, y, 0.031, 0.056, 0.014, 0.009) + gauss(x, y, -0.031, 0.056, 0.014, 0.009));          // eye sockets
      d += 0.0045 * gauss(x, y, 0, 0.076, 0.05, 0.007);                                                           // brow
      d += 0.005 * gauss(x, y, 0, -0.016, 0.017, 0.0055) - 0.003 * gauss(x, y, 0, -0.004, 0.02, 0.004);           // lips
      d += 0.005 * gauss(x, y, 0, -0.042, 0.02, 0.011);                                                           // chin
      d += 0.0035 * (gauss(x, y, 0.047, 0.03, 0.015, 0.013) + gauss(x, y, -0.047, 0.03, 0.015, 0.013));           // cheekbones
      v.z += d * ss(0.02, 0.05, v.z);
      const jaw = ss(0.0, -0.045, y) * ss(0.03, 0.07, Math.abs(x)); v.x *= 1 - jaw * 0.1;
    },
    colFn: (v) => tmpC.copy(col.skin).multiplyScalar(1 - 0.16 * (gauss(v.x, v.y, 0.031, 0.057, 0.014, 0.008) + gauss(v.x, v.y, -0.031, 0.057, 0.014, 0.008)) * (v.z > 0 ? 1 : 0) - 0.1 * gauss(v.x, v.y, 0, -0.016, 0.014, 0.004) * (v.z > 0 ? 1 : 0)).clone(),
  });
  const hm = (x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => headM.clone().multiply(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz)));
  for (const s of [1, -1]) {
    B.add(new THREE.SphereGeometry(0.0125, 12, 8), hm(s * 0.031, 0.0555, 0.0775, 0, s * 0.25, 0, 1.3, 0.72, 0.6), 'eye', col.eye, hw);
    B.add(new RoundedBoxGeometry(0.03, 0.0055, 0.008, 1, 0.002), hm(s * 0.032, 0.0715, 0.089, 0.2, s * 0.32, -s * 0.1), 'hair', col.hair, hw);
    B.add(new THREE.SphereGeometry(0.021, 10, 8), hm(s * 0.0765, 0.036, -0.006, 0, s * 0.35, 0, 0.36, 1, 0.68), 'skin', col.skinDark, hw);
  }
  // hair: a swept-back cap whose front edge dives inside the skull to make the hairline, plus loose locks and a tail
  const hairRows = resample([[0.199, 0.014, 0.016, -0.022], [0.190, 0.042, 0.044, -0.056], [0.174, 0.063, 0.071, -0.082], [0.152, 0.077, 0.094, -0.099], [0.128, 0.084, 0.103, -0.107],
    [0.105, 0.087, 0.080, -0.109], [0.078, 0.087, 0.052, -0.107], [0.05, 0.085, 0.030, -0.100], [0.022, 0.078, 0.010, -0.090], [-0.006, 0.064, -0.012, -0.078], [-0.03, 0.044, -0.03, -0.066]], 22);
  B.loft(hairRows.map(([y, rx, zf, zb]) => ({ c: [0, y, (zf + zb) / 2], rx, rz: (zf - zb) / 2, w: hw })), {
    mat: 'hair', seg: 30, matrix: headM, capA: true, capB: true, tile: 0.09,
    disp: (v, th) => { const k = 1 + 0.035 * Math.sin(th * 13 + v.y * 40) + 0.02 * Math.sin(th * 29 + 1); v.x *= k; v.z = (v.z + 0.01) * k - 0.01; },
    colFn: (v, th) => tmpC.copy(col.hair).multiplyScalar(0.8 + 0.3 * (0.5 + 0.5 * Math.sin(th * 13 + v.y * 40))).clone(),
  });
  const lock = (x, y, z, rx, ry, rz, len, w0, bone = 'head') => B.loft([[0.004, 0.3], [0, 1], [-len * 0.45, 0.9], [-len * 0.85, 0.5], [-len, 0.08]].map(([ly, k]) => ({ c: [0, ly, 0.012 * Math.sin((-ly / len) * 2.2)], rx: w0 * k, rz: 0.0075 * k + 0.001, w: [bone, 1] })), {
    mat: 'hair', seg: 8, matrix: hm(x, y, z, rx, ry, rz), capA: true, capB: true, tile: 0.06,
    colFn: (v, th) => tmpC.copy(col.hair).multiplyScalar(0.85 + 0.25 * Math.sin(th * 3 + v.y * 60)).clone(),
  });
  lock(0.012, 0.142, 0.094, -0.5, 0, -0.35, 0.062, 0.02); lock(-0.03, 0.144, 0.088, -0.45, 0, 0.3, 0.07, 0.022); lock(0.048, 0.138, 0.076, -0.3, 0, -0.75, 0.066, 0.018);
  lock(-0.062, 0.128, 0.06, -0.15, 0, 0.5, 0.085, 0.018); lock(0.072, 0.12, 0.04, -0.05, 0, -0.35, 0.095, 0.02); lock(-0.079, 0.1, 0.028, 0.05, 0, 0.18, 0.1, 0.018);
  lock(0.081, 0.08, 0.016, 0.1, 0, -0.1, 0.075, 0.016); lock(0.03, 0.0, -0.085, 0.2, 0, -0.2, 0.06, 0.02); lock(-0.035, 0.002, -0.083, 0.2, 0, 0.25, 0.065, 0.02);
  // tied-back tail, driven by two spring bones
  B.loft([[0.028, 0.012, -0.082], [0.018, 0.024, -0.094], [-0.012, 0.027, -0.112], [-0.05, 0.024, -0.122], [-0.09, 0.018, -0.124], [-0.122, 0.009, -0.12], [-0.136, 0.002, -0.118]].map(([y, r, z]) => ({ c: [0, y, z], rx: r, rz: r * 0.85 })), {
    mat: 'hair', seg: 10, matrix: headM, capA: true, capB: true, tile: 0.06,
    w: (v) => { const a = ss(0.03, 0.0, v.y), b = ss(-0.035, -0.075, v.y); return ['head', 1 - a, 'hairA', a * (1 - b), 'hairB', a * b]; },
    colFn: (v, th) => (v.y > -0.004 && v.y < 0.012 ? col.leather : tmpC.copy(col.hair).multiplyScalar(0.8 + 0.3 * Math.sin(th * 5 + v.y * 50)).clone()),
  });

  // ---------------- arms: sleeve to the elbow, bare forearm, bracer, articulated hand
  for (const [S, s] of SIDES) {
    const M = bones['upperArm' + S].matrixWorld.clone();
    const U = 'upperArm' + S, F = 'foreArm' + S, H = 'hand' + S;
    B.loft([[0.018, 0.008, 0.01], [0.008, 0.028, 0.034], [-0.02, 0.045, 0.049], [-0.06, 0.049, 0.052], [-0.14, 0.046, 0.049], [-0.205, 0.045, 0.048], [-0.232, 0.049, 0.052], [-0.252, 0.047, 0.05], [-0.246, 0.037, 0.04]].map(([y, rx, rz]) => ({ c: [0, y, 0], rx, rz })), {
      mat: 'cloth', seg: 14, matrix: M, capA: true,
      w: (v) => { const k = ss(-0.08, 0.02, v.y); return [U, 1 - k * 0.75, 'clav' + S, k * 0.4, 'chest', k * 0.35]; },
      colFn: (v) => tmpC.copy(v.y < -0.22 ? shade(col.tunic, 0.86) : col.tunic).multiplyScalar(0.9 + 0.1 * Math.sin(v.y * 50 + Math.sin(v.x * 60 + v.z * 40))).clone(),
      disp: (v, th) => { const k = 1 + Math.sin(th * 4 + v.y * 30) * 0.03 * ss(0, -0.1, v.y); v.x *= k; v.z *= k; },
    });
    const arm = resample([[-0.17, 0.034, 0.036], [-0.23, 0.038, 0.040], [-0.28, 0.0355, 0.0385], [-0.32, 0.0385, 0.040], [-0.37, 0.036, 0.0385], [-0.43, 0.0305, 0.0335], [-0.49, 0.0235, 0.029], [-0.53, 0.0205, 0.027],
      [-0.552, 0.0165, 0.034], [-0.582, 0.014, 0.0405], [-0.608, 0.0125, 0.041], [-0.621, 0.009, 0.036]], 26);
    const armW = (v) => { const k = ss(-0.245, -0.315, v.y), h = ss(-0.505, -0.555, v.y); return [U, 1 - k, F, k * (1 - h), H, k * h]; };
    B.loft(arm.map(([y, rx, rz]) => ({ c: [y < -0.53 ? -s * 0.002 : 0, y, y < -0.53 ? 0.002 : 0], rx, rz })), { mat: 'skin', seg: 12, matrix: M, capA: true, capB: true, w: armW, col: col.skin });
    B.loft([[-0.362, 0.036], [-0.366, 0.0425], [-0.40, 0.041], [-0.45, 0.0355], [-0.498, 0.030], [-0.503, 0.0255]].map(([y, r]) => ({ c: [0, y, 0], rx: r, rz: r + 0.003, w: [F, 1] })), {
      mat: 'leather', seg: 12, matrix: M, colFn: (v) => (Math.abs(v.y + 0.385) < 0.006 || Math.abs(v.y + 0.475) < 0.006 ? shade(col.leather, 0.6) : col.leather),
    });
    // fingers (index → little) curl on two shared joints; thumb has its own two
    const FA = 'fingersA' + S, FB = 'fingersB' + S;
    [[0.0285, 0.066, 0.0082, -0.616], [0.0096, 0.075, 0.0086, -0.62], [-0.0096, 0.069, 0.0082, -0.618], [-0.0282, 0.054, 0.0072, -0.612]].forEach(([z, len, r, y0]) => {
      B.loft([[0.006, 1], [-0.25, 1], [-0.5, 0.94], [-0.75, 0.86], [-0.94, 0.78], [-1, 0.4]].map(([t, k]) => ({ c: [-s * 0.002, y0 + t * len, z + 0.002], rx: r * k * 0.92, rz: r * k })), {
        mat: 'skin', seg: 7, matrix: M, capB: true, col: col.skin,
        w: (v) => { const t = (y0 - v.y) / len, a = ss(-0.1, 0.12, t), b = ss(0.4, 0.62, t); return [H, 1 - a, FA, a * (1 - b), FB, a * b]; },
      });
    });
    const tm = M.clone().multiply(new THREE.Matrix4().compose(new THREE.Vector3(-s * 0.006, -0.556, 0.03), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), new THREE.Vector3(-s * 0.3, -0.72, 0.62).normalize()), new THREE.Vector3(1, 1, 1)));
    B.loft([[0.01, 0.011], [-0.012, 0.0125], [-0.03, 0.0105], [-0.048, 0.0092], [-0.06, 0.0075], [-0.066, 0.003]].map(([y, r]) => ({ c: [0, y, 0], rx: r, rz: r })), {
      mat: 'skin', seg: 7, matrix: tm, capB: true, col: col.skin, w: (v) => { const a = ss(0.01, -0.012, v.y), b = ss(-0.024, -0.04, v.y); return [H, 1 - a, 'thumbA' + S, a * (1 - b), 'thumbB' + S, a * b]; },
    });
  }

  // ---------------- mantle over the shoulders, scarf, belt and kit
  const mantle = resample([[1.502, 0.056, 0.054, 0.064], [1.482, 0.071, 0.064, 0.078], [1.456, 0.112, 0.080, 0.094], [1.436, 0.178, 0.097, 0.107], [1.41, 0.214, 0.110, 0.117], [1.37, 0.226, 0.120, 0.125], [1.325, 0.233, 0.125, 0.13], [1.285, 0.236, 0.128, 0.132]], 16);
  const mantleW = (v) => {
    const S = v.x >= 0 ? 'L' : 'R', ax = Math.abs(v.x), a = ss(0.125, 0.205, ax) * ss(1.46, 1.39, v.y) * 0.5, n = ss(1.46, 1.5, v.y) * 0.5;
    return ['chest', (1 - a) * (1 - n), 'neck', (1 - a) * n, 'upperArm' + S, a * 0.75, 'clav' + S, a * 0.25];
  };
  B.loft(mantle.map(([y, rx, zf, zb]) => ({ c: [0, y, (zf - zb) / 2], rx, rz: (zf + zb) / 2 })), {
    mat: 'cloth', seg: 28, e: 0.9, w: mantleW,
    disp: (v, th) => { const low = ss(1.42, 1.3, v.y); v.y += low * (Math.sin(th * 5 + 1) * 0.012 + 0.05 * Math.max(0, Math.cos(th)) ** 2); const k = 1 + Math.sin(th * 7 + v.y * 12) * 0.018 * low; v.x *= k; v.z *= k; },
    colFn: (v) => tmpC.copy(v.y < 1.335 && v.y > 1.318 ? col.cloakBand : col.cloak).multiplyScalar(0.88 + 0.12 * Math.sin(v.y * 37 + Math.sin(v.x * 29 + v.z * 23) * 1.5)).clone(),
  });
  B.loft([[1.462, 0.066, 0.062, 0.07], [1.474, 0.09, 0.083, 0.09], [1.496, 0.098, 0.09, 0.098], [1.518, 0.089, 0.081, 0.092], [1.533, 0.066, 0.06, 0.074], [1.52, 0.05, 0.05, 0.056]].map(([y, rx, zf, zb]) => ({ c: [0, y, (zf - zb) / 2 - 0.004], rx, rz: (zf + zb) / 2 })), {
    mat: 'cloth', seg: 22, w: () => ['chest', 0.55, 'neck', 0.45], tile: 0.1,
    disp: (v, th) => { const k = 1 + 0.05 * Math.sin(th * 3 + v.y * 90) + 0.025 * Math.sin(th * 7 + 2); v.x *= k; v.z *= k; v.y += 0.007 * Math.sin(th * 2 + 0.6) - 0.02 * Math.cos(th); },
    colFn: (v, th) => tmpC.copy(col.scarf).multiplyScalar(0.82 + 0.2 * Math.sin(th * 3 + v.y * 90)).clone(),
  });
  const beltR = (y) => { const [, rx, zf, zb] = sample(TORSO, y); return { c: [0, y, (zf - zb) / 2], rx: rx + 0.007, rz: (zf + zb) / 2 + 0.007 }; };
  B.loft([1.071, 1.066, 1.024, 1.019].map((y, i) => { const r = beltR(y); if (i === 0 || i === 3) { r.rx -= 0.007; r.rz -= 0.007; } return r; }), { mat: 'leather', seg: 28, e: 0.88, w: trunkWeights, col: col.leather });
  const rigid = (geo, x, y, z, rx, ry, rz, mat, c, bone) => B.add(geo, new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1)), mat, c, [bone, 1]);
  rigid(new RoundedBoxGeometry(0.04, 0.046, 0.012, 1, 0.004), 0, 1.045, 0.104, 0, 0, 0, 'metal', shade(col.metal, 0.7), 'hips');
  rigid(new RoundedBoxGeometry(0.095, 0.105, 0.05, 2, 0.018), -0.118, 0.985, 0.078, 0.05, -0.75, 0, 'leather', col.leather, 'hips');
  rigid(new RoundedBoxGeometry(0.1, 0.04, 0.054, 2, 0.012), -0.118, 1.025, 0.08, 0.05, -0.75, 0, 'leather', shade(col.leather, 0.75), 'hips');

  // ---------------- materials and mesh
  const weave = weaveTexture(5), weaveFine = weave.clone(); weaveFine.repeat.set(1, 1);
  const leatherT = leatherTexture(8), hairT = hairTexture(3);
  // a soft sky-coloured rim keeps the figure readable against dark walls and in deep shade
  const rim = (mat, k = 1) => { mat.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', `
      float rimF = pow(1.0 - clamp(abs(dot(normalize(normal), normalize(vViewPosition))), 0.0, 1.0), 2.6);
      outgoingLight += (diffuseColor.rgb * 0.75 + 0.06) * vec3(0.78, 0.84, 0.9) * rimF * ${(0.85 * k).toFixed(2)};
      #include <opaque_fragment>`); }; return mat; };
  const M = (o) => rim(new THREE.MeshStandardMaterial({ vertexColors: true, ...o }));
  const materials = {
    cloth: M({ map: weave, bumpMap: weave, bumpScale: 1.6, roughness: 0.96, side: THREE.DoubleSide }),
    leather: M({ map: leatherT, bumpMap: leatherT, bumpScale: 1.2, roughness: 0.78 }),
    skin: M({ roughness: 0.62 }),
    hair: M({ map: hairT, bumpMap: hairT, bumpScale: 2, roughness: 0.7 }),
    eye: M({ roughness: 0.25 }),
    metal: M({ roughness: 0.35, metalness: 0.8 }),
  };
  const order = ['cloth', 'leather', 'skin', 'hair', 'eye', 'metal'];
  const geo = B.build(order);
  const mesh = new THREE.SkinnedMesh(geo, order.map((n) => materials[n]));
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
  const root = new THREE.Group();
  root.add(bones.hips, mesh);
  root.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(list));
  for (const [S] of SIDES) bones['upperArm' + S].rotation.set(0, 0, 0);

  // ---------------- blade: rides in a sheath on the left hip until it is drawn
  const leatherMat = new THREE.MeshStandardMaterial({ color: col.leather, map: leatherT, roughness: 0.8 });
  const sheath = new THREE.Group(); sheath.position.set(0.158, 0.085, -0.035); sheath.rotation.set(0.42, 0, -0.1); bones.hips.add(sheath);
  const sh = new THREE.Mesh(new RoundedBoxGeometry(0.052, 0.4, 0.022, 2, 0.009), leatherMat); sh.position.y = -0.285; sh.castShadow = true; sheath.add(sh);
  const grip = new THREE.Group(); grip.position.set(0.02, -0.062, 0.004); grip.rotation.x = -Math.PI / 2; bones.handR.add(grip);
  const blade = new THREE.Group();
  const bladeGlow = new THREE.MeshStandardMaterial({ color: 0xe2dccf, roughness: 0.22, metalness: 0.8, emissive: 0xffd9a0, emissiveIntensity: 0 });
  const metalMat = new THREE.MeshStandardMaterial({ color: 0xd6d0c4, roughness: 0.3, metalness: 0.85 });
  const part = (g, m, y) => { const o = new THREE.Mesh(g, m); o.position.y = y; o.castShadow = true; blade.add(o); return o; };
  part(new THREE.CylinderGeometry(0.0135, 0.0145, 0.1, 8), leatherMat, 0);
  part(new THREE.SphereGeometry(0.018, 8, 6), metalMat, 0.055);
  part(new RoundedBoxGeometry(0.1, 0.016, 0.03, 1, 0.006), metalMat, -0.056);
  const edge = new THREE.Shape(); edge.moveTo(-0.021, 0); edge.lineTo(0.021, 0); edge.lineTo(0.015, -0.33); edge.lineTo(0, -0.4); edge.lineTo(-0.015, -0.33); edge.closePath();
  const eg = new THREE.ExtrudeGeometry(edge, { depth: 0.006, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.004, bevelSegments: 1 }); eg.translate(0, -0.062, -0.003);
  part(eg, bladeGlow, 0);
  sheath.add(blade);

  return { root, mesh, bones, list, materials, blade, bladeGlow, sheath, grip, col, cloakMaterial: materials.cloth };
}

import * as THREE from 'three';
import { makeNoise2D, fbm, smoothstep, lerp, mulberry32, clamp } from '../core/util.js';
import { mossTexture, groundTexture, softDotTexture, fogPuffTexture, shaftTexture, masonryTexture, noiseTexture, leafTexture, vineTexture, barkTexture } from './textures.js';
import { blob, mergeGeometries, chiseledBox, noise3 } from './shapes.js';
import { installAtmosphere, skyMaterial, weatherStone, terrainMaterial, canopyMaterial as envCanopy, ATMOS } from './envShaders.js';
import { buildMountains, buildFarRuins, buildBirds, buildDrift } from './envScenery.js';

/**
 * The world: one continuous valley.
 *   South  – the walled ruin plaza (Chapter I, spawn z≈178)
 *   Middle – a stone causeway over a misty ravine (Chapter II)
 *   North  – a sunken basin where the Colossus wanders (Chapter III)
 * Forward / north is −Z.
 */
export const SUN_DIR = new THREE.Vector3(-0.45, 0.62, -0.64).normalize();
export const PLAY_CENTER = new THREE.Vector2(0, 30);
export const PLAY_RADIUS = 225;
/** Chapter IV: the high meadow west of the plaza, reached through a breach in the plaza's west wall. */
export const MEADOW = { x: -112, z: 160, radius: 40, breachZ: 161.2, pool: { x: -119, z: 169, r: 5.2 } };
/** Chapter III: a free-standing ruined wall at the back of the basin, the one thing the Warden can grind against. */
export const BASIN_WALL = { x: -24, z: -140, w: 15, h: 13, d: 2.6 };

function segDist(x, z, ax, az, bx, bz) {
  const vx = bx - ax, vz = bz - az, t = clamp(((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz), 0, 1);
  return Math.hypot(x - ax - vx * t, z - az - vz * t);
}

const noiseA = makeNoise2D(17), noiseB = makeNoise2D(29), noiseC = makeNoise2D(41);

export function terrainHeight(x, z) {
  let h = fbm(noiseA, x * 0.011, z * 0.011, 4) * 7 + fbm(noiseB, x * 0.05, z * 0.05, 3) * 0.9;
  // plaza: flat floor
  const plaza = 1 - smoothstep(30, 48, Math.hypot(x * 0.8, z - 160));
  h = lerp(h, 0.02 * fbm(noiseB, x * 0.2, z * 0.2, 2), Math.max(plaza, (1 - smoothstep(26, 40, Math.abs(x))) * smoothstep(104, 112, z) * (1 - smoothstep(196, 200, z))));
  // hill behind spawn (south)
  h += smoothstep(192, 225, z) * (26 + fbm(noiseC, x * 0.03, z * 0.03, 3) * 10);
  // the high meadow (Chapter IV) and the old track to it from the plaza's west breach
  const meadow = 1 - smoothstep(MEADOW.radius + 2, MEADOW.radius + 24, Math.hypot(x - MEADOW.x, z - MEADOW.z));
  const track = 1 - smoothstep(4, 11, segDist(x, z, -30, MEADOW.breachZ, MEADOW.x + MEADOW.radius, MEADOW.z));
  h = lerp(h, 0.35 + fbm(noiseB, x * 0.05, z * 0.05, 2) * 0.35, Math.max(meadow, track));
  // the watering pool in the meadow: a shallow dish
  { const pd = Math.hypot(x - MEADOW.pool.x, z - MEADOW.pool.z); if (pd < MEADOW.pool.r + 3) h -= 0.75 * (1 - smoothstep(MEADOW.pool.r - 2, MEADOW.pool.r + 3, pd)); }
  // ravine crossing the valley (spanned by the causeway)
  const rav = smoothstep(16, 34, z) * (1 - smoothstep(94, 112, z));
  h = lerp(h, -18 + fbm(noiseC, x * 0.04, z * 0.04, 3) * 2.5, rav);
  // sunken basin (arena)
  const bd = Math.hypot(x, (z + 110) * 0.9);
  const basin = 1 - smoothstep(62, 98, bd);
  h = lerp(h, -6 + fbm(noiseB, x * 0.03, z * 0.03, 2) * 0.5, basin);
  // path from the causeway down into the basin
  const path = (1 - smoothstep(6, 16, Math.abs(x))) * smoothstep(-40, -20, z) * (1 - smoothstep(14, 20, z));
  h = lerp(h, lerp(-6, 0, smoothstep(-34, 12, z)), path);
  // causeway landings
  const land = (1 - smoothstep(8, 18, Math.abs(x))) * ((1 - smoothstep(12, 20, Math.abs(z - 116))) + (1 - smoothstep(6, 14, Math.abs(z - 15))));
  h = lerp(h, 0, clamp(land, 0, 1));
  // mountains enclosing the valley
  const R = Math.hypot(x, z - 30);
  h += smoothstep(215, 320, R) * (60 + fbm(noiseA, x * 0.008, z * 0.008, 4) * 70);
  return h;
}

const tmpV = new THREE.Vector3();
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1);

export class World {
  constructor(settings, bus) {
    this.settings = settings; this.bus = bus;
    this.scene = new THREE.Scene();
    this.colliders = [];          // static OBBs { c, h, cos, sin }
    this.climbables = [];         // static Object3D with userData.climb.half
    this.interactables = [];
    this.animated = [];
    this.rnd = mulberry32(1234);    // gameplay layout: never add or reorder calls
    this.drnd = mulberry32(9001);   // decoration only
    this.vegUniforms = { uTime: { value: 0 } };
    // bodies that part the grass as they pass (xyz, radius): the wanderer and a warden's feet
    this.pushers = { value: Array.from({ length: 6 }, () => new THREE.Vector4(0, -9999, 0, 0.001)) };
    this.batches = new Map();       // static stone merged per material / zone
    this.pillars = [];
    installAtmosphere(SUN_DIR);
    this.tex = {
      stone: masonryTexture(3), rock: masonryTexture(8, { courses: false }), noise: noiseTexture(),
      moss: mossTexture(), ground: groundTexture(), leaf: leafTexture(), vine: vineTexture(), bark: barkTexture(),
      dot: softDotTexture(), fog: fogPuffTexture(), shaft: shaftTexture(),
    };
    const stone = (color, map, o) => weatherStone(new THREE.MeshStandardMaterial({ color, map, roughness: 0.96 }), this.tex.noise, o);
    this.mat = {
      stone: stone(0xb3ab9a, this.tex.stone),
      stoneDark: stone(0x8d8678, this.tex.stone, { moss: 1.15 }),
      rock: stone(0x99948a, this.tex.rock, { scale: 0.33, moss: 1.1, stain: 0.4 }),
      farStone: stone(0x9d978a, this.tex.stone, { scale: 0.021, moss: 0.5, bump: 3 }),
      moss: new THREE.MeshStandardMaterial({ color: 0x8a9a5a, map: this.tex.moss, roughness: 1 }),
      wood: new THREE.MeshStandardMaterial({ color: 0x5a4a3a, map: this.tex.bark, bumpMap: this.tex.bark, bumpScale: 2.5, roughness: 1 }),
      leaf: new THREE.MeshStandardMaterial({ color: 0x5e6d3a, roughness: 0.9, flatShading: true }),
      leafDark: new THREE.MeshStandardMaterial({ color: 0x46552c, roughness: 0.9, flatShading: true }),
      obsidian: new THREE.MeshStandardMaterial({ color: 0x2a2826, roughness: 0.6, metalness: 0.1 }),
    };
    this.buildSky();
    this.buildLights();
    this.buildTerrain();
    this.buildPlaza();
    this.buildCauseway();
    this.buildBasin();
    this.buildMeadow();
    this.buildTrees();
    this.buildGrass();
    this.buildAtmosphere();
    this.buildRuinDetail();
    this.buildDistance();
    this.finalizeStatic();
    this.tintTerrainNearRuins();
    bus.on('settings:changed', ({ key }) => { if (key === 'vegetation') this.applyVegetation(); });
  }

  // ---------------------------------------------------------------- sky & light
  buildSky() {
    const s = this.scene;
    this.fogColor = new THREE.Color(ATMOS.warm);
    s.fog = new THREE.Fog(this.fogColor, 40, 560);   // enables fog; the look comes from envShaders
    s.background = this.fogColor.clone();
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1800, 32, 16), skyMaterial(this.vegUniforms));
    this.sky.frustumCulled = false; this.sky.renderOrder = -10;
    s.add(this.sky);
  }

  buildLights() {
    // cool, soft sky fill against a low warm sun
    const hemi = new THREE.HemisphereLight(0xcdd3d2, 0x6a604a, 1.95);
    this.scene.add(hemi);
    const sun = this.sun = new THREE.DirectionalLight(0xffe2b6, 3.3);
    sun.userData.sun = true;
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera; sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 1; sc.far = 400;
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.05; sun.shadow.radius = 2.2;
    this.scene.add(sun, sun.target);
    // light-space basis for texel snapping
    this._sunR = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), SUN_DIR).normalize();
    this._sunU = new THREE.Vector3().crossVectors(SUN_DIR, this._sunR).normalize();
    this._sunF = new THREE.Vector3();
  }

  /** Keep the shadow frustum centred on whatever matters this frame — moved in whole shadow texels so edges never crawl. */
  followSun(focus) {
    const texel = 140 / this.sun.shadow.mapSize.x;
    const r = Math.round(focus.dot(this._sunR) / texel) * texel, u = Math.round(focus.dot(this._sunU) / texel) * texel;
    const f = this._sunF.set(0, 0, 0).addScaledVector(this._sunR, r).addScaledVector(this._sunU, u).addScaledVector(SUN_DIR, focus.dot(SUN_DIR));
    this.sun.position.copy(f).addScaledVector(SUN_DIR, 200);
    this.sun.target.position.copy(f);
    this.sky.position.copy(focus).setY(0);
  }

  // ---------------------------------------------------------------- terrain
  buildTerrain() {
    const size = 900, seg = 300;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    // muted palette: olive turf, faded yellow-green, earth, weathered rock, damp ravine floor
    const cGrass = new THREE.Color(0x55633a), cDry = new THREE.Color(0x7c7e4c), cDirt = new THREE.Color(0x6c5e48), cRock = new THREE.Color(0x7f7b72), cDeep = new THREE.Color(0x474c3c), cPath = new THREE.Color(0x73664f);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      // beyond the playable rim the mesh alone grows crags and gullies (collision never reaches there)
      const R = Math.hypot(x, z - 30), rim = smoothstep(238, 310, R);
      const crag = rim > 0 ? (1 - Math.abs(fbm(noiseB, x * 0.012, z * 0.012, 4)) * 2.2) * 34 + fbm(noiseC, x * 0.06, z * 0.06, 3) * 9 : 0;
      pos.setY(i, terrainHeight(x, z) + rim * crag);
    }
    geo.computeVertexNormals();
    const nrm = geo.attributes.normal;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), y = pos.getY(i);
      const slope = 1 - nrm.getY(i);
      const v = fbm(noiseC, x * 0.022, z * 0.022, 3), w = fbm(noiseA, x * 0.07 + 40, z * 0.07, 2);
      c.copy(cGrass).lerp(cDry, clamp(0.38 + v * 1.3 + w * 0.35, 0, 1));
      if (y < -12) c.lerp(cDeep, smoothstep(-12, -17, y));
      // the old road: worn earth from the plaza gate, over the causeway landings, down into the basin
      const road = (1 - smoothstep(2.5, 7 + w * 4, Math.abs(x + Math.sin(z * 0.05) * 2))) * smoothstep(-70, -30, z) * (1 - smoothstep(124, 131, z));
      c.lerp(cPath, road * (0.45 + w * 0.5));
      c.lerp(cDirt, smoothstep(0.1, 0.26, slope) * 0.8);
      c.lerp(cRock, smoothstep(50, 130, y) * 0.8);
      if (y > 20) c.lerp(cDry, smoothstep(20, 70, y) * 0.5);
      colors.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mesh = this.terrain = new THREE.Mesh(geo, terrainMaterial(this.tex.noise, this.tex.rock));
    mesh.receiveShadow = true;
    this.scene.add(mesh);
  }

  /** Darker, barer earth hugging walls and plinths — a cheap baked contact shadow. */
  tintTerrainNearRuins() {
    const pos = this.terrain.geometry.attributes.position, col = this.terrain.geometry.attributes.color;
    const dark = new THREE.Color(0x4f4737), c = new THREE.Color();
    const cols = this.colliders.filter((k) => k.h.x * k.h.z > 0.6);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      if (Math.abs(x) > 80 || z > 205 || z < -200) continue;
      const y = pos.getY(i);
      let near = 9;
      for (const k of cols) {
        if (k.c.y - k.h.y > y + 1.5) continue;
        const dx = x - k.c.x, dz = z - k.c.z;
        const lx = Math.abs(dx * k.cos + dz * k.sin) - k.h.x, lz = Math.abs(-dx * k.sin + dz * k.cos) - k.h.z;
        const d = Math.hypot(Math.max(lx, 0), Math.max(lz, 0));
        if (d < near) near = d;
      }
      if (near >= 4.5) continue;
      c.fromBufferAttribute(col, i).lerp(dark, (1 - near / 4.5) * 0.35);
      col.setXYZ(i, c.r, c.g, c.b);
    }
    col.needsUpdate = true;
  }

  heightAt(x, z) { return terrainHeight(x, z); }

  /** Highest supporting surface under (x,z) not above feetY + step. */
  groundAt(x, z, feetY, step = 0.6) {
    let y = terrainHeight(x, z);
    for (const col of this.colliders) {
      const top = col.c.y + col.h.y;
      if (top < y || top > feetY + step) continue;
      const dx = x - col.c.x, dz = z - col.c.z;
      const lx = dx * col.cos + dz * col.sin, lz = -dx * col.sin + dz * col.cos;
      if (Math.abs(lx) <= col.h.x + 0.05 && Math.abs(lz) <= col.h.z + 0.05) y = top;
    }
    return y;
  }

  /** Push a vertical cylinder out of static colliders (horizontal only). */
  resolveCollisions(p, radius, height) {
    for (const col of this.colliders) {
      const top = col.c.y + col.h.y, bottom = col.c.y - col.h.y;
      if (p.y >= top - 0.05 || p.y + height <= bottom) continue;
      const dx = p.x - col.c.x, dz = p.z - col.c.z;
      let lx = dx * col.cos + dz * col.sin, lz = -dx * col.sin + dz * col.cos;
      const ox = col.h.x + radius - Math.abs(lx), oz = col.h.z + radius - Math.abs(lz);
      if (ox <= 0 || oz <= 0) continue;
      // step-up: tiny ledges are handled by groundAt
      if (top - p.y < 0.6) continue;
      if (ox < oz) lx += Math.sign(lx || 1) * ox; else lz += Math.sign(lz || 1) * oz;
      p.x = col.c.x + lx * col.cos - lz * col.sin;
      p.z = col.c.z + lx * col.sin + lz * col.cos;
    }
    // world boundary
    const dx = p.x - PLAY_CENTER.x, dz = p.z - PLAY_CENTER.y, d = Math.hypot(dx, dz);
    if (d > PLAY_RADIUS) { p.x = PLAY_CENTER.x + dx / d * PLAY_RADIUS; p.z = PLAY_CENTER.y + dz / d * PLAY_RADIUS; }
  }

  // ---------------------------------------------------------------- building helpers
  /** Queue static stone for merging: one draw call per material / shadow flag / zone instead of one per block. */
  addStatic(geo, mat, matrix, shadow = true) {
    let g = geo.index ? geo.toNonIndexed() : geo;
    g.deleteAttribute('uv'); g.deleteAttribute('color');
    g.applyMatrix4(matrix);
    if (this._capture) {                                  // stone that must come and go stays its own mesh
      const m = new THREE.Mesh(g, mat); m.castShadow = shadow; m.receiveShadow = true; this._capture.add(m); return;
    }
    const z = matrix.elements[14], zone = z > 120 ? 0 : z > 0 ? 1 : 2;
    const key = mat.uuid + (shadow ? 's' : 'n') + zone;
    let b = this.batches.get(key);
    if (!b) this.batches.set(key, b = { mat, shadow, parts: [] });
    b.parts.push(g);
  }
  finalizeStatic() {
    for (const b of this.batches.values()) {
      const m = new THREE.Mesh(mergeGeometries(b.parts), b.mat);
      m.castShadow = b.shadow; m.receiveShadow = true; m.matrixAutoUpdate = false;
      this.scene.add(m);
      for (const g of b.parts) g.dispose();
    }
    this.batches.clear();
  }
  /** Hewn block with worn, chipped edges. */
  hewn(w, h, d, amp = 1) {
    const r = Math.min(0.18, w * 0.2, h * 0.2, d * 0.2);
    return chiseledBox(w, h, d, { radius: r, seg: 2, amp: Math.min(0.07, r * 0.55) * amp, freq: 0.8, seed: this.drnd() * 90 });
  }
  /** Box block; y is the BOTTOM of the block. */
  block(x, y, z, w, h, d, { mat = this.mat.stone, yaw = 0, collide = true, shadow = true, roll = 0, pitch = 0 } = {}) {
    const pos = new THREE.Vector3(x, y + h / 2, z);
    this.addStatic(this.hewn(w, h, d), mat, _m4.compose(pos, _q.setFromEuler(_e.set(pitch, yaw, roll, 'YXZ')), _one), shadow);
    if (collide && roll === 0 && pitch === 0) this.addCollider(pos, new THREE.Vector3(w / 2, h / 2, d / 2), yaw);
    return { position: pos, receiveShadow: true };
  }
  uvScale(geo, w, h, d) {
    // world-scaled UVs so stone texture density is consistent across block sizes
    const uv = geo.attributes.uv, n = geo.attributes.normal;
    for (let i = 0; i < uv.count; i++) {
      const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i));
      const sx = ax > 0.5 ? d : w, sy = ay > 0.5 ? d : h;
      uv.setXY(i, uv.getX(i) * sx / 4, uv.getY(i) * sy / 4);
    }
  }
  addCollider(center, half, yaw = 0) {
    // local frame matches a mesh with rotation.y = yaw (local x = (cos, 0, -sin))
    this.colliders.push({ c: center.clone(), h: half.clone(), cos: Math.cos(yaw), sin: -Math.sin(yaw) });
  }
  pillar(x, y, z, r, h, { broken = false, mat = this.mat.stone } = {}) {
    const put = (g, py, rz = 0, ry = 0) => this.addStatic(g, mat, _m4.compose(_v.set(x, y + py, z), _q.setFromEuler(_e.set(0, ry, rz, 'YXZ')), _one));
    const seed = this.drnd() * 50;
    put(this.hewn(r * 2.6, 0.6, r * 2.6), 0.3, 0, (this.drnd() - 0.5) * 0.08);
    put(new THREE.CylinderGeometry(r * 1.08, r * 1.2, 0.24, 20), 0.72);                      // base moulding
    // shaft: slight entasis, weathered out of round
    const shaft = new THREE.CylinderGeometry(r * 0.9, r, h, 20, Math.max(3, Math.round(h / 0.9)));
    { const p = shaft.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const px = p.getX(i), py = p.getY(i), pz = p.getZ(i), rr = Math.hypot(px, pz); if (rr < 1e-3) continue;
        const k = 1 + Math.sin((py / h + 0.5) * Math.PI) * 0.03 + noise3(px * 2.2, py * 0.9, pz * 2.2, seed) * 0.03 + Math.cos(Math.atan2(pz, px) * 16) * 0.012;
        p.setX(i, px * k); p.setZ(i, pz * k);
      }
      shaft.computeVertexNormals(); }
    put(shaft, 0.6 + h / 2);
    if (!broken) {
      put(new THREE.CylinderGeometry(r * 1.28, r * 0.92, 0.36, 20), 0.6 + h - 0.1);          // echinus
      put(this.hewn(r * 2.7, 0.7, r * 2.7), 0.6 + h + 0.35, 0, (this.drnd() - 0.5) * 0.06);  // abacus
    } else {
      const top = new THREE.CylinderGeometry(r * 0.45, r * 0.92, 0.9, 9, 2);
      { const p = top.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + noise3(p.getX(i) * 4, 0, p.getZ(i) * 4, seed) * 0.28 * (p.getY(i) > 0 ? 1 : 0)); top.computeVertexNormals(); }
      put(top, 0.6 + h + 0.3, 0.3, this.drnd() * 6.28);
    }
    this.addCollider(new THREE.Vector3(x, y + (h + 1.3) / 2, z), new THREE.Vector3(r * 1.1, (h + 1.3) / 2, r * 1.1));
    this.pillars.push({ x, y, z, r, h, broken, mat });
  }
  /** Mossy, climbable panel glued to a wall face. Climb system reads userData.climb. */
  mossPanel(x, y, z, w, h, d, { yaw = 0, parent = this.scene, isStatic = true } = {}) {
    const geo = new THREE.BoxGeometry(w, h, d);
    this.uvScale(geo, w, h, d);
    const m = new THREE.Mesh(geo, this.mat.moss);
    m.position.set(x, y + h / 2, z); m.rotation.y = yaw;
    m.receiveShadow = true; m.castShadow = false;
    m.userData.climb = { half: new THREE.Vector3(w / 2, h / 2, d / 2), static: isStatic, side: 1 };
    parent.add(m);
    if (isStatic) this.climbables.push(m);
    // hanging moss fringe for silhouette
    const fringe = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.9, 0.8), new THREE.MeshStandardMaterial({ color: 0x6a7a42, map: this.tex.moss, transparent: true, opacity: 0.9, side: THREE.DoubleSide, alphaTest: 0.2 }));
    fringe.position.set(0, -h / 2 - 0.3, d / 2 + 0.02); m.add(fringe);
    return m;
  }

  /** Returns add(geo, px,py,pz, rx,ry,rz) placing a piece inside a yawed group at (x,y,z). */
  statueBuilder(x, y, z, yaw, mat) {
    const G = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), _one);
    return (geo, px, py, pz, rx = 0, ry = 0, rz = 0, m = mat) => {
      const L = new THREE.Matrix4().compose(new THREE.Vector3(px, py, pz), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), _one);
      this.addStatic(geo, m, L.premultiply(G));
    };
  }
  statueKneeling(x, z, yaw) {
    const y = this.heightAt(x, z);
    const add = this.statueBuilder(x, y, z, yaw, this.mat.stoneDark);
    const B = (w, h, d, r = 0.22) => chiseledBox(w, h, d, { radius: Math.min(r, w * 0.3, h * 0.3, d * 0.3), seg: 3, amp: 0.07, freq: 1.1, seed: this.drnd() * 60 });
    add(this.hewn(5.4, 0.45, 4.4), 0, 0.22, 0);                               // plinth, two courses
    add(this.hewn(5, 0.6, 4), 0, 0.72, 0);
    add(B(1.4, 3.4, 1.2, 0.4), -0.9, 2.6, 0.3, 0.1);                           // thigh/knee mass
    add(B(1.4, 1.2, 3, 0.4), 0.9, 1.6, 0.2);                                   // folded leg
    add(chiseledBox(2.8, 3.8, 1.8, { radius: 0.55, seg: 3, amp: 0.08, seed: 3, taper: [0.82, 1.05] }), 0, 5.4, -0.2, -0.18); // torso bowed
    add(B(3.3, 0.9, 1.7, 0.4), 0, 7.0, -0.38, -0.2);                           // shoulder yoke
    add(chiseledBox(1.4, 1.6, 1.5, { radius: 0.5, seg: 3, amp: 0.06, seed: 5 }), 0, 7.75, 0.45, 0.5);  // head bowed
    add(B(1.55, 0.5, 1.6, 0.2), 0, 8.38, 0.05, 0.5);                           // helm brow
    add(B(0.8, 3.6, 0.8, 0.3), -1.8, 4.6, 0.6, -0.5, 0, 0.1);                  // arms
    add(B(0.8, 3.6, 0.8, 0.3), 1.8, 4.6, 0.6, -0.5, 0, -0.1);
    add(B(0.5, 0.3, 4.5, 0.1), 0, 3.6, 1.8, 0.25);                             // sword across knees
    add(B(1.5, 0.22, 0.4, 0.08), 0, 3.3, 0.35, 0.25);                          // crossguard
    this.addCollider(new THREE.Vector3(x, y + 2, z), new THREE.Vector3(2.6, 2, 2.2), yaw);
  }
  statueHeadless(x, z, yaw) {
    const y = this.heightAt(x, z);
    const add = this.statueBuilder(x, y, z, yaw, this.mat.stone);
    add(this.hewn(3.8, 0.5, 3.8), 0, 0.25, 0);
    add(this.hewn(3.4, 0.7, 3.4), 0, 0.85, 0);
    // robed body: folds cut into the drum
    const robe = new THREE.CylinderGeometry(1.05, 1.6, 6, 22, 8);
    { const p = robe.attributes.position; for (let i = 0; i < p.count; i++) { const a = Math.atan2(p.getZ(i), p.getX(i)), k = 1 + Math.cos(a * 7 + p.getY(i) * 0.25) * 0.055 * (0.6 - p.getY(i) / 6); p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); } robe.computeVertexNormals(); }
    add(robe, 0, 4.2, 0);
    add(chiseledBox(3.2, 1, 1.4, { radius: 0.4, seg: 3, amp: 0.06, seed: 9 }), 0, 7.4, 0);   // shoulders
    add(chiseledBox(0.7, 3.2, 0.7, { radius: 0.28, seg: 3, amp: 0.05, seed: 11 }), -1.5, 5.6, 0.2, 0, 0, 0.05);
    add(chiseledBox(0.7, 1.3, 0.7, { radius: 0.28, seg: 3, amp: 0.08, seed: 12 }), 1.5, 6.5, 0.15, 0, 0, -0.05); // arm broken at the elbow
    add(chiseledBox(0.6, 0.5, 0.6, { radius: 0.2, seg: 2, amp: 0.08, seed: 13 }), 0, 8.1, 0); // broken neck
    this.addCollider(new THREE.Vector3(x, y + 4, z), new THREE.Vector3(1.7, 4, 1.7));
  }

  // ---------------------------------------------------------------- Chapter I: plaza
  buildPlaza() {
    const S = this.mat.stone, D = this.mat.stoneDark;
    // paving (overgrown, broken)
    for (let i = 0; i < 160; i++) {
      const x = (this.rnd() - 0.5) * 50, z = 136 + this.rnd() * 58;
      if (this.rnd() < 0.35) continue;
      const w = 1.6 + this.rnd() * 1.8;
      const t = this.block(x, -0.12 + this.rnd() * 0.08, z, w, 0.22, w * (0.7 + this.rnd() * 0.5), { mat: this.rnd() < 0.5 ? S : D, yaw: (this.rnd() - 0.5) * 0.3, collide: false, shadow: false });
      t.receiveShadow = true;
    }
    // side walls (tall, smooth, not climbable)
    for (const sx of [-1, 1]) {
      for (let z = 132; z < 200; z += 8.4) {
        const h = 7.5 + this.rnd() * 3 - (z > 180 ? 2 : 0);
        const mat = this.rnd() < 0.5 ? S : D;
        if (sx < 0 && Math.abs(z + 4 - MEADOW.breachZ) < 1) { this.breachSection(sx * 32, z + 4, h, mat); continue; }
        this.block(sx * 32, -0.5, z + 4, 3, h, 8.6, { mat });
      }
    }
    // north wall with the collapsed gate
    const wallZ = 130, wallH = 7;
    this.block(-18.5, -0.5, wallZ, 27, wallH + 0.5, 3, { mat: S });
    this.block(18.5, -0.5, wallZ, 27, wallH + 0.5, 3, { mat: S });
    // gate frame + rubble (blocked)
    this.block(-4.2, -0.5, wallZ, 2.4, 11, 3.6, { mat: D });
    this.block(4.2, -0.5, wallZ, 2.4, 11, 3.6, { mat: D });
    this.block(0, 9.2, wallZ, 11, 1.8, 3.8, { mat: D, collide: false });
    for (let i = 0; i < 9; i++) {
      const s = 1.4 + this.rnd() * 1.6;
      this.block((this.rnd() - 0.5) * 5.6, -0.3 + (i % 3) * 1.4, wallZ + (this.rnd() - 0.5) * 2, s, s, s, { mat: this.rnd() < 0.5 ? S : D, yaw: this.rnd() * 3 });
    }
    // the climbable moss section on the inner (south) face of the north wall
    this.mossPanel(10, 0.2, wallZ + 1.62, 5, wallH - 0.1, 0.24);
    // colonnade
    for (const sx of [-1, 1]) for (let i = 0; i < 6; i++) {
      const z = 142 + i * 8.5; const broken = this.rnd() < 0.4;
      this.pillar(sx * 12, 0, z, 0.8, broken ? 3 + this.rnd() * 4 : 9, { broken, mat: i % 2 ? S : D });
    }
    // fallen pillar
    const fp = new THREE.Mesh(new THREE.CylinderGeometry(0.76, 0.8, 9, 22, 6), D);
    fp.rotation.z = Math.PI / 2; fp.rotation.y = 0.5; fp.position.set(-6, 0.75, 154); fp.castShadow = fp.receiveShadow = true;
    this.scene.add(fp); this.addCollider(fp.position, new THREE.Vector3(4.2, 0.75, 0.8), 0.5);
    // statues
    this.statueKneeling(-19, 160, Math.PI / 2);
    this.statueHeadless(19, 146, -Math.PI / 2);
    // low altar in the middle
    this.block(0, 0, 160, 3.6, 0.9, 2.2, { mat: D });

    this.interactables.push(
      { id: 'statueKneeling', kind: 'examine', label: 'Examine', pos: new THREE.Vector3(-15.5, 1, 160), radius: 4.2,
        lines: [{ speaker: '', text: 'A kneeling warden. Its sword rests across its knees, never drawn.' }, { speaker: 'Echo', text: 'They knelt so the giants would pass them by.' }] },
      { id: 'statueHeadless', kind: 'examine', label: 'Examine', pos: new THREE.Vector3(16.6, 1, 146), radius: 3.8,
        lines: [{ speaker: '', text: 'The head lies somewhere in the grass. The plinth reads only: “Hold fast.”' }] },
      { id: 'altar', kind: 'examine', label: 'Examine', pos: new THREE.Vector3(0, 1, 160), radius: 3.2,
        lines: [{ speaker: '', text: 'Grooves worn into the altar trace the shape of a hand, gripping.' }, { speaker: 'Echo', text: 'Where stone is soft with moss, it can be held.' }] },
    );
    // shrine past the wall – end of Chapter I
    this.shrine(0, 117, 'shrine1', 1);
  }

  /** Curtain of hanging vines; y is the TOP edge. Only used on ledges out of reach, so it never reads as a handhold. */
  mossDrape(x, y, z, yaw = 0, w = 2.5, h = 3) {
    const g = new THREE.PlaneGeometry(w, h, 4, 3); g.translate(0, -h / 2, 0);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 2.3 + x) * 0.07 * (-p.getY(i) / h + 0.3));
    g.computeVertexNormals();
    g.applyMatrix4(_m4.compose(_v.set(x, y, z), _q.setFromEuler(_e.set(0, yaw, 0, 'YXZ')), _one));
    (this.drapes || (this.drapes = [])).push(g);
  }

  shrine(x, z, id, chapterCompleted) {
    const y = this.heightAt(x, z);
    const g = new THREE.Group(); g.position.set(x, y, z);
    const D = this.mat.stoneDark;
    const put = (geo, py, ry = 0) => this.addStatic(geo, D, _m4.compose(_v.set(x, y + py, z), _q.setFromEuler(_e.set(0, ry, 0, 'YXZ')), _one));
    put(new THREE.CylinderGeometry(2.5, 2.8, 0.25, 8), 0.12, 0.39);
    put(new THREE.CylinderGeometry(2.05, 2.25, 0.3, 8), 0.38, 0.39);
    put(chiseledBox(0.9, 2.4, 0.9, { radius: 0.12, seg: 2, amp: 0.04, seed: x + z, taper: [1.12, 0.86] }), 1.7);
    put(new THREE.CylinderGeometry(0.62, 0.5, 0.22, 12), 2.86);
    put(new THREE.CylinderGeometry(0.98, 0.52, 0.5, 14), 3.15);
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xffe2b0, transparent: true, opacity: 0.0, fog: false });
    const flame = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 8), flameMat); flame.position.y = 3.5;
    const light = new THREE.PointLight(0xffd6a0, 0, 12, 2); light.position.y = 3.6;
    g.add(flame, light);
    this.scene.add(g);
    this.addCollider(new THREE.Vector3(x, y + 1.8, z), new THREE.Vector3(0.5, 1.8, 0.5));
    const it = { id, kind: 'shrine', label: 'Rest', pos: new THREE.Vector3(x, y + 1, z), radius: 3.4, chapterCompleted,
      lit: false, flame, light,
      light_up: () => { it.lit = true; } };
    this.interactables.push(it);
    this.animated.push((dt, t) => {
      const target = it.lit ? 1 : 0.12;
      flameMat.opacity += (target * 0.9 - flameMat.opacity) * Math.min(1, dt * 2);
      light.intensity += (target * 14 * (0.9 + Math.sin(t * 7) * 0.06 + Math.sin(t * 13) * 0.04) - light.intensity) * Math.min(1, dt * 3);
      flame.scale.setScalar(0.8 + Math.sin(t * 9) * 0.06 + (it.lit ? 0.4 : 0));
    });
    return it;
  }

  // ---------------------------------------------------------------- Chapter II: causeway
  buildCauseway() {
    const S = this.mat.stone, D = this.mat.stoneDark;
    const deckTop = 0.4, gapA = 77.5, gapB = 80.7;
    this.causeway = { deckTop, gapA, gapB, zStart: 110, zEnd: 21, hazardZ: [38, 62] };
    const segs = [[110, gapB], [gapA, 21]];
    for (const [z0, z1] of segs) {
      const len = z0 - z1, cz = (z0 + z1) / 2;
      this.block(0, deckTop - 1.4, cz, 6, 1.4, len, { mat: S });
      // low parapets with gaps
      for (const sx of [-1, 1]) for (let z = z1 + 1; z < z0 - 1; z += 4.2) {
        if (this.rnd() < 0.35) continue;
        this.block(sx * 2.75, deckTop, z, 0.5, 0.5 + this.rnd() * 0.5, 3.6, { mat: D });
      }
    }
    // broken jagged ends at the gap
    this.block(-1.4, deckTop - 1.4, gapB + 0.6, 2.4, 1.4, 1.2, { mat: D, yaw: 0.2, collide: false });
    this.block(1.6, deckTop - 1.8, gapA - 0.5, 2, 1.2, 1.4, { mat: D, yaw: -0.3, collide: false });
    // support piers into the ravine
    for (let z = 104; z > 24; z -= 12) {
      if (Math.abs(z - (gapA + gapB) / 2) < 3) continue;
      const by = this.heightAt(0, z) - 2;
      this.block(0, by, z, 4.6, deckTop - 1.4 - by, 3.2, { mat: D });
      // arch skirts
      this.block(0, deckTop - 3.2, z - 6, 5.2, 1.8, 8, { mat: S, collide: false });
    }
    // sentinel pillars along the causeway
    for (let z = 104; z > 26; z -= 13) for (const sx of [-1, 1]) {
      if (Math.abs(z - 79) < 4) continue;
      const broken = this.rnd() < 0.5;
      this.block(sx * 4, deckTop - 1.4, z, 2.2, 1.4, 2.2, { mat: S });  // buttress the pillar stands on
      this.pillar(sx * 4, deckTop, z, 0.55, broken ? 2 + this.rnd() * 3 : 6.5, { broken, mat: D });
    }
    // ruined tower beside the hazard section (where rocks fall from)
    const tx = 15, tz = 50, tb = this.heightAt(tx, tz) - 1;
    this.block(tx, tb, tz, 7, 44, 7, { mat: D });
    this.block(tx - 1, tb + 44, tz, 5, 4, 6, { mat: S, yaw: 0.2 });
    this.block(tx - 3.5, tb + 36, tz + 1, 3, 3, 3, { mat: S, yaw: 0.5, collide: false });
    this.towerTop = new THREE.Vector3(tx - 3, tb + 46, tz);
    // mist in the ravine
    const mist = new THREE.Mesh(new THREE.PlaneGeometry(600, 70), new THREE.MeshBasicMaterial({ color: 0xd9d3c4, transparent: true, opacity: 0.55, depthWrite: false, map: this.tex.fog }));
    mist.rotation.x = -Math.PI / 2; mist.position.set(0, -12, 64); this.tex.fog.repeat?.set(1, 1);
    this.scene.add(mist);
    for (let i = 0; i < 3; i++) {
      const m2 = mist.clone(); m2.material = mist.material.clone(); m2.material.opacity = 0.3; m2.position.y = -9 + i * 2.5; m2.position.z = 60 + i * 4; this.scene.add(m2);
      this.animated.push((dt, t) => { m2.position.x = Math.sin(t * 0.03 + i) * 20; });
    }
    this.shrine(0, 15, 'shrine2', 2);
  }

  /**
   * The stretch of west wall that opens onto the meadow: whole until the first warden falls, then breached.
   * Both versions are built once as their own groups (not merged), with their own colliders, and swapped.
   */
  breachSection(x, zc, h, mat) {
    const build = (fn) => {
      const g = new THREE.Group(), n0 = this.colliders.length;
      this._capture = g; fn(); this._capture = null;
      this.scene.add(g);
      return { g, cols: this.colliders.splice(n0) };
    };
    // the whole wall is chiselled from its own seed, so it doesn't shift the decoration stream after it
    const whole = build(() => {
      const pos = new THREE.Vector3(x, -0.5 + h / 2, zc);
      this.addStatic(chiseledBox(3, h, 8.6, { radius: 0.18, seg: 2, amp: 0.07, freq: 0.8, seed: 77 }), mat, _m4.compose(pos, _q.identity(), _one));
      this.addCollider(pos, new THREE.Vector3(1.5, h / 2, 4.3));
    });
    const broken = build(() => this.breach(x, zc, h, mat));
    const show = (part, on) => {
      part.g.visible = on;
      this.colliders = this.colliders.filter((k) => !part.cols.includes(k));
      if (on) this.colliders.push(...part.cols);
    };
    this.westBreach = { open: null, setOpen: (open) => { if (this.westBreach.open === open) return; this.westBreach.open = open; show(whole, !open); show(broken, open); } };
    this.westBreach.setOpen(true);
  }

  /** A stretch of the plaza wall fallen outward: broken stubs either side, the courses spilled down the slope. */
  breach(x, zc, h, mat) {
    const D = this.mat.stoneDark, S = this.mat.stone;
    this.block(x, -0.5, zc - 3.4, 3, h * 0.55, 1.8, { mat });
    this.block(x + 0.2, -0.5, zc + 3.5, 3, h * 0.38, 1.6, { mat });
    this.block(x - 0.3, h * 0.55 - 0.5, zc - 3.6, 2.4, 1.1, 1.2, { mat: D, collide: false, roll: 0.3, yaw: 0.2 });
    const r = mulberry32(51);
    for (let i = 0; i < 12; i++) {
      let s = 0.7 + r() * 1.4; const bx = x - 2 - r() * 9, bz = zc + (r() - 0.5) * 9;
      if (Math.abs(bz - zc) < 2.4) s = Math.min(s, 0.45);           // a walkable lane through the gap: pebbles only
      const by = this.heightAt(bx, bz) - s * 0.35;
      const w = s * (1.2 + r()), d = s * (0.8 + r() * 0.6), yaw = r() * 3;
      this.block(bx, by, bz, w, s, d, { mat: r() < 0.5 ? S : D, collide: false, yaw, roll: (r() - 0.5) * 0.6, pitch: (r() - 0.5) * 0.5 });
      // tilted blocks get no collider of their own: give the bigger ones a slightly shrunk upright one, so they can't be walked through
      if (s > 0.85) this.addCollider(new THREE.Vector3(bx, by + s * 0.5, bz), new THREE.Vector3(w * 0.42, s * 0.5, d * 0.42), yaw);
    }
  }

  inMeadow(x, z) {
    return Math.hypot(x - MEADOW.x, z - MEADOW.z) < MEADOW.radius + 12 || (z > MEADOW.breachZ - 9 && z < MEADOW.breachZ + 9 && x < -30 && x > MEADOW.x);
  }

  // ---------------------------------------------------------------- Chapter IV: the high meadow
  /** A level field ringed with standing stones — the only things the Strider's horns can't shove aside. */
  buildMeadow() {
    const r = mulberry32(4242), c = MEADOW;
    const stones = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + (r() - 0.5) * 0.3, rad = 23 + r() * 5;
      if (Math.abs(Math.atan2(Math.sin(a - Math.PI / 2), Math.cos(a - Math.PI / 2))) < 0.45) { r(); r(); continue; } // the way in stays open
      const x = c.x + Math.sin(a) * rad, z = c.z + Math.cos(a) * rad, y = this.heightAt(x, z);
      const h = 9 + r() * 3, w = 3.2, d = 2.5, yaw = a + (r() - 0.5) * 0.5;
      const m = new THREE.Mesh(chiseledBox(w, h, d, { radius: 0.45, seg: 3, amp: 0.14, freq: 0.7, seed: 900 + i, taper: [1.08, 0.82] }), this.mat.stoneDark);
      m.position.set(x, y + h / 2 - 0.6, z); m.rotation.y = yaw; m.castShadow = true; m.receiveShadow = true;
      this.scene.add(m);
      this.addCollider(new THREE.Vector3(x, y + h / 2 - 0.6, z), new THREE.Vector3(w / 2, h / 2, d / 2), yaw);
      const col = this.colliders[this.colliders.length - 1];
      const s = { x, z, y, h, r: 1.75, hp: 2, broken: false, mesh: m, col, lean: 0, base: m.quaternion.clone(), axis: new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)), yaw };
      stones.push(s);
      // weathered chips at the foot
      for (let k = 0; k < 3; k++) { const q = 0.4 + r() * 0.6, bx = x + (r() - 0.5) * 5, bz = z + (r() - 0.5) * 5; this.block(bx, this.heightAt(bx, bz) - q * 0.3, bz, q * 1.4, q, q, { mat: this.mat.stone, collide: false, yaw: r() * 3, roll: (r() - 0.5) * 0.5 }); }
    }
    // the watering pool: the only place the Strider lowers its head of its own accord
    const pool = { ...c.pool, y: this.heightAt(c.pool.x + c.pool.r, c.pool.z) - 0.2 };
    { const water = new THREE.Mesh(new THREE.CircleGeometry(c.pool.r + 0.6, 40), new THREE.MeshStandardMaterial({ color: 0x41535a, roughness: 0.08, metalness: 0.35, transparent: true, opacity: 0.82 }));
      water.rotation.x = -Math.PI / 2; water.position.set(pool.x, pool.y, pool.z); water.receiveShadow = true; this.scene.add(water);
      for (let k = 0; k < 9; k++) { const a = (k / 9) * Math.PI * 2 + r() * 0.4, q = 0.35 + r() * 0.5, bx = pool.x + Math.sin(a) * (c.pool.r + 1.2), bz = pool.z + Math.cos(a) * (c.pool.r + 1.2); this.block(bx, this.heightAt(bx, bz) - q * 0.4, bz, q * 1.6, q, q * 1.2, { mat: this.mat.stone, collide: false, yaw: r() * 3, roll: (r() - 0.5) * 0.4 }); } }
    // stones crack when rammed and shatter on the second blow; a reload stands them all up again
    const chunkGeo = chiseledBox(1.6, 1.2, 1.3, { radius: 0.3, amp: 0.12, seed: 77 });
    const stoneApi = {
      crack: (st) => { if (st.broken) return false; st.hp--; st.lean += 0.06; if (st.hp <= 0) { stoneApi.shatter(st); return true; } return false; },
      shatter: (st) => {
        st.broken = true; st.mesh.visible = false;
        this.colliders = this.colliders.filter((k) => k !== st.col);
        if (!st.rubble) {
          st.rubble = new THREE.Group();
          const stump = new THREE.Mesh(chiseledBox(3.2, 2.4, 2.5, { radius: 0.4, amp: 0.2, seed: 901 + stones.indexOf(st), taper: [1.08, 0.9] }), this.mat.stoneDark);
          stump.position.set(0, 0.6, 0); stump.rotation.y = st.yaw; st.rubble.add(stump);
          for (let k = 0; k < 6; k++) { const ch = new THREE.Mesh(chunkGeo, this.mat.stoneDark); const a = k * 1.1 + st.x; ch.position.set(Math.sin(a) * (2 + k * 0.5), 0.2, Math.cos(a) * (2 + k * 0.5)); ch.rotation.set(k, a, k * 0.7); ch.scale.setScalar(0.6 + (k % 3) * 0.35); st.rubble.add(ch); }
          st.rubble.position.set(st.x, st.y - 0.3, st.z); st.rubble.traverse((o) => { o.castShadow = o.receiveShadow = true; });
          this.scene.add(st.rubble);
          st.stumpCol = { c: new THREE.Vector3(st.x, st.y + 0.6, st.z), h: new THREE.Vector3(1.5, 1.2, 1.2), cos: Math.cos(st.yaw), sin: -Math.sin(st.yaw) };
        }
        st.rubble.visible = true;
        if (!this.colliders.includes(st.stumpCol)) this.colliders.push(st.stumpCol);
      },
      restore: () => {
        for (const st of stones) {
          st.hp = 2; st.broken = false; st.lean = 0; st.shown = -1; st.mesh.visible = true;
          if (st.rubble) st.rubble.visible = false;
          this.colliders = this.colliders.filter((k) => k !== st.stumpCol);
          if (!this.colliders.includes(st.col)) this.colliders.push(st.col);
        }
      },
    };
    this.arena2 = { center: new THREE.Vector3(c.x, this.heightAt(c.x, c.z), c.z), radius: c.radius, stones, pool, ...stoneApi };
    // a struck stone settles a little further over each time
    this.animated.push(() => {
      for (const s of stones) {
        if (s.shown === s.lean) continue;
        s.shown = s.lean; s.mesh.quaternion.copy(s.base).premultiply(new THREE.Quaternion().setFromAxisAngle(s.axis, Math.min(0.2, s.lean)));
      }
    });
  }

  /**
   * A tall, free-standing stretch of old wall at the back of the basin. When the Warden's back mark breaks
   * it backs into this wall to grind off whoever clings there, and brings it down.
   */
  buildBasinWall() {
    const W = BASIN_WALL, r = mulberry32(606);
    const y = this.heightAt(W.x, W.z) - 0.5;
    const toC = Math.atan2(0 - W.x, -110 - W.z);             // faces the basin centre
    const pivot = new THREE.Group(); pivot.position.set(W.x, y, W.z); pivot.rotation.y = toC; this.scene.add(pivot);
    const slab = new THREE.Group(); pivot.add(slab);           // hinged at the outer foot: it falls away from the basin
    slab.position.set(0, 0, -W.d / 2);
    const courses = 6, ch = W.h / courses;
    for (let i = 0; i < courses; i++) for (let j = 0; j < 4; j++) {
      const bw = W.w / 4, ragged = i === courses - 1 ? r() * 0.6 : 0;
      if (i === courses - 1 && r() < 0.3) continue;                                           // broken crest
      const m = new THREE.Mesh(chiseledBox(bw - 0.06, ch - 0.05 - ragged, W.d, { radius: 0.18, amp: 0.08, seed: 700 + i * 4 + j }), (i + j) % 3 ? this.mat.stone : this.mat.stoneDark);
      m.position.set(-W.w / 2 + bw * (j + 0.5) + (i % 2 ? bw * 0.15 : 0), ch * (i + 0.5), W.d / 2);
      m.castShadow = m.receiveShadow = true; slab.add(m);
    }
    this.addCollider(new THREE.Vector3(W.x, y + W.h / 2, W.z), new THREE.Vector3(W.w / 2, W.h / 2, W.d / 2), toC);
    const col = this.colliders[this.colliders.length - 1];
    const normal = new THREE.Vector3(Math.sin(toC), 0, Math.cos(toC));
    // lying flat it is a low causeway of rubble, outward from the old foot
    const flat = { c: new THREE.Vector3(W.x - normal.x * (W.h / 2 + W.d / 2), y + W.d / 2, W.z - normal.z * (W.h / 2 + W.d / 2)), h: new THREE.Vector3(W.w / 2, W.d / 2, W.h / 2), cos: Math.cos(toC), sin: -Math.sin(toC) };
    const lay = () => { this.colliders = this.colliders.filter((k) => k !== col); if (!this.colliders.includes(flat)) this.colliders.push(flat); };
    const wall = this.basinWall = {
      pos: new THREE.Vector3(W.x, y, W.z), normal, yaw: toC, fallen: false, falling: 0, slab,
      topple: () => { if (wall.fallen || wall.falling) return; wall.falling = 0.001; lay(); },
      restore: () => { wall.fallen = false; wall.falling = 0; slab.rotation.x = 0; this.colliders = this.colliders.filter((k) => k !== flat); if (!this.colliders.includes(col)) this.colliders.push(col); },
      setFallen: () => { wall.falling = 0; wall.fallen = true; slab.rotation.x = -(Math.PI / 2 - 0.08); lay(); },
    };
    this.animated.push((dt) => {
      if (!wall.falling) return;
      wall.falling += dt || 0.016;
      const k = Math.min(1, Math.pow(wall.falling / 2.2, 2));
      slab.rotation.x = -(Math.PI / 2 - 0.08) * k;
      if (k >= 1) { wall.falling = 0; wall.fallen = true; }
    });
  }

  // ---------------------------------------------------------------- Chapter III: basin
  buildBasin() {
    const D = this.mat.stoneDark, S = this.mat.stone;
    // the Monolith itself, far end of the basin
    const mz = -190, my = this.heightAt(0, mz) - 2;
    const mono = new THREE.Mesh(chiseledBox(9, 70, 6, { radius: 0.35, seg: 3, amp: 0.1, freq: 0.35, seed: 4 }), this.mat.obsidian);
    mono.position.set(0, my + 35, mz); mono.rotation.y = 0.12; mono.castShadow = true; this.scene.add(mono);
    this.addCollider(mono.position, new THREE.Vector3(4.5, 35, 3), 0.12);
    const veins = new THREE.Mesh(new THREE.BoxGeometry(9.1, 70, 6.1), new THREE.MeshBasicMaterial({ color: 0xe8d9b5, transparent: true, opacity: 0.05, wireframe: true }));
    veins.position.copy(mono.position); veins.rotation.copy(mono.rotation); this.scene.add(veins);
    this.monolith = mono;
    // broken ring of pillars around the basin
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + 0.2, r = 58 + this.rnd() * 6;
      const x = Math.sin(a) * r, z = -110 + Math.cos(a) * r;
      if (z > -60 && Math.abs(x) < 16) continue; // keep the entrance open
      const broken = this.rnd() < 0.6;
      this.pillar(x, this.heightAt(x, z) - 0.3, z, 1.1, broken ? 3 + this.rnd() * 5 : 12, { broken, mat: i % 2 ? S : D });
    }
    this.buildBasinWall();
    // scattered fallen blocks (cover)
    for (let i = 0; i < 18; i++) {
      const a = this.rnd() * Math.PI * 2, r = 15 + this.rnd() * 45;
      const x = Math.sin(a) * r, z = -110 + Math.cos(a) * r;
      const s = 1.5 + this.rnd() * 2.5;
      this.block(x, this.heightAt(x, z) - 0.4, z, s * 1.4, s, s, { mat: this.rnd() < 0.5 ? S : D, yaw: this.rnd() * 3 });
    }
  }

  // ---------------------------------------------------------------- vegetation
  /** Wind + base→tip shading shared by grass, ferns and flowers. Local y must run 0 (root) → 1 (tip). */
  swayMaterial(mat, { base = 0.55, tip = 1.15, warm = 0.0, stiff = 1 } = {}) {
    const uniforms = this.vegUniforms;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = uniforms.uTime; sh.uniforms.uPush = this.pushers;
      sh.vertexShader = 'uniform float uTime; uniform vec4 uPush[6];\nvarying float vH; varying float vGust;\n' + sh.vertexShader.replace('#include <begin_vertex>', `
        #include <begin_vertex>
        vH = clamp(position.y, 0.0, 1.0);
        vec3 wp = instanceMatrix[3].xyz;
        // gust fronts roll across the fields along the wind; blades lean with them, then flutter
        vec2 wd = vec2(0.8, 0.6);
        float along = dot(wp.xz, wd);
        float front = sin(along * 0.05 - uTime * 0.6 + sin(dot(wp.xz, vec2(-0.6, 0.8)) * 0.021) * 2.0);
        float gust = smoothstep(-0.2, 1.0, front) * (0.6 + 0.4 * sin(along * 0.013 - uTime * 0.17));
        float flutter = sin(uTime * 2.7 + wp.x * 0.9 + wp.z * 0.7) * 0.6 + sin(uTime * 4.9 + wp.x * 1.7 - wp.z * 1.3) * 0.4;
        float bend = (0.06 + gust * 0.34 + flutter * (0.03 + gust * 0.07)) * ${stiff.toFixed(2)};
        vec3 wl = normalize(vec3(wd.x, 0.0, wd.y) * mat3(instanceMatrix));
        float k = position.y * position.y;
        transformed += wl * bend * k;
        transformed.y -= bend * bend * k * 0.5;
        // pressed aside around anything heavy moving through
        for (int i = 0; i < 6; i++) {
          vec2 dd = wp.xz - uPush[i].xz; float dl = length(dd);
          float near = (1.0 - smoothstep(uPush[i].w * 0.35, uPush[i].w, dl)) * (1.0 - smoothstep(0.5, 3.0, abs(wp.y - uPush[i].y)));
          if (near > 0.001) { vec3 away = normalize(vec3(dd.x, 0.0, dd.y) + vec3(1e-4)) * mat3(instanceMatrix); transformed += away * near * 0.75 * k; transformed.y -= near * 0.45 * k; }
        }
        vGust = gust;`);
      sh.fragmentShader = 'varying float vH; varying float vGust;\n' + sh.fragmentShader
        .replace('#include <normal_fragment_begin>', 'float faceDirection = 1.0;\nvec3 normal = normalize( vNormal );\nvec3 nonPerturbedNormal = normal;')
        .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb *= mix(${base.toFixed(2)}, ${tip.toFixed(2)}, smoothstep(0.0, 1.0, vH)) * (1.0 + vGust * 0.14 * vH);
        diffuseColor.rgb += vec3(0.05, 0.042, 0.0) * ${warm.toFixed(2)} * vH;`);
    };
    mat.customProgramCacheKey = () => `envSway${base}_${tip}_${warm}_${stiff}`;
    return mat;
  }

  /** Kept for API compatibility: foliage lump material. */
  canopyMaterial() { return envCanopy(this.tex.leaf, this.vegUniforms.uTime); }

  vegetationSpot(x, z, { plazaClear = 0.85 } = {}, rnd = this.rnd) {
    const h = terrainHeight(x, z);
    if (Math.hypot(x, z - 30) > 205) return null;
    if (Math.abs(x) < 9 && z < 120 && z > -40) return null;            // causeway & path
    if (Math.abs(x) < 30 && z > 128 && z < 200 && rnd() < plazaClear) return null; // plaza mostly clear
    if (Math.hypot(x, (z + 110) * 0.9) < 70) return null;              // basin floor clear
    if (this.inMeadow(x, z)) return null;                              // the meadow arena & its track
    if (h < -14) return null;
    return h;
  }

  buildTrees() {
    const dr = this.drnd;
    // trunk: flared roots, a slow bend, never a clean cylinder
    const trunkGeo = new THREE.CylinderGeometry(0.15, 0.4, 1, 12, 10); trunkGeo.translate(0, 0.5, 0);
    { const p = trunkGeo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i), a = Math.atan2(p.getZ(i), p.getX(i));
        const flare = 1 + Math.pow(Math.max(0, 1 - y / 0.16), 2) * (0.9 + 0.5 * Math.cos(a * 5 + 1)) + Math.cos(a * 3 + y * 9) * 0.07;
        p.setX(i, p.getX(i) * flare + Math.sin(y * Math.PI) * 0.09 + Math.sin(y * 7) * 0.02);
        p.setZ(i, p.getZ(i) * flare + Math.sin(y * Math.PI * 2) * 0.05);
      }
      trunkGeo.computeVertexNormals(); }
    const branchGeo = new THREE.CylinderGeometry(0.03, 0.12, 1, 6, 4); branchGeo.translate(0, 0.5, 0);
    { const p = branchGeo.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setX(i, p.getX(i) + Math.sin(y * Math.PI) * 0.08); p.setZ(i, p.getZ(i) + Math.sin(y * 5) * 0.03); } branchGeo.computeVertexNormals(); }
    const leafGeo = blob(1, 2, 0.34, 7, 1.0);
    const spots = [];
    let guard = 0;
    while (spots.length < 85 && guard++ < 3000) {
      const x = (this.rnd() - 0.5) * 400, z = 200 - this.rnd() * 380;
      const h = this.vegetationSpot(x, z); if (h === null) continue;
      spots.push([x, h, z]);
    }
    const MAXB = 7, MAXL = 9;
    const trunks = new THREE.InstancedMesh(trunkGeo, this.mat.wood, spots.length);
    const branches = new THREE.InstancedMesh(branchGeo, this.mat.wood, spots.length * MAXB);
    const leaves = new THREE.InstancedMesh(leafGeo, envCanopy(this.tex.leaf, this.vegUniforms.uTime), spots.length * MAXL);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3(), base = new THREE.Vector3(), axis = new THREE.Vector3(), yawQ = new THREE.Quaternion();
    let nb = 0, nl = 0;
    this.treeSpots = [];
    spots.forEach(([x, y, z], i) => {
      // legacy layout draws (keep the gameplay random stream exactly as it was)
      let th = 5 + this.rnd() * 6;
      const lx = (this.rnd() - 0.5) * 0.15, ly = this.rnd() * 6.28, lz = (this.rnd() - 0.5) * 0.15;
      for (let k = 0; k < 46; k++) this.rnd();
      const t = dr(), kind = t < 0.56 ? 0 : t < 0.84 ? 1 : 2;        // broad · gnarled · dead
      const leanK = kind === 1 ? 3.2 : kind === 2 ? 2 : 1;
      if (kind === 1) th *= 0.68; if (kind === 2) th *= 0.8;
      q.setFromEuler(new THREE.Euler(lx * leanK, ly, lz * leanK));
      axis.copy(up).applyQuaternion(q);
      const girth = (1 + th * 0.06) * (kind === 2 ? 0.8 : 1);
      base.set(x, y - 0.3, z);
      m.compose(base, q, s.set(girth, th, girth)); trunks.setMatrixAt(i, m);
      this.treeSpots.push([x, y, z, kind]);
      const hue = kind === 1 ? 0.14 + dr() * 0.05 : 0.18 + dr() * 0.06, sat = 0.2 + dr() * 0.14, lum = 0.19 + dr() * 0.06;
      const leaf = (px, py, pz, r, flat = 0.8) => {
        if (kind === 2 || nl >= leaves.count) return;
        m.compose(p.set(px, py, pz), yawQ.setFromAxisAngle(up, dr() * 6.28), s.set(r * 1.25, r * flat, r * 1.25));
        leaves.setMatrixAt(nl, m);
        leaves.setColorAt(nl++, col.setHSL(hue + (dr() - 0.5) * 0.025, sat, lum + dr() * 0.07));
      };
      const count = kind === 0 ? 4 + Math.floor(dr() * 2) : kind === 1 ? 3 + Math.floor(dr() * 2) : 4 + Math.floor(dr() * 3);
      const spread = th / 8;
      for (let b = 0; b < count; b++) {
        const f = kind === 2 ? 0.45 + 0.55 * (b + dr()) / count : 0.55 + 0.42 * (b + dr()) / count;
        const az = b * 2.4 + dr() * 1.2, el = kind === 0 ? 0.3 + dr() * 0.45 : kind === 1 ? 0.05 + dr() * 0.45 : 0.3 + dr() * 0.7;
        const len = (kind === 0 ? 2.4 + dr() * 2.2 : kind === 1 ? 1.8 + dr() * 1.6 : 1.4 + dr() * 2.4) * (0.7 + spread * 0.4);
        dir.set(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
        p.copy(base).addScaledVector(axis, f * th);
        const thick = (1.5 - f * 0.8) * girth * 0.8;
        m.compose(p, yawQ.setFromUnitVectors(up, dir), s.set(thick, len, thick)); branches.setMatrixAt(nb++, m);
        const r = kind === 0 ? 1.5 + dr() * 1.0 : 1.0 + dr() * 0.7;
        leaf(p.x + dir.x * len, p.y + dir.y * len + r * 0.15, p.z + dir.z * len, r);
      }
      // crown
      p.copy(base).addScaledVector(axis, th);
      const cr = kind === 0 ? 2.2 + dr() * 1.0 : 1.2 + dr() * 0.6;
      const cx = p.x, cy = p.y, cz = p.z;
      leaf(cx, cy + 0.3, cz, cr, 0.85);
      if (kind === 0) for (let k = 0; k < 2; k++) { const a = dr() * 6.28, d = 1.4 + dr() * 1.4; leaf(cx + Math.cos(a) * d, cy - 0.5 + dr() * 1.1, cz + Math.sin(a) * d, 1.3 + dr() * 0.9); }
      this.addCollider(new THREE.Vector3(x, y + 3, z), new THREE.Vector3(0.45, 3, 0.45));
    });
    branches.count = nb; leaves.count = nl;
    for (const im of [trunks, branches, leaves]) { im.castShadow = true; im.receiveShadow = true; this.scene.add(im); }
    this.buildBushesAndRocks();
  }

  buildBushesAndRocks() {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
    // bushes: low lumpy shrubs, clustered in twos and threes
    const bushGeo = blob(1, 2, 0.3, 21, 0.72);
    const bushes = new THREE.InstancedMesh(bushGeo, envCanopy(this.tex.leaf, this.vegUniforms.uTime, { cut: 0.46 }), 420);
    let n = 0, guard = 0;
    while (n < 420 && guard++ < 6000) {
      const x = (this.rnd() - 0.5) * 380, z = 200 - this.rnd() * 370;
      const h = this.vegetationSpot(x, z, { plazaClear: 0.6 }); if (h === null) continue;
      const cluster = 1 + Math.floor(this.rnd() * 3);
      for (let c = 0; c < cluster && n < 420; c++) {
        const bx = x + (this.rnd() - 0.5) * 2.6, bz = z + (this.rnd() - 0.5) * 2.6, r = 0.6 + this.rnd() * 1.1;
        m.compose(p.set(bx, terrainHeight(bx, bz) + r * 0.22, bz), q.setFromEuler(new THREE.Euler(0, this.rnd() * 6.28, 0)), s.set(r * 1.2, r * 0.9, r * 1.2));
        bushes.setMatrixAt(n, m);
        bushes.setColorAt(n, col.setHSL(0.16 + this.rnd() * 0.08, 0.2 + this.rnd() * 0.14, 0.18 + this.rnd() * 0.08));
        n++;
      }
    }
    bushes.count = n; bushes.castShadow = true; bushes.receiveShadow = true; this.scene.add(bushes);

    // rocks: half-buried weathered boulders
    const rockGeo = blob(1, 2, 0.34, 5, 0.66);
    const rocks = new THREE.InstancedMesh(rockGeo, this.mat.rock, 220);
    n = 0; guard = 0;
    while (n < 220 && guard++ < 4000) {
      const x = (this.rnd() - 0.5) * 380, z = 200 - this.rnd() * 370;
      const h = terrainHeight(x, z);
      if (Math.hypot(x, z - 30) > 205 || h < -14) continue;
      if (Math.abs(x) < 4 && z < 120 && z > 15) continue;
      if (this.inMeadow(x, z)) continue;
      const r = 0.25 + Math.pow(this.rnd(), 2.5) * 2.2;
      m.compose(p.set(x, h - r * 0.25, z), q.setFromEuler(new THREE.Euler(this.rnd() * 0.4, this.rnd() * 6.28, this.rnd() * 0.4)), s.set(r * (1 + this.rnd() * 0.5), r, r));
      rocks.setMatrixAt(n, m);
      const l = (0.5 + this.rnd() * 0.15) * 1.6; rocks.setColorAt(n, col.setRGB(l * 1.02, l, l * 0.95));
      if (r > 1.2) this.addCollider(new THREE.Vector3(x, h + r * 0.3, z), new THREE.Vector3(r * 0.9, r * 0.5, r * 0.9));
      n++;
    }
    rocks.count = n; rocks.castShadow = true; rocks.receiveShadow = true; this.scene.add(rocks);
  }

  /** One tuft: several soft, curved, tapering blades fanning out from a single root. */
  grassClumpGeometry({ blades = 7, seed = 99, hMin = 0.5, hVar = 0.5, w0 = 0.014, wVar = 0.012, bend0 = 0.08, bendVar = 0.22, spread = 0.16 } = {}) {
    const parts = [];
    const rnd = mulberry32(seed);
    for (let b = 0; b < blades; b++) {
      const g = new THREE.PlaneGeometry(1, 1, 1, 2); g.translate(0, 0.5, 0);
      const ang = (b / blades) * Math.PI * 2 + rnd() * 0.6;
      const h = hMin + rnd() * hVar, w = w0 + rnd() * wVar, bend = bend0 + rnd() * bendVar, root = rnd() * spread;
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const t = p.getY(i);
        const x = p.getX(i) * w * (1 - Math.pow(t, 1.6) * 0.85) * 2;
        // arc outward and droop: blades curve away from the tuft centre
        const out = root + bend * t * t, y = h * t - bend * 0.25 * t * t * t;
        p.setXYZ(i, x, y, out);
      }
      g.rotateY(ang);
      parts.push(g);
    }
    const g = mergeGeometries(parts);
    // soft, mostly-up normals: tufts light like a mass instead of flickering dark spikes
    const nrm = g.attributes.normal;
    for (let i = 0; i < nrm.count; i++) { nrm.setXYZ(i, nrm.getX(i) * 0.25, 1, nrm.getZ(i) * 0.25); }
    g.normalizeNormals();
    return g;
  }

  /** Low arching fronds for damp, shaded ground at the foot of walls and trees. */
  fernGeometry() {
    const parts = [], rnd = mulberry32(31), N = 8;
    for (let b = 0; b < N; b++) {
      const g = new THREE.PlaneGeometry(1, 1, 2, 5); g.translate(0, 0.5, 0);
      const len = 0.75 + rnd() * 0.4, lift = 0.5 + rnd() * 0.35, wid = 0.1 + rnd() * 0.05;
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const t = p.getY(i), side = p.getX(i) * 2;
        const w = Math.pow(Math.sin(Math.min(1, t * 0.92 + 0.08) * Math.PI), 0.7) * wid * (1 + 0.25 * Math.cos(t * 28));   // scalloped leaflets
        const y = Math.sin(t * 2.1) * lift * 0.55 - Math.abs(side) * 0.03, out = 0.05 + t * len;
        p.setXYZ(i, side * w, Math.max(0.005, y), out);
      }
      g.rotateY((b / N) * Math.PI * 2 + rnd() * 0.5);
      parts.push(g);
    }
    const g = mergeGeometries(parts);
    const nrm = g.attributes.normal;
    for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, nrm.getX(i) * 0.3, 1, nrm.getZ(i) * 0.3);
    g.normalizeNormals();
    return g;
  }

  buildGrass() {
    const dr = this.drnd;
    const max = 80000;
    const grassMat = () => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, side: THREE.DoubleSide });
    const im = this.grass = new THREE.InstancedMesh(this.grassClumpGeometry(), this.swayMaterial(grassMat(), { base: 0.78, tip: 1.1, warm: 1 }), max);
    const tallMax = 5200;
    const tall = this.tallGrass = new THREE.InstancedMesh(this.grassClumpGeometry({ blades: 6, seed: 7, hMin: 0.75, hVar: 0.25, w0: 0.008, wVar: 0.007, bend0: 0.03, bendVar: 0.14, spread: 0.1 }),
      this.swayMaterial(grassMat(), { base: 0.6, tip: 1.2, warm: 1.4, stiff: 1.5 }), tallMax);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
    const col = new THREE.Color(), cLush = new THREE.Color(0x64703e), cMid = new THREE.Color(0x83884e), cDry = new THREE.Color(0x9a935e), cStraw = new THREE.Color(0xb0a678);
    const flowerSpots = [];
    let n = 0, nt = 0, guard = 0;
    while (n < max && guard++ < max * 6) {
      // cluster grass near the play paths so density reads well
      const zone = dr();
      let x, z;
      if (zone < 0.2) { x = (dr() - 0.5) * 64; z = 128 + dr() * 72; }
      else if (zone < 0.38) { x = (dr() - 0.5) * 110; z = 100 + dr() * 30; }
      else if (zone < 0.66) { const a = dr() * 6.283, r = Math.sqrt(dr()) * 95; x = Math.sin(a) * r; z = -110 + Math.cos(a) * r; }
      else { x = (dr() - 0.5) * 300; z = 200 - dr() * 380; }
      const y = terrainHeight(x, z);
      if (Math.abs(x) < 3.2 && z > 21 && z < 111) continue;
      if (y > 14 || Math.hypot(x, z - 30) > 210) continue;
      // meadows thin out into bare patches and thicken into drifts; the old road stays worn
      const dens = fbm(noiseB, x * 0.045 + 9, z * 0.045, 3) * 0.5 + 0.5 + fbm(noiseA, x * 0.25, z * 0.25, 2) * 0.25;
      if (dr() > smoothstep(0.3, 0.6, dens) * 0.72 + 0.28) continue;
      const road = (1 - smoothstep(2.0, 6.5, Math.abs(x + Math.sin(z * 0.05) * 2))) * smoothstep(-70, -30, z) * (1 - smoothstep(124, 131, z));
      if (dr() < road * 0.85) continue;
      const dry = clamp(0.4 + fbm(noiseC, x * 0.022, z * 0.022, 3) * 1.3 + (dr() - 0.5) * 0.3, 0, 1);
      const lush = 1 - dry;
      const h = (0.2 + dr() * 0.3) * (0.8 + lush * 0.75) * (0.75 + smoothstep(0.4, 0.8, dens) * 0.5), wdt = 0.8 + dr() * 0.5;
      q.setFromEuler(e.set((dr() - 0.5) * 0.2, dr() * Math.PI * 2, (dr() - 0.5) * 0.2));
      m.compose(p.set(x, y - 0.04, z), q, s.set(wdt, h, wdt));
      im.setMatrixAt(n, m);
      if (dry < 0.5) col.copy(cLush).lerp(cMid, dry * 2); else col.copy(cMid).lerp(cDry, dry * 2 - 1);
      if (dr() < 0.07) col.lerp(cStraw, 0.7);
      col.multiplyScalar(0.86 + dr() * 0.3);
      im.setColorAt(n, col);
      if (dr() < 0.035 && lush > 0.35) flowerSpots.push([x, y, z, h]);
      // tall seeding grass stands in the dry drifts
      if (nt < tallMax && dry > 0.52 && dr() < 0.2 + (dry - 0.52) * 0.5 && road < 0.2) {
        const th = 0.75 + dr() * 0.7;
        m.compose(p.set(x + (dr() - 0.5) * 0.5, y - 0.04, z + (dr() - 0.5) * 0.5), q, s.set(1, th, 1));
        tall.setMatrixAt(nt, m);
        tall.setColorAt(nt++, col.copy(cDry).lerp(cStraw, dr()).multiplyScalar(0.85 + dr() * 0.25));
      }
      n++;
    }
    this.grassTotal = n; this.tallTotal = nt;
    for (const g of [im, tall]) { g.receiveShadow = true; g.frustumCulled = false; this.scene.add(g); }
    this.grassUniforms = this.vegUniforms;

    // ferns: at the foot of trees and walls, where it stays damp
    const fernMax = 2600;
    const ferns = this.ferns = new THREE.InstancedMesh(this.fernGeometry(), this.swayMaterial(grassMat(), { base: 0.5, tip: 1.05, stiff: 0.45 }), fernMax);
    let nf = 0;
    const fern = (x, z) => {
      if (nf >= fernMax) return;
      const y = terrainHeight(x, z); if (y < -14 || y > 14) return;
      if (this.groundAt(x, z, y + 0.3) > y + 0.05) return;             // not on paving or blocks
      if (Math.abs(x) < 3.4 && z > 19 && z < 113) return;
      const sc = 0.55 + dr() * 0.8;
      m.compose(p.set(x, y - 0.02, z), q.setFromEuler(e.set(0, dr() * 6.28, 0)), s.set(sc, sc * (0.8 + dr() * 0.5), sc));
      ferns.setMatrixAt(nf, m);
      ferns.setColorAt(nf++, col.setHSL(0.2 + dr() * 0.06, 0.22 + dr() * 0.12, 0.15 + dr() * 0.07));
    };
    for (const [tx, , tz, kind] of this.treeSpots) {
      const k = kind === 2 ? 3 : 9 + Math.floor(dr() * 8);
      for (let i = 0; i < k; i++) { const a = dr() * 6.28, r = 0.7 + dr() * 3.2; fern(tx + Math.cos(a) * r, tz + Math.sin(a) * r); }
    }
    for (const c of this.colliders) {
      if (c.h.x * c.h.z < 0.5 || c.c.y - c.h.y > terrainHeight(c.c.x, c.c.z) + 1) continue;
      const per = (c.h.x + c.h.z) * 2, k = Math.min(26, Math.floor(per * 0.55));
      for (let i = 0; i < k; i++) {
        if (dr() < 0.45) continue;
        const side = Math.floor(dr() * 4), t = dr() * 2 - 1, off = 0.25 + dr() * dr() * 1.3;
        const lx = side < 2 ? t * c.h.x : (side === 2 ? -1 : 1) * (c.h.x + off), lz = side < 2 ? (side === 0 ? -1 : 1) * (c.h.z + off) : t * c.h.z;
        fern(c.c.x + lx * c.cos - lz * c.sin, c.c.z + lx * c.sin + lz * c.cos);
      }
    }
    this.fernTotal = nf;
    ferns.receiveShadow = true; ferns.frustumCulled = false; this.scene.add(ferns);

    // wildflowers: small pale heads on thin stems, tucked into tufts
    const head = new THREE.IcosahedronGeometry(0.04, 1); head.scale(1, 0.55, 1); head.translate(0, 0.85, 0);
    const paint = (g, r, gg, b) => { g = g.toNonIndexed(); const c = new Float32Array(g.attributes.position.count * 3); for (let i = 0; i < c.length; i += 3) { c[i] = r; c[i + 1] = gg; c[i + 2] = b; } g.setAttribute('color', new THREE.BufferAttribute(c, 3)); return g; };
    const fl = this.flowers = new THREE.InstancedMesh(mergeGeometries([paint(head, 1, 1, 1)]), this.swayMaterial(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, vertexColors: true }), { base: 0.85, tip: 1.05 }), flowerSpots.length);
    const palette = [0xe6dfcb, 0xd9cc8e, 0xbfb0c4, 0xe3d9bb, 0xc9a089];
    flowerSpots.forEach(([x, y, z, h], i) => {
      m.compose(p.set(x + (dr() - 0.5) * 0.3, y - 0.02, z + (dr() - 0.5) * 0.3), q.identity(), s.set(1, h * 1.05 + 0.06, 1));
      fl.setMatrixAt(i, m); fl.setColorAt(i, col.set(palette[Math.floor(dr() * palette.length)]));
    });
    this.flowerTotal = flowerSpots.length;
    fl.frustumCulled = false; this.scene.add(fl);
    this.applyVegetation();
  }
  applyVegetation() {
    const v = this.settings.get('vegetation');
    this.grass.count = Math.floor(this.grassTotal * v);
    this.tallGrass.count = Math.floor(this.tallTotal * v);
    this.ferns.count = Math.floor(this.fernTotal * (0.4 + v * 0.6));
    this.flowers.count = Math.floor(this.flowerTotal * v);
  }

  buildAtmosphere() {
    // low drifting fog banks
    const fogMat = new THREE.SpriteMaterial({ map: this.tex.fog, color: 0xe2dccb, transparent: true, opacity: 0.22, depthWrite: false, fog: true });
    this.fogSprites = [];
    for (let i = 0; i < 70; i++) {
      const sp = new THREE.Sprite(fogMat);
      const x = (this.rnd() - 0.5) * 360, z = 200 - this.rnd() * 380;
      const s = 30 + this.rnd() * 40;
      sp.scale.set(s, s * 0.35, 1);
      sp.position.set(x, terrainHeight(x, z) + 3 + this.rnd() * 6, z);
      sp.userData.base = sp.position.clone(); sp.userData.speed = 0.2 + this.rnd() * 0.5; sp.userData.phase = this.rnd() * 10;
      this.scene.add(sp); this.fogSprites.push(sp);
    }
    // pollen catching the light, and the odd leaf carried on the wind — anchored in the world, wrapped around the camera
    const time = this.vegUniforms.uTime;
    this.drift = [
      buildDrift(this.scene, this.tex.dot, time, { count: 800, box: new THREE.Vector3(56, 16, 56), size: 0.05, color: 0xfff0d2, opacity: 0.5, wind: new THREE.Vector3(0.5, 0.03, 0.38), additive: true, seed: 5 }),
      buildDrift(this.scene, this.tex.dot, time, { count: 110, box: new THREE.Vector3(70, 22, 70), size: 0.11, color: 0x6f6a3e, opacity: 0.85, wind: new THREE.Vector3(1.5, 0, 1.1), fall: 0.5, seed: 6 }),
    ];
    // light shafts in the plaza
    const shaftMat = new THREE.MeshBasicMaterial({ map: this.tex.shaft, transparent: true, opacity: 0.13, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
    for (let i = 0; i < 5; i++) {
      const sh = new THREE.Mesh(new THREE.PlaneGeometry(4 + this.rnd() * 3, 34), shaftMat);
      sh.position.set(-20 + i * 10 + this.rnd() * 4, 12, 150 + this.rnd() * 30);
      sh.lookAt(sh.position.clone().add(new THREE.Vector3(0, 0, 1)));
      sh.rotation.z = 0.55; sh.rotation.y = 0.6;
      this.scene.add(sh);
    }
  }

  // ---------------------------------------------------------------- ruin detail (decoration: own random stream)
  buildRuinDetail() {
    const dr = this.drnd, S = this.mat.stone, D = this.mat.stoneDark;
    const pick = () => (dr() < 0.5 ? S : D);
    // --- plaza side walls: buttresses, a footing course, broken stones along the top
    for (const sx of [-1, 1]) for (let z = 132; z < 200; z += 8.4) {
      const zc = z + 4, top = this.groundAt(sx * 32, zc, 200, 0);
      if (sx < 0 && Math.abs(zc - MEADOW.breachZ) < 1) continue;   // the breach stays open
      this.block(sx * 30.25, -0.4, zc, 0.5, 0.8, 8.3, { mat: D, collide: false });
      if (dr() < 0.7) {
        const bh = (top + 0.5) * (0.55 + dr() * 0.3);
        this.block(sx * 30.0, -0.5, zc + (dr() - 0.5) * 2, 1.1, bh, 1.9, { mat: pick() });
        this.block(sx * 30.2, -0.5 + bh, zc, 0.7, 0.7, 1.7, { mat: pick(), collide: false, roll: -sx * 0.5 });
      }
      for (let k = 0; k < 2; k++) if (dr() < 0.6) { const w = 0.9 + dr() * 1.4; this.block(sx * 32 + (dr() - 0.5), top - 0.1, zc + (dr() - 0.5) * 6, 2.2, 0.5 + dr() * 0.9, w, { mat: pick(), collide: false, yaw: (dr() - 0.5) * 0.3 }); }
    }
    // --- north wall: a cornice that survives in stretches, footing, pediment over the dead gate, vines from the lintel
    for (let x = -30; x <= 30; x += 4) {
      if (Math.abs(x) < 7 || (x > 5 && x < 15) || dr() < 0.3) continue;
      this.block(x, 7.0, 130, 3.9, 0.42, 3.6, { mat: pick() });
    }
    this.block(-18.8, -0.4, 131.75, 26.4, 0.7, 0.5, { mat: D, collide: false });
    this.block(22.8, -0.4, 131.75, 18.4, 0.7, 0.5, { mat: D, collide: false });
    this.block(0, 11, 130, 8, 0.9, 3.4, { mat: S, collide: false });
    this.block(-0.4, 11.9, 130, 4.2, 0.8, 3.0, { mat: D, collide: false, yaw: 0.04 });
    this.mossDrape(-1.2, 9.25, 131.95, 0, 4.2, 3.4); this.mossDrape(2.6, 9.25, 131.95, 0, 2.6, 2.2);
    this.mossDrape(0.5, 9.25, 128.05, Math.PI, 5, 3.0);
    // --- colonnade: architraves still bridge neighbours that both stand; vines hang from them
    const col = this.pillars.filter((c) => c.z > 130 && !c.broken);
    for (const a of col) for (const b of col) {
      if (a.x !== b.x || Math.abs(b.z - a.z - 8.5) > 0.1) continue;
      this.block(a.x, a.h + 1.3, (a.z + b.z) / 2, 1.5, 0.9, 10.2, { mat: D, collide: false });
      this.block(a.x, a.h + 2.2, (a.z + b.z) / 2 + (dr() - 0.5) * 2, 1.9, 0.4, 5 + dr() * 4, { mat: S, collide: false });
      this.mossDrape(a.x + 0.05, a.h + 1.35, (a.z + b.z) / 2 + (dr() - 0.5) * 2, Math.PI / 2, 4 + dr() * 2, 2 + dr() * 1.6);
    }
    // a lone standing capital keeps a stub of beam
    for (const c of col) if (dr() < 0.5) this.block(c.x, c.h + 1.3, c.z + 1.2, 1.4, 0.85, 3.2, { mat: pick(), collide: false, yaw: (dr() - 0.5) * 0.1 });
    // --- dais under the altar
    this.block(0, 0, 160, 6.6, 0.2, 5, { mat: S });
    // --- fallen fragments: toppled drums and chipped stones around every broken pillar
    const drumGeo = (r, len) => { const g = new THREE.CylinderGeometry(r * 0.9, r * 0.94, len, 18, 2); const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const k = 1 + noise3(p.getX(i) * 3, p.getY(i) * 2, p.getZ(i) * 3, r * 7) * 0.05; p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); } g.computeVertexNormals(); return g; };
    for (const c of this.pillars) {
      if (!c.broken) continue;
      const onDeck = Math.abs(c.x) < 6 && c.z < 112 && c.z > 18;
      if (!onDeck && dr() < 0.75) {
        const a = dr() * 6.28, d = c.r * 2 + 1.6 + dr() * 2.5, len = 1.6 + dr() * 2.4;
        const x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d, y = terrainHeight(x, z), yaw = dr() * 3.14;
        if (Math.abs(x) > 9 || z > 122 || z < -42) {
          this.addStatic(drumGeo(c.r, len), c.mat, _m4.compose(_v.set(x, y + c.r * 0.72, z), _q.setFromEuler(_e.set(0, yaw, Math.PI / 2 + (dr() - 0.5) * 0.12, 'YXZ')), _one));
          this.addCollider(new THREE.Vector3(x, y + c.r * 0.72, z), new THREE.Vector3(len / 2, c.r * 0.8, c.r * 0.85), yaw);
        }
      }
      const k = onDeck ? 2 : 3 + Math.floor(dr() * 4);
      for (let i = 0; i < k; i++) {
        const a = dr() * 6.28, d = c.r + 0.6 + dr() * (onDeck ? 0.9 : 3), sz = 0.25 + dr() * 0.55;
        const x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d;
        if (onDeck && Math.abs(x) < 2.3) continue;
        this.block(x, this.groundAt(x, z, c.y + 2, 3) - sz * 0.3, z, sz * (1 + dr()), sz, sz * (1 + dr() * 0.6), { mat: pick(), collide: false, yaw: dr() * 3, roll: (dr() - 0.5) * 0.7, pitch: (dr() - 0.5) * 0.5 });
      }
    }
    // loose stones at the foot of the plaza walls
    for (let i = 0; i < 46; i++) {
      const side = dr() < 0.7, sx = dr() < 0.5 ? -1 : 1, sz = 0.3 + dr() * 0.7;
      const x = side ? sx * (29.6 - dr() * 2.4) : (dr() - 0.5) * 56, z = side ? 133 + dr() * 64 : 132.4 + dr() * 2.2;
      if (!side && x > 6.5 && x < 13.5) continue;       // keep the moss wall's foot clear
      this.block(x, -sz * 0.3, z, sz * (1 + dr()), sz, sz * (1 + dr() * 0.5), { mat: pick(), collide: false, yaw: dr() * 3, roll: (dr() - 0.5) * 0.6, pitch: (dr() - 0.5) * 0.4 });
    }
    // --- causeway: vines trailing off the deck edge, slabs of the fallen span below, tower string courses
    const cw = this.causeway;
    for (const sx of [-1, 1]) for (let z = 24; z < 108; z += 5.5) {
      if (Math.abs(z - 79) < 4 || dr() < 0.45) continue;
      this.mossDrape(sx * 3.03, cw.deckTop - 0.25, z + dr() * 2, sx * Math.PI / 2, 2.6 + dr() * 2.4, 1.6 + dr() * 2.2);
    }
    for (let i = 0; i < 6; i++) {
      const x = (dr() - 0.5) * 9, z = 79 + (dr() - 0.5) * 9, w = 1.4 + dr() * 1.8;
      this.block(x, terrainHeight(x, z) - 0.3, z, w, 0.9 + dr() * 0.5, w * (0.7 + dr() * 0.6), { mat: pick(), collide: false, yaw: dr() * 3, roll: (dr() - 0.5) * 0.8, pitch: (dr() - 0.5) * 0.6 });
    }
    const tx = 15, tz = 50, tb = this.heightAt(tx, tz) - 1;
    for (const [h, w] of [[13, 7.7], [24, 7.6], [35, 7.5]]) this.block(tx, tb + h, tz, w, 0.55, w, { mat: S, collide: false });
    for (const [ox, oz] of [[-3.3, -3.3], [3.3, -3.3], [-3.3, 3.3], [3.3, 3.3]]) this.block(tx + ox, tb, tz + oz, 1.5, 15 + dr() * 6, 1.5, { mat: D, collide: false });
    this.mossDrape(tx - 3.53, tb + 35.2, tz + 0.5, -Math.PI / 2, 4.5, 4.5); this.mossDrape(tx - 3.53, tb + 24.2, tz - 1, -Math.PI / 2, 3.5, 3.2);
    // --- the Monolith stands on a stepped base
    const mz = -190, my = this.heightAt(0, mz);
    this.block(0, my - 1.2, mz, 17, 1.6, 13, { mat: D, yaw: 0.12 });
    this.block(0, my + 0.4, mz, 13, 0.9, 9.6, { mat: S, yaw: 0.12 });

    // merge the vine curtains into one mesh
    if (this.drapes?.length) {
      const mat = new THREE.MeshStandardMaterial({ map: this.tex.vine, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 1, color: 0xb9c092 });
      const mesh = new THREE.Mesh(mergeGeometries(this.drapes), mat);
      mesh.receiveShadow = true; mesh.matrixAutoUpdate = false;
      this.scene.add(mesh);
      this.drapes = null;
    }
  }

  // ---------------------------------------------------------------- far scenery
  buildDistance() {
    buildMountains(this.scene, PLAY_CENTER);
    buildFarRuins(this.scene, this.mat.farStone, terrainHeight);
    this.updateBirds = buildBirds(this.scene, this.vegUniforms.uTime);
  }

  /** list of {x, y, z, r}: up to six bodies that press the grass aside this frame. */
  setPushers(list) {
    const v = this.pushers.value;
    for (let i = 0; i < 6; i++) { const p = list[i]; if (p) v[i].set(p.x, p.y, p.z, p.r); else v[i].set(0, -9999, 0, 0.001); }
  }
  update(dt, t, focus) {
    this.vegUniforms.uTime.value = t;
    for (const sp of this.fogSprites) {
      const b = sp.userData.base;
      sp.position.x = b.x + Math.sin(t * 0.02 * sp.userData.speed + sp.userData.phase) * 18;
      sp.position.z = b.z + Math.cos(t * 0.015 * sp.userData.speed + sp.userData.phase) * 10;
    }
    if (focus) {
      const px = innerHeight * 0.5 * Math.min(devicePixelRatio || 1, 2) * this.settings.get('renderScale');
      for (const u of this.drift) { u.uFocus.value.set(focus.x, focus.y + 4, focus.z); u.uPx.value = px; }
    }
    this.updateBirds(t);
    for (const a of this.animated) a(dt, t);
  }
}

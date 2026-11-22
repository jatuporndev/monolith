import * as THREE from 'three';

const _v = new THREE.Vector3();

/**
 * Small Verlet cloth pinned along its top row. Simulated in world space so the body's
 * motion drags it naturally; written back in the owner's local space every frame.
 */
export class Cloth {
  constructor({ cols, rows, width, flare = 1, length, material, colorFn }) {
    this.cols = cols; this.rows = rows; this.n = cols * rows;
    this.pos = new Float32Array(this.n * 3); this.prev = new Float32Array(this.n * 3);
    this.rest = { h: new Float32Array(rows), v: length / (rows - 1) };
    for (let r = 0; r < rows; r++) this.rest.h[r] = (width * (1 + (flare - 1) * (r / (rows - 1)))) / (cols - 1);
    const g = this.geometry = new THREE.BufferGeometry();
    const uv = new Float32Array(this.n * 2), col = new Float32Array(this.n * 3), idx = [];
    const c = new THREE.Color();
    for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
      const i = r * cols + k; uv[i * 2] = (k / (cols - 1)) * (width / 0.16); uv[i * 2 + 1] = (r / (rows - 1)) * (length / 0.16);
      colorFn(k / (cols - 1), r / (rows - 1), c); col.set([c.r, c.g, c.b], i * 3);
      if (r < rows - 1 && k < cols - 1) idx.push(i, i + cols, i + 1, i + 1, i + cols, i + cols + 1);
    }
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.n * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.n * 3), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.castShadow = true; this.mesh.receiveShadow = true; this.mesh.frustumCulled = false;
    this.acc = 0; this.fresh = true;
  }

  /** Drop the cloth straight down from its pins (after a spawn or teleport). */
  reset(pins) {
    const { cols, rows, pos, prev } = this;
    for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
      const i = (r * cols + k) * 3, p = pins[k];
      pos[i] = p.x; pos[i + 1] = p.y - r * this.rest.v; pos[i + 2] = p.z;
    }
    prev.set(pos); this.fresh = false;
  }

  /**
   * pins: world Vector3 per column. spheres: flat [x,y,z,r, …] world colliders. wind: world acceleration.
   * plane: optional {n, d} half-space the cloth must stay in front of (the wall being climbed).
   */
  step(dt, pins, spheres, wind, groundY, plane) {
    if (this.fresh) this.reset(pins);
    const { cols, rows, pos, prev, n } = this;
    // a teleport would whip the cloth across the world: just re-hang it
    if (Math.abs(pos[0] - pins[0].x) + Math.abs(pos[1] - pins[0].y) + Math.abs(pos[2] - pins[0].z) > 2.5) this.reset(pins);
    this.acc = Math.min(this.acc + dt, 0.05);
    const h = 1 / 90;
    while (this.acc >= h) {
      this.acc -= h;
      for (let i = cols; i < n; i++) {
        const j = i * 3, row = Math.floor(i / cols) / (rows - 1);
        for (let a = 0; a < 3; a++) {
          const cur = pos[j + a], vel = (cur - prev[j + a]) * 0.975;
          prev[j + a] = cur;
          pos[j + a] = cur + vel + (a === 1 ? -9.8 : 0) * h * h + (a === 0 ? wind.x : a === 1 ? wind.y : wind.z) * row * h * h;
        }
      }
      for (let it = 0; it < 4; it++) {
        for (let k = 0; k < cols; k++) { const p = pins[k]; pos[k * 3] = p.x; pos[k * 3 + 1] = p.y; pos[k * 3 + 2] = p.z; }
        for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
          const i = r * cols + k;
          if (k < cols - 1) this.link(i, i + 1, this.rest.h[r], r === 0);
          if (r < rows - 1) this.link(i, i + cols, this.rest.v, r === 0);
          if (r < rows - 1 && k < cols - 1 && it < 2) { const d = Math.hypot((this.rest.h[r] + this.rest.h[r + 1]) / 2, this.rest.v); this.link(i, i + cols + 1, d, r === 0); this.link(i + 1, i + cols, d, r === 0); }
        }
        for (let i = cols; i < n; i++) {
          const j = i * 3;
          for (let s = 0; s < spheres.length; s += 4) {
            const dx = pos[j] - spheres[s], dy = pos[j + 1] - spheres[s + 1], dz = pos[j + 2] - spheres[s + 2], rr = spheres[s + 3];
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 < rr * rr && d2 > 1e-8) { const d = Math.sqrt(d2), f = (rr - d) / d; pos[j] += dx * f; pos[j + 1] += dy * f; pos[j + 2] += dz * f; }
          }
          if (plane) { const d = pos[j] * plane.n.x + pos[j + 1] * plane.n.y + pos[j + 2] * plane.n.z - plane.d; if (d < 0) { pos[j] -= plane.n.x * d; pos[j + 1] -= plane.n.y * d; pos[j + 2] -= plane.n.z * d; } }
          if (pos[j + 1] < groundY) { pos[j + 1] = groundY; prev[j] += (pos[j] - prev[j]) * 0.5; prev[j + 2] += (pos[j + 2] - prev[j + 2]) * 0.5; }
        }
      }
    }
  }
  link(a, b, rest, aFixed, bFixed) {
    const p = this.pos, i = a * 3, j = b * 3;
    const dx = p[j] - p[i], dy = p[j + 1] - p[i + 1], dz = p[j + 2] - p[i + 2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
    const f = (d - rest) / d, wa = aFixed ? 0 : bFixed ? 1 : 0.5, wb = bFixed ? 0 : aFixed ? 1 : 0.5;
    p[i] += dx * f * wa; p[i + 1] += dy * f * wa; p[i + 2] += dz * f * wa;
    p[j] -= dx * f * wb; p[j + 1] -= dy * f * wb; p[j + 2] -= dz * f * wb;
  }

  /** Copy the simulated points into the mesh, expressed in `inv` (world → owner local). */
  write(inv) {
    const a = this.geometry.attributes.position;
    for (let i = 0; i < this.n; i++) { _v.set(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]).applyMatrix4(inv); a.setXYZ(i, _v.x, _v.y, _v.z); }
    a.needsUpdate = true;
    this.geometry.computeVertexNormals();
  }
}

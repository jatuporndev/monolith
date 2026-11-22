import * as THREE from 'three';
import { makeNoise2D, fbm, mulberry32 } from '../core/util.js';

/** Procedural canvas textures — the game ships with no image assets. */
function canvasTex(size, draw, { repeat = 1, srgb = true } = {}) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d');
  draw(ctx, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function stoneTexture(seed = 3) {
  const n = makeNoise2D(seed);
  return canvasTex(256, (ctx, s) => {
    const img = ctx.createImageData(s, s);
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const u = x / s, v = y / s;
      // tileable-ish by sampling on a torus
      const a = u * Math.PI * 2, b = v * Math.PI * 2;
      const f = fbm(n, Math.cos(a) * 2 + 10, Math.sin(a) * 2 + Math.cos(b) * 2, 5) * 0.5 + fbm(n, Math.sin(b) * 6, Math.cos(a) * 6, 3) * 0.25;
      const crack = Math.abs(n(Math.cos(a) * 4 + Math.sin(b) * 3, Math.sin(a) * 4)) < 0.03 ? -40 : 0;
      const g = 200 + f * 90 + crack;
      const i = (y * s + x) * 4;
      img.data[i] = g; img.data[i + 1] = g * 0.98; img.data[i + 2] = g * 0.93; img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  });
}

export function mossTexture(seed = 7) {
  const rnd = mulberry32(seed);
  return canvasTex(256, (ctx, s) => {
    ctx.fillStyle = '#6f7d48'; ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 5000; i++) {
      const x = rnd() * s, y = rnd() * s, r = 0.5 + rnd() * 2.2;
      const l = 30 + rnd() * 40;
      ctx.fillStyle = `hsl(${70 + rnd() * 25}, ${25 + rnd() * 20}%, ${l}%)`;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
  });
}

export function furTexture(seed = 11) {
  const rnd = mulberry32(seed);
  return canvasTex(256, (ctx, s) => {
    ctx.fillStyle = '#3a3527'; ctx.fillRect(0, 0, s, s);
    ctx.lineCap = 'round';
    for (let i = 0; i < 2600; i++) {
      const x = rnd() * s, y = rnd() * s, len = 6 + rnd() * 16;
      const l = 14 + rnd() * 26;
      ctx.strokeStyle = `hsla(${40 + rnd() * 30}, ${15 + rnd() * 20}%, ${l}%, 0.9)`;
      ctx.lineWidth = 0.6 + rnd() * 1.4;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (rnd() - 0.5) * 4, y + len); ctx.stroke();
    }
  });
}

export function groundTexture(seed = 5) {
  const n = makeNoise2D(seed);
  return canvasTex(256, (ctx, s) => {
    const img = ctx.createImageData(s, s);
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const a = (x / s) * Math.PI * 2, b = (y / s) * Math.PI * 2;
      const f = fbm(n, Math.cos(a) * 3 + Math.sin(b), Math.sin(a) * 3 + Math.cos(b) * 3, 5);
      const g = 215 + f * 70;
      const i = (y * s + x) * 4;
      img.data[i] = g; img.data[i + 1] = g; img.data[i + 2] = g; img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, { repeat: 1, srgb: false });
}

export function softDotTexture() {
  return canvasTex(64, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  });
}

export function fogPuffTexture(seed = 9) {
  const n = makeNoise2D(seed);
  return canvasTex(128, (ctx, s) => {
    const img = ctx.createImageData(s, s);
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const dx = x / s - 0.5, dy = y / s - 0.5, r = Math.sqrt(dx * dx + dy * dy) * 2;
      const f = fbm(n, x * 0.05, y * 0.05, 4) * 0.5 + 0.5;
      const a = Math.max(0, 1 - r) ** 2 * f;
      const i = (y * s + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255; img.data[i + 3] = a * 255;
    }
    ctx.putImageData(img, 0, 0);
  });
}

export function shaftTexture() {
  return canvasTex(128, (ctx, s) => {
    const g = ctx.createLinearGradient(0, 0, 0, s);
    g.addColorStop(0, 'rgba(255,240,210,0.0)'); g.addColorStop(0.25, 'rgba(255,240,210,0.6)'); g.addColorStop(1, 'rgba(255,240,210,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
    const h = ctx.createLinearGradient(0, 0, s, 0);
    h.addColorStop(0, 'rgba(0,0,0,1)'); h.addColorStop(0.5, 'rgba(0,0,0,0)'); h.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = h; ctx.fillRect(0, 0, s, s);
  });
}

/** Thin branching cracks on black — used as an emissive map so the Colossus' stone glows faintly from within. */
export function veinTexture(seed = 17) {
  const rnd = mulberry32(seed);
  return canvasTex(512, (ctx, s) => {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, s, s);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const crack = (x, y, a, len, w, depth) => {
      ctx.lineWidth = w; ctx.strokeStyle = `rgba(255,220,170,${0.5 + w * 0.15})`;
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let i = 0; i < len; i++) {
        a += (rnd() - 0.5) * 0.9; x += Math.cos(a) * 9; y += Math.sin(a) * 9; ctx.lineTo(x, y);
        if (depth < 2 && rnd() < 0.12) { ctx.stroke(); crack(x, y, a + (rnd() < 0.5 ? 1 : -1) * (0.6 + rnd()), len * 0.5, w * 0.6, depth + 1); ctx.lineWidth = w; ctx.strokeStyle = `rgba(255,220,170,${0.5 + w * 0.15})`; ctx.beginPath(); ctx.moveTo(x, y); }
      }
      ctx.stroke();
    };
    for (let i = 0; i < 5; i++) crack(rnd() * s, rnd() * s, rnd() * 6.28, 14 + rnd() * 16, 2.2, 0);
  }, { srgb: true });
}

// ---------------------------------------------------------------------------------------------
// Environment upgrade: tileable data textures (albedo in rgb, height in alpha → one fetch gives both)

/** Periodic value noise: `per` lattice cells per unit, wraps exactly at 1. */
function makeTileNoise(seed) {
  const rnd = mulberry32(seed), N = 64;
  const tab = new Float32Array(N * N * 4);
  for (let i = 0; i < tab.length; i++) tab[i] = rnd();
  const fade = (t) => t * t * (3 - 2 * t);
  const n = (u, v, per, layer = 0, perV = per) => {
    const x = u * per, y = v * perV;
    const xi = Math.floor(x), yi = Math.floor(y), xf = fade(x - xi), yf = fade(y - yi);
    const x0 = ((xi % per) + per) % per, y0 = ((yi % perV) + perV) % perV, x1 = (x0 + 1) % per, y1 = (y0 + 1) % perV;
    const o = layer * N * N;
    const a = tab[o + y0 * N + x0], b = tab[o + y0 * N + x1], c = tab[o + y1 * N + x0], d = tab[o + y1 * N + x1];
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  };
  /** 0..1 fractal noise; per·2^(oct-1) must stay ≤ 64 */
  n.fbm = (u, v, per, oct, layer = 0) => {
    let s = 0, a = 0.5, tot = 0;
    for (let o = 0; o < oct; o++) { s += a * n(u, v, per, (layer + o) & 3); tot += a; a *= 0.5; per *= 2; }
    return s / tot;
  };
  return n;
}

function dataTex(size, fill, { srgb = true } = {}) {
  const data = new Uint8Array(size * size * 4);
  const px = [0, 0, 0, 0];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    fill(x / size, y / size, px);
    const i = (y * size + x) * 4;
    data[i] = Math.max(0, Math.min(255, px[0] * 255)); data[i + 1] = Math.max(0, Math.min(255, px[1] * 255));
    data[i + 2] = Math.max(0, Math.min(255, px[2] * 255)); data[i + 3] = Math.max(0, Math.min(255, px[3] * 255));
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Four independent tileable noise channels (linear): r soft fbm, g blotches, b fine grain, a ridged. */
export function noiseTexture(seed = 23) {
  const n = makeTileNoise(seed);
  return dataTex(256, (u, v, px) => {
    px[0] = n.fbm(u, v, 4, 5, 0);
    px[1] = n.fbm(u + 0.37, v + 0.11, 3, 4, 1);
    px[2] = n.fbm(u, v, 16, 3, 2);
    px[3] = 1 - Math.abs(n.fbm(u + 0.7, v + 0.2, 4, 4, 3) * 2 - 1);
  }, { srgb: false });
}

/**
 * Weathered masonry: megalithic courses with fine, eroded joints, per-block tone, stains, pits and cracks.
 * One tile = 4 m of wall. rgb = albedo (kept bright: the material colour tints it), a = height.
 * courses=false gives natural bedded rock for boulders and cliffs.
 */
export function masonryTexture(seed = 3, { courses = true, size = 512 } = {}) {
  const n = makeTileNoise(seed), rnd = mulberry32(seed * 31 + 7);
  // rows: [height, [block widths]] in metres (sum of heights = 4, widths sum to 4)
  const rows = [
    [1.15, [1.5, 1.1, 1.4]], [0.85, [0.9, 1.7, 1.4]], [1.05, [1.3, 1.5, 1.2]], [0.95, [1.8, 1.0, 1.2]],
  ].map(([h, ws]) => ({ h, ws, off: rnd() * 4, tone: ws.map(() => rnd()), lift: ws.map(() => rnd()) }));
  return dataTex(size, (u, v, px) => {
    const big = n.fbm(u, v, 2, 6, 0), mid = n.fbm(u + 0.31, v + 0.57, 8, 4, 1), fine = n(u, v, 64, 2);
    let tone = 1, edge = 1, lift = 0.5;
    if (courses) {
      let y = v * 4, r = 0; while (y >= rows[r].h) { y -= rows[r].h; r++; }
      const row = rows[r];
      let x = (u * 4 + row.off) % 4, k = 0; while (x >= row.ws[k]) { x -= row.ws[k]; k++; }
      const wob = (n(u, v, 16, 3) - 0.5) * 0.05;       // joints are not ruler-straight
      const e = Math.min(x, row.ws[k] - x, y, row.h - y) + wob;
      edge = Math.max(0, Math.min(1, e / 0.07));
      tone = 0.9 + row.tone[k] * 0.2; lift = 0.35 + row.lift[k] * 0.3;
    }
    const bed = courses ? 0 : (n(u + big * 0.6, v, 4, 3, 32) - 0.5) * 0.18;   // strata for natural rock
    const ridged = 1 - Math.abs(n.fbm(u + 0.13, v + 0.71, 4, 4, 2) * 2 - 1);
    const crack = courses && ridged > 0.982 ? (ridged - 0.982) / 0.018 * (mid > 0.42 ? 0.7 : 0) : 0;
    const pit = fine < 0.1 && mid > 0.52 ? 1 : 0;
    const streak = n(u, v, 32, 1, 4);                                   // vertical run-off stains
    const stain = Math.max(0, streak - 0.6) * 1.6 * (0.5 + big);
    const joint = 1 - edge * edge * (3 - 2 * edge);
    let g = (0.74 + (big - 0.5) * 0.34 + (mid - 0.5) * 0.2 + (fine - 0.5) * 0.08 + bed) * tone;
    g *= 1 - joint * 0.5 - crack * 0.35 - pit * 0.16 - stain * 0.3;
    const warm = (mid - 0.5) * 0.06;                                              // faint ochre / grey drift
    px[0] = g * (1.0 + warm); px[1] = g * 0.985; px[2] = g * (0.94 - warm);
    px[3] = (lift + (big - 0.5) * 0.5 + (mid - 0.5) * 0.3 + (fine - 0.5) * 0.12 + bed) * (1 - joint * 0.85) * (1 - crack * 0.9) * (1 - pit * 0.5);
  });
}

/** Leaf-litter of small overlapping leaves; alpha is coverage (used to break up canopy silhouettes). */
export function leafTexture(seed = 13) {
  const rnd = mulberry32(seed);
  const t = canvasTex(256, (ctx, s) => {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 1500; i++) {
      const x = rnd() * s, y = rnd() * s, a = rnd() * Math.PI, l = 5 + rnd() * 7, w = l * (0.35 + rnd() * 0.2);
      const v = Math.floor(90 + rnd() * 165);
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      for (const [ox, oy] of [[0, 0], [s, 0], [-s, 0], [0, s], [0, -s]]) {   // wrap so it tiles
        ctx.save(); ctx.translate(x + ox, y + oy); ctx.rotate(a);
        ctx.beginPath(); ctx.ellipse(0, 0, l, w, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      }
    }
  }, { srgb: false });
  t.anisotropy = 4;
  return t;
}

/** Hanging vines / moss curtain with alpha, for drapes on out-of-reach ledges. */
export function vineTexture(seed = 19) {
  const rnd = mulberry32(seed);
  const t = canvasTex(256, (ctx, s) => {
    ctx.clearRect(0, 0, s, s); ctx.lineCap = 'round';
    for (let i = 0; i < 46; i++) {
      let x = rnd() * s, y = 0; const len = s * (0.35 + rnd() * 0.65);
      const hue = 62 + rnd() * 26, lum = 20 + rnd() * 18;
      ctx.strokeStyle = `hsl(${hue}, 24%, ${lum * 0.8}%)`; ctx.lineWidth = 1 + rnd() * 1.2;
      ctx.beginPath(); ctx.moveTo(x, 0);
      const pts = [];
      while (y < len) { y += 7; x += (rnd() - 0.5) * 5; ctx.lineTo(x, y); pts.push([x, y]); }
      ctx.stroke();
      for (const [px, py] of pts) {
        if (rnd() < 0.25) continue;
        ctx.fillStyle = `hsl(${hue + (rnd() - 0.5) * 14}, ${20 + rnd() * 14}%, ${lum + rnd() * 14}%)`;
        ctx.save(); ctx.translate(px + (rnd() - 0.5) * 9, py + (rnd() - 0.5) * 4); ctx.rotate(rnd() * 6.28);
        ctx.beginPath(); ctx.ellipse(0, 0, 3 + rnd() * 3.5, 1.8 + rnd() * 1.6, 0, 0, 6.28); ctx.fill(); ctx.restore();
      }
    }
  });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Bark: vertical furrows, tileable around the trunk. */
export function barkTexture(seed = 27) {
  const n = makeTileNoise(seed);
  return dataTex(256, (u, v, px) => {
    const f = n(u + n(u, v, 4, 1) * 0.08, v, 32, 0, 6), m = n.fbm(u, v, 4, 4, 2);
    const fur = Math.abs(f * 2 - 1);
    const g = 0.5 + fur * 0.38 + (m - 0.5) * 0.3;
    px[0] = g; px[1] = g * 0.94; px[2] = g * 0.86; px[3] = fur * 0.7 + m * 0.3;
  });
}

/**
 * Living hide, tileable. 'wrinkle': thick cracked leather (elephant / rhino), 'scale': rows of overlapping scales.
 * Grey only: the red channel doubles as the height the skin shader bumps with.
 */
export function hideTexture(kind = 'wrinkle', seed = 5) {
  const rnd = mulberry32(seed), scale = kind === 'scale', N = scale ? 12 : 9;
  const pts = []; for (let i = 0; i < N * N; i++) pts.push([rnd(), rnd(), rnd()]);
  const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  return canvasTex(256, (ctx, sz) => {
    const img = ctx.createImageData(sz, sz);
    for (let y = 0; y < sz; y++) for (let x = 0; x < sz; x++) {
      const u = x / sz * N, v = y / sz * N, ci = Math.floor(u), cj = Math.floor(v);
      let f1 = 9, f2 = 9, tone = 0, ny = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const cx = ci + di, cy = cj + dj, q = pts[((cx % N) + N) % N + (((cy % N) + N) % N) * N];
        const px = scale ? cx + 0.5 + (q[0] - 0.5) * 0.3 + (((cy % 2) + 2) % 2) * 0.5 : cx + q[0];
        const py = scale ? cy + 0.5 + (q[1] - 0.5) * 0.2 : cy + q[1];
        const dx = px - u, dy = (py - v) * (scale ? 0.85 : 1), d = dx * dx + dy * dy;
        if (d < f1) { f2 = f1; f1 = d; tone = q[2]; ny = v - py; } else if (d < f2) f2 = d;
      }
      const e = Math.sqrt(f2) - Math.sqrt(f1);
      const g = scale
        ? 96 + ss(0, 0.16, e) * 78 + ny * 46 + tone * 26          // each scale: dark rim, lit lower lip
        : 104 + ss(0, 0.1, e) * 62 + ss(0.1, 0.6, e) * 16 + tone * 34;   // pads of skin between deep creases
      const i = (y * sz + x) * 4, gg = Math.max(0, Math.min(255, g + (rnd() - 0.5) * 10));
      img.data[i] = gg; img.data[i + 1] = gg; img.data[i + 2] = gg; img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  });
}

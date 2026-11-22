import * as THREE from 'three';

/**
 * Shared atmosphere + surface shading for the valley.
 *  - installAtmosphere(): replaces three's fog chunks with height + distance fog that glows toward the sun.
 *    It is global, so every fogged material (player, Colossus, particles) sits in the same air.
 *  - skyMaterial(): gradient sky, haze band and a slow cloud layer; its horizon is the fog colour, so far
 *    terrain dissolves into it without a seam.
 *  - weatherStone(): world-space triplanar masonry with bump, run-off stains and lichen on upward faces.
 *  - terrainMaterial(), canopyMaterial(): ground and foliage shading.
 */

const lin = (hex) => { const c = new THREE.Color(hex); return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`; };
const v3 = (v) => `vec3(${v.x.toFixed(5)}, ${v.y.toFixed(5)}, ${v.z.toFixed(5)})`;

export const ATMOS = {
  warm: 0xc9c0a6,      // haze on the sun side
  cool: 0xa3aaa4,      // haze away from the sun
  glow: 0xffdfae,
  top: 0x6c7a82,       // zenith behind the cloud      // inscatter around the sun
  density: 0.00095,    // uniform haze per metre
  heightDensity: 0.0034, // extra haze pooled low (ravine, basin floor)
  heightFalloff: 0.055,
  heightBase: -9,
};

let atmosGLSL = '';

export function installAtmosphere(sunDir) {
  const hz = new THREE.Vector2(sunDir.x, sunDir.z).normalize();
  atmosGLSL = /* glsl */`
    const vec3 ENV_SUN = ${v3(sunDir)};
    vec3 envFogColor(vec3 dir) {
      float s = max(dot(dir, ENV_SUN), 0.0);
      float side = dot(normalize(dir.xz + 1e-5), vec2(${hz.x.toFixed(5)}, ${hz.y.toFixed(5)}));
      vec3 col = mix(${lin(ATMOS.cool)}, ${lin(ATMOS.warm)}, smoothstep(-0.7, 0.8, side));
      col += ${lin(ATMOS.glow)} * (pow(s, 5.0) * 0.22 + pow(s, 28.0) * 0.25);
      // the haze thins upward into the sky's own colour, so far peaks fade into what is behind them
      return mix(col, ${lin(ATMOS.top)}, smoothstep(0.0, 0.6, dir.y) * (1.0 - pow(s, 6.0) * 0.5));
    }
    float envFogAmount(float dist, float camY, float dirY) {
      float b = ${ATMOS.heightFalloff.toFixed(4)};
      float t = dirY * dist;
      float k = abs(t) > 0.01 ? (1.0 - exp(-clamp(b * t, -8.0, 8.0))) / (b * dirY) : dist;
      float hf = ${ATMOS.heightDensity.toFixed(5)} * exp(clamp(-b * (camY - (${ATMOS.heightBase.toFixed(2)})), -8.0, 3.0)) * k;
      return (1.0 - exp(-(dist * ${ATMOS.density.toFixed(6)} + max(hf, 0.0)))) * 0.93;
    }`;
  const C = THREE.ShaderChunk;
  C.fog_pars_vertex = /* glsl */`#ifdef USE_FOG\n varying vec3 vFogView;\n#endif`;
  C.fog_vertex = /* glsl */`#ifdef USE_FOG\n vFogView = mvPosition.xyz;\n#endif`;
  C.fog_pars_fragment = /* glsl */`#ifdef USE_FOG
    uniform vec3 fogColor;
    varying vec3 vFogView;
    #ifdef FOG_EXP2
      uniform float fogDensity;
    #else
      uniform float fogNear; uniform float fogFar;
    #endif
    ${atmosGLSL}
  #endif`;
  C.fog_fragment = /* glsl */`#ifdef USE_FOG
    float envDist = length(vFogView);
    vec3 envDir = (vFogView / max(envDist, 1e-4)) * mat3(viewMatrix);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, envFogColor(envDir), envFogAmount(envDist, cameraPosition.y, envDir.y));
  #endif`;
}

export function skyMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uTime: uniforms.uTime, uCloudLit: { value: new THREE.Color(0xe9dfc8) }, uCloudDark: { value: new THREE.Color(0x8a8e8c) } },
    vertexShader: /* glsl */`varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w; }`,
    fragmentShader: /* glsl */`
      uniform vec3 uCloudLit, uCloudDark; uniform float uTime; varying vec3 vDir;
      ${atmosGLSL}
      float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
      float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ s += a * vn(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
      void main(){
        vec3 dir = normalize(vDir);
        float y = dir.y;
        vec3 col = envFogColor(dir);
        float s = max(dot(dir, ENV_SUN), 0.0);
        if (y > 0.0) {
          // a high, thin cloud deck drifting slowly; flattened toward the horizon
          vec2 uv = dir.xz / (y + 0.16) * 1.15 + vec2(uTime * 0.004, uTime * 0.0015);
          float c = fbm(uv) * 0.65 + fbm(uv * 2.7 + 5.0) * 0.35;
          float cover = smoothstep(0.46, 0.74, c);
          float thick = smoothstep(0.5, 0.9, c);
          vec3 cc = mix(uCloudLit, uCloudDark, thick * 0.75);
          cc += vec3(1.0, 0.85, 0.62) * pow(s, 6.0) * 0.5 * (1.0 - thick * 0.6);   // silver lining near the sun
          col = mix(col, cc, cover * smoothstep(0.015, 0.22, y) * 0.82);
        }
        // sun: soft disc behind the haze
        col += vec3(1.0, 0.88, 0.66) * (pow(s, 40.0) * 0.22 + pow(s, 1200.0) * 2.2);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

// ---------------------------------------------------------------------------------------------
const WORLD_VARY_VERT = /* glsl */`
  vec4 envWP = vec4(transformed, 1.0); vec3 envWN = objectNormal;
  #ifdef USE_INSTANCING
    envWP = instanceMatrix * envWP; envWN = mat3(instanceMatrix) * envWN;
  #endif
  vWPos = (modelMatrix * envWP).xyz; vWNrm = normalize(mat3(modelMatrix) * envWN);`;

const PERTURB = /* glsl */`
  vec3 envPerturb(vec3 sp, vec3 sn, vec2 dH, float fd) {
    vec3 sx = normalize(dFdx(sp)), sy = normalize(dFdy(sp));
    vec3 r1 = cross(sy, sn), r2 = cross(sn, sx);
    float det = dot(sx, r1) * fd;
    vec3 g = sign(det) * (dH.x * r1 + dH.y * r2);
    return normalize(abs(det) * sn - g);
  }`;

/**
 * Triplanar, world-anchored stone. `mat.map` must be a masonry/rock texture (rgb albedo, a height).
 * scale: texture tiles per metre. moss: 0..1 lichen on upward faces. bump: relief strength.
 */
export function weatherStone(mat, noiseTex, { scale = 0.25, moss = 1, bump = 5, stain = 1 } = {}) {
  const u = { tNoise: { value: noiseTex }, uEnvScale: { value: scale }, uEnvMoss: { value: moss }, uEnvBump: { value: bump }, uEnvStain: { value: stain },
    uMossA: { value: new THREE.Color(0x4a4e33) }, uMossB: { value: new THREE.Color(0x76735a) } };
  mat.userData.env = u;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = 'varying vec3 vWPos; varying vec3 vWNrm;\n' + sh.vertexShader.replace('#include <project_vertex>', WORLD_VARY_VERT + '\n#include <project_vertex>');
    sh.fragmentShader = /* glsl */`varying vec3 vWPos; varying vec3 vWNrm;
      uniform sampler2D tNoise; uniform float uEnvScale, uEnvMoss, uEnvBump, uEnvStain; uniform vec3 uMossA, uMossB;
      float envH = 0.5; float envMossW = 0.0;
      ${PERTURB}
      ` + sh.fragmentShader
      .replace('#include <map_fragment>', /* glsl */`
        vec3 eN = normalize(vWNrm);
        vec3 eW = pow(abs(eN), vec3(6.0)); eW /= (eW.x + eW.y + eW.z);
        vec3 eP = vWPos * uEnvScale;
        vec4 eX = texture2D(map, eP.zy), eY = texture2D(map, eP.xz), eZ = texture2D(map, eP.xy);
        vec4 eS = eX * eW.x + eY * eW.y + eZ * eW.z;
        envH = eS.a;
        vec4 eM = texture2D(tNoise, vWPos.xz * 0.021 + vWPos.y * 0.017);
        vec4 eF = texture2D(tNoise, vWPos.xz * 0.31 + vWPos.y * 0.23);
        vec3 eAlb = eS.rgb * mix(0.82, 1.1, eM.g);
        // run-off stains under ledges, darker damp toward crevices
        float eStreak = texture2D(tNoise, vec2((vWPos.x + vWPos.z) * 0.11, vWPos.y * 0.012)).b;
        eAlb *= 1.0 - smoothstep(0.5, 0.78, eStreak) * 0.3 * uEnvStain * (1.0 - eW.y);
        eAlb *= mix(0.78, 1.0, smoothstep(0.1, 0.55, envH));
        // lichen and moss settle on upward faces and creep out of the joints
        float up = eN.y;
        envMossW = smoothstep(0.55, 0.98, up * 0.62 + (eM.r - 0.5) * 1.3 + (1.0 - envH) * 0.5 + eF.b * 0.2 - 0.05) * 0.8 * uEnvMoss;
        envMossW = max(envMossW, smoothstep(0.66, 0.9, eM.a * 0.6 + (1.0 - envH) * 0.5) * 0.35 * uEnvMoss);
        vec3 eMoss = mix(uMossA, uMossB, eF.r) * (0.55 + eF.b * 0.8);
        diffuseColor.rgb = mix(diffuseColor.rgb * eAlb, eMoss, envMossW);`)
      .replace('#include <normal_fragment_maps>', /* glsl */`#include <normal_fragment_maps>
        normal = envPerturb(-vViewPosition, normal, vec2(dFdx(envH), dFdy(envH)) * uEnvBump * (1.0 - envMossW * 0.7), faceDirection);`);
  };
  mat.customProgramCacheKey = () => 'envStone';
  return mat;
}

/** Ground: vertex colours carry the biome; the shader adds soil, wear, rock on slopes and fine relief. */
export function terrainMaterial(noiseTex, rockTex) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, map: rockTex });
  const u = { tNoise: { value: noiseTex } };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = 'varying vec3 vWPos; varying vec3 vWNrm;\n' + sh.vertexShader.replace('#include <project_vertex>', WORLD_VARY_VERT + '\n#include <project_vertex>');
    sh.fragmentShader = /* glsl */`varying vec3 vWPos; varying vec3 vWNrm; uniform sampler2D tNoise; float envH = 0.5; float envRock = 0.0;
      ${PERTURB}
      ` + sh.fragmentShader
      .replace('#include <map_fragment>', '')
      .replace('#include <color_fragment>', /* glsl */`#include <color_fragment>
        vec3 eN = normalize(vWNrm);
        vec4 n0 = texture2D(tNoise, vWPos.xz * 1.9);
        vec4 n1 = texture2D(tNoise, vWPos.xz * 0.23);
        vec4 n2 = texture2D(tNoise, vWPos.xz * 0.031 + 0.37);
        vec4 n3 = texture2D(tNoise, vWPos.xz * 0.0043 + 0.11);
        vec3 col = diffuseColor.rgb;
        // broad drifts of drier and lusher ground, then mottling down to the grain of the turf
        col *= mix(0.78, 1.18, n3.r) * mix(0.84, 1.12, n2.g) * mix(0.86, 1.12, n1.g) * mix(0.8, 1.16, n0.b);
        col = mix(col, col * vec3(1.16, 1.05, 0.78), smoothstep(0.48, 0.72, n3.g * 0.6 + n2.r * 0.4) * 0.55);   // straw-yellow drifts
        col = mix(col, col * vec3(0.72, 0.84, 0.66), smoothstep(0.5, 0.75, n2.b * 0.5 + n1.a * 0.5) * 0.5);      // dark clover / damp olive
        // bare earth where the turf is thin
        float soil = smoothstep(0.62, 0.78, n2.a * 0.55 + n1.r * 0.45 + (0.5 - n3.r) * 0.3);
        vec3 soilCol = vec3(0.150, 0.118, 0.082) * (0.7 + n0.r * 0.7);
        col = mix(col, soilCol, soil * 0.5);
        // exposed rock on steep ground
        float slope = 1.0 - eN.y;
        envRock = smoothstep(0.2, 0.36, slope + (n2.r - 0.5) * 0.22 + (n1.r - 0.5) * 0.08);
        vec3 eW = pow(abs(eN), vec3(5.0)); eW /= (eW.x + eW.y + eW.z);
        vec3 rP = vWPos * 0.09;
        vec4 rk = texture2D(map, rP.zy) * eW.x + texture2D(map, rP.xz) * eW.y + texture2D(map, rP.xy) * eW.z;
        vec3 rockCol = rk.rgb * vec3(0.30, 0.29, 0.265) * mix(0.75, 1.15, n3.a) * mix(0.8, 1.1, n2.g);
        col = mix(col, rockCol, envRock);
        envH = mix(n0.b * 0.6 + n0.r * 0.4, rk.a, envRock);
        diffuseColor.rgb = col;`)
      .replace('#include <normal_fragment_maps>', /* glsl */`#include <normal_fragment_maps>
        normal = envPerturb(-vViewPosition, normal, vec2(dFdx(envH), dFdy(envH)) * mix(1.3, 6.0, envRock), faceDirection);`);
  };
  mat.customProgramCacheKey = () => 'envTerrain';
  return mat;
}

/**
 * Foliage masses (tree crowns, shrubs): instance-tinted lumps whose silhouettes are eaten away by a leaf
 * mask, shaded darker underneath, swaying in the wind. Local y runs about -1 (underside) → 1 (top).
 */
export function canopyMaterial(leafTex, time, { cut = 0.52 } = {}) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 });
  const u = { tLeaf: { value: leafTex }, uTime: time, uCut: { value: cut } };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = 'varying vec3 vWPos; varying vec3 vWNrm; varying float vLy; uniform float uTime;\n' + sh.vertexShader
      .replace('#include <begin_vertex>', /* glsl */`#include <begin_vertex>
        vLy = position.y;
        #ifdef USE_INSTANCING
          vec3 ip = instanceMatrix[3].xyz;
          float ph = uTime * 0.8 + ip.x * 0.21 + ip.z * 0.17;
          float sw = sin(ph) * 0.6 + sin(ph * 2.3 + position.x * 2.0) * 0.3;
          transformed.x += sw * 0.05 * (0.6 + position.y);
          transformed.z += cos(ph * 0.83) * 0.035 * (0.6 + position.y);
          transformed += normal * sin(uTime * 2.6 + position.x * 9.0 + position.z * 7.0 + ip.x) * 0.014;
        #endif`)
      .replace('#include <project_vertex>', WORLD_VARY_VERT + '\n#include <project_vertex>');
    sh.fragmentShader = 'varying vec3 vWPos; varying vec3 vWNrm; varying float vLy; uniform sampler2D tLeaf; uniform float uCut;\n' + sh.fragmentShader
      .replace('#include <color_fragment>', /* glsl */`#include <color_fragment>
        vec3 eN = normalize(vWNrm);
        vec3 eW = abs(eN); eW /= (eW.x + eW.y + eW.z);
        vec3 lP = vWPos * 0.55;
        float leaf = texture2D(tLeaf, lP.zy).r * eW.x + texture2D(tLeaf, lP.xz).r * eW.y + texture2D(tLeaf, lP.xy).r * eW.z;
        vec3 cP = vWPos * 0.16;
        float clump = texture2D(tLeaf, cP.zy).r * eW.x + texture2D(tLeaf, cP.xz).r * eW.y + texture2D(tLeaf, cP.xy).r * eW.z;
        float rim = 1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition)));
        if (leaf * 0.45 + clump * 0.55 < uCut * smoothstep(0.2, 0.8, rim)) discard;
        leaf = leaf * 0.6 + clump * 0.4;
        diffuseColor.rgb *= mix(0.45, 1.1, smoothstep(-0.9, 0.8, vLy)) * mix(0.72, 1.2, leaf) * mix(1.0, 1.25, smoothstep(0.5, 1.0, rim));`);
  };
  mat.customProgramCacheKey = () => 'envCanopy';
  return mat;
}

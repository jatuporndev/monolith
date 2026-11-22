import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

/**
 * Cheap screen-space ambient occlusion straight from the scene depth buffer (no extra scene pass).
 * Half-resolution occlusion, then a depth-aware blur while compositing. Fades out with distance so the
 * haze stays clean. Grounds ruins, rocks and trunks without baking anything.
 */
export class EnvAOPass extends Pass {
  constructor(camera) {
    super();
    this.camera = camera;
    this.aoRT = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
    this.aoRT.texture.minFilter = this.aoRT.texture.magFilter = THREE.LinearFilter;
    const vs = /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
    this.aoMat = new THREE.ShaderMaterial({
      depthTest: false, depthWrite: false,
      uniforms: { tDepth: { value: null }, uProjInv: { value: new THREE.Matrix4() }, uP11: { value: 1 }, uRes: { value: new THREE.Vector2(1, 1) }, uRadius: { value: 1.1 } },
      vertexShader: vs,
      fragmentShader: /* glsl */`
        uniform sampler2D tDepth; uniform mat4 uProjInv; uniform float uP11, uRadius; uniform vec2 uRes; varying vec2 vUv;
        vec3 vpos(vec2 uv){ float d = texture2D(tDepth, uv).x; vec4 v = uProjInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); return v.xyz / v.w; }
        void main(){
          float d = texture2D(tDepth, vUv).x;
          if (d >= 0.99999) { gl_FragColor = vec4(1.0); return; }
          vec3 p = vpos(vUv);
          float dist = -p.z;
          float fade = 1.0 - smoothstep(55.0, 110.0, dist);
          if (fade <= 0.0) { gl_FragColor = vec4(1.0); return; }
          vec2 px = 1.0 / uRes;
          vec3 pr = vpos(vUv + vec2(px.x, 0.0)), pl = vpos(vUv - vec2(px.x, 0.0)), pu = vpos(vUv + vec2(0.0, px.y)), pd = vpos(vUv - vec2(0.0, px.y));
          vec3 dx = abs(pr.z - p.z) < abs(p.z - pl.z) ? pr - p : p - pl;
          vec3 dy = abs(pu.z - p.z) < abs(p.z - pd.z) ? pu - p : p - pd;
          vec3 n = normalize(cross(dx, dy));
          float rUv = clamp(uRadius * uP11 * 0.5 / dist, 3.0 * px.y, 0.09);
          float ang = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) * 6.2831853;
          float occ = 0.0;
          const int N = 10;
          for (int i = 0; i < N; i++) {
            float fi = (float(i) + 0.5) / float(N);
            float a = ang + float(i) * 2.399963;
            vec2 o = vec2(cos(a), sin(a)) * sqrt(fi) * rUv * vec2(uRes.y / uRes.x, 1.0);
            vec3 v = vpos(vUv + o) - p;
            float l2 = dot(v, v);
            occ += max(dot(n, v) - 0.02 * dist * 0.2 - 0.015, 0.0) / (l2 + 0.02) * smoothstep(uRadius * uRadius * 2.5, uRadius * uRadius * 0.4, l2);
          }
          float ao = clamp(1.0 - occ * uRadius * 1.5 / float(N), 0.0, 1.0);
          gl_FragColor = vec4(vec3(mix(1.0, ao, fade)), 1.0);
        }`,
    });
    this.compMat = new THREE.ShaderMaterial({
      depthTest: false, depthWrite: false,
      uniforms: { tDiffuse: { value: null }, tAO: { value: null }, tDepth: { value: null }, uTexel: { value: new THREE.Vector2() }, uStrength: { value: 0.85 }, uNearFar: { value: new THREE.Vector2(0.1, 2400) } },
      vertexShader: vs,
      fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse, tAO, tDepth; uniform vec2 uTexel, uNearFar; uniform float uStrength; varying vec2 vUv;
        float lz(vec2 uv){ float d = texture2D(tDepth, uv).x; return uNearFar.x * uNearFar.y / (uNearFar.y - d * (uNearFar.y - uNearFar.x)); }
        void main(){
          vec4 col = texture2D(tDiffuse, vUv);
          float z0 = lz(vUv), acc = 0.0, tot = 0.0;
          for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) {
            vec2 uv = vUv + vec2(float(x), float(y)) * uTexel * 1.5;
            float w = 1.0 / (1.0 + abs(lz(uv) - z0) * 40.0 / z0);
            acc += texture2D(tAO, uv).r * w; tot += w;
          }
          float ao = acc / tot;
          // tint the occlusion slightly warm-dark rather than pure black
          col.rgb *= mix(vec3(1.0), vec3(ao, ao * 1.01, ao * 1.04), uStrength);
          gl_FragColor = col;
        }`,
    });
    this.quad = new FullScreenQuad(this.aoMat);
  }
  setSize(w, h) {
    const hw = Math.max(1, Math.ceil(w / 2)), hh = Math.max(1, Math.ceil(h / 2));
    this.aoRT.setSize(hw, hh);
    this.aoMat.uniforms.uRes.value.set(hw, hh);
    this.compMat.uniforms.uTexel.value.set(1 / hw, 1 / hh);
  }
  render(renderer, writeBuffer, readBuffer) {
    const depth = readBuffer.depthTexture;
    const cam = this.camera;
    this.aoMat.uniforms.tDepth.value = depth;
    this.aoMat.uniforms.uProjInv.value.copy(cam.projectionMatrixInverse);
    this.aoMat.uniforms.uP11.value = cam.projectionMatrix.elements[5];
    this.quad.material = this.aoMat;
    renderer.setRenderTarget(this.aoRT); this.quad.render(renderer);
    const c = this.compMat.uniforms;
    c.tDiffuse.value = readBuffer.texture; c.tAO.value = this.aoRT.texture; c.tDepth.value = depth; c.uNearFar.value.set(cam.near, cam.far);
    this.quad.material = this.compMat;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer); this.quad.render(renderer);
  }
  dispose() { this.aoRT.dispose(); this.aoMat.dispose(); this.compMat.dispose(); this.quad.dispose(); }
}

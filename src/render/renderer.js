import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { clamp, damp } from '../core/util.js';
import { EnvAOPass } from './envPost.js';

/**
 * Condition shader: everything the invisible health system needs to say.
 * desaturation, vignette (neutral dark, never red), edge blur, camera motion blur, grade.
 */
const ConditionShader = {
  uniforms: {
    tDiffuse: { value: null },
    uDesat: { value: 0 }, uVignette: { value: 0 }, uBlur: { value: 0 }, uDark: { value: 0 },
    uPulse: { value: 0 }, uMotion: { value: new THREE.Vector2() }, uFade: { value: 0 }, uFlash: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 }, uGrain: { value: 0.035 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uDesat, uVignette, uBlur, uDark, uPulse, uFade, uTime, uGrain, uFlash;
    uniform vec2 uMotion, uResolution;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      float r = length(c * vec2(uResolution.x/uResolution.y, 1.0));
      vec4 col = texture2D(tDiffuse, uv);
      // edge blur (radial), stronger towards the frame edges
      float edge = smoothstep(0.25, 0.85, r);
      float b = uBlur * edge;
      if (b > 0.001) {
        vec4 acc = col; float tot = 1.0;
        for (int i = 1; i <= 6; i++) {
          float a = float(i) * 2.399;
          vec2 o = vec2(cos(a), sin(a)) * b * float(i) * 1.6 / uResolution;
          acc += texture2D(tDiffuse, uv + o); acc += texture2D(tDiffuse, uv - o * 0.7);
          tot += 2.0;
        }
        col = acc / tot;
      }
      // camera motion blur
      float m = length(uMotion);
      if (m > 0.0005) {
        vec4 acc = col;
        for (int i = 1; i <= 6; i++) { acc += texture2D(tDiffuse, uv - uMotion * (float(i)/6.0) * edge * 1.4); }
        col = acc / 7.0;
      }
      float l = dot(col.rgb, vec3(0.2126, 0.7152, 0.0722));
      // gentle warm grade for the whole game
      col.rgb = mix(col.rgb, col.rgb * vec3(1.03, 1.0, 0.95), 0.6);
      // desaturate toward a cool ashen grey
      col.rgb = mix(col.rgb, vec3(l) * vec3(0.97, 0.98, 1.02), clamp(uDesat, 0.0, 1.0));
      // vignette: neutral black, tightening with condition, breathing with the pulse
      float v = smoothstep(1.05 - uVignette * 0.45 - uPulse * 0.1, 0.25 - uVignette * 0.1, r);
      col.rgb *= mix(1.0, v, clamp(0.3 + uVignette * 0.65, 0.0, 0.92));
      col.rgb *= 1.0 - uDark;
      // film grain (subtle, keeps gradients from banding)
      col.rgb += (hash(uv * uResolution + uTime) - 0.5) * uGrain;
      // impact flash: warm, brief, strongest at the centre (never red)
      float fr = 1.0 - smoothstep(0.0, 0.9, length(vUv - 0.5) * 1.6);
      col.rgb += uFlash * vec3(1.0, 0.92, 0.78) * (0.12 + 0.22 * fr);
      col.rgb *= 1.0 - uFade;
      gl_FragColor = col;
    }`,
};

export class Renderer {
  constructor(bus, settings, container) {
    this.bus = bus; this.settings = settings;
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(r.domElement);
    r.domElement.id = 'game-canvas';
    this.canvas = r.domElement;

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 2400);
    this.scene = null;

    // effect values driven each frame by the gameplay → UI bridge
    this.fx = { desat: 0, vignette: 0, blur: 0, dark: 0, pulse: 0, fade: 0, flash: 0, motion: new THREE.Vector2() };
    this.prevCamQuat = new THREE.Quaternion();
    this.fadeOverlay = document.getElementById('fx-fallback');

    this.buildComposer();
    addEventListener('resize', () => this.resize());
    bus.on('settings:changed', ({ key, value }) => {
      if (['renderScale', 'antialias', 'postProcessing'].includes(key)) this.buildComposer();
      if (key === 'shadows') { this.applyShadows(); if (!!this.ao !== (value !== 'off' && this.settings.get('postProcessing'))) this.buildComposer(); }
    });
  }

  setScene(scene) { this.scene = scene; this.renderPass && (this.renderPass.scene = scene); this.applyShadows(); }

  applyShadows() {
    const mode = this.settings.get('shadows');
    const r = this.renderer;
    r.shadowMap.enabled = mode !== 'off';
    const size = { low: 1024, medium: 2048, high: 4096 }[mode] || 1024;
    this.scene?.traverse((o) => {
      if (o.isDirectionalLight && o.castShadow !== undefined && o.userData.sun) {
        o.castShadow = mode !== 'off';
        if (o.shadow.mapSize.x !== size) { o.shadow.mapSize.set(size, size); o.shadow.map?.dispose(); o.shadow.map = null; }
      }
      if (o.material) o.material.needsUpdate = true;
    });
  }

  buildComposer() {
    const s = this.settings;
    this.composer?.dispose?.();
    const aa = s.get('antialias');
    const post = s.get('postProcessing');
    // ambient occlusion reads the scene depth, so the composer targets carry a depth texture
    const ao = post && s.get('shadows') !== 'off';
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: aa === 'msaa' ? 4 : 0, depthTexture: ao ? new THREE.DepthTexture(1, 1) : null });
    const c = this.composer = new EffectComposer(this.renderer, target);
    // clone() shares the depth image between both buffers; give the second its own so reading one while writing the other is legal
    if (ao) { c.renderTarget2.depthTexture?.dispose(); c.renderTarget2.depthTexture = new THREE.DepthTexture(1, 1); }
    this.renderPass = new RenderPass(this.scene || new THREE.Scene(), this.camera);
    c.addPass(this.renderPass);
    this.condition = null; this.fxaa = null;
    this.ao?.dispose(); this.ao = null;
    if (ao) { this.ao = new EnvAOPass(this.camera); c.addPass(this.ao); }
    if (post) { this.condition = new ShaderPass(ConditionShader); c.addPass(this.condition); }
    c.addPass(new OutputPass());
    if (aa === 'fxaa') { this.fxaa = new ShaderPass(FXAAShader); c.addPass(this.fxaa); }
    if (aa === 'smaa') c.addPass(new SMAAPass(1, 1));
    // when post-processing is disabled, damage feedback falls back to a CSS filter + DOM vignette
    document.body.classList.toggle('fx-css', !post);
    this.resize();
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    const scale = this.settings.get('renderScale');
    const pr = Math.min(devicePixelRatio || 1, 2) * scale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    if (this.fxaa) this.fxaa.material.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr));
    if (this.condition) this.condition.uniforms.uResolution.value.set(w * pr, h * pr);
  }

  /** Native resolution string for the settings menu. */
  resolutionLabel(scale) {
    const pr = Math.min(devicePixelRatio || 1, 2) * scale;
    return `${Math.round(innerWidth * pr)} × ${Math.round(innerHeight * pr)}`;
  }

  render(dt, time) {
    if (!this.scene) return;
    // camera rotation velocity → motion blur vector
    const mb = this.settings.get('motionBlur');
    const q = this.camera.quaternion;
    if (mb && dt > 0) {
      const dq = this.prevCamQuat.clone().invert().multiply(q);
      const e = new THREE.Euler().setFromQuaternion(dq, 'YXZ');
      const target = new THREE.Vector2(clamp(-e.y / dt * 0.004, -0.03, 0.03), clamp(e.x / dt * 0.004, -0.03, 0.03));
      this.fx.motion.lerp(target, 0.5);
    } else this.fx.motion.set(0, 0);
    this.prevCamQuat.copy(q);

    const k = this.settings.get('screenEffects') / 100;
    const f = this.fx;
    if (this.condition) {
      const u = this.condition.uniforms;
      u.uDesat.value = f.desat * k; u.uVignette.value = f.vignette * k; u.uBlur.value = f.blur * k;
      u.uDark.value = f.dark * k; u.uPulse.value = f.pulse * k; u.uFade.value = f.fade; u.uFlash.value = (f.flash || 0) * k;
      u.uMotion.value.copy(f.motion); u.uTime.value = time % 100;
    } else {
      // CSS fallback keeps the feedback when post-processing is off
      this.canvas.style.filter = `saturate(${1 - f.desat * k * 0.9}) brightness(${(1 - f.dark * k) * (1 - f.fade)})` + (f.blur * k > 0.4 ? ` blur(${(f.blur * k - 0.4) * 1.5}px)` : '');
      if (this.fadeOverlay) this.fadeOverlay.style.opacity = String(clamp(f.vignette * k * 1.3 + f.pulse * k * 0.3, 0, 1));
    }
    this.composer.render(dt);
  }

  /** Render the current scene from a camera into an image (used for chapter / loading art).
   *  Draws to the real canvas (so tone mapping / colour space match the game) and copies it
   *  out in the same task, before the browser clears the drawing buffer. */
  snapshot(camera, w = 960, h = 540) {
    const src = this.canvas;
    const prevAspect = camera.aspect;
    camera.aspect = src.width / src.height; camera.updateProjectionMatrix();
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, camera);
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    // cover-crop to the requested aspect
    const sa = src.width / src.height, ta = w / h;
    let sw = src.width, sh = src.height, sx = 0, sy = 0;
    if (sa > ta) { sw = sh * ta; sx = (src.width - sw) / 2; } else { sh = sw / ta; sy = (src.height - sh) / 2; }
    ctx.drawImage(src, sx, sy, sw, sh, 0, 0, w, h);
    camera.aspect = prevAspect; camera.updateProjectionMatrix();
    return cv.toDataURL('image/jpeg', 0.85);
  }

  ease(key, target, speed, dt) { this.fx[key] = damp(this.fx[key], target, speed, dt); }
}

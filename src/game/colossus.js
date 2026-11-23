import * as THREE from 'three';
import { clamp, damp, lerp, smoothstep } from '../core/util.js';
import { furTexture, stoneTexture, softDotTexture, mossTexture, veinTexture, hideTexture } from './textures.js';
import { chiseledBox, blob, furCards } from './shapes.js';
import { furUniforms, strandMaterial } from './bossKit.js';
import { Sculpt, sculptMaterial, pnoise } from './sculpt.js';

const sndP = new THREE.Vector3();
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
const UNSEEN = new THREE.MeshBasicMaterial({ visible: false });
const GLOW = 0.1;   // how brightly the light under the hide shows through its creases
const STOMP_HOLD = 3.2;   // seconds a stamped foot stays stuck in the ground — the window to take hold of that shin

/**
 * The Warden — a walking ruin. No health bar, no markers: its state reads through
 * posture, sound and the faint sigils on its back and crown.
 * Local forward is +Z.
 */
export class Colossus {
  constructor(world, bus, audio) {
    this.world = world; this.bus = bus; this.audio = audio;
    this.climbables = []; this.weakPoints = []; this.feet = [];
    this.state = 'dormant'; this.timer = 0; this.phase = 0; this.walkAmt = 0;
    this.shakeIntensity = 0; this.flinch = 0; this.yaw = Math.PI; this.target = new THREE.Vector3();
    this.home = new THREE.Vector3(0, 0, -118);
    this.attention = 0; this.climbTimer = 0; this.dyingT = 0;
    this.furLag = new THREE.Vector3(); this.furVel = new THREE.Vector3(); this.furPrev = new THREE.Vector3(); this.furInit = false;
    this.lookYaw = 0; this.lookPitch = 0;
    this.build();
  }

  build() {
    const veins = veinTexture();
    const stone = new THREE.MeshStandardMaterial({ color: 0xb3ad9e, map: repeatTex(stoneTexture(23), 3), roughness: 0.93, emissive: 0xffe2b8, emissiveMap: veins, emissiveIntensity: 0.28 });
    const stoneDark = new THREE.MeshStandardMaterial({ color: 0x878175, map: repeatTex(stoneTexture(31), 3), roughness: 1, emissive: 0xffe2b8, emissiveMap: veins, emissiveIntensity: 0.18 });
    const fur = new THREE.MeshStandardMaterial({ color: 0x8a8070, map: furTexture(), roughness: 1 });
    // living fur (shared rules in bossKit): locks hang from their roots, trail the body, stir and whip
    const fu = this.furU = furUniforms();
    const strands = strandMaterial(fu, { color: 0xa39a8a, seed: 4, hue: 34, lum: 24, sat: 0.55 });   // dry, ash-brown, sun-bleached
    const moss = new THREE.MeshStandardMaterial({ color: 0x7d8f4c, map: mossTexture(9), roughness: 1 });
    const socket = new THREE.MeshBasicMaterial({ color: 0x15130f });
    this.mats = { stone, stoneDark, fur, strands, moss };
    const root = this.root = new THREE.Group();
    let seed = 1;
    const mesh = (geo, mat, parent, x, y, z) => {
      const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z);
      m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
    };
    const rock = (w, h, d, mat, parent, x, y, z, o = {}) =>
      mesh(chiseledBox(w, h, d, { radius: Math.min(w, h, d) * 0.28, amp: Math.min(w, h, d) * 0.05, seed: seed++, ...o }), mat, parent, x, y, z);
    const boulder = (r, mat, parent, x, y, z, sq = 1) => mesh(blob(r, 2, 0.16, seed++, sq), mat, parent, x, y, z);
    const furPatch = (w, h, d, parent, x, y, z, rx = 0, holes = []) => {
      const side = d <= h && d <= w ? -1 : 1;
      // the hide under the locks is pillowed: corners pulled in so no hard rectangle shows through the coat
      const hide = chiseledBox(w, h, d, { radius: Math.min(d, w, h) * 0.45, amp: 0.06, seed: seed++, seg: 7 });
      { const p = hide.attributes.position, flat = side < 0 ? ['x', 'y', w, h] : ['x', 'z', w, d];
        for (let i = 0; i < p.count; i++) {
          const a = (flat[0] === 'x' ? p.getX(i) : 0) / (flat[2] / 2), bRaw = flat[1] === 'y' ? p.getY(i) : p.getZ(i), b = bRaw / (flat[3] / 2);
          const ka = Math.sqrt(Math.max(0.2, 1 - 0.5 * Math.min(1, b * b))), kb = Math.sqrt(Math.max(0.2, 1 - 0.5 * Math.min(1, a * a)));
          const ax = lerp(1, ka, 0.55) * 0.97, bx = lerp(1, kb, 0.55) * 0.97;
          p.setX(i, p.getX(i) * ax); if (flat[1] === 'y') p.setY(i, bRaw * bx); else p.setZ(i, bRaw * bx);
        }
        hide.computeVertexNormals(); }
      const m = mesh(hide, fur, parent, x, y, z);
      m.rotation.x = rx;
      m.userData.climb = { half: new THREE.Vector3(w / 2, h / 2, d / 2), static: false, side };
      this.climbables.push(m);
      // shaggy layered strands so the fur reads as fur from any distance
      const cards = new THREE.Mesh(furCards(w, h, d, { side, axis: side > 0 ? 'y' : 'z', len: side > 0 ? 1.2 : 1.0, seed: seed++, holes }), strands);
      cards.receiveShadow = true; m.add(cards);
      return m;
    };

    // ---- skeleton + coat. The body itself is sculpted below as one skinned surface over these joints.
    this.hips = new THREE.Group(); this.hips.position.y = 11.2; root.add(this.hips);
    // fur faces step back gradually from shin → thigh → hips → back so the climb is continuous
    // the climb runs up the middle, under the belly of the fold: the coat leans out overhead and carries the
    // climber to the shelf's lip
    furPatch(2.6, 3.44, 1.0, this.hips, 0, -0.03, -3.4, -0.451);
    this.legs = [-1, 1].map((side) => {
      const hip = new THREE.Group(); hip.position.set(side * 2.5, -0.8, 0); this.hips.add(hip);
      furPatch(2.3, 5.4, 1.3, hip, 0, -3.0, -1.95);
      const knee = new THREE.Group(); knee.position.y = -5.4; hip.add(knee);
      // the coat on the shin lies flat and slick while the leg swings: it holds only on a foot planted hard and still
      const shin = furPatch(2.1, 4.9, 1.4, knee, 0, -2.0, -1.8);
      const foot = new THREE.Object3D(); foot.position.set(0, -5.0, 0.6); knee.add(foot);   // where the sole meets the ground
      this.feet.push(foot);
      return { hip, knee, foot, side, shin, planted: 0 };
    });
    this.torso = new THREE.Group(); this.torso.position.y = 1.5; this.hips.add(this.torso);
    this.backFur = furPatch(8.2, 9.2, 0.7, this.torso, 0, 4.4, -3.05, 0, [{ x: 0, y: 2.4, r: 1.5 }]);
    this.shoulderFur = furPatch(8.4, 0.6, 6.2, this.torso, 0, 9.4, -0.3);
    this.arms = [-1, 1].map((side) => {
      const sh = new THREE.Group(); sh.position.set(side * 5.6, 7.6, 0); this.torso.add(sh);
      const el = new THREE.Group(); el.position.y = -6.1; sh.add(el);
      furPatch(2.2, 5, 0.5, el, 0, -2.8, -1.38);
      return { sh, el, side };
    });
    this.head = new THREE.Group(); this.head.position.set(0, 9.6, 1.6); this.torso.add(this.head);
    // a broad mat of coat over the skull: room to walk about on its head
    this.crownFur = furPatch(4.6, 0.6, 4.9, this.head, 0, 3.85, 0.05, 0, [{ x: 0, y: 0.15, r: 1.25 }]);
    this.headBackFur = furPatch(4.6, 3.2, 0.5, this.head, 0, 1.9, -2.05);
    this.jaw = new THREE.Group(); this.jaw.position.set(0, 0.75, 0.2); this.head.add(this.jaw);
    // a shelf of matted fur along the top of the hips, under the back: the one place to stand and get your
    // breath between the legs and the back mark (added last so existing patch indices stay put)
    // it juts out from the foot of the back fur, so stepping inward from it lands on the back
    // where the hunched back bends, the old hide has folded into a thick roll across it — mossed over on top,
    // broad enough to stand on. Its top is level with the foot of the back fur.
    // One unbroken shelf from flank to flank: the climb up the middle comes over its lip.
    // It runs in under the foot of the back, so a rider whose grip fails anywhere on the back lands on it.
    this.beltFur = furPatch(7.8, 1.3, 2.2, this.hips, 0, 0.9, -3.5);
    this.beltFolds = [this.beltFur];
    // the coat over the haunches, below the fold: carries a climber across from the thighs to the gap
    for (const sd of [-1, 1]) furPatch(2.1, 1.2, 0.5, this.hips, sd * 2.35, -1.2, -2.85);
    // above them the coat leans out under the belly of the fold, up to the shelf's lip (the climb from either thigh)
    for (const sd of [-1, 1]) furPatch(2.1, 2.42, 0.5, this.hips, sd * 2.35, 0.505, -3.654, -0.669);

    this.sculptBody(veins);
    const eyeMat = this.eyeMat = new THREE.MeshBasicMaterial({ color: 0xffc878, transparent: true, opacity: 0.85 });
    // small eyes sunk deep behind the mask; they blink
    this.eyes = [-1, 1].map((s) => {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 8), eyeMat);
      e.position.set(s * 1.05, 2.08, 2.08); this.head.add(e); return e;
    });
    this.eyeGlow = new THREE.PointLight(0xffd9a0, 6, 9, 2); this.eyeGlow.position.set(0, 2.1, 3.4); this.head.add(this.eyeGlow);

    // sigils (weak points)
    const sigilTex = this.sigilTexture();
    const mkSigil = (parent, pos, normalRot, id) => {
      const mat = new THREE.MeshBasicMaterial({ map: sigilTex, transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xfff0d0 });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), mat);
      m.position.copy(pos); m.rotation.copy(normalRot); parent.add(m);
      const light = new THREE.PointLight(0xffe0a8, 0, 7, 2); light.position.copy(pos); parent.add(light);
      const wp = { id, mesh: m, mat, light, hits: 0, destroyed: false, flash: 0 };
      this.weakPoints.push(wp);
      return wp;
    };
    mkSigil(this.torso, new THREE.Vector3(0, 6.8, -3.46), new THREE.Euler(0, Math.PI, 0), 'back');
    mkSigil(this.head, new THREE.Vector3(0, 4.17, 0.2), new THREE.Euler(-Math.PI / 2, 0, 0), 'crown');

    // stomp shockwave
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.6, 48), new THREE.MeshBasicMaterial({ color: 0xd8ccb2, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    this.ring.rotation.x = -Math.PI / 2; this.world.scene.add(this.ring);
    const dustGeo = new THREE.BufferGeometry(); this.dustCount = 120;
    dustGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.dustCount * 3), 3));
    this.dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ map: softDotTexture(), size: 2.2, color: 0xcabfa6, transparent: true, opacity: 0, depthWrite: false }));
    this.dustVel = new Float32Array(this.dustCount * 3);
    this.world.scene.add(this.dust);
    // light-motes that burst from a struck sigil (no blood — the stone bleeds light)
    this.sparkCount = 90;
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.sparkCount * 3), 3));
    this.sparks = new THREE.Points(sg, new THREE.PointsMaterial({ map: softDotTexture(), size: 0.15, color: 0xffd08a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.sparks.frustumCulled = false;
    this.sparkVel = new Float32Array(this.sparkCount * 3); this.sparkLife = 0;
    this.world.scene.add(this.sparks);

    this.world.scene.add(root);
    this.placeAt(this.home, Math.PI);
  }

  /**
   * The Warden — "the Mourner": an old living giant, ape-shouldered and heavy-handed, grown over by its own
   * years. Thick umber hide in deep folds, a pale belly, and bone wherever the body met the world: a mask of
   * bone grown over the face, tusks, knuckle and knee calluses, spurs on the right shoulder.
   * Signature features: the bone mask with sunken eyes · the left horn broken to a stump · a great healed scar
   * from right shoulder to left hip · bone spurs through the right shoulder · the moss mantle and gold coat.
   * One skinned surface over the joints (see sculpt.js).
   */
  sculptBody(veins) {
    const S = new Sculpt(this.root), H = this.hips, T = this.torso, D = this.head, J = this.jaw;
    const HIDE = 0, DARK = 1, MOSS = 2, SOCKET = 3, BONE = 4, PALE = 5, SCAR = 6;
    // the arms hang close to the flanks: keep them separate limbs so they don't melt into the body and stretch
    // into webbing when they swing out (only the shoulder ball and the shoulder mass blend across)
    const armLimb = this.arms.map((a) => S.limb([a.sh, a.el]));
    // the coat grows out of the body: under every patch of fur the flesh swells out to meet the roots of the locks
    // (the patch's own box stays as the unseen climbing surface)
    // the fold of hide: thick in the middle, tapering round toward the flanks, flattened on top by the years
    for (const sd of [-1, 1]) {
      // flattened along the haunch and wrapping round toward the flank, the coat spilling over its rim
      for (const [x, dy, dz, r] of [[2.5, 0, 0, [1.45, 0.5, 0.95]], [3.9, -0.15, 0.7, [1.0, 0.42, 0.8]], [4.5, -0.35, 1.6, [0.6, 0.32, 0.7]]])
        S.ell(H, [sd * x, 1.0 + dy, -3.75 + dz], r, { tag: HIDE, k: 0.95, rough: 0.8 });
      S.ell(H, [sd * 2.6, 0.55, -3.0], [1.4, 0.9, 0.9], { tag: HIDE, k: 0.9, rough: 0.7 });   // the fold grows out of the haunch, not stuck on it
    }
    S.ell(H, [0, 1.0, -3.75], [1.6, 0.5, 0.95], { tag: HIDE, k: 0.95, rough: 0.8 });          // unbroken across the spine
    for (const m of this.climbables) {
      if (this.beltFolds.includes(m)) { m.material = UNSEEN; m.castShadow = false; continue; }
      const h = m.userData.climb.half;
      S.box(m.parent, m.position.toArray(), [h.x * 0.97, h.y * 0.97, h.z * 0.97], Math.min(h.x, h.y, h.z) * 0.9, { tag: 7, k: 0.7, rough: 0.25, rot: [m.rotation.x, m.rotation.y, m.rotation.z] });
      m.material = UNSEEN; m.castShadow = false;
    }
    // ---- pelvis and loins
    S.ell(H, [0, -0.2, 0], [3.2, 1.9, 2.25], { tag: DARK, k: 1.0 });
    S.ell(H, [0, 1.3, 0.1], [3.5, 1.3, 2.4], { tag: HIDE, k: 1.0 });                       // waist
    S.ell(H, [0, -0.7, 1.7], [2.2, 1.5, 1.0], { tag: PALE, k: 0.8 });                      // low belly
    for (const s of [-1, 1]) S.ell(H, [s * 1.9, -0.5, -1.2], [1.6, 1.6, 1.3], { tag: HIDE, k: 0.8 });   // haunch
    // ---- legs: short, bowed, built to carry
    for (const leg of this.legs) {
      const { hip, knee, side } = leg;
      S.ell(hip, [0, -0.2, 0], [1.65, 1.5, 1.65], { tag: DARK, k: 1.0 });
      S.cone(hip, [0, -0.6, 0], [0, -5.3, 0.1], 1.45, 1.05, { tag: HIDE, k: 0.7 });
      S.ell(hip, [side * 0.4, -2.2, 0.65], [1.2, 2.3, 1.15], { tag: HIDE, k: 0.55 });        // outer thigh
      S.ell(hip, [-side * 0.55, -2.7, 0.5], [0.85, 1.9, 0.95], { tag: HIDE, k: 0.5 });       // inner thigh
      S.ell(knee, [0, 0, 0.2], [1.2, 1.1, 1.25], { tag: DARK, k: 0.7 });
      S.ell(knee, [0, 0.15, 1.05], [0.8, 0.85, 0.5], { tag: BONE, k: 0.3, rough: 0.5 });     // knee callus
      S.cone(knee, [0, -0.2, 0.1], [0, -4.3, 0.2], 1.15, 0.85, { tag: HIDE, k: 0.6 });
      S.ell(knee, [0, -1.6, -0.5], [1.05, 1.7, 0.95], { tag: HIDE, k: 0.55 });               // calf
      S.cone(knee, [0, -0.9, 1.0], [0, -3.7, 0.85], 0.42, 0.32, { tag: PALE, k: 0.35 });     // shin
      S.ell(knee, [0, -4.5, 0.1], [1.0, 0.8, 1.0], { tag: DARK, k: 0.6 });                   // ankle
      S.ell(knee, [0, -4.95, 0.8], [1.5, 0.6, 2.2], { tag: DARK, k: 0.6 });                  // foot
      S.ell(knee, [0, -4.9, -0.9], [0.85, 0.6, 0.75], { tag: DARK, k: 0.5 });                // heel
      for (const tx of [-1, 0, 1]) {
        S.cone(knee, [tx * 0.95, -5.05, 2.3], [tx * 1.15, -5.2, 3.2], 0.55, 0.42, { tag: HIDE, k: 0.3 });           // toe
        S.cone(knee, [tx * 1.15, -5.1, 3.2], [tx * 1.22, -5.38, 3.95], 0.34, 0.13, { tag: BONE, k: 0.12, rough: 0.4 }); // claw
      }
    }
    // ---- trunk
    S.ell(T, [0, 5.3, 0], [4.3, 3.6, 2.8], { tag: HIDE, k: 1.2 });                          // ribcage
    S.ell(T, [0, 2.0, 0.3], [3.2, 2.5, 2.2], { tag: PALE, k: 1.2 });                         // belly
    for (const s of [-1, 1]) {
      S.ell(T, [s * 1.9, 6.2, 2.0], [2.0, 1.45, 1.0], { tag: HIDE, k: 0.45 });               // breast
      for (const y of [1.3, 2.6, 3.9]) S.ell(T, [s * 0.9, y, 2.3], [0.8, 0.58, 0.42], { tag: PALE, k: 0.3 });        // belly segments
      for (let i = 0; i < 4; i++) S.ell(T, [s * 3.35, 3.0 + i * 0.95, 1.25 - i * 0.12], [0.95, 0.32, 0.75], { tag: HIDE, k: 0.28, rot: [0, 0, s * 0.5] }); // ribs under the hide
      S.ell(T, [s * 3.6, 5.0, -1.0], [1.3, 3.0, 1.6], { tag: HIDE, k: 0.8 });                // flank
      S.cone(T, [s * 0.7, 7.65, 2.3], [s * 4.2, 8.3, 1.9], 0.42, 0.36, { tag: HIDE, k: 0.35 });   // collarbone
      S.ell(T, [s * 5.4, 8.6, 0.2], [2.5, 1.7, 2.7], { tag: HIDE, k: 0.9, join: armLimb[s > 0 ? 1 : 0] });   // shoulder
      S.ell(T, [s * 5.5, 9.8, 0.1], [1.9, 0.5, 2.0], { tag: MOSS, k: 0.5, rough: 1.4, join: armLimb[s > 0 ? 1 : 0] });   // moss mantle
    }
    S.ell(T, [0, 8.2, -0.15], [4.9, 1.25, 2.85], { tag: DARK, k: 1.0 });                     // yoke of muscle under the shoulder coat
    S.cone(T, [0, 8.4, 0.6], [0, 9.6, 1.5], 1.9, 1.6, { tag: DARK, k: 0.8 });                // neck
    // the scar: a raised welt of pale tissue with a trench down its middle
    S.cone(T, [2.9, 7.3, 2.45], [-2.1, 2.5, 2.3], 0.55, 0.48, { tag: SCAR, k: 0.4, rough: 0.4 });
    S.cone(T, [3.0, 7.45, 3.02], [-2.2, 2.4, 2.8], 0.26, 0.22, { tag: SCAR, k: 0.2, sub: true });
    // bone spurs broken through the right shoulder
    for (const [a0, b0, r] of [[[6.2, 9.5, -0.9], [7.6, 11.9, -1.7], 0.6], [[6.6, 9.3, 0.5], [8.2, 10.8, 0.9], 0.5], [[5.4, 9.7, -1.9], [5.9, 11.2, -3.0], 0.45]])
      S.cone(T, a0, b0, r, 0.14, { tag: BONE, k: 0.3, rough: 0.5 });
    // ---- arms: longer and heavier than the legs; hands that could close round a tower
    for (const arm of this.arms) {
      const { sh, el, side } = arm;
      S.ell(sh, [0, -0.5, 0], [1.65, 1.9, 1.65], { tag: HIDE, k: 0.9, join: 0 });             // shoulder ball: grows out of the body
      S.cone(sh, [0, -0.6, 0], [0, -5.9, 0], 1.3, 1.0, { tag: HIDE, k: 0.6 });
      S.ell(sh, [0, -2.8, 0.6], [1.0, 1.9, 0.95], { tag: HIDE, k: 0.5 });                    // biceps
      S.ell(sh, [0, -3.2, -0.6], [0.95, 2.0, 0.9], { tag: HIDE, k: 0.5 });                   // triceps
      S.ell(el, [0, 0, 0], [1.1, 1.05, 1.1], { tag: DARK, k: 0.6 });
      S.cone(el, [0, 0.3, -0.9], [0, 1.25, -1.75], 0.5, 0.16, { tag: BONE, k: 0.22, rough: 0.5 });   // elbow spur
      S.cone(el, [0, -0.3, 0], [0, -4.9, 0], 1.1, 1.35, { tag: HIDE, k: 0.6 });              // forearm, thickest at the wrist
      S.ell(el, [side * 0.35, -1.8, 0.5], [0.9, 1.6, 0.9], { tag: HIDE, k: 0.45 });
      S.ell(el, [0, -6.05, 0], [1.3, 1.05, 1.45], { tag: DARK, k: 0.6 });                    // hand
      S.ell(el, [side * -0.55, -6.1, 0], [0.6, 0.85, 1.2], { tag: PALE, k: 0.4 });           // palm
      for (let f = 0; f < 4; f++) {
        const fz = -0.95 + f * 0.63;
        S.ell(el, [side * 0.95, -6.75, fz], [0.34, 0.3, 0.32], { tag: BONE, k: 0.14, rough: 0.5 });   // knuckle callus
        S.cone(el, [side * 0.75, -6.7, fz], [side * 1.15, -7.75, fz], 0.36, 0.31, { tag: HIDE, k: 0.22 });
        S.cone(el, [side * 1.15, -7.75, fz], [side * 0.6, -8.55, fz], 0.31, 0.24, { tag: DARK, k: 0.18 });
      }
      S.cone(el, [side * -0.4, -6.4, 0.9], [side * -0.6, -7.5, 1.65], 0.42, 0.33, { tag: HIDE, k: 0.25 }); // thumb
    }
    // ---- head: hide behind, bone in front
    S.cone(D, [0, -0.3, -0.4], [0, 1.0, 0.2], 1.5, 1.4, { tag: DARK, k: 0.8 });
    S.ell(D, [0, 1.95, 0.1], [2.0, 1.75, 2.1], { tag: HIDE, k: 0.8 });                       // cranium
    S.ell(D, [0, 2.05, 1.5], [1.75, 1.5, 1.1], { tag: BONE, k: 0.4, rough: 0.45 });          // the mask
    S.cone(D, [-1.9, 2.8, 2.1], [1.9, 2.8, 2.1], 0.5, 0.5, { tag: BONE, k: 0.4, rough: 0.45 });   // brow
    S.ell(D, [0, 1.4, 2.5], [0.55, 0.95, 0.45], { tag: BONE, k: 0.35, rough: 0.45 });        // nasal ridge
    S.ell(D, [0, 0.8, 1.9], [1.35, 0.48, 1.2], { tag: BONE, k: 0.4, rough: 0.45 });          // upper jaw
    for (const s of [-1, 1]) {
      S.ell(D, [s * 1.6, 1.35, 1.55], [0.5, 0.95, 0.85], { tag: BONE, k: 0.35, rough: 0.45 });    // cheek flange
      S.ell(D, [s * 1.05, 2.1, 2.5], [0.56, 0.4, 0.6], { tag: SOCKET, k: 0.25, sub: true });      // eye socket
      S.ell(D, [s * 0.24, 1.05, 2.92], [0.13, 0.3, 0.25], { tag: SOCKET, k: 0.1, sub: true });    // nasal slit
    }
    // horns: the right one whole, swept back; the left broken short
    { const pts = [[0, 0, 0], [1.1, 0.6, -0.3], [1.8, 1.6, -1.2], [1.7, 2.7, -2.4]].map(([x, y, z]) => [1.9 + x, 3.0 + y, 0.2 + z]), rs = [0.62, 0.5, 0.36, 0.14];
      for (let i = 0; i < 3; i++) S.cone(D, pts[i], pts[i + 1], rs[i], rs[i + 1], { tag: BONE, k: i ? 0.15 : 0.5, rough: 0.5 });
      S.cone(D, [-1.9, 3.0, 0.2], [-2.75, 3.5, -0.05], 0.62, 0.52, { tag: BONE, k: 0.5, rough: 0.5 });
      S.ell(D, [-3.0, 3.75, -0.2], [0.42, 0.5, 0.4], { tag: BONE, k: 0.1, rough: 2.4 });     // the jagged break
      S.ell(D, [-3.15, 3.7, -0.1], [0.3, 0.26, 0.3], { tag: SOCKET, k: 0.1, sub: true });    // marrow hollow
    }
    // ---- jaw (its own joint): a heavy mandible with two tusks
    S.ell(J, [0, -0.45, 1.15], [1.4, 0.55, 1.5], { tag: DARK, k: 0.45 });
    S.ell(J, [0, -0.85, 2.2], [0.9, 0.45, 0.6], { tag: HIDE, k: 0.4 });                      // chin
    for (const s of [-1, 1]) {
      S.cone(J, [s * 1.0, -0.25, 2.25], [s * 1.28, 0.85, 2.72], 0.34, 0.25, { tag: BONE, k: 0.14, rough: 0.4 });
      S.cone(J, [s * 1.28, 0.85, 2.72], [s * 1.16, 1.65, 2.86], 0.25, 0.1, { tag: BONE, k: 0.1, rough: 0.4 });
    }
    // old weathered stone: broad worn slabs, hairline seams, muted grey-brown — age, not scales
    const mat = sculptMaterial({ grain: hideTexture('weathered', 23), veins, scale: 0.21, bump: 0.55, emissive: 0xffd9a0, emissiveIntensity: GLOW, roughness: 0.95, grainAmt: 0.55 });
    const pal = [0x837b6e, 0x5c564c, 0x5f6a4a, 0x0c0b0a, 0xa29a88, 0x8f877a, 0x968c7e, 0x6a6254].map((h) => new THREE.Color(h));
    const dust = new THREE.Color(0x938b7a), dark = new THREE.Color(0x4a453e);
    const paint = (c, x, y, z, nY, tw) => {
      const skin = tw[HIDE] + tw[DARK] + tw[PALE];
      // old skin is never one colour: liver-dark blotches, and the dust of the basin up to the knees
      const blotch = pnoise(x * 0.22 + 3, y * 0.22, z * 0.22) * 0.5 + pnoise(x * 0.7, y * 0.7 + 9, z * 0.7) * 0.25;
      if (blotch > 0.08) c.lerp(dark, Math.min(0.35, (blotch - 0.08) * 1.2) * skin);
      c.lerp(dust, Math.max(0, 1 - y / 6) * 0.45 * skin);
    };
    this.skin = S.build({ voxel: 0.22, detail: { freq: 0.5, amp: 0.06, crack: 0.14 }, palette: pal, stain: 0.3, paint, moss: { color: new THREE.Color(0x5f6a48), amount: 0.45 }, material: mat });
    this.sculptStats = S.stats;
    this.mats.stone = mat; this.mats.stoneDark = { emissiveIntensity: 0 };
    // blunt lower teeth between the tusks (too fine for the sculpt grid)
    const tooth = new THREE.MeshStandardMaterial({ color: 0xd9cfb2, roughness: 0.6 });
    for (let i = 0; i < 6; i++) {
      const tx = (i - 2.5) * 0.3, m = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.42 + (i % 2) * 0.1, 5), tooth);
      m.position.set(tx, 0.18, 2.55 - Math.abs(tx) * 0.25); m.castShadow = true; J.add(m);
    }
  }

  sigilTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
    x.strokeStyle = 'rgba(255,240,210,0.95)'; x.lineWidth = 3; x.lineCap = 'round';
    x.beginPath(); x.arc(64, 64, 44, 0, Math.PI * 2); x.stroke();
    x.lineWidth = 2; x.beginPath(); x.arc(64, 64, 30, 0.4, Math.PI * 2 - 0.4); x.stroke();
    x.beginPath(); x.moveTo(64, 26); x.lineTo(64, 102); x.moveTo(40, 52); x.lineTo(88, 52); x.moveTo(46, 80); x.lineTo(82, 80); x.stroke();
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, 'rgba(255,230,190,0.5)'); g.addColorStop(1, 'rgba(255,230,190,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }

  placeAt(pos, yaw) {
    this.root.position.set(pos.x, this.world.heightAt(pos.x, pos.z), pos.z);
    this.yaw = yaw; this.root.rotation.y = yaw;
    this.root.updateMatrixWorld(true);
  }

  reset(mode) {
    this.state = mode; this.timer = 0; this.dyingT = 0; this.flinch = 0; this.shakeIntensity = 0; this.climbTimer = 0;
    this.loosened = false; this.fallen = false; this.slammed = false; this.walkAmt = 0; this.stagger = 0; this.hurt = 0; this.armSpread = 0;
    for (const leg of this.legs) { leg.hip.rotation.set(0, 0, 0); leg.knee.rotation.set(0, 0, 0); }
    for (const arm of this.arms) { arm.sh.rotation.set(0, 0, 0); arm.el.rotation.set(0, 0, 0); }
    this.torso.rotation.set(0.12, 0, 0); this.head.rotation.set(0, 0, 0);
    this.root.visible = true; this.root.rotation.set(0, 0, 0); this.hips.rotation.set(0, 0, 0); this.hips.position.y = 11.2;
    // the crown stays sealed until the back mark breaks
    for (const wp of this.weakPoints) { wp.hits = 0; wp.destroyed = false; wp.flash = 0; wp.sealed = wp.id === 'crown'; }
    this.rubPhase = null; this.sealedSaid = false; this.grindHits = 0; this.mountSaid = false;
    for (const leg of this.legs) leg.planted = 0;
    this.world.basinWall?.restore();
    for (const c of this.climbables) c.userData.climb.disabled = false;
    this.eyeMat.opacity = 0.85; this.eyeGlow.intensity = 6; this.mats.stone.emissiveIntensity = GLOW; this.mats.stoneDark.emissiveIntensity = 0.18;
    this.placeAt(this.home, 0);
    this.awakened = false;
  }

  /** Lie where it fell: the collapsed pose, cold and unclimbable (chapters after its defeat). */
  setDefeated() {
    this.reset('dying');
    this.awakened = true;
    this.loosened = this.fallen = true;                       // no thud, no shockwave: it fell long ago
    this.world.basinWall?.setFallen();
    for (let i = 0; i < 11; i++) this.updateDying(0.99);      // stops short of t=11, which would announce a victory
    this.state = 'dead'; this.shakeIntensity = 0;
    for (const c of this.climbables) c.userData.climb.disabled = true;
    for (const wp of this.weakPoints) { wp.destroyed = true; wp.hits = 3; wp.mat.opacity = 0; wp.light.intensity = 0; }
    this.root.updateMatrixWorld(true);
  }

  get alive() { return this.state !== 'dead' && this.state !== 'dying'; }
  get defeated() { return this.state === 'dead' || this.state === 'dying'; }

  weakPointNear(p, r) {
    for (const wp of this.weakPoints) {
      if (wp.destroyed || wp.sealed) continue;
      wp.mesh.getWorldPosition(tmp);
      if (tmp.distanceTo(p) < r) return wp;
    }
    return null;
  }

  /** power 1 = quick stab, 2 = fully charged stab. */
  strike(wp, power = 1) {
    if (wp.destroyed || !this.alive) return;
    wp.hits = Math.min(3, wp.hits + power); wp.flash = 1 + power * 0.5;
    this.snd(power > 1 ? 'strikeHeavy' : 'strike');
    this.bus.emit('colossus:struck', { id: wp.id, hits: wp.hits, power });
    // the reaction grows with each wound: a flinch, then a thrash that demands a grip, then the break
    this.flinch = wp.hits >= 2 ? 1.5 : 0.9 + power * 0.3; this.flinchAmt = wp.hits >= 2 ? 0.75 : 0.25;
    if (wp.hits === 2) { this.snd('colossusGroan', { vol: 1.3 }); this.stagger = 1; }
    this.burstSparks(wp, power);
    if (wp.hits === 1) setTimeout(() => this.snd('colossusGroan', { vol: 1.2 }), 300);
    if (wp.hits >= 3) {
      wp.destroyed = true;
      this.snd('sigil');
      const remaining = this.weakPoints.filter((w) => !w.destroyed).length;
      if (remaining > 0 && wp.id === 'back') {
        // the back mark broken: the crown wakes, and it goes to scrape its tormentor off against the old wall
        const crown = this.weakPoints.find((w) => w.id === 'crown'); crown.sealed = false; crown.flash = 2;
        if (this.world.basinWall && !this.world.basinWall.fallen) { this.state = 'rub'; this.rubPhase = 'walk'; this.timer = 0; }
        setTimeout(() => this.snd('colossusGroan', { vol: 1.5 }), 500);
      }
      this.bus.emit('colossus:sigilBroken', { id: wp.id, remaining });
      if (this.weakPoints.every((w) => w.destroyed)) this.beginDying();
    }
  }

  burstSparks(wp, power) {
    const c = new THREE.Vector3(), n = new THREE.Vector3(0, 0, 1);
    wp.mesh.getWorldPosition(c); n.applyQuaternion(wp.mesh.getWorldQuaternion(new THREE.Quaternion()));
    const pos = this.sparks.geometry.attributes.position, v = this.sparkVel, sp = 4 + power * 3;
    for (let i = 0; i < this.sparkCount; i++) {
      pos.setXYZ(i, c.x + (Math.random() - 0.5) * 0.4, c.y + (Math.random() - 0.5) * 0.4, c.z + (Math.random() - 0.5) * 0.4);
      const r = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(1.4).add(n).normalize().multiplyScalar(sp * (0.4 + Math.random()));
      v[i * 3] = r.x; v[i * 3 + 1] = r.y + 1.5; v[i * 3 + 2] = r.z;
    }
    pos.needsUpdate = true;
    this.sparkLife = 1; this.sparks.material.size = 0.12 + power * 0.05;
  }
  updateSparks(dt) {
    if (this.sparkLife <= 0) return;
    this.sparkLife = Math.max(0, this.sparkLife - dt * 1.1);
    const pos = this.sparks.geometry.attributes.position, v = this.sparkVel, drag = Math.exp(-dt * 2.2);
    for (let i = 0; i < this.sparkCount; i++) {
      v[i * 3] *= drag; v[i * 3 + 1] = v[i * 3 + 1] * drag - 3.5 * dt; v[i * 3 + 2] *= drag;
      pos.setXYZ(i, pos.getX(i) + v[i * 3] * dt, pos.getY(i) + v[i * 3 + 1] * dt, pos.getZ(i) + v[i * 3 + 2] * dt);
    }
    pos.needsUpdate = true;
    this.sparks.material.opacity = Math.pow(this.sparkLife, 1.5);
  }

  beginDying() {
    this.state = 'dying'; this.dyingT = 0;
    this.snd('colossusGroan', { vol: 1.5 });
    this.bus.emit('colossus:dying');
  }

  /** Keep the player out of the feet and shins. */
  pushOut(p, r) {
    for (const leg of this.legs) {
      leg.foot.getWorldPosition(tmp);
      if (p.y > tmp.y + 6) continue;
      const dx = p.x - tmp.x, dz = p.z - tmp.z, d = Math.hypot(dx, dz), min = 2.0 + r;
      if (d < min && d > 0.0001) { p.x = tmp.x + dx / d * min; p.z = tmp.z + dz / d * min; }
    }
  }

  focusPoint(out) { return this.hips.getWorldPosition(out); }

  /** Its sounds come from where it stands: far off they are a distant thud, underfoot they fill the ears. */
  snd(name, opts = {}) { this.hips.getWorldPosition(sndP); this.audio.play(name, { pos: sndP, ...opts }); }

  // ---------------------------------------------------------------- update
  update(dt, t, player, active) {
    const pl = player;
    const climbing = active && pl.onColossus;
    this.updateSparks(dt);
    // the head follows whoever it is hunting; it cannot see a climber on its own back
    let wantYaw = 0, wantPitch = 0;
    if (active && this.awakened && this.alive && !climbing) {
      this.head.getWorldPosition(tmp);
      const dx = pl.pos.x - tmp.x, dz = pl.pos.z - tmp.z, dy = pl.pos.y + 1 - tmp.y, hd = Math.hypot(dx, dz);
      let a = Math.atan2(dx, dz) - this.yaw; a = Math.atan2(Math.sin(a), Math.cos(a));
      wantYaw = clamp(a, -0.85, 0.85); wantPitch = clamp(-Math.atan2(dy, hd + 6) * 0.8, -0.2, 0.6);
    }
    this.lookYaw = damp(this.lookYaw, wantYaw, 1.4, dt); this.lookPitch = damp(this.lookPitch, wantPitch, 1.4, dt);
    let walkTarget = 0;

    // eyes & sigils
    for (const wp of this.weakPoints) {
      wp.flash = Math.max(0, wp.flash - dt * 1.5);
      let near = 0;
      if (active && !wp.destroyed) { wp.mesh.getWorldPosition(tmp); near = 1 - smoothstep(4, 22, tmp.distanceTo(pl.pos)); }
      const off = wp.destroyed || wp.sealed;
      const base = off ? 0.0 : 0.12 + near * 0.45 + Math.sin(t * 1.4 + wp.hits) * 0.05;
      wp.mat.opacity = damp(wp.mat.opacity, Math.min(1, base + wp.flash), 4, dt);
      wp.light.intensity = (off ? 0 : near * 6) + wp.flash * 10;
      // a climber who reaches the sealed crown is told why it will not take the blade
      if (wp.sealed && climbing && !this.sealedSaid && near > 0.85) { this.sealedSaid = true; this.bus.emit('warden:sealed'); }
    }

    // the way on: the shin coat can be taken any time it is in reach, but a swinging leg flings whoever hangs on it
    // (slow to climb, the arms burn, hands tear loose when tired). A foot stamped and stuck is the still moment.
    if (this.state !== 'dead' && !this.loosened) {
      for (const leg of this.legs) {
        leg.planted = Math.max(0, leg.planted - dt);
        leg.shin.getWorldPosition(tmp);
        const c = leg.shin.userData.climb, prev = leg.shinPrev || (leg.shinPrev = tmp.clone());
        const v = dt > 0 ? tmp.distanceTo(prev) / dt : 0; prev.copy(tmp);
        c.sway = leg.planted > 0 ? 0 : damp(c.sway || 0, clamp((v - 0.4) / 2.2, 0, 0.85), 6, dt);
      }
    }
    if (climbing && !this.mountSaid) { this.mountSaid = true; this.bus.emit('warden:mounted'); }

    switch (this.state) {
      case 'dormant': {
        // breathing in place (menu backdrop / before the encounter)
        this.idleSway(t, 1);
        if (active && pl.pos.distanceTo(this.root.position) < 85 && pl.pos.z < -12) this.awaken();
        break;
      }
      case 'hunt': {
        const toP = tmp.copy(pl.pos).sub(this.root.position); toP.y = 0;
        const dist = toP.length();
        if (climbing) { this.state = 'carry'; this.timer = 0; this.climbTimer = 5 + Math.random() * 3; break; }
        const want = Math.atan2(toP.x, toP.z);
        this.turnToward(want, 0.55, dt);
        let facing = Math.cos(want - this.yaw);
        if (dist > 10) walkTarget = facing > 0.6 ? 1 : 0.25;
        this.timer -= dt;
        if (dist < 13 && pl.state === 'ground' && this.timer <= 0) this.beginStomp();
        break;
      }
      case 'stomp': this.updateStomp(dt, pl); break;
      case 'carry': {
        // the player is on the colossus: wander, and periodically try to shake them off
        if (!climbing) { this.state = 'hunt'; this.timer = 2.5; break; }
        this.climbTimer -= dt;
        const toHome = tmp.copy(this.home).sub(this.root.position); toHome.y = 0;
        if (toHome.length() > 30) { this.turnToward(Math.atan2(toHome.x, toHome.z), 0.2, dt); walkTarget = 0.6; }
        else walkTarget = 0.35;
        if (this.climbTimer <= 0) { this.state = 'shakeWarn'; this.timer = 1.3; this.snd('colossusGroan'); this.bus.emit('colossus:shakeWarn'); }
        break;
      }
      case 'shakeWarn':
        this.timer -= dt;
        this.shakeIntensity = damp(this.shakeIntensity, 0.25, 3, dt);
        if (this.timer <= 0) { this.state = 'shaking'; this.timer = 2.4; this.snd('shake'); this.bus.emit('colossus:shake'); }
        break;
      case 'shaking':
        this.timer -= dt;
        this.shakeIntensity = damp(this.shakeIntensity, 1, 6, dt);
        if (this.timer <= 0) { this.state = climbing ? 'carry' : 'hunt'; this.climbTimer = 7 + Math.random() * 4; this.timer = 3; }
        break;
      case 'rub': walkTarget = this.updateRub(dt, pl, climbing); break;
      case 'dying': this.updateDying(dt); break;
      case 'dead': break;
    }

    if (this.state !== 'shakeWarn' && this.state !== 'shaking') this.shakeIntensity = damp(this.shakeIntensity, this.flinch > 0 ? this.flinchAmt || 0.25 : 0, 6, dt);
    this.flinch = Math.max(0, this.flinch - dt);

    // walk cycle
    this.walkAmt = damp(this.walkAmt, walkTarget, 1.5, dt);
    if (this.state !== 'stomp' && this.state !== 'dying' && this.state !== 'dead') this.animateWalk(dt, t);
    if (this.rubPhase !== 'back' && this.rubPhase !== 'grind') this.keepOffWall();

    // shake wobble on top of everything
    // the trunk counter-sways against the stride; a thrash is slow and huge, not a buzz
    const s = this.shakeIntensity, w = this.walkAmt, sw = Math.sin(this.phase), cw = Math.cos(this.phase);
    this.torso.rotation.z = cw * 0.03 * w + (Math.sin(t * 7.1) * 0.12 + Math.sin(t * 12.3) * 0.035) * s;
    this.torso.rotation.y = -sw * 0.075 * w + (Math.sin(t * 5.2) * 0.2 + Math.sin(t * 9.1) * 0.05) * s;
    this.hips.rotation.z = sw * 0.028 * w + Math.sin(t * 6.3) * 0.05 * s;
    if (this.state !== 'dead' && this.state !== 'dying') {
      // it is never silent: a breath every eleven seconds, and its joints complain whenever the mass turns
      const bp = Math.floor(t * 0.55 / (Math.PI * 2) + 0.75);
      if (bp !== this.breathN) { this.breathN = bp; this.head.getWorldPosition(tmp); this.audio.play('giantBreath', { pos: tmp, ref: 28 }); }
      this.creakT = (this.creakT ?? 1) - dt;
      if (this.creakT <= 0 && (Math.abs(this.turning || 0) > 0.2 || s > 0.3)) { this.creakT = 1.6 + Math.random() * 1.8; this.snd('giantCreak', { vol: 0.8 + s }); }
    }
    this.turning = 0;
    if (this.state !== 'dead') {
      const br = Math.sin(t * 0.55), live = this.state === 'dying' ? 0.3 : 1;
      this.torso.scale.set(1 + br * 0.012 * live, 1, 1 + br * 0.028 * live);                 // the ribs fill and empty
      // the jaw hangs a little on each breath out, gapes when it thrashes or is hurt
      // its own habit: now and then, when nothing troubles it, it lifts its face to the sky and lows
      this.mournT = (this.mournT ?? 11) - dt;
      const calm = s < 0.05 && this.awakened && (this.state === 'hunt' || this.state === 'walk' || this.state === 'turn');
      if (this.mournT < 0 && !this.mourning && calm) { this.mourning = true; this.snd('colossusGroan', { vol: 0.5 }); }
      if (this.mournT < -3.2 || (this.mourning && !calm)) { this.mourning = false; this.mournT = 16 + Math.sin(t * 3.7) * 5; }
      this.mourn = damp(this.mourn || 0, this.mourning ? Math.sin(Math.PI * Math.min(1, -this.mournT / 3.2)) : 0, 4, dt);
      const gape = 0.05 + Math.max(0, -br) * 0.05 + Math.min(1, s * 1.2) * 0.42 + (this.flinch > 0 ? 0.3 : 0) + this.mourn * 0.4;
      this.jaw.rotation.x = damp(this.jaw.rotation.x, gape, 7, dt);
      const blink = (t * 0.23 + Math.sin(t * 0.07) * 0.5) % 1 < 0.035 ? 0.12 : 1;
      for (const e of this.eyes) e.scale.y = damp(e.scale.y, blink, 30, dt);
    }
    if (this.state !== 'dying' && this.state !== 'dead') {
      // hurt: it arches away from the blade, throws its head back, and a hand gropes for the wound
      const hurt = this.hurt = damp(this.hurt || 0, this.flinch > 0 && this.state !== 'rub' ? (this.flinchAmt > 0.5 ? 1 : 0.55) : 0, 5, dt);
      const turn = this.turnS = damp(this.turnS || 0, this.turnNow || 0, 3, dt); this.turnNow = 0;
      this.armS = damp(this.armS || 0, this.state === 'stomp' ? this.armSpread || 0 : 0, 6, dt);
      // stagger: a knee gives, the whole mass drops and is caught
      if (this.stagger > 0) {
        const was = this.stagger; this.stagger = Math.max(0, this.stagger - dt / 1.7);
        if (was === 1) this.snd('giantCreak', { vol: 1.4 });
        if (was > 0.5 && this.stagger <= 0.5) { this.legs[0].foot.getWorldPosition(tmp2); this.audio.play('giantStep', { vol: 1.2, pos: tmp2 }); this.bus.emit('colossus:footfall', { pos: tmp2.clone(), strength: 1.3 }); }
        const k = Math.sin(Math.PI * (1 - this.stagger));
        this.hips.position.y -= 1.2 * k; this.hips.rotation.x = 0.07 * k;
        this.legs[0].knee.rotation.x += 0.55 * k; this.legs[0].hip.rotation.x -= 0.3 * k; this.legs[1].knee.rotation.x += 0.2 * k;
        this.torso.rotation.x += 0.16 * k;
      } else if (this.state !== 'stomp') this.hips.rotation.x = 0;
      this.torso.rotation.x += -0.15 * hurt;
      this.torso.rotation.y += turn * 0.1;                                                   // the shoulders lead a turn
      this.hips.rotation.z += turn * 0.03;
      this.torso.rotation.x += Math.sin(t * 6.1 + 1) * 0.07 * s;
      this.head.rotation.y = this.lookYaw + Math.sin(t * 0.21) * 0.12 * (1 - Math.abs(this.lookYaw)) + Math.sin(t * 8.3) * 0.12 * s + turn * 0.18;
      this.head.rotation.x = this.lookPitch + cw * cw * 0.03 * w + Math.sin(t * 7.7) * 0.08 * s - (this.mourn || 0) * 0.3 - hurt * 0.3;
      for (const arm of this.arms) {
        arm.sh.rotation.z = arm.side * (0.05 + 0.03 * Math.sin(t * 0.5) + this.armS * 0.42) + Math.sin(t * 6.6 + arm.side) * 0.14 * s;
        if (arm.side > 0 && this.state !== 'stomp') { arm.sh.rotation.x += 0.55 * hurt; arm.el.rotation.x -= 0.85 * hurt; }     // the right hand goes for the wound
      }
    }

    this.root.updateMatrixWorld(true);
    this.updateFur(dt, t);
    this.updateFx(dt);
  }

  /** Fur trails the torso on a loose spring, so it swings through when the giant stops or turns. */
  updateFur(dt, t) {
    const u = this.furU; u.uTime.value = t; u.uShake.value = this.shakeIntensity;
    const gust = 0.6 + 0.4 * Math.sin(t * 0.43) * Math.sin(t * 0.17 + 1);
    u.uWind.value.set(0.8 * gust, 0, 0.6 * gust);
    this.torso.getWorldPosition(tmp);
    if (!this.furInit || tmp.distanceToSquared(this.furPrev) > 25) { this.furLag.copy(tmp); this.furVel.set(0, 0, 0); this.furInit = true; }
    this.furPrev.copy(tmp);
    const h = Math.min(dt, 0.033), om = 5.5;
    this.furVel.addScaledVector(tmp2.copy(tmp).sub(this.furLag), om * om * h).multiplyScalar(Math.exp(-3.2 * h));
    this.furLag.addScaledVector(this.furVel, h);
    u.uLag.value.copy(this.furLag).sub(tmp).clampLength(0, 0.9);
  }

  /**
   * Phase 2 set piece: walk to the old wall, turn its back to it, back up, and grind. Whoever still clings
   * to its back is crushed and scraped off; the shoulders are out of reach of the stones. The wall comes down.
   * Returns the walk amount for the stride.
   */
  updateRub(dt, pl, climbing) {
    const W = this.world.basinWall;
    if (!W || W.fallen || W.falling) { this.rubPhase = null; this.state = climbing ? 'carry' : 'hunt'; this.timer = 2; this.climbTimer = 6; return 0; }
    this.timer += dt;
    const n = W.normal, p = this.root.position;
    const off = (p.x - W.pos.x) * n.x + (p.z - W.pos.z) * n.z;
    const away = Math.atan2(n.x, n.z);
    switch (this.rubPhase) {
      case 'walk': {
        const gx = W.pos.x + n.x * 11 - p.x, gz = W.pos.z + n.z * 11 - p.z, d = Math.hypot(gx, gz), want = Math.atan2(gx, gz);
        this.turnToward(want, 0.5, dt);
        if (d < 2.5 || this.timer > 20) { this.rubPhase = 'turn'; this.timer = 0; return 0; }
        return Math.cos(want - this.yaw) > 0.5 ? 0.9 : 0.3;
      }
      case 'turn':
        this.turnToward(away, 0.55, dt);
        if (Math.abs(Math.atan2(Math.sin(away - this.yaw), Math.cos(away - this.yaw))) < 0.08 || this.timer > 6) {
          this.rubPhase = 'back'; this.timer = 0; this.snd('colossusGroan', { vol: 1.3 }); this.bus.emit('warden:rub');
        }
        return 0.15;
      case 'back':
        // heavy steps backwards until its shoulders meet the stones
        p.x -= Math.sin(this.yaw) * 1.9 * dt; p.z -= Math.cos(this.yaw) * 1.9 * dt;
        if (off < 5.4 || this.timer > 9) { this.rubPhase = 'grind'; this.timer = 0; this.grindHits = 0; this.grindT = 0.6; this.snd('rumble'); }
        return 0.2;
      case 'grind': {
        this.flinch = 0.2; this.flinchAmt = 0.6;
        this.grindT -= dt;
        if (this.grindT <= 0) {
          this.grindT = 1.0;
          this.snd('rockHit'); this.bus.emit('camera:shake', { amount: 0.35 });
          this.bus.emit('colossus:footfall', { pos: W.pos.clone(), strength: 1.2 });
          // only the back is against the wall: a rider anywhere on the back fur is crushed between
          if (climbing && pl.att?.obj === this.backFur) {
            // first scrape hurts, the second tears the rider loose
            if (++this.grindHits === 1) pl.damage(10, 'crushed');
            else if (pl.state === 'climb') pl.throwOff(n.clone());
          }
        }
        if (this.timer > 4.6) {
          W.topple();
          this.snd('rumble'); this.snd('impact', { vol: 1.4 }); this.snd('colossusGroan', { vol: 1.2 });
          this.bus.emit('warden:wallDown'); this.stagger = 1;
          this.rubPhase = null; this.state = climbing ? 'carry' : 'hunt'; this.timer = 3; this.climbTimer = 6 + Math.random() * 3;
        }
        return 0;
      }
    }
    return 0;
  }

  /** The giant cannot walk through the old wall: it is pushed back out to the nearer face. */
  keepOffWall() {
    const W = this.world.basinWall;
    if (!W || W.fallen) return;
    const n = W.normal, p = this.root.position, rx = p.x - W.pos.x, rz = p.z - W.pos.z;
    const off = rx * n.x + rz * n.z, lat = rx * n.z - rz * n.x;
    if (Math.abs(lat) > 11 || off > 5.4 || off < -6) return;
    const to = off > -0.7 ? 5.4 : -6;
    p.x += n.x * (to - off); p.z += n.z * (to - off);
  }

  awaken() {
    if (this.awakened) return;
    this.awakened = true;
    this.state = 'hunt'; this.timer = 4;
    this.snd('colossusGroan', { vol: 1.4 });
    this.bus.emit('colossus:awaken');
  }

  idleSway(t, amt) {
    this.hips.position.y = 11.2 + Math.sin(t * 0.5) * 0.08 * amt;
    this.torso.rotation.x = 0.12 + Math.sin(t * 0.5) * 0.02 * amt;
  }

  turnToward(want, rate, dt) {
    let d = want - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += clamp(d, -rate * dt, rate * dt);
    this.turning = Math.abs(d) > 0.05 ? clamp(d, -1, 1) : 0; this.turnNow = this.turning;
    this.root.rotation.y = this.yaw;
  }

  animateWalk(dt, t) {
    const w = this.walkAmt;
    const prev = this.phase;
    this.phase += dt * 1.15 * (0.3 + w);
    const s = Math.sin(this.phase);
    // footfalls at zero crossings
    if (w > 0.15 && Math.sign(Math.sin(prev)) !== Math.sign(s)) this.footfall(s > 0 ? 0 : 1, w);
    const c = Math.cos(this.phase);
    for (const leg of this.legs) {
      const ph = s * leg.side, air = Math.max(0, -c * leg.side);
      leg.hip.rotation.x = ph * 0.32 * w - air * air * 0.1 * w;          // the swinging leg is hauled up and through
      leg.knee.rotation.x = air * 0.55 * w + (1 - air) * 0.07 * w;        // the planted knee gives under the load
    }
    // heavy arms: the forearm trails the shoulder's swing
    for (const arm of this.arms) { arm.sh.rotation.x = -Math.sin(this.phase) * arm.side * 0.2 * w; arm.el.rotation.x = -0.22 - Math.max(0, -Math.sin(this.phase - 0.7) * arm.side) * 0.22 * w; }
    // the weight rolls across onto the planted leg; the body sinks into each step; slow breathing under it all
    const breath = Math.sin(t * 0.55);
    this.hips.position.y = 11.2 - Math.abs(c) * 0.35 * w - Math.pow(Math.abs(s), 6) * 0.12 * w + breath * 0.06;
    this.hips.position.x = -c * 0.32 * w + (1 - Math.min(1, w * 3)) * Math.sin(t * 0.23) * 0.28;   // standing, it shifts from leg to leg
    this.torso.rotation.x = 0.12 + w * 0.05 + breath * 0.012;
    // advance along heading
    const speed = 3.0 * w;
    this.root.position.x += Math.sin(this.yaw) * speed * dt;
    this.root.position.z += Math.cos(this.yaw) * speed * dt;
    // stay inside the basin
    const dx = this.root.position.x, dz = this.root.position.z + 110, d = Math.hypot(dx, dz);
    if (d > 52) { this.root.position.x = dx / d * 52; this.root.position.z = dz / d * 52 - 110; }
    this.root.position.y = this.world.heightAt(this.root.position.x, this.root.position.z);
  }

  footfall(legIdx, w) {
    const foot = this.legs[legIdx].foot; foot.getWorldPosition(tmp2);
    this.audio.play('giantStep', { vol: 0.55 + w * 0.6, pos: tmp2 });
    this.furVel.y -= 1.6 * w; // every footfall jolts the coat
    this.bus.emit('colossus:footfall', { pos: tmp2.clone(), strength: w });
  }

  beginStomp() {
    // stomp with the leg closest to the player
    this.state = 'stomp'; this.timer = 0;
    this.stompLeg = this.legs[0];
    this.snd('colossusGroan', { vol: 0.6 }); this.snd('giantLift');
    this.bus.emit('colossus:stompWindup');
  }

  updateStomp(dt, pl) {
    this.timer += dt;
    const leg = this.stompLeg, other = this.legs.find((l) => l !== leg);
    const lift = 1.6, slam = 0.22, hold = STOMP_HOLD, rec = 1.4;
    const tt = this.timer;
    let hipX = 0, knee = 0;
    if (tt > lift + slam + hold && !this.pulled) {
      // it wrenches the foot free: stones crack out of the hole it leaves
      this.pulled = true; this.snd('giantLift'); this.snd('giantCreak', { vol: 1.2 });
      leg.foot.getWorldPosition(tmp2); this.bus.emit('colossus:footfall', { pos: tmp2.clone(), strength: 0.7 });
    }
    if (tt < lift) {
      // anticipation: raise leg, track the player
      const k = smoothstep(0, lift, tt);
      hipX = -0.95 * k; knee = 1.2 * k;
      this.torso.rotation.x = lerp(0.12, -0.1, k); this.armSpread = k;                    // rears back, arms out for balance
      const toP = tmp.copy(pl.pos).sub(this.root.position);
      this.turnToward(Math.atan2(toP.x, toP.z) - 0.18 * leg.side, 0.6, dt);
    } else if (tt < lift + slam) {
      const k = (tt - lift) / slam; hipX = lerp(-0.95, 0.1, k * k); knee = lerp(1.2, 0, k * k);
      this.torso.rotation.x = lerp(-0.1, 0.36, k * k); this.armSpread = 1 - k;            // and throws its weight down after the foot
    } else if (tt < lift + slam + hold) {
      // driven in to the ankle: the foot is stuck fast and the leg stands still while it heaves to free it
      if (!this.slammed) { this.slam(leg, pl); this.pulled = false; leg.planted = hold; }
      const strain = Math.sin((tt - lift - slam) * 5.5) * 0.5 + 0.5;
      hipX = 0.1; this.torso.rotation.x = 0.36 - strain * 0.06; this.armSpread = 0.25 * strain;
      if (Math.random() < dt * 3) { leg.foot.getWorldPosition(tmp2); this.bus.emit('colossus:footfall', { pos: tmp2.clone(), strength: 0.15 }); }
    } else {
      const k = smoothstep(lift + slam + hold, lift + slam + hold + rec, tt);
      hipX = lerp(0.1, 0, k);
      this.torso.rotation.x = lerp(0.36, 0.12, k); this.armSpread = 0;                    // hauls itself upright again
      if (tt > lift + slam + hold + rec) { this.slammed = false; this.state = 'hunt'; this.timer = 3.5 + Math.random() * 2; }
    }
    leg.hip.rotation.x = hipX; leg.knee.rotation.x = knee;
    other.hip.rotation.x = damp(other.hip.rotation.x, 0.15, 3, dt);
    other.knee.rotation.x = damp(other.knee.rotation.x, 0.2, 3, dt);
    const sink = tt <= lift + slam ? 0 : tt < lift + slam + hold ? 0.9 : 0.9 * (1 - smoothstep(lift + slam + hold, lift + slam + hold + rec, tt));
    this.hips.position.y = 11.2 - 0.3 * (knee / 1.2) - sink;   // sinks into the blow, and stays down while the foot is stuck
  }

  slam(leg, pl) {
    this.slammed = true;
    leg.foot.getWorldPosition(tmp2);
    const ground = this.world.heightAt(tmp2.x, tmp2.z);
    const center = new THREE.Vector3(tmp2.x, ground, tmp2.z);
    this.audio.play('giantStomp', { vol: 1.1, pos: center });
    this.bus.emit('colossus:footfall', { pos: center, strength: 2 });
    this.spawnShockwave(center);
    if (pl.state === 'dead' || pl.state === 'climb') return;
    const d = Math.hypot(pl.pos.x - center.x, pl.pos.z - center.z);
    const away = new THREE.Vector3(pl.pos.x - center.x, 0, pl.pos.z - center.z).normalize();
    if (d < 4.5 && pl.pos.y < ground + 2) {
      pl.damage(42, 'crushed', away.multiplyScalar(9).setY(7));
    } else if (d < 11 && pl.pos.y < ground + 1.5) {
      pl.damage(12 * (1 - (d - 4.5) / 6.5) + 4, 'shockwave', away.multiplyScalar(5).setY(4));
    }
  }

  spawnShockwave(center) {
    this.ring.position.copy(center).setY(center.y + 0.15); this.ringT = 0;
    const pos = this.dust.geometry.attributes.position;
    for (let i = 0; i < this.dustCount; i++) {
      const a = Math.random() * Math.PI * 2, r = 1 + Math.random() * 2;
      pos.setXYZ(i, center.x + Math.cos(a) * r, center.y + 0.5 + Math.random(), center.z + Math.sin(a) * r);
      this.dustVel[i * 3] = Math.cos(a) * (4 + Math.random() * 6); this.dustVel[i * 3 + 1] = 1 + Math.random() * 3; this.dustVel[i * 3 + 2] = Math.sin(a) * (4 + Math.random() * 6);
    }
    pos.needsUpdate = true; this.dustT = 0;
  }

  updateFx(dt) {
    if (this.ringT !== undefined && this.ringT < 1.4) {
      this.ringT += dt; const k = this.ringT / 1.4;
      this.ring.scale.setScalar(1 + k * 9); this.ring.material.opacity = (1 - k) * 0.35;
    } else this.ring.material.opacity = 0;
    if (this.dustT !== undefined && this.dustT < 3) {
      this.dustT += dt;
      const pos = this.dust.geometry.attributes.position;
      for (let i = 0; i < this.dustCount; i++) {
        this.dustVel[i * 3] *= 1 - dt * 1.5; this.dustVel[i * 3 + 2] *= 1 - dt * 1.5; this.dustVel[i * 3 + 1] -= dt * 0.8;
        pos.setXYZ(i, pos.getX(i) + this.dustVel[i * 3] * dt, pos.getY(i) + Math.max(-0.2, this.dustVel[i * 3 + 1]) * dt, pos.getZ(i) + this.dustVel[i * 3 + 2] * dt);
      }
      pos.needsUpdate = true;
      this.dust.material.opacity = 0.45 * (1 - this.dustT / 3);
    } else this.dust.material.opacity = 0;
  }

  updateDying(dt) {
    this.dyingT += dt;
    const t = this.dyingT;
    this.shakeIntensity = damp(this.shakeIntensity, t < 3 ? 0.4 : 0, 2, dt);
    // stagger, kneel, then fall forward
    const kneel = smoothstep(1, 4, t), fall = smoothstep(4.5, 8.5, t);
    for (const leg of this.legs) { leg.hip.rotation.x = -1.2 * kneel; leg.knee.rotation.x = 1.9 * kneel; }
    this.hips.position.y = 11.2 - 5.2 * kneel - 3.2 * fall;
    this.hips.rotation.x = 1.25 * fall * fall;
    this.torso.rotation.x = 0.12 + 0.3 * kneel;
    this.head.rotation.x = 0.4 * kneel;
    for (const arm of this.arms) arm.sh.rotation.x = -0.3 * kneel - 1.0 * fall;
    { const k = 1 - smoothstep(4, 8, t); this.eyeMat.opacity = 0.85 * k; this.eyeGlow.intensity = 6 * k; this.mats.stone.emissiveIntensity = GLOW * k; this.mats.stoneDark.emissiveIntensity = 0.18 * k; }
    // the player is shaken loose as it collapses
    if (t > 4.2 && !this.loosened) { this.loosened = true; for (const c of this.climbables) c.userData.climb.disabled = true; }
    if (t > 8.5 && !this.fallen) {
      this.fallen = true;
      this.snd('giantCollapse'); this.snd('rumble');
      this.bus.emit('camera:shake', { amount: 1, duration: 1.5 });
      this.root.getWorldPosition(tmp);
      this.spawnShockwave(tmp.clone().add(new THREE.Vector3(Math.sin(this.yaw) * 10, 0, Math.cos(this.yaw) * 10)));
    }
    if (t > 11) { this.state = 'dead'; this.bus.emit('colossus:defeated'); }
  }

  /** Pose used for the menu backdrop and chapter art: dormant, quiet. */
  poseDormant(t) { this.idleSway(t, 1); this.head.rotation.y = Math.sin(t * 0.21) * 0.25; this.root.updateMatrixWorld(true); }
}

/** A curved horn sweeping out and back from the skull, tapering to a blunt tip. */
function hornGeometry(side) {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0), new THREE.Vector3(side * 1.1, 0.6, -0.3),
    new THREE.Vector3(side * 1.8, 1.6, -1.2), new THREE.Vector3(side * 1.7, 2.7, -2.4),
  ]);
  const tubular = 16, radial = 8;
  const g = new THREE.TubeGeometry(curve, tubular, 0.55, radial, false);
  const p = g.attributes.position, v = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    const ring = Math.floor(i / (radial + 1)), t = ring / tubular;
    curve.getPointAt(t, c); v.fromBufferAttribute(p, i).sub(c).multiplyScalar(1 - t * 0.8 + Math.sin(ring * 1.7) * 0.04).add(c);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

function repeatTex(t, n) { t.repeat.set(n, n); return t; }

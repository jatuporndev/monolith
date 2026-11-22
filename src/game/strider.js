import * as THREE from 'three';
import { Sculpt, sculptMaterial, pnoise } from './sculpt.js';
import { clamp, damp, lerp, smoothstep } from '../core/util.js';
import { stoneTexture, veinTexture, hideTexture } from './textures.js';
import { chiseledBox, blob, furCards } from './shapes.js';
import { furUniforms, strandMaterial, furPatch, FurLag, makeSigil, BossFx, repeatTex } from './bossKit.js';

const sndP = new THREE.Vector3();
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), tmp3 = new THREE.Vector3();
const UA = 3.5, LB = 3.55;          // upper / lower leg lengths
const HIP_Y = -0.6;                  // hip pivots below the body pivot
const UNSEEN = new THREE.MeshBasicMaterial({ visible: false });
const GLOW = 0.08;                   // light under the hide
// kneeling on the forehand to drink / winded: the low edge of the breast mane comes within reach (~1.1 m)
const DRINK_POSE = { by: 5.4, bp: 0.4, neck: 0.2, head: 0, fold: 0.3, rearKick: 0, paw: 0 };
const WINDED_POSE = { by: 5.5, bp: 0.38, neck: 0.45, head: -0.3, fold: 0.3, rearKick: 0, paw: 0 };
const DRINK_REACH = 19.2;            // root to pool centre while drinking: forehand down, muzzle in the water

/**
 * The Strider — the second warden: a long, armoured, four-legged ram on a high meadow ringed with
 * standing stones. Its legs are bare stone. It is not lured; it is approached unseen and broken like a
 * wild horse: taken at the pool while it drinks, ridden, steered by the horns into the stones until the
 * plate over its croup splits. Marks: the nape (behind the horns) and the croup (under the plate).
 * Local forward is +Z.
 */
export class Strider {
  constructor(world, bus, audio) {
    this.world = world; this.bus = bus; this.audio = audio;
    this.arena = world.arena2;
    this.home = new THREE.Vector3(this.arena.center.x, 0, this.arena.center.z);
    this.throwOnSigil = true; this.climbables = []; this.weakPoints = []; this.legs = [];
    this.state = 'dormant'; this.timer = 0; this.shakeIntensity = 0; this.flinch = 0; this.yaw = 0;
    this.speed = 0; this.phase = 0; this.awakened = false; this.dyingT = 0; this.cooldown = 0; this.kickCd = 0;
    this.chargeDist = 0; this.reinsT = 0; this.steer = 0; this.stage = 1; this.charges = 0;
    this.thirst = 0; this.goal = null; this.hostile = false; this.lostT = 0; this.armourHits = 0; this.buckT = 8;
    // pose targets the body eases toward — every state just sets where it wants to be
    this.pose = { by: 3.4, bp: 0, roll: 0, neck: 0.35, head: -0.2, fold: 1, stride: 0, rearKick: 0, paw: 0 };
    this.cur = { ...this.pose };
    this.build();
    this.reset('dormant');
  }

  // ---------------------------------------------------------------- body
  build() {
    const veins = veinTexture();
    const stone = new THREE.MeshStandardMaterial({ color: 0x8f9397, map: repeatTex(stoneTexture(57), 3), roughness: 0.9, emissive: 0xcfe6ff, emissiveMap: veins, emissiveIntensity: 0.22 });
    const plate = new THREE.MeshStandardMaterial({ color: 0x6c6f72, map: repeatTex(stoneTexture(61), 3), roughness: 0.95, emissive: 0xcfe6ff, emissiveMap: veins, emissiveIntensity: 0.12 });
    const horn = new THREE.MeshStandardMaterial({ color: 0xb8ad97, map: repeatTex(stoneTexture(73), 2), roughness: 0.75 });
    const hide = new THREE.MeshStandardMaterial({ color: 0x8b979b, roughness: 1 });
    const fu = this.furU = furUniforms();
    const strands = strandMaterial(fu, { color: 0xe2e0d6, seed: 11, hue: 200, lum: 42 });
    this.mats = { stone, plate, horn, hide, strands };
    this.furLag = new FurLag(fu);
    let seed = 300;
    const add = (geo, mat, parent, x, y, z, rx = 0, ry = 0, rz = 0) => {
      const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
      m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
    };
    const rock = (w, h, d, mat, parent, x, y, z, o = {}, rx = 0, ry = 0, rz = 0) =>
      add(chiseledBox(w, h, d, { radius: Math.min(w, h, d) * 0.3, amp: Math.min(w, h, d) * 0.05, seed: seed++, ...o }), mat, parent, x, y, z, rx, ry, rz);
    const boulder = (r, mat, parent, x, y, z, sx = 1, sy = 1, sz = 1) => { const m = add(blob(r, 2, 0.14, seed++), mat, parent, x, y, z); m.scale.set(sx, sy, sz); return m; };
    const patch = (o, parent, x, y, z) => { const m = furPatch({ ...o, hide, strands, climbables: this.climbables, seed: seed++ }); m.position.set(x, y, z); parent.add(m); return m; };

    const root = this.root = new THREE.Group();
    const rig = this.rig = new THREE.Group(); root.add(rig);
    const body = this.body = new THREE.Group(); rig.add(body);

    // ---- coat: the only holds. A forelock-like breast fall, a mane over the withers and down the spine
    // a bison-like breast mane the neck grows out of: the way up, once the forehand is down
    this.chestFur = patch({ w: 3.6, h: 5.6, d: 0.6, face: '+z', len: 1.4 }, body, 0, 1.0, 6.75);
    // the withers mane stops short where the neck mane comes down over it, so a climber heading forward
    // steps onto the neck instead of running along under it; a short tuft in front still takes the chest climb
    this.withersFur = patch({ w: 3.4, h: 0.5, d: 3.4, face: '+y', len: 1.0 }, body, 0, 4.15, 3.9);
    this.brisketFur = patch({ w: 3.4, h: 0.5, d: 0.9, face: '+y', len: 1.0 }, body, 0, 4.15, 6.55);
    this.backFur = patch({ w: 3.0, h: 0.5, d: 9.4, face: '+y', len: 0.9, holes: [{ x: 0, y: -2.3, r: 1.2 }] }, body, 0, 3.55, -2.3);
    // the mane runs on down behind the shoulder hump, so a climber can cross from withers to back
    this.saddleFur = patch({ w: 2.8, h: 0.5, d: 3.0, face: '+y', len: 0.9 }, body, 0, 3.86, 1.7);
    this.saddleFur.rotation.x = -0.22;

    // ---- neck and head
    const neck = this.neck = new THREE.Group(); neck.position.set(0, 3.0, 6.0); body.add(neck);
    // the mane runs back over the base of the neck onto the withers, so there is no gap to cross whatever the neck's angle
    this.neckFur = patch({ w: 1.9, h: 0.5, d: 8.6, face: '+y', len: 1.15, holes: [{ x: 0, y: 3.4, r: 1.05 }] }, neck, 0, 1.4, 2.4);
    this.neckFur.userData.climb.reach = 0.6;   // the neck rides up and down over the withers: reach across to it
    const head = this.head = new THREE.Group(); head.position.set(0, 0.25, 7.0); neck.add(head);
    const eyeMat = this.eyeMat = new THREE.MeshBasicMaterial({ color: 0xa8d8ff, transparent: true, opacity: 0.85 });
    for (const s of [-1, 1]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), eyeMat);
      e.scale.set(0.45, 0.75, 1.05); e.position.set(s * 1.1, 0.8, 2.85); head.add(e); (this.eyes ||= []).push(e);
    }
    this.eyeGlow = new THREE.PointLight(0xcfe6ff, 5, 8, 2); this.eyeGlow.position.set(0, 0.8, 3.6); head.add(this.eyeGlow);

    // ---- tail: a jointed chain of stones with a brush at the end
    this.tail = [];
    let parent = body, tz = -6.6, ty = 1.2;
    for (let i = 0; i < 6; i++) {
      const g = new THREE.Group(); g.position.set(0, ty, tz); parent.add(g);
      const r = 0.75 - i * 0.09;
      g.userData.r = r;
      this.tail.push(g); parent = g; tz = -r * 1.7; ty = 0;
    }
    { const brush = new THREE.Mesh(furCards(0.5, 0.3, 1.0, { side: 1, axis: 'y', len: 1.7, seed: 78 }), strands); brush.position.z = -0.9; parent.add(brush); }

    // ---- legs: bare stone pillars, ungrippable
    for (const [sx, sz, front] of [[-1, 5.0, true], [1, 5.0, true], [-1, -5.2, false], [1, -5.2, false]]) {
      const hip = new THREE.Group(); hip.position.set(sx * 2.35, HIP_Y, sz); body.add(hip);
      const knee = new THREE.Group(); knee.position.y = -UA; hip.add(knee);
      const hoof = new THREE.Group(); hoof.position.y = -LB + 0.35; knee.add(hoof);
      this.legs.push({ hip, knee, hoof, sx, sz, front, phase: (front ? 0 : Math.PI) + (sx < 0 ? 0 : Math.PI), lifted: false });
    }

    // a split-able plate of shell over the croup mark
    this.armour = new THREE.Group(); this.armour.position.set(0, 4.15, -4.6); body.add(this.armour);

    // sigils
    this.weakPoints.push(makeSigil(neck, new THREE.Vector3(0, 1.67, 5.8), new THREE.Euler(-Math.PI / 2, 0, 0), 'nape', 0xe6f2ff));
    this.weakPoints.push(makeSigil(body, new THREE.Vector3(0, 3.82, -4.6), new THREE.Euler(-Math.PI / 2, 0, 0), 'croup', 0xe6f2ff));

    this.jaw = new THREE.Group(); this.jaw.position.set(0, -0.5, 1.5); head.add(this.jaw);
    this.sculptBody(veins);
    this.fx = new BossFx(this.world.scene, { dust: 0xbab49c, spark: 0xd8ecff });
    this.world.scene.add(root);
  }

  /**
   * The Strider — "the Tarn Runner": a living grazer of the high water, half deer and half something scaled.
   * Slate-teal hide of fine scales with pale tiger-barring on flank and leg, a cream belly, ivory scutes down
   * either side of an ash-silver mane, cloven hooves.
   * Signature features: two long ribbed horns swept back over the neck (the rider's reins) · an ivory blaze of
   * bone from poll to nostril · a hanging dewlap and beard · the row of ivory scutes · the barred legs.
   * One skinned surface over the joints.
   */
  sculptBody(veins) {
    const S = new Sculpt(this.root), B = this.body, N = this.neck, H = this.head, J = this.jaw;
    const HIDE = 0, PLATE = 1, DARK = 2, SOCKET = 3, PALE = 4, HOOF = 5, HORN = 6;
    // the coat grows out of the body: under every patch of fur the flesh swells out to meet the roots of the locks
    // (the patch's own box stays as the unseen climbing surface)
    for (const m of this.climbables) {
      const h = m.userData.climb.half;
      S.box(m.parent, m.position.toArray(), [h.x * 0.97, h.y * 0.97, h.z * 0.97], Math.min(h.x, h.y, h.z) * 0.9, { tag: 7, k: 0.7, rough: 0.25, rot: [m.rotation.x, m.rotation.y, m.rotation.z] });
      m.material = UNSEEN; m.castShadow = false;
    }
    // ---- trunk: deep through the chest, tucked up at the loin
    S.ell(B, [0, 0.95, -0.2], [2.4, 1.95, 6.0], { tag: HIDE, k: 1.2 });                   // barrel
    S.ell(B, [0, 1.6, 3.7], [2.5, 2.15, 3.0], { tag: HIDE, k: 1.3 });                     // chest and withers
    S.ell(B, [0, 0.5, 5.3], [1.9, 2.25, 1.6], { tag: PALE, k: 1.0 });                     // breast
    S.ell(B, [0, 1.25, -4.6], [2.35, 2.05, 2.5], { tag: HIDE, k: 1.2 });                  // croup
    S.ell(B, [0, -0.6, 1.2], [1.85, 1.35, 3.8], { tag: PALE, k: 1.0 });                   // belly
    S.ell(B, [0, -0.1, -2.8], [1.5, 1.1, 2.0], { tag: PALE, k: 0.9 });                    // tucked loin
    for (const s of [-1, 1]) {
      for (let i = 0; i < 6; i++) {                                                       // ivory scutes beside the mane
        const z = -5.4 + i * 2.05, w = 1.9 - Math.abs(i - 2.5) * 0.12;
        S.ell(B, [s * 2.1, 2.9 - Math.abs(z) * 0.03, z], [w / 2, 0.3, 1.15], { tag: PLATE, k: 0.22, rot: [0.08, 0, s * 0.55], rough: 0.5 });
      }
      for (let i = 0; i < 5; i++) S.ell(B, [s * 2.3, 0.7, -1.9 + i * 1.05], [0.3, 1.5, 0.42], { tag: HIDE, k: 0.3, rot: [0.25, 0, s * 0.1] });   // ribs under the hide
      S.ell(B, [s * 2.15, 0.5, 4.5], [1.25, 2.1, 1.85], { tag: HIDE, k: 0.8 });           // shoulder
      S.ell(B, [s * 2.1, 0.3, -4.6], [1.35, 2.05, 2.1], { tag: HIDE, k: 0.8 });           // haunch
    }
    // ---- neck: thick at the withers, arched, fine at the throat; a dewlap hangs beneath
    S.cone(B, [0, 2.0, 4.6], [0, 3.0, 6.4], 1.75, 1.45, { tag: HIDE, k: 1.0 });
    S.cone(N, [0, -0.15, 0.2], [0, 0.0, 6.8], 1.3, 0.95, { tag: HIDE, k: 0.8 });
    S.ell(N, [0, 0.55, 3.0], [1.0, 0.75, 3.6], { tag: DARK, k: 0.8 });                    // crest
    S.ell(N, [0, -1.35, 2.4], [0.42, 1.0, 2.7], { tag: PALE, k: 0.45 });                  // dewlap
    S.ell(N, [0, -1.9, 3.6], [0.36, 0.7, 1.3], { tag: PALE, k: 0.35 });
    // ---- head: long, dished, with the blaze of bone down its face
    S.ell(H, [0, 0.3, 1.25], [1.25, 1.15, 1.9], { tag: HIDE, k: 0.7 });                    // skull
    for (const s of [-1, 1]) {
      S.ell(H, [s * 0.95, 0.5, 2.6], [0.55, 0.5, 0.8], { tag: HIDE, k: 0.4 });             // cheekbone
      S.ell(H, [s * 1.3, 1.05, 0.55], [0.26, 0.7, 0.5], { tag: DARK, k: 0.2, rot: [-0.5, s * 0.3, s * 0.7] });   // ear
    }
    S.cone(H, [0, 0.0, 2.4], [0, -0.42, 4.8], 0.92, 0.66, { tag: HIDE, k: 0.6 });         // muzzle
    S.cone(H, [0, 1.25, 1.2], [0, 0.42, 4.3], 0.7, 0.42, { tag: PLATE, k: 0.3, rough: 0.4 });   // the blaze
    S.cone(H, [-1.25, 1.3, 2.4], [1.25, 1.3, 2.4], 0.36, 0.36, { tag: PLATE, k: 0.4, rough: 0.4 });   // brow
    S.ell(H, [0, -0.35, 4.95], [0.6, 0.42, 0.42], { tag: DARK, k: 0.3 });                  // nose pad
    for (const s of [-1, 1]) {
      S.ell(H, [s * 1.3, 0.8, 2.85], [0.36, 0.24, 0.46], { tag: SOCKET, k: 0.2, sub: true });    // eye socket
      S.ell(H, [s * 0.34, -0.28, 5.2], [0.17, 0.2, 0.3], { tag: SOCKET, k: 0.15, sub: true });    // nostril
      // horns: ribbed, laid back along the neck and lifting at the tips; the left tip is chipped short
      const pts = [[0.85, 1.35, 1.3], [1.55, 2.5, 0.0], [2.05, 3.3, -1.8], [2.2, 3.65, -3.6], [2.0, 3.45, -5.1]], rs = [0.52, 0.45, 0.36, 0.26, 0.1];
      const last = s < 0 ? 3 : 4;
      for (let i = 0; i < last; i++) {
        const a0 = [s * pts[i][0], pts[i][1], pts[i][2]], b0 = [s * pts[i + 1][0], pts[i + 1][1], pts[i + 1][2]];
        S.cone(H, a0, b0, rs[i], s < 0 && i === 2 ? 0.3 : rs[i + 1], { tag: HORN, k: i ? 0.12 : 0.4, rough: 0.5 });
        for (const u of [0.3, 0.7]) S.ell(H, a0.map((q, j) => q + (b0[j] - q) * u), [rs[i] * 1.12, rs[i] * 1.12, 0.2], { tag: HORN, k: 0.08, rough: 0.5, rot: [0.35 - i * 0.25, s * 0.25, 0] });   // growth rings
      }
    }
    // ---- jaw (its own joint)
    S.ell(J, [0, -0.3, 1.45], [0.68, 0.36, 1.6], { tag: PALE, k: 0.4 });
    S.ell(J, [0, -0.25, 0.1], [0.85, 0.7, 0.7], { tag: HIDE, k: 0.5 });                    // jowl
    // ---- tail: a tapering whip
    this.tail.forEach((g, i) => { const r = g.userData.r; S.ell(g, [0, 0, -r * 0.8], [r * 0.9, r * 0.9, r * 1.4], { tag: i % 2 ? DARK : HIDE, k: 0.6 }); });
    // ---- legs: long, dry and barred; all the muscle is carried high
    for (const leg of this.legs) {
      const { hip, knee, hoof, front } = leg;
      S.ell(hip, [0, -0.2, 0], [1.1, 1.4, 1.2], { tag: HIDE, k: 0.9 });
      S.cone(hip, [0, -0.4, 0], [0, -UA + 0.1, 0], 0.9, 0.56, { tag: HIDE, k: 0.6 });
      if (!front) { S.ell(hip, [0, -1.1, -0.3], [1.12, 1.75, 1.45], { tag: HIDE, k: 0.8 }); S.ell(hip, [0, -2.5, -0.35], [0.6, 1.0, 0.7], { tag: HIDE, k: 0.4 }); }   // ham, gaskin
      else { S.ell(hip, [0, -1.2, 0.25], [0.85, 1.4, 0.95], { tag: HIDE, k: 0.7 }); S.ell(hip, [0, -2.4, -0.3], [0.5, 0.9, 0.55], { tag: HIDE, k: 0.4 }); }
      S.ell(knee, [0, 0, front ? 0.22 : -0.3], [0.6, 0.66, 0.66], { tag: DARK, k: 0.45 });   // knee / point of hock
      S.cone(knee, [0, -0.1, 0], [0, -LB + 0.6, 0], 0.5, 0.38, { tag: HIDE, k: 0.5 });      // cannon
      S.cone(knee, [0, -0.3, -0.4], [0, -LB + 0.9, -0.3], 0.26, 0.22, { tag: DARK, k: 0.3 });   // tendon
      S.ell(hoof, [0, 0.42, 0], [0.52, 0.5, 0.58], { tag: DARK, k: 0.5 });                  // fetlock
      for (const t of [-1, 1]) S.ell(hoof, [t * 0.36, -0.05, 0.3], [0.42, 0.42, 0.92], { tag: HOOF, k: 0.12, rough: 0.3 });   // cloven hoof
    }
    const mat = sculptMaterial({ grain: hideTexture('scale', 57), veins, scale: 0.62, bump: 1.0, emissive: 0xcfe6ff, emissiveIntensity: GLOW, roughness: 0.74, grainAmt: 0.42 });
    const pal = [0x44626c, 0xdcd2b6, 0x25353c, 0x0a0c0e, 0xbfb79e, 0x191715, 0xc9bd9c, 0x7f898c].map((h) => new THREE.Color(h));
    const bar = new THREE.Color(0x9fb3ae), back = new THREE.Color(0x1f2d33);
    const paint = (c, x, y, z, nY, tw) => {
      const hide = tw[HIDE];
      // a dark saddle along the spine, pale barring that breaks up on the flank and wraps the legs
      c.lerp(back, Math.max(0, Math.min(1, (nY - 0.15) * 1.4)) * 0.6 * hide);
      const side = 1 - Math.abs(nY), band = Math.sin(z * 2.1 + y * 1.3 + pnoise(x * 0.5, y * 0.5, z * 0.5) * 2.4);
      c.lerp(bar, Math.max(0, band - 0.55) * 1.6 * side * hide * (0.5 + 0.5 * pnoise(x * 0.3 + 5, y * 0.3, z * 0.3)));
    };
    this.skin = S.build({ voxel: 0.2, detail: { freq: 0.6, amp: 0.03, crack: 0.05 }, palette: pal, stain: 0.2, paint, material: mat });
    this.sculptStats = S.stats;
    this.mats.stone = mat; this.mats.plate = { emissiveIntensity: 0 };
    // the croup plate: one great scute over the hindquarters that can be broken away
    const A = new Sculpt(this.armour);
    A.ell(this.armour, [0, 0, 0], [1.75, 0.42, 1.8], { tag: 1, k: 0.4 });
    A.cone(this.armour, [0, 0.3, -1.4], [0, 0.4, 1.4], 0.3, 0.3, { tag: 1, k: 0.3 });        // keel of the scute
    A.build({ voxel: 0.12, detail: { freq: 1.4, amp: 0.02, crack: 0.05 }, palette: pal, stain: 0.2, material: mat });
    // a beard of the same ash-silver as the mane
    const beard = new THREE.Mesh(furCards(0.7, 0.2, 1.3, { side: 1, axis: 'y', len: 1.5, seed: 77 }), this.mats.strands);
    beard.position.set(0, -0.8, 1.3); J.add(beard);
  }

  // ---------------------------------------------------------------- lifecycle
  reset(mode) {
    this.state = mode; this.timer = 0; this.dyingT = 0; this.flinch = 0; this.shakeIntensity = 0; this.speed = 0;
    this.awakened = false; this.cooldown = 2; this.kickCd = 0; this.loosened = false; this.fallen = false; this.stumble = 0; this.hurt = 0;
    for (const wp of this.weakPoints) { wp.hits = 0; wp.destroyed = false; wp.flash = 0; wp.sealed = wp.id === 'croup'; }
    this.stage = 1; this.charges = 0; this.thirst = 6; this.goal = null; this.hostile = false; this.lostT = 0; this.reinsT = 0; this.steer = 0; this.lastReins = -99;
    this.armourHits = 0; this.armour.visible = true; this.armour.rotation.z = 0; this.armour.position.y = 4.15;
    this.arena.restore?.();
    for (const c of this.climbables) c.userData.climb.disabled = false;
    this.eyeMat.opacity = 0.85; this.eyeGlow.intensity = 5; this.eyeMat.color.set(0xa8d8ff); this.mats.stone.emissiveIntensity = GLOW; this.mats.plate.emissiveIntensity = 0.12;
    this.rig.rotation.set(0, 0, 0); this.rig.position.set(0, 0, 0);
    // it rests on the meadow facing the gap in the stones it came through
    const a = this.arena;
    this.root.position.set(a.center.x + 6, this.world.heightAt(a.center.x + 6, a.center.z - 4), a.center.z - 4);
    this.yaw = Math.atan2(-30 - this.root.position.x, 160 - this.root.position.z);
    this.root.rotation.y = this.yaw;
    Object.assign(this.pose, { by: 3.4, bp: 0.02, roll: 0, neck: 0.4, head: -0.25, fold: 1, stride: 0, rearKick: 0, paw: 0 });
    Object.assign(this.cur, this.pose);
    this.applyPose(0, 0, true);
  }

  /** Lie where it fell (chapters after its defeat): on its side, dark and unclimbable. */
  setDefeated() {
    this.reset('dying'); this.awakened = true; this.loosened = this.fallen = true;
    for (let i = 0; i < 40; i++) this.update(0.22, i * 0.22, null, false);
    this.state = 'dead'; this.shakeIntensity = 0;
    for (const c of this.climbables) c.userData.climb.disabled = true;
    for (const wp of this.weakPoints) { wp.destroyed = true; wp.hits = 3; wp.mat.opacity = 0; wp.light.intensity = 0; }
  }

  /** Standing tall, head raised: the pose its effigy is carved in. */
  standPose() {
    Object.assign(this.pose, { by: 7.4, bp: 0, roll: 0, neck: -0.55, head: 0.5, fold: 0, stride: 0, rearKick: 0, paw: 0 });
    this.speed = 0; this.applyPose(0, 0, true); this.root.updateMatrixWorld(true);
  }

  get alive() { return this.state !== 'dead' && this.state !== 'dying'; }
  get defeated() { return this.state === 'dead' || this.state === 'dying'; }
  focusPoint(out) { return this.body.getWorldPosition(out); }
  poseDormant(t) { this.applyPose(0, t, true); }

  weakPointNear(p, r) {
    for (const wp of this.weakPoints) {
      if (wp.destroyed || wp.sealed) continue;
      wp.mesh.getWorldPosition(tmp);
      if (tmp.distanceTo(p) < r) return wp;
    }
    return null;
  }

  strike(wp, power = 1) {
    if (wp.destroyed || !this.alive) return;
    wp.hits = Math.min(3, wp.hits + power); wp.flash = 1 + power * 0.5;
    this.snd(power > 1 ? 'strikeHeavy' : 'strike');
    this.bus.emit('colossus:struck', { id: wp.id, hits: wp.hits, power });
    // the reaction grows with each wound: a flinch, then a thrash that demands a grip, then the break
    this.flinch = wp.hits >= 2 ? 1.3 : 0.7 + power * 0.3; this.flinchAmt = wp.hits >= 2 ? 0.7 : 0.25;
    if (wp.hits === 2) this.snd('striderCall', { vol: 1.1 });
    this.fx.burst(wp, power);
    if (wp.hits === 1) setTimeout(() => this.snd('striderCall', { vol: 0.9 }), 250);
    if (wp.hits >= 3) {
      wp.destroyed = true;
      this.snd('sigil');
      const remaining = this.weakPoints.filter((w) => !w.destroyed).length;
      // the first mark broken, it rears and bucks hard: whoever rides it is thrown clear, and phase 2 begins
      if (remaining > 0) {
        this.state = 'shaking'; this.timer = 2.0; this.shakeIntensity = 1; this.speed = 0; this.snd('shake');
        this.stage = 2; this.charges = 0; this.hostile = true; this.eyeGlow.intensity = 9; this.eyeMat.color.set(0xfff0d8);
      }
      this.bus.emit('colossus:sigilBroken', { id: wp.id, remaining });
      if (this.weakPoints.every((w) => w.destroyed)) { this.state = 'dying'; this.dyingT = 0; this.snd('striderCall', { vol: 1.3 }); this.bus.emit('colossus:dying'); }
    }
  }

  /** Bare stone legs: the climber is pushed out of them, never through. The belly is high enough to run under. */
  pushOut(p, r) {
    // the barrel of the body is solid: anything inside it is moved out through the nearer flank
    const lp = this.body.worldToLocal(tmp.copy(p));
    const HX = 3.2 + r, top = 3.7, bot = -2.0, HZ = 6.4;
    if (lp.y + 1.6 > bot && lp.y < top && Math.abs(lp.z) < HZ && Math.abs(lp.x) < HX && this.alive) {
      lp.x = (Math.sign(lp.x) || 1) * HX;
      p.copy(this.body.localToWorld(lp));
    }
    for (const leg of this.legs) {
      leg.hoof.getWorldPosition(tmp);
      if (p.y > tmp.y + 6) continue;
      const dx = p.x - tmp.x, dz = p.z - tmp.z, d = Math.hypot(dx, dz), min = 1.15 + r;
      if (d < min && d > 1e-4) { p.x = tmp.x + dx / d * min; p.z = tmp.z + dz / d * min; }
    }
  }

  /** Its sounds come from where it stands. */
  snd(name, opts = {}) { this.body.getWorldPosition(sndP); this.audio.play(name, { pos: sndP, ...opts }); }

  // ---------------------------------------------------------------- behaviour
  /*
   * A wild thing to be broken, not a wall to be climbed.
   *  Phase 1 — it grazes and goes to the pool to drink. Seen, it hunts you with charges until it loses you
   *    (a standing stone between you, or distance). Unseen, you can reach it while its head is in the water
   *    and take its mane. Ridden, it bolts; hold the horns to steer it, and drive it into the stones —
   *    two rams crack the plate over the mark on its back.
   *  Phase 2 (one mark broken) — it throws you, and does not go back to the water. It charges harder and
   *    twice in a row, until it is winded and stands head-down, blowing; that is the way back on.
   */
  update(dt, t, pl, active) {
    const climbing = !!(active && pl && pl.onColossus);
    const P = this.pose, a = this.arena;
    const fwd = tmp3.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    let wantSpeed = 0;
    this.time = (this.time || 0) + dt; this.lastReins ??= -99;
    this.cooldown -= dt; this.kickCd -= dt; this.reinsT = Math.max(0, this.reinsT - dt);
    const s2 = this.stage === 2;
    // the marks: faint, brighter as the climber nears, flaring when struck; a sealed mark is dark
    for (const wp of this.weakPoints) {
      wp.flash = Math.max(0, wp.flash - dt * 1.5);
      let near = 0;
      if (active && pl && !wp.destroyed && !wp.sealed) { wp.mesh.getWorldPosition(tmp); near = 1 - smoothstep(4, 22, tmp.distanceTo(pl.pos)); }
      const base = wp.destroyed || wp.sealed ? 0 : 0.12 + near * 0.45 + Math.sin(t * 1.4 + wp.hits) * 0.05;
      wp.mat.opacity = damp(wp.mat.opacity, Math.min(1, base + wp.flash), 4, dt);
      wp.light.intensity = (wp.destroyed || wp.sealed ? 0 : near * 6) + wp.flash * 10;
    }
    const toP = pl ? tmp.copy(pl.pos).sub(this.root.position).setY(0) : tmp.set(0, 0, 1);
    const dist = toP.length(), want = Math.atan2(toP.x, toP.z);
    let rel = want - this.yaw; rel = Math.atan2(Math.sin(rel), Math.cos(rel));
    const grounded = pl && pl.state !== 'climb' && pl.state !== 'dead' && pl.state !== 'cinematic';
    // getting on: whatever it was doing, a rider makes it rear
    const calmStates = ['graze', 'toDrink', 'drink', 'alert', 'hunt', 'paw', 'skid', 'stagger', 'winded', 'calm', 'kick', 'toss'];
    if (climbing && calmStates.includes(this.state)) {
      this.state = 'rear'; this.timer = 1.6; this.snd('striderCall', { vol: 1.1 }); this.bus.emit('strider:mounted');
    }

    switch (this.state) {
      case 'dormant':
        Object.assign(P, { by: 3.4 + Math.sin(t * 0.6) * 0.06, bp: 0.02, neck: 0.4 + Math.sin(t * 0.31) * 0.05, head: -0.25, fold: 1, stride: 0, rearKick: 0, paw: 0 });
        if (active && pl && Math.hypot(pl.pos.x - a.center.x, pl.pos.z - a.center.z) < a.radius + 8) this.awaken();
        break;
      case 'rise':
        this.timer -= dt;
        Object.assign(P, { by: 7.4, bp: 0, neck: -0.5, head: 0.4, fold: 0, stride: 0 });
        if (this.backOff > 0) { this.backOff -= dt; wantSpeed = -2.4; }
        if (this.timer <= 0) { this.state = this.hostile ? 'hunt' : 'graze'; this.timer = 2; this.lostT = 0; }
        break;
      case 'graze': {
        // amble between patches of grass; head down to crop them, up to look round
        this.thirst += dt;
        if (!this.goal || this.goal.distanceTo(tmp2.copy(this.root.position).setY(0)) < 2) this.pickGrazeGoal();
        this.timer -= dt;
        const cropping = this.timer > 0;
        if (!cropping) {
          this.turnToward(Math.atan2(this.goal.x - this.root.position.x, this.goal.z - this.root.position.z), 0.5, dt);
          wantSpeed = 1.7;
          if (Math.random() < dt * 0.12) this.timer = 2.5 + Math.random() * 2;
        }
        Object.assign(P, { by: 7.3, bp: cropping ? 0.1 : 0, neck: cropping ? 0.75 : -0.35, head: cropping ? -0.3 : 0.35, fold: 0, rearKick: 0, paw: 0 });
        if (this.notices(pl, dist, rel, 24, 10)) { this.becomeAlert(); break; }
        if (this.thirst > 12) { this.state = 'toDrink'; this.timer = 0; this.drinkSpot = this.drinkSpotFrom(this.root.position); }
        break;
      }
      case 'toDrink': {
        const ds = this.drinkSpot, pool = a.pool;
        const dx = ds.x - this.root.position.x, dz = ds.z - this.root.position.z, dd = Math.hypot(dx, dz);
        Object.assign(P, { by: 7.3, bp: 0, neck: -0.3, head: 0.3, fold: 0 });
        // a stone in the way of the chosen spot: come round to the pool from another side
        this.timer += dt;
        if (this.timer > 14) { this.timer = 0; const ang = Math.atan2(ds.x - pool.x, ds.z - pool.z) + 0.9; ds.set(pool.x + Math.sin(ang) * DRINK_REACH, 0, pool.z + Math.cos(ang) * DRINK_REACH); }
        if (dd > 1.0) { this.turnToward(Math.atan2(dx, dz), 0.7, dt); wantSpeed = Math.min(2.4, dd); }
        else {
          const face = Math.atan2(pool.x - this.root.position.x, pool.z - this.root.position.z);
          this.turnToward(face, 0.6, dt);
          let r2 = face - this.yaw; r2 = Math.atan2(Math.sin(r2), Math.cos(r2));
          if (Math.abs(r2) < 0.08) { this.state = 'drink'; this.timer = 24; this.snd('striderSnort'); this.bus.emit('strider:drinking'); }
        }
        if (this.notices(pl, dist, rel, 24, 10)) this.becomeAlert();
        break;
      }
      case 'drink': {
        // muzzle in the water: blind, and deaf to anything but a step close behind it
        this.timer -= dt;
        Object.assign(P, DRINK_POSE);
        P.neck += Math.sin(t * 1.7) * 0.03;
        if (this.timer < 3 && !this.drinkWarned) { this.drinkWarned = true; this.snd('striderSnort'); }
        if (this.timer < 3) { P.neck -= (3 - this.timer) * 0.15; P.by += (3 - this.timer) * 0.2; }
        if (this.notices(pl, dist, rel, 0, 4.5)) { this.becomeAlert(); break; }
        if (this.timer <= 0) { this.state = 'graze'; this.thirst = 0; this.timer = 0; this.goal = null; this.drinkWarned = false; }
        break;
      }
      case 'alert':
        this.timer -= dt;
        Object.assign(P, { by: 7.6, bp: -0.05, neck: -0.7, head: 0.55, fold: 0 });
        this.turnToward(want, 1.4, dt);
        if (this.timer <= 0) { this.state = 'hunt'; this.hostile = true; this.lostT = 0; this.cooldown = 0.6; }
        break;
      case 'calm':
        // it has lost you: snorts, looks about, and goes back to its grass
        this.timer -= dt;
        Object.assign(P, { by: 7.3, bp: 0, neck: -0.4 + Math.sin(t * 2) * 0.1, head: 0.3, fold: 0 });
        this.turnToward(this.yaw + Math.sin(t * 0.8) * 0.6, 0.4, dt);
        if (this.notices(pl, dist, rel, 24, 10)) { this.becomeAlert(); break; }
        if (this.timer <= 0) { this.state = 'graze'; this.hostile = false; this.goal = null; this.thirst = Math.max(this.thirst, 8); }
        break;
      case 'hunt': {
        Object.assign(P, { by: 7.4, bp: 0, neck: -0.5 + Math.sin(t * 0.7) * 0.05, head: 0.42, fold: 0, rearKick: 0, paw: 0 });
        this.turnToward(want, s2 ? 1.2 : 0.95, dt);
        // it hunts by sight: a standing stone between you, or a long way off, and it loses you
        const lost = !pl || pl.state === 'dead' || this.hidden(pl) || dist > 48;
        this.lostT = lost ? this.lostT + dt : 0;
        if (!s2 && this.lostT > 4) { this.state = 'calm'; this.timer = 2.5; this.snd('striderSnort'); break; }
        if (dist > 26) wantSpeed = Math.abs(rel) < 0.6 ? 3.2 : 1.2;
        else if (Math.abs(rel) > 0.4) wantSpeed = 0.8;
        if (grounded && dist < 9 && Math.abs(rel) > 2.1 && this.kickCd <= 0) { this.state = 'kick'; this.timer = 0; this.kicked = false; this.snd('striderSnort'); break; }
        if (grounded && dist < 9 && Math.abs(rel) <= 2.1) {
          if (Math.abs(rel) < 0.7 && this.kickCd <= 0) { this.state = 'toss'; this.timer = 0; this.kicked = false; this.snd('striderSnort'); break; }
          wantSpeed = -2.2;
        }
        if (grounded && !lost && dist > 9 && dist < 52 && Math.abs(rel) < 0.22 && this.cooldown <= 0) this.beginPaw(s2 ? 0.9 : 1.35);
        break;
      }
      case 'paw': {
        this.timer -= dt;
        Object.assign(P, { by: 6.9, bp: 0.12, neck: 0.05, head: 0.15, fold: 0, paw: 1 });
        this.turnToward(want, 1.2, dt);
        if (this.timer <= 0) {
          this.state = 'charge'; this.timer = 0; this.chargeDist = 0; this.trampled = false;
          this.snd('striderCall', { vol: 1.1 });
        }
        break;
      }
      case 'charge': {
        this.timer += dt;
        Object.assign(P, { by: 6.8, bp: 0.14, neck: 0.1, head: 0.1, fold: 0, paw: 0 });
        if (this.timer < 0.5) this.turnToward(want, 0.2, dt);
        wantSpeed = s2 ? 18 : 15.5;
        this.chargeDist += this.speed * dt;
        const hit = this.chargeDist > 4 && this.stoneAhead(fwd);
        if (hit && this.speed > 6) { this.ramStone(hit, false); break; }
        if (pl && !this.trampled && grounded && this.speed > 6 && pl.pos.y < this.root.position.y + 2.5) {
          const along = toP.dot(fwd), side = Math.abs(toP.x * fwd.z - toP.z * fwd.x);
          if (along > -4 && along < 6.8 && side < 2.4 && (this.trampled = true)) pl.damage(30, 'trampled', tmp2.copy(fwd).multiplyScalar(8).addScaledVector(new THREE.Vector3(fwd.z, 0, -fwd.x), Math.sign(toP.x * fwd.z - toP.z * fwd.x) * 5 || 5).setY(6));
        }
        const out = tmp2.copy(this.root.position).addScaledVector(fwd, 9).sub(this.home).setY(0).length() > a.radius - 2;
        if (out || this.chargeDist > 58) { this.state = 'skid'; this.timer = 1.2; this.snd('striderSnort'); }
        break;
      }
      case 'skid':
        this.timer -= dt; wantSpeed = 0;
        Object.assign(P, { by: 7.0, bp: -0.06, neck: -0.35, head: 0.4, paw: 0 });
        if (this.timer <= 0) this.afterCharge();
        break;
      case 'stagger':
        // horns into a stone without a rider: it reels, shakes its head, and is angrier for it
        this.timer -= dt; wantSpeed = this.timer > 0.8 ? -1.5 : 0;
        Object.assign(P, { by: 7.0, bp: -0.1, neck: -0.6, head: 0.5 + Math.sin(t * 9) * 0.25, paw: 0 });
        if (this.timer <= 0) this.afterCharge();
        break;
      case 'winded': {
        // phase 2: spent after its charges, head hanging, sides heaving — the way back on
        this.timer -= dt;
        Object.assign(P, WINDED_POSE);
        P.by += Math.sin(t * 3.1) * 0.12;
        if (this.timer <= 0) { this.state = 'rise'; this.timer = 1.2; this.snd('striderCall', { vol: 0.9 }); this.charges = 0; }
        break;
      }
      case 'kick': {
        this.timer += dt;
        const k = smoothstep(0, 0.55, this.timer) * (1 - smoothstep(0.95, 1.5, this.timer));
        Object.assign(P, { by: 7.0, bp: 0.28 * k, neck: 0.1 * k - 0.4 * (1 - k), head: 0.3, rearKick: k });
        if (!this.kicked && this.timer > 0.7) {
          this.kicked = true; this.snd('impact', { vol: 0.5 });
          if (grounded && dist < 9.5 && toP.dot(fwd) < -dist * 0.5) pl.damage(22, 'kicked', toP.clone().normalize().multiplyScalar(10).setY(5));
        }
        if (this.timer > 1.55) { this.state = 'hunt'; this.kickCd = 3.5; }
        break;
      }
      case 'toss': {
        this.timer += dt;
        const down = smoothstep(0, 0.5, this.timer) * (1 - smoothstep(0.75, 0.95, this.timer));
        const up = smoothstep(0.75, 0.95, this.timer) * (1 - smoothstep(1.2, 1.7, this.timer));
        Object.assign(P, { by: 7.0 - down * 0.5, bp: 0.2 * down, neck: 0.5 * down - 0.9 * up - 0.4 * (1 - down - up), head: 0.1 * down + 0.6 * up + 0.4 * (1 - down - up), rearKick: 0, paw: 0 });
        if (!this.kicked && this.timer > 0.8) {
          this.kicked = true; this.snd('impact', { vol: 0.45 });
          if (grounded && dist < 8.5 && toP.dot(fwd) > dist * 0.5) pl.damage(22, 'tossed', toP.clone().normalize().multiplyScalar(7).setY(9));
        }
        if (this.timer > 1.7) { this.state = 'hunt'; this.kickCd = 2.5; }
        break;
      }
      case 'rear': {
        // taken by surprise: up on its hind legs, forehand pawing the air
        this.timer -= dt;
        const k = Math.sin(Math.min(1, (1.6 - this.timer) / 1.6) * Math.PI);
        Object.assign(P, { by: 7.4 + k * 1.2, bp: -0.42 * k, neck: -0.9 * k - 0.3, head: 0.5, fold: 0, rearKick: 0, paw: k });
        this.shakeIntensity = damp(this.shakeIntensity, 0.5, 5, dt);
        if (this.timer <= 0) { this.state = climbing ? 'carry' : 'hunt'; this.hostile = true; this.buckT = s2 ? 5 : 8; this.snd('striderLand'); this.bus.emit('colossus:footfall', { pos: this.root.position.clone(), strength: 1.2 }); }
        break;
      }
      case 'carry': {
        if (!climbing) { this.state = 'hunt'; this.hostile = true; this.cooldown = 2.5; break; }
        Object.assign(P, { by: 7.3, bp: 0.04, neck: -0.35, head: 0.3, fold: 0, paw: 0, rearKick: 0 });
        if (this.time - this.lastReins < 3) {
          // the rider has its horns: it goes where it is turned, flat out, and holds that line for a while
          // after the turn (no shying away from the stone the rider is aiming it at)
          if (this.reinsT > 0) this.yaw -= clamp(this.steer, -1, 1) * 1.3 * dt;   // +x input = rider's right = clockwise from above
          this.root.rotation.y = this.yaw;
          wantSpeed = s2 ? 10 : 8.5;
        } else {
          // bolting in wide loops of its own choosing — and shying away from the stones it sees coming
          const off = tmp2.copy(this.root.position).sub(this.home).setY(0);
          const ang = Math.atan2(off.x, off.z) + 0.9, r = 15;
          let goal = Math.atan2(this.home.x + Math.sin(ang) * r - this.root.position.x, this.home.z + Math.cos(ang) * r - this.root.position.z);
          for (const st of a.stones) {
            if (st.broken) continue;
            const sx = st.x - this.root.position.x, sz = st.z - this.root.position.z, sd = Math.hypot(sx, sz);
            let sr = Math.atan2(sx, sz) - this.yaw; sr = Math.atan2(Math.sin(sr), Math.cos(sr));
            if (sd < 16 && Math.abs(sr) < 0.7) goal = this.yaw - Math.sign(sr || 1) * 1.2;
          }
          this.turnToward(goal, 0.9, dt);
          wantSpeed = s2 ? 7 : 5.5;
        }
        const hit = this.speed > 5 && this.stoneAhead(fwd);
        if (hit) { this.ramStone(hit, true); break; }
        this.buckT -= dt;
        if (this.buckT <= 0) { this.state = 'shakeWarn'; this.timer = 1.2; this.snd('striderSnort'); this.bus.emit('colossus:shakeWarn'); }
        break;
      }
      case 'reel':
        // ridden into a stone: the whole length shudders, then it runs on
        this.timer -= dt; wantSpeed = this.timer > 0.6 ? -2 : 0;
        this.shakeIntensity = damp(this.shakeIntensity, 0.6, 8, dt);
        Object.assign(P, { by: 7.0, bp: -0.12, neck: -0.7, head: 0.6 + Math.sin(t * 10) * 0.2 });
        if (this.timer <= 0) this.state = climbing ? 'carry' : 'hunt';
        break;
      case 'shakeWarn':
        this.timer -= dt; wantSpeed = 1.5;
        this.shakeIntensity = damp(this.shakeIntensity, 0.25, 3, dt);
        Object.assign(P, { by: 7.0, bp: 0.1, neck: 0.2, head: 0.1 });
        if (this.timer <= 0) { this.state = 'shaking'; this.timer = 2.3; this.snd('shake'); this.snd('striderCall', { vol: 0.7 }); this.bus.emit('colossus:shake'); }
        break;
      case 'shaking': {
        this.timer -= dt;
        this.shakeIntensity = damp(this.shakeIntensity, 1, 6, dt);
        const b = Math.sin((2.3 - this.timer) * 5.2);
        Object.assign(P, { by: 7.2 + Math.max(0, -b) * 0.8, bp: b * 0.32, neck: -0.2 - b * 0.4, head: 0.3, rearKick: Math.max(0, b) * 0.8 });
        if (this.timer <= 0) { this.state = climbing ? 'carry' : 'hunt'; this.hostile = true; this.buckT = s2 ? 4.5 + Math.random() * 1.5 : 7 + Math.random() * 2; this.cooldown = 2; }
        break;
      }
      case 'dying': this.updateDying(dt); break;
      case 'dead': break;
    }

    if (!['shakeWarn', 'shaking', 'rear', 'reel'].includes(this.state)) this.shakeIntensity = damp(this.shakeIntensity, this.flinch > 0 ? this.flinchAmt || 0.25 : 0, 6, dt);
    if (this.flinch > 0 && this.alive && this.state !== 'winded' && this.state !== 'drink') { P.bp -= 0.18 * Math.min(1, this.flinch); P.neck -= 0.3 * Math.min(1, this.flinch); }
    this.flinch = Math.max(0, this.flinch - dt);

    // locomotion
    const accel = this.state === 'charge' ? 7 : this.state === 'skid' ? 9 : 3;
    this.speed = damp(this.speed, this.alive ? wantSpeed : 0, accel, dt);
    if (Math.abs(this.speed) > 0.01) {
      this.root.position.x += Math.sin(this.yaw) * this.speed * dt;
      this.root.position.z += Math.cos(this.yaw) * this.speed * dt;
    }
    this.keepInArena();
    this.root.position.y = this.world.heightAt(this.root.position.x, this.root.position.z);
    this.applyPose(dt, t, false);
    this.root.updateMatrixWorld(true);
    this.body.getWorldPosition(tmp);
    this.furLag.update(dt, t, tmp, this.shakeIntensity);
    if (this.state !== 'dead' && this.state !== 'dying') {
      const bp = Math.floor((t * 0.9 + this.speed * 0.2) / (Math.PI * 2));
      if (bp !== this.breathN) { this.breathN = bp; this.head.getWorldPosition(tmp); this.audio.play('striderBreath', { pos: tmp, ref: 22, vol: 1 + Math.min(1.5, this.speed * 0.1) }); }
    }
    if (this.state !== 'dead') {
      // breath in the flanks, a jaw that works when it drinks, bellows or bucks, eyes that blink
      const br = Math.sin(t * 0.9 + this.speed * 0.2), sh = this.shakeIntensity;
      this.body.scale.set(1 + br * 0.014, 1, 1);
      const chew = this.state === 'drink' ? 0.1 + Math.max(0, Math.sin(t * 5)) * 0.12 : 0.03;
      this.jaw.rotation.x = damp(this.jaw.rotation.x, chew + Math.min(1, sh * 1.3) * 0.4 + (this.flinch > 0 ? 0.3 : 0), 8, dt);
      const blink = (t * 0.19 + Math.sin(t * 0.11) * 0.5) % 1 < 0.03 ? 0.1 : 1;
      for (const e of this.eyes) e.scale.y = damp(e.scale.y, blink, 30, dt);
    }
    this.fx.update(dt);
  }

  /** Does it see the player? `front` is the reach of its gaze ahead, `all` the reach of its hearing all round. */
  notices(pl, dist, rel, front, all) {
    if (!pl || pl.state === 'dead' || pl.state === 'cinematic' || pl.state === 'climb') return false;
    if (this.hidden(pl)) return false;
    const loud = (pl.anim?.speed || 0) > 5.5 ? 1.45 : 1;   // a sprint carries
    return dist < all * loud || (Math.abs(rel) < 1.25 && dist < front * loud);
  }

  /** A standing stone (not a shattered one) between its eyes and the player. */
  hidden(pl) {
    this.head.getWorldPosition(tmp2);
    const ax = tmp2.x, az = tmp2.z, bx = pl.pos.x - ax, bz = pl.pos.z - az, L2 = bx * bx + bz * bz;
    for (const s of this.arena.stones) {
      if (s.broken) continue;
      const u = clamp(((s.x - ax) * bx + (s.z - az) * bz) / L2, 0, 1);
      if (u > 0.02 && u < 0.98 && Math.hypot(ax + bx * u - s.x, az + bz * u - s.z) < s.r + 0.45) return true;
    }
    return false;
  }

  becomeAlert() {
    this.state = 'alert'; this.timer = 0.9;
    this.snd('striderSnort'); this.snd('striderCall', { vol: 0.8 });
    this.bus.emit('strider:spotted');
  }

  beginPaw(time) {
    this.state = 'paw'; this.timer = time; this.snd('striderSnort'); this.bus.emit('colossus:stompWindup');
  }

  /** After a charge: phase 2 charges again at once, and after three it is winded. */
  afterCharge() {
    this.charges++;
    if (this.stage === 2 && this.charges >= 3) {
      this.state = 'winded'; this.timer = 8; this.snd('striderSnort');
      this.bus.emit('strider:winded');
      return;
    }
    if (this.stage === 2 && this.charges % 2 === 1) { this.state = 'hunt'; this.cooldown = 0; return; }
    this.state = 'hunt'; this.cooldown = (this.stage === 2 ? 1.2 : 2.2) + Math.random() * 1.2;
  }

  pickGrazeGoal() {
    const a = this.arena;
    for (let i = 0; i < 8; i++) {
      const ang = Math.random() * Math.PI * 2, r = 4 + Math.random() * 15;
      const x = a.center.x + Math.sin(ang) * r, z = a.center.z + Math.cos(ang) * r;
      if (Math.hypot(x - a.pool.x, z - a.pool.z) < a.pool.r + 9) continue;
      if (a.stones.some((s) => Math.hypot(x - s.x, z - s.z) < 7)) continue;
      this.goal = new THREE.Vector3(x, 0, z); this.timer = 0; return;
    }
    this.goal = new THREE.Vector3(a.center.x, 0, a.center.z);
  }

  /** Where to stand so the muzzle reaches the water, coming from where it is now. */
  drinkSpotFrom(p) {
    const pool = this.arena.pool, dx = p.x - pool.x, dz = p.z - pool.z, d = Math.hypot(dx, dz) || 1;
    return new THREE.Vector3(pool.x + dx / d * DRINK_REACH, 0, pool.z + dz / d * DRINK_REACH);
  }

  /** A standing stone right in front of the horns, which it is running into rather than away from. */
  stoneAhead(fwd) {
    this.hornTip(tmp2);
    // the stone it just struck does not count again until it has backed off and come round for another run
    return this.arena.stones.find((s) => !s.broken && !(s === this.lastStone && this.time - this.lastRamT < 3) && Math.hypot(tmp2.x - s.x, tmp2.z - s.z) < s.r + 1.1 && (s.x - tmp2.x) * fwd.x + (s.z - tmp2.z) * fwd.z > -0.3);
  }

  /** Horns into a stone. The stone cracks (and on a second blow shatters); ridden, the blow also splits the plate over the croup. */
  ramStone(stone, ridden) {
    this.speed = 0; this.lastStone = stone; this.lastRamT = this.time;
    // only a ridden blow can bring a stone down; on its own it just knocks them askew (cover must survive)
    const shattered = ridden || stone.hp > 1 ? this.arena.crack(stone) : (stone.lean += 0.03, false);
    this.snd('impact', { vol: 1.4 }); this.snd('rockHit'); this.snd('striderCall', { vol: 0.6 }); this.stumble = 1;
    if (shattered) this.snd('rumble');
    this.hornTip(tmp2);
    this.fx.shockwave(new THREE.Vector3(tmp2.x, this.world.heightAt(tmp2.x, tmp2.z), tmp2.z), { ring: true, spread: shattered ? 1.2 : 0.6 });
    this.bus.emit('camera:shake', { amount: 0.8 });
    this.bus.emit('colossus:footfall', { pos: tmp2.clone(), strength: 1.6 });
    this.bus.emit('strider:ram', { ridden, shattered });
    if (ridden) {
      this.state = 'reel'; this.timer = 1.2;
      // only a blow the rider aimed splits the plate
      const aimed = this.time - this.lastReins < 3.5;
      if (aimed && this.armour.visible && ++this.armourHits >= 2) this.breakArmour();
      else if (aimed && this.armour.visible) { this.armour.rotation.z = 0.06; this.armour.position.y += 0.08; this.bus.emit('strider:plateCracked'); }
    } else { this.state = 'stagger'; this.timer = 1.4; this.bus.emit('strider:staggered'); }
  }

  breakArmour() {
    this.armour.visible = false;
    const croup = this.weakPoints.find((w) => w.id === 'croup');
    croup.sealed = false; croup.flash = 1.5;
    this.armour.getWorldPosition(tmp2);
    this.fx.shockwave(tmp2.clone(), { ring: false, spread: 1.4 });
    this.snd('rockHit'); this.snd('sigil');
    this.bus.emit('strider:armourBroken');
  }

  /** Called by the climber each frame they hold the neck mane near the horns: their sideways input steers. */
  reins(att, mv) {
    if (!att || (att.obj !== this.neckFur && att.obj !== this.withersFur && att.obj !== this.brisketFur)) return false;
    if (!['carry', 'reel', 'shakeWarn'].includes(this.state)) return false;
    this.reinsT = 0.25; this.steer = mv.x; this.lastReins = this.time;
    return true;
  }

  awaken() {
    if (this.awakened) return;
    this.awakened = true; this.state = 'rise'; this.timer = 2.4; this.cooldown = 3.5;
    this.snd('striderCall', { vol: 1.3 });
    this.bus.emit('colossus:awaken');
  }

  hornTip(out) { return out.set(0, 0.6, 5.6).applyMatrix4(this.head.matrixWorld); }

  turnToward(want, rate, dt) {
    let d = want - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += clamp(d, -rate * dt, rate * dt);
    this.root.rotation.y = this.yaw;
  }

  keepInArena() {
    const a = this.arena, p = this.root.position;
    const dx = p.x - a.center.x, dz = p.z - a.center.z, d = Math.hypot(dx, dz), lim = a.radius - 4;
    if (d > lim) { p.x = a.center.x + dx / d * lim; p.z = a.center.z + dz / d * lim; }
    // shoulders shove past the stones (and their stumps); only the horns strike them
    for (const s of a.stones) {
      const sx = p.x - s.x, sz = p.z - s.z, sd = Math.hypot(sx, sz), min = s.r + 2.8;
      if (sd < min && sd > 1e-4) { p.x = s.x + sx / sd * min; p.z = s.z + sz / sd * min; }
    }
  }

  // ---------------------------------------------------------------- animation
  /** Ease the body toward the pose targets, then place every leg on the ground with two-bone IK. */
  applyPose(dt, t, snap) {
    const P = this.pose, C = this.cur, k = snap ? 1 : 1 - Math.exp(-(this.state === 'shaking' ? 9 : this.state === 'charge' ? 5 : 3) * dt);
    for (const key in P) C[key] += (P[key] - C[key]) * k;
    const dying = this.state === 'dying' || this.state === 'dead';
    // gait: a trot; the forehand leads the stride when galloping
    const sp = Math.abs(this.speed);
    this.phase += dt * (1.6 + sp * 0.42) * Math.sign(this.speed || 1);
    const stride = clamp(sp * 0.3, 0, 2.7) * (dying ? 0 : 1);
    const lift = 0.35 + Math.min(1, sp / 8) * 0.9;
    const bob = Math.abs(Math.sin(this.phase)) * Math.min(1, sp / 6) * 0.35;
    this.body.position.y = C.by - bob;
    this.body.rotation.x = C.bp + Math.sin(this.phase * 2) * 0.015 * Math.min(1, sp / 4);
    this.rig.position.y = 2.5 * Math.sin(Math.min(1.45, C.roll));   // roll about the flank, not the ground under the spine
    this.rig.rotation.z = C.roll + (this.state === 'shaking' ? Math.sin(t * 6.1) * 0.08 : 0) + Math.sin(this.phase) * 0.012 * Math.min(1, sp / 3);
    this.neck.rotation.x = C.neck + Math.sin(this.phase * 2 + 0.6) * 0.04 * Math.min(1, sp / 5);
    // hurt: the head is flung up and the quarters sink; after a ram it pitches onto its knees and scrambles up
    const hurt = this.hurt = damp(this.hurt || 0, this.flinch > 0 ? 1 : 0, 6, dt);
    if (this.stumble > 0) this.stumble = Math.max(0, this.stumble - dt / 1.3);
    const st = this.stumble > 0 ? Math.sin(Math.PI * (1 - this.stumble)) : 0;
    this.neck.rotation.x += -0.3 * hurt + 0.35 * st;
    this.body.position.y -= 0.3 * hurt + 0.75 * st;
    this.body.rotation.x += -0.05 * hurt + 0.14 * st;
    this.head.rotation.x = C.head;
    this.head.rotation.y = this.state === 'shaking' ? Math.sin(t * 7.3) * 0.25 : Math.sin(t * 0.37) * 0.08;
    // its own habit: a quick toss of the horns, like a beast shaking off flies
    { const ph = (t * 0.097) % 1; this.head.rotation.z = ph < 0.06 && sp < 3 ? Math.sin(ph / 0.06 * Math.PI * 3) * 0.2 * Math.sin(ph / 0.06 * Math.PI) : 0; }
    // tail sways behind the body's motion
    for (let i = 0; i < this.tail.length; i++) {
      const g = this.tail[i];
      g.rotation.y = Math.sin(t * 1.3 - i * 0.5) * 0.12 + (this.state === 'shaking' ? Math.sin(t * 9 - i) * 0.25 : 0);
      g.rotation.x = (dying ? 0.15 : 0.32 - Math.min(1, sp / 10) * 0.35) + Math.sin(t * 0.9 - i * 0.4) * 0.04 - C.bp * 0.4;
    }
    this.body.updateMatrix();
    if (this.state === 'dead' && !snap) return;
    const p = this.body.rotation.x, cp = Math.cos(p), spn = Math.sin(p), by = this.body.position.y;
    for (const leg of this.legs) {
      const ph = this.phase + leg.phase;
      // foot target in the root frame (ground at y=0)
      let fz = leg.sz + Math.sin(ph) * stride, fy = 0;
      if (stride > 0.05) fy = Math.max(0, Math.cos(ph)) * lift;
      if (leg.front) {
        fz += C.fold * 1.3 + C.paw * (leg.sx < 0 ? Math.max(0, Math.sin(t * 7)) * 1.4 : 0);
        fy += C.paw * (leg.sx < 0 ? Math.max(0, Math.sin(t * 7)) * 0.9 : 0);
      } else {
        fz -= C.fold * 1.3 + C.rearKick * 2.6;
        fy += C.rearKick * 2.4;
      }
      // hip pivot in the root frame
      const hy = by + HIP_Y * cp - leg.sz * spn, hz = HIP_Y * spn + leg.sz * cp;
      // into the body frame
      const vy = fy - hy, vz = fz - hz;
      const by2 = vy * cp + vz * spn, bz2 = -vy * spn + vz * cp;
      const h = -by2, dz = bz2;
      const d = clamp(Math.hypot(dz, h), 0.6, UA + LB - 0.03);
      const phi = Math.atan2(dz, h);
      const beta = Math.acos(clamp((UA * UA + d * d - LB * LB) / (2 * UA * d), -1, 1));
      const delta = Math.PI - Math.acos(clamp((UA * UA + LB * LB - d * d) / (2 * UA * LB), -1, 1));
      if (!dying || C.roll < 0.05) {
        if (leg.front) { leg.hip.rotation.x = -(phi + beta); leg.knee.rotation.x = delta; }
        else { leg.hip.rotation.x = -(phi - beta); leg.knee.rotation.x = -delta; }
      }
      leg.hoof.rotation.x = -(leg.hip.rotation.x + leg.knee.rotation.x) - p;
      // hoof falls: a short, hard clop
      const down = Math.cos(ph) <= 0;
      if (stride > 0.3 && down && leg.lifted && !snap) {
        const strength = Math.min(1.2, sp / 9);
        this.snd('hoof', { vol: 0.4 + strength * 0.6 });
        this.furLag.jolt(-0.6 * strength);
        leg.hoof.getWorldPosition(tmp2); this.bus.emit('colossus:footfall', { pos: tmp2.clone(), strength: Math.max(0.22, strength * 0.5) });
      }
      leg.lifted = !down;
    }
  }

  updateDying(dt) {
    this.dyingT += dt;
    const t = this.dyingT, P = this.pose;
    this.shakeIntensity = damp(this.shakeIntensity, t < 2 ? 0.45 : 0, 2, dt);
    // the forehand gives way, then the whole length rolls onto its side
    const kneel = smoothstep(0.6, 2.6, t), roll = smoothstep(3.0, 6.0, t);
    Object.assign(P, { by: lerp(lerp(7.2, 5.0, kneel), 2.2, roll), bp: 0.32 * kneel * (1 - roll), neck: lerp(0.4, 0.9, kneel), head: -0.6, roll: 1.42 * roll * roll, fold: 0.2 * kneel, stride: 0, rearKick: 0, paw: 0 });
    // legs stiffen as it goes over
    if (roll > 0) for (const leg of this.legs) { leg.hip.rotation.x = damp(leg.hip.rotation.x, leg.front ? -0.5 : 0.4, 2, dt); leg.knee.rotation.x = damp(leg.knee.rotation.x, leg.front ? 0.4 : -0.3, 2, dt); }
    { const k = 1 - smoothstep(3.5, 7, t); this.eyeMat.opacity = 0.85 * k; this.eyeGlow.intensity = 5 * k; this.mats.stone.emissiveIntensity = GLOW * k; this.mats.plate.emissiveIntensity = 0.12 * k; }
    if (t > 2.8 && !this.loosened) { this.loosened = true; for (const c of this.climbables) c.userData.climb.disabled = true; }
    if (t > 6 && !this.fallen) {
      this.fallen = true;
      this.snd('impact', { vol: 1.5 }); this.snd('rumble');
      this.bus.emit('camera:shake', { amount: 1, duration: 1.5 });
      this.root.getWorldPosition(tmp);
      this.fx.shockwave(tmp.clone().add(new THREE.Vector3(Math.cos(this.yaw) * 4, 0, -Math.sin(this.yaw) * 4)));
    }
    if (t > 9 && this.state === 'dying') { this.state = 'dead'; this.bus.emit('colossus:defeated'); }
  }
}

/** Thick ridged horns sweeping out, back, then forward past the muzzle — a battering ram. */
function ramHornGeometry(side) {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0), new THREE.Vector3(side * 1.3, 0.7, -0.6), new THREE.Vector3(side * 2.2, 0.3, 0.6),
    new THREE.Vector3(side * 1.9, -0.3, 2.6), new THREE.Vector3(side * 1.1, -0.2, 4.4),
  ]);
  const tubular = 24, radial = 9;
  const g = new THREE.TubeGeometry(curve, tubular, 0.62, radial, false);
  const p = g.attributes.position, v = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    const ring = Math.floor(i / (radial + 1)), t = ring / tubular;
    curve.getPointAt(t, c);
    // growth ridges every few rings, tapering to a blunt point
    v.fromBufferAttribute(p, i).sub(c).multiplyScalar((1 - t * 0.72) * (1 + (ring % 3 === 0 ? 0.07 : 0))).add(c);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

import * as THREE from 'three';

const _l = new THREE.Vector3(), _q = new THREE.Vector3(), _w = new THREE.Vector3(), _n = new THREE.Vector3();
const _m3 = new THREE.Matrix3();

/**
 * Closest point on the surface of an oriented box (Object3D with userData.climb.half),
 * plus the outward face normal at that point. Works on moving objects (the Colossus).
 */
export function closestOnBox(obj, worldPoint, out = {}) {
  const half = obj.userData.climb.half;
  _l.copy(worldPoint); obj.worldToLocal(_l);
  _q.set(
    Math.max(-half.x, Math.min(half.x, _l.x)),
    Math.max(-half.y, Math.min(half.y, _l.y)),
    Math.max(-half.z, Math.min(half.z, _l.z)),
  );
  // Only the two broad faces of a patch are grippable (the faces across its thinnest axis).
  // Moving between patches happens through overlap, never by wrapping around thin edges.
  const axis = half.x <= half.y && half.x <= half.z ? 0 : half.y <= half.z ? 1 : 2;
  const comp = axis === 0 ? 'x' : axis === 1 ? 'y' : 'z';
  // one-sided patches never expose the face buried in the body or wall
  const sign = obj.userData.climb.side || Math.sign(_l[comp]) || 1;
  _q[comp] = sign * half[comp];
  _n.set(0, 0, 0); _n[comp] = sign;
  out.obj = obj;
  out.local = (out.local || new THREE.Vector3()).copy(_q);
  out.normalLocal = (out.normalLocal || new THREE.Vector3()).copy(_n);
  out.world = (out.world || new THREE.Vector3()).copy(_q); obj.localToWorld(out.world);
  out.normal = (out.normal || new THREE.Vector3()).copy(_n).applyMatrix3(_m3.getNormalMatrix(obj.matrixWorld)).normalize();
  out.dist = out.world.distanceTo(worldPoint);
  return out;
}

/** Best surface point among many climbables. */
export function closestClimbable(list, worldPoint, maxDist = Infinity) {
  let best = null; const tmp = {};
  for (const obj of list) {
    if (!obj.visible || !obj.userData.climb || obj.userData.climb.disabled) continue;
    closestOnBox(obj, worldPoint, tmp);
    if (tmp.dist < maxDist && (!best || tmp.dist < best.dist)) {
      best = { obj, local: tmp.local.clone(), normalLocal: tmp.normalLocal.clone(), world: tmp.world.clone(), normal: tmp.normal.clone(), dist: tmp.dist };
    }
  }
  return best;
}

/**
 * Like closestClimbable, but when several surfaces are within reach prefer the one that
 * moves the grip furthest along `dir` — this is what carries a climber across seams
 * between overlapping fur patches instead of pinning them to the edge of the first one.
 */
export function bestClimbStep(list, cand, from, dir, maxDist = 0.6) {
  let best = null, bestScore = -Infinity; const tmp = {};
  for (const obj of list) {
    if (!obj.visible || !obj.userData.climb || obj.userData.climb.disabled) continue;
    closestOnBox(obj, cand, tmp);
    // a patch may declare extra `reach`: a hold you can stretch across to (e.g. a mane on a moving neck)
    const reach = obj.userData.climb.reach || 0, d = Math.max(0, tmp.dist - reach);
    if (d > maxDist) continue;
    const progress = (tmp.world.x - from.x) * dir.x + (tmp.world.y - from.y) * dir.y + (tmp.world.z - from.z) * dir.z;
    const score = progress - d * 0.6;
    if (score > bestScore) {
      bestScore = score;
      best = { obj, local: tmp.local.clone(), normalLocal: tmp.normalLocal.clone(), world: tmp.world.clone(), normal: tmp.normal.clone(), dist: tmp.dist };
    }
  }
  return best;
}

export function attachmentWorld(att, outPoint, outNormal) {
  outPoint.copy(att.local); att.obj.localToWorld(outPoint);
  outNormal.copy(att.normalLocal).applyMatrix3(_m3.getNormalMatrix(att.obj.matrixWorld)).normalize();
}

export { _w as tmpWorld };

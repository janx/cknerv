// courierGlyph — the ONE courier vocabulary, as per-instance math.
//
// A courier is a glow-mote head (a camera-facing bloom billboard) trailing a
// velocity-aligned plume (a quad whose local +Y runs along the flight and
// which is billboarded AROUND that axis toward the camera). Two layers throw
// couriers: ColonyCourierLayer's glints down the propagation tree, and
// BlockDeliveryLayer's last hop from a peer up into the Cell field. Both call
// the writers below, so the hop form cannot fork between them — a source pin
// (courierGlyph.test.ts) keeps either layer from growing a private copy.
//
// Everything here is allocation-free: the writers compose into module scratch
// and write straight into the caller's instance batch.
import * as THREE from 'three';

/** Ease the mote + plume in/out over this fraction of each hop so nothing
 *  pops — a courier shrinks to nothing at both ends of its flight. */
export const COURIER_END_EASE = 0.08;
/** Plume length added per (world-unit/s) of courier speed. */
export const FLAME_SPEED_STRETCH = 0.02;

// Scratch objects reused every call (no per-frame allocation in the hot loop).
const _dir = new THREE.Vector3();
const _view = new THREE.Vector3();
const _x = new THREE.Vector3();
const _z = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _worldX = new THREE.Vector3(1, 0, 0);
const _basis = new THREE.Matrix4();
const _quaternion = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _matrix = new THREE.Matrix4();

/** Presence at hop progress `t` ∈ [0, 1]: 0 at both ends, 1 across the middle,
 *  ramping over `ease` of the hop at each end. Scales the mote and the plume
 *  length, so a courier is absorbed at arrival rather than switched off. */
export function courierEdgeEase(t: number, ease = COURIER_END_EASE): number {
  return Math.max(0, Math.min(t / ease, (1 - t) / ease, 1));
}

/** Analytic speed (world units/s) of an easeOutCubic hop over `legDist` in
 *  `durS` seconds at progress `t`: d/dt[1 − (1 − t)³] = 3(1 − t)². Fast off
 *  the launch, coasting to rest — the thrown-object velocity every courier has. */
export function courierHopSpeed(legDist: number, durS: number, t: number): number {
  return (legDist * 3 * (1 - t) * (1 - t)) / durS;
}

/** Plume length from the courier's speed: `minLen` at rest, stretching by
 *  `stretch` per world-unit/s, capped at `maxLen`. */
export function courierPlumeLength(
  minLen: number,
  maxLen: number,
  speed: number,
  stretch = FLAME_SPEED_STRETCH,
): number {
  return Math.min(maxLen, minLen + speed * stretch);
}

/**
 * Orient local +Y along the flight direction, billboarded around that axis so
 * the quad faces the camera as closely as the axis allows. `dir` may be any
 * length (it is normalized here); `position` is the plume's nozzle in world.
 * The basis is (x = dir × view, y = dir, z = x × dir): z is the camera's view
 * vector with its along-axis component removed, so the quad's normal always
 * points back at the viewer.
 */
export function courierPlumeQuaternion(
  target: THREE.Quaternion,
  dir: THREE.Vector3,
  position: THREE.Vector3,
  camPos: THREE.Vector3,
): THREE.Quaternion {
  _dir.copy(dir).normalize();
  _view.subVectors(camPos, position).normalize();
  _x.crossVectors(_dir, _view);
  if (_x.lengthSq() < 1e-6) {
    // Camera dead-on the flight axis → dir×view collapses. Fall back to a
    // world axis guaranteed non-parallel to _dir. Hops fly in 3D (the colony
    // is a cloud at CHAIN_Y ± y, and the last hop climbs to the Cell field),
    // so a near-vertical flight needs world-X, not up.
    _x.crossVectors(_dir, Math.abs(_dir.y) < 0.9 ? _up : _worldX);
  }
  _x.normalize();
  _z.crossVectors(_x, _dir).normalize();
  _basis.makeBasis(_x, _dir, _z);
  return target.setFromRotationMatrix(_basis);
}

/** The glow-mote head: a camera-quaternion billboard (every plane receives
 *  the camera's world quaternion, so an instance batch keeps Sprite-style
 *  billboarding in one draw), `size × edge` world units across. */
export function writeCourierMote(
  batch: THREE.InstancedMesh,
  slot: number,
  position: THREE.Vector3,
  camQuat: THREE.Quaternion,
  size: number,
  edge: number,
): void {
  _scale.setScalar(size * edge);
  _matrix.compose(position, camQuat, _scale);
  batch.setMatrixAt(slot, _matrix);
}

/** The plume: a `width × (length × edge)` quad with its nozzle at `position`
 *  and its body trailing down local −Y — callers translate their plane
 *  geometry by (0, −0.5, 0) so the nozzle edge sits at the origin — oriented
 *  by `courierPlumeQuaternion`. */
export function writeCourierPlume(
  batch: THREE.InstancedMesh,
  slot: number,
  position: THREE.Vector3,
  dir: THREE.Vector3,
  camPos: THREE.Vector3,
  width: number,
  length: number,
  edge: number,
): void {
  courierPlumeQuaternion(_quaternion, dir, position, camPos);
  _scale.set(width, length * edge, 1);
  _matrix.compose(position, _quaternion, _scale);
  batch.setMatrixAt(slot, _matrix);
}

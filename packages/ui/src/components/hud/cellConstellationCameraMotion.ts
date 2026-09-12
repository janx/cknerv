import * as THREE from 'three';

/**
 * Screen drift, in CSS px per frame at the selected Cell's depth, above which
 * the camera is MOVING: the leaders hide, the seats freeze, and no route work
 * runs. One frame is enough to say so — nothing but the visitor's hand or a
 * camera flight moves a selected anchor three pixels in a frame; the canopy's
 * own turn at inspection tempo moves it a fortieth of that.
 */
export const CONSTELLATION_CAMERA_MOTION_PX = 3;
/**
 * Per-frame drift at or below which a moving camera is AT REST once it has
 * held there for the settle window.
 *
 * ⚠️ IT USED TO BE 0.02 PX OF ACCUMULATED DRIFT, and that is why the
 * constellation came back one to two seconds after the galaxy had visibly
 * stopped. The rule was built so that the remaining 0.92 damping tail could
 * never re-open the motion window, and the only way to guarantee that with one
 * threshold was to wait until the tail was geometrically spent — measured
 * against OrbitControls' damping, rest at frame 79 after a one-pixel nudge and
 * frame 123 after a forty-pixel fling, while the galaxy was under half a pixel
 * a frame by frames 9 and 53.
 *
 * Two thresholds are the fix. Below this one the drift path carries the
 * leaders frame by frame — re-anchoring a proven leader for a move of two
 * pixels or less always succeeds, and the seats hold — so what is left of the
 * tail (at most 2 / 0.08 = 25 px of travel) is followed live rather than
 * waited out. The gap up to `CONSTELLATION_CAMERA_MOTION_PX` is the
 * hysteresis: a tail that has fallen under two pixels a frame cannot climb back
 * over three on its own, so rest, once declared, is not withdrawn by the tail.
 */
export const CONSTELLATION_CAMERA_REST_PX = 2;
/** Consecutive frames at or under the rest drift before rest is declared. */
export const CONSTELLATION_CAMERA_SETTLE_FRAMES = 3;
/** …and the least wall time those frames may span, so a burst of queued
 * animation frames after a tab comes back cannot pass for a settled camera. */
export const CONSTELLATION_CAMERA_SETTLE_MS = 40;

export interface CellConstellationCameraMotion {
  initialized: boolean;
  moving: boolean;
  /** Consecutive frames whose drift stayed at or under the rest threshold. */
  stableFrames: number;
  /** When the current run of stable frames began. */
  stableSinceMs: number;
  /** The previous frame's pose: drift is measured frame to frame. */
  previousPosition: THREE.Vector3;
  previousQuaternion: THREE.Quaternion;
  previousProjection: THREE.Matrix4;
  currentPosition: THREE.Vector3;
  currentQuaternion: THREE.Quaternion;
  currentScale: THREE.Vector3;
}

export function createCellConstellationCameraMotion(): CellConstellationCameraMotion {
  return {
    initialized: false,
    moving: false,
    stableFrames: 0,
    stableSinceMs: 0,
    previousPosition: new THREE.Vector3(),
    previousQuaternion: new THREE.Quaternion(),
    previousProjection: new THREE.Matrix4(),
    currentPosition: new THREE.Vector3(),
    currentQuaternion: new THREE.Quaternion(),
    currentScale: new THREE.Vector3(),
  };
}

/** A conservative CSS-pixel reading of one frame's camera change at the
 * anchor's depth: translation as a fraction of the anchor's distance plus the
 * rotation angle, both scaled by the focal length in pixels. */
function poseDriftPx(
  fromPosition: THREE.Vector3,
  fromQuaternion: THREE.Quaternion,
  position: THREE.Vector3,
  quaternion: THREE.Quaternion,
  projection: THREE.Matrix4,
  anchorWorld: THREE.Vector3,
  viewportHeight: number,
): number {
  const focalPx = Math.abs(projection.elements[5]) * Math.max(0, viewportHeight) * 0.5;
  if (!(focalPx > 0)) return Infinity;
  const distance = Math.max(1e-6, fromPosition.distanceTo(anchorWorld));
  const translation = fromPosition.distanceTo(position) / distance;
  const rotation = fromQuaternion.angleTo(quaternion);
  return focalPx * (translation + rotation);
}

function rememberPose(state: CellConstellationCameraMotion, projection: THREE.Matrix4): void {
  state.previousPosition.copy(state.currentPosition);
  state.previousQuaternion.copy(state.currentQuaternion);
  state.previousProjection.copy(projection);
}

/**
 * Observe actual camera pose and projection changes, independently of input
 * events. This catches OrbitControls' damping tail and camera flights, works in
 * standalone Labs with no App sentinel, and lets a held-but-still pointer rest.
 *
 * Returns true while the camera is MOVING. Motion opens on any frame whose
 * drift exceeds `CONSTELLATION_CAMERA_MOTION_PX` or whose projection changed;
 * it closes after `CONSTELLATION_CAMERA_SETTLE_FRAMES` consecutive frames and
 * `CONSTELLATION_CAMERA_SETTLE_MS` at or under `CONSTELLATION_CAMERA_REST_PX`.
 * What the tail still moves after that is the drift path's to carry, and it
 * does so with the leaders up.
 */
export function settleCellConstellationCameraMotion(
  state: CellConstellationCameraMotion,
  camera: THREE.Camera,
  anchorWorld: THREE.Vector3,
  viewportHeight: number,
  atMs: number,
): boolean {
  camera.matrixWorld.decompose(
    state.currentPosition,
    state.currentQuaternion,
    state.currentScale,
  );
  const projection = camera.projectionMatrix;
  const now = Number.isFinite(atMs) ? atMs : 0;

  if (!state.initialized) {
    rememberPose(state, projection);
    state.initialized = true;
    state.moving = false;
    state.stableFrames = 0;
    state.stableSinceMs = now;
    return false;
  }

  const jumped = !state.previousProjection.equals(projection);
  const drift = poseDriftPx(
    state.previousPosition,
    state.previousQuaternion,
    state.currentPosition,
    state.currentQuaternion,
    projection,
    anchorWorld,
    viewportHeight,
  );
  rememberPose(state, projection);

  if (!state.moving) {
    if (!jumped && drift <= CONSTELLATION_CAMERA_MOTION_PX) return false;
    state.moving = true;
    state.stableFrames = 0;
    state.stableSinceMs = now;
    return true;
  }

  if (jumped || drift > CONSTELLATION_CAMERA_REST_PX || now < state.stableSinceMs) {
    state.stableFrames = 0;
    state.stableSinceMs = now;
    return true;
  }
  state.stableFrames += 1;
  if (state.stableFrames < CONSTELLATION_CAMERA_SETTLE_FRAMES
    || now - state.stableSinceMs < CONSTELLATION_CAMERA_SETTLE_MS) return true;
  state.moving = false;
  return false;
}

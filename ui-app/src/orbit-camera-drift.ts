import * as THREE from 'three';
import { poseDriftPx } from '@cknerv/ui';

/**
 * How far the picture moved this frame, in CSS pixels at the orbit target's
 * depth — the reading the motion window CLOSES on.
 *
 * `OrbitControls` answers a different question. It reports a `change` while
 * its damped pose moves more than 1e-3 world units or radians in an update,
 * and at the default pose that is 0.007 CSS px: the tail keeps saying "moving"
 * for 104-151 frames after a release, the last half of them invisible. Cell
 * picking is dead and the adaptive sampler blind for the whole of it, so what
 * the two consumers need is not "did the controller move the camera" but "can
 * a reader see it move" — which is this, and which the selected-Cell leaders
 * already settle on (`poseDriftPx`, one reading for both layers).
 *
 * State is one pose, kept frame to frame; the reading allocates nothing after
 * construction. The projection is deliberately NOT part of it: a resize or a
 * fov change is not the camera moving, and the picker has its own rebuild
 * reasons for both.
 */
export interface OrbitCameraDrift {
  initialized: boolean;
  previousPosition: THREE.Vector3;
  previousQuaternion: THREE.Quaternion;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
}

export function createOrbitCameraDrift(): OrbitCameraDrift {
  return {
    initialized: false,
    previousPosition: new THREE.Vector3(),
    previousQuaternion: new THREE.Quaternion(),
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    scale: new THREE.Vector3(),
  };
}

/**
 * One frame's drift, and remember the pose for the next. The first frame has
 * nothing to measure against and answers `Infinity` — a camera whose history
 * is unknown is moving, which is the safe answer for a rule that hands
 * picking back.
 */
export function orbitCameraDriftPx(
  state: OrbitCameraDrift,
  camera: THREE.Camera,
  targetWorld: THREE.Vector3,
  viewportHeight: number,
): number {
  camera.matrixWorld.decompose(state.position, state.quaternion, state.scale);
  if (!state.initialized) {
    state.initialized = true;
    state.previousPosition.copy(state.position);
    state.previousQuaternion.copy(state.quaternion);
    return Number.POSITIVE_INFINITY;
  }
  const drift = poseDriftPx(
    state.previousPosition,
    state.previousQuaternion,
    state.position,
    state.quaternion,
    camera.projectionMatrix,
    targetWorld,
    viewportHeight,
  );
  state.previousPosition.copy(state.position);
  state.previousQuaternion.copy(state.quaternion);
  return drift;
}

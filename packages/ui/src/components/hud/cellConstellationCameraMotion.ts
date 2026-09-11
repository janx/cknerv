import * as THREE from 'three';

/** A camera move becomes observable before a leader can drift by a tenth of a
 * CSS pixel. The lower settle threshold leaves room for OrbitControls' 0.92
 * damping tail to finish without making the leaders flash back off. */
export const CONSTELLATION_CAMERA_MOTION_PX = 0.1;
export const CONSTELLATION_CAMERA_SETTLE_PX = 0.02;
export const CONSTELLATION_CAMERA_SETTLE_MS = 80;
export const CONSTELLATION_CAMERA_SETTLE_FRAMES = 3;

export interface CellConstellationCameraMotion {
  initialized: boolean;
  moving: boolean;
  stableFrames: number;
  stableSinceMs: number;
  settledPosition: THREE.Vector3;
  settledQuaternion: THREE.Quaternion;
  settledProjection: THREE.Matrix4;
  candidatePosition: THREE.Vector3;
  candidateQuaternion: THREE.Quaternion;
  candidateProjection: THREE.Matrix4;
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
    settledPosition: new THREE.Vector3(),
    settledQuaternion: new THREE.Quaternion(),
    settledProjection: new THREE.Matrix4(),
    candidatePosition: new THREE.Vector3(),
    candidateQuaternion: new THREE.Quaternion(),
    candidateProjection: new THREE.Matrix4(),
    currentPosition: new THREE.Vector3(),
    currentQuaternion: new THREE.Quaternion(),
    currentScale: new THREE.Vector3(),
  };
}

function copyPose(
  position: THREE.Vector3,
  quaternion: THREE.Quaternion,
  projection: THREE.Matrix4,
  sourcePosition: THREE.Vector3,
  sourceQuaternion: THREE.Quaternion,
  sourceProjection: THREE.Matrix4,
): void {
  position.copy(sourcePosition);
  quaternion.copy(sourceQuaternion);
  projection.copy(sourceProjection);
}

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

function projectionChanged(from: THREE.Matrix4, current: THREE.Matrix4): boolean {
  return !from.equals(current);
}

function startStableWindow(
  state: CellConstellationCameraMotion,
  projection: THREE.Matrix4,
  atMs: number,
): void {
  copyPose(
    state.candidatePosition,
    state.candidateQuaternion,
    state.candidateProjection,
    state.currentPosition,
    state.currentQuaternion,
    projection,
  );
  state.stableFrames = 0;
  state.stableSinceMs = atMs;
}

/**
 * Observe actual camera pose and projection changes, independently of input
 * events. This catches OrbitControls' damping tail and camera flights, works in
 * standalone Labs with no App sentinel, and lets a held-but-still pointer rest.
 *
 * While moving, the stable window compares against its first pose rather than
 * only the preceding frame. Sub-threshold movement therefore accumulates and
 * cannot make the leaders flicker on through a slow damping tail.
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
    copyPose(
      state.settledPosition,
      state.settledQuaternion,
      state.settledProjection,
      state.currentPosition,
      state.currentQuaternion,
      projection,
    );
    startStableWindow(state, projection, now);
    state.initialized = true;
    return false;
  }

  if (!state.moving) {
    const changed = projectionChanged(state.settledProjection, projection)
      || poseDriftPx(
        state.settledPosition,
        state.settledQuaternion,
        state.currentPosition,
        state.currentQuaternion,
        projection,
        anchorWorld,
        viewportHeight,
      ) > CONSTELLATION_CAMERA_MOTION_PX;
    if (!changed) return false;
    state.moving = true;
    startStableWindow(state, projection, now);
    return true;
  }

  const stable = !projectionChanged(state.candidateProjection, projection)
    && poseDriftPx(
      state.candidatePosition,
      state.candidateQuaternion,
      state.currentPosition,
      state.currentQuaternion,
      projection,
      anchorWorld,
      viewportHeight,
    ) <= CONSTELLATION_CAMERA_SETTLE_PX;
  if (!stable || now < state.stableSinceMs) {
    startStableWindow(state, projection, now);
    return true;
  }

  state.stableFrames += 1;
  if (state.stableFrames < CONSTELLATION_CAMERA_SETTLE_FRAMES
    || now - state.stableSinceMs < CONSTELLATION_CAMERA_SETTLE_MS) return true;

  copyPose(
    state.settledPosition,
    state.settledQuaternion,
    state.settledProjection,
    state.currentPosition,
    state.currentQuaternion,
    projection,
  );
  state.moving = false;
  return false;
}

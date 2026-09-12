import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import {
  createOrbitCameraDrift,
  orbitCameraDriftPx,
} from '../src/orbit-camera-drift';
import {
  ORBIT_CAMERA_REST_DRIFT_PX,
  ORBIT_CAMERA_SETTLE_FRAMES,
  createOrbitGestureState,
  noteOrbitCameraChange,
  orbitCameraSuspendsPicking,
  orbitInMotion,
  settleOrbitCameraFrame,
} from '../src/orbit-gesture-state';

/**
 * OrbitControls' own damped release, driven through a real camera.
 *
 * The controls apply `sphericalDelta * dampingFactor` to the pose each update
 * and then decay the delta by `1 - dampingFactor`, so a release of `delta`
 * radians moves the camera `delta * 0.08 * 0.92^n` radians on frame `n` and
 * travels exactly `delta` in total. `change` fires while the position moved
 * more than 1e-3 world units, which at this pose is 0.007 CSS px — the tail
 * the review measured at 104-151 frames.
 */
const DAMPING = 0.08;
const TARGET = new THREE.Vector3(0, 38, 0);
const START = new THREE.Vector3(110, 108, 110);
const VIEWPORT = 1080;

function productionCamera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(50, 1920 / VIEWPORT, 0.1, 4_000);
  camera.position.copy(START);
  camera.lookAt(TARGET);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  return camera;
}

function spherical(camera: THREE.PerspectiveCamera): THREE.Spherical {
  return new THREE.Spherical().setFromVector3(
    camera.position.clone().sub(TARGET),
  );
}

interface Release {
  /** Frames until the gesture state stopped calling the camera moving. */
  settledAt: number | null;
  /** Frames until OrbitControls would have stopped firing `change`. */
  latchEndsAt: number;
  /** Per-frame drift, in CSS px, as the settle saw it. */
  drift: number[];
}

/** Play one release out, frame by frame, through the real settle rule. */
function release(deltaRad: number, frames = 400): Release {
  const camera = productionCamera();
  const pose = spherical(camera);
  const drift = createOrbitCameraDrift();
  const gesture = createOrbitGestureState();
  // The opening frame of the tail: `change` has fired and the window is open.
  orbitCameraDriftPx(drift, camera, TARGET, VIEWPORT);
  // ⚠️ The controls compare against the pose they last REPORTED, not against
  // the previous frame's, and only reset it when they fire. So the tail runs
  // until the whole REMAINING travel is under 1e-3 wu, not until one frame's
  // step is — which is why it lasts twice as long as a per-frame reading of
  // the same threshold would suggest, and why the last thirty events of it
  // are sporadic. (r169 `OrbitControls.update`, `EPS = 1e-6` against the
  // SQUARED distance, plus `8 * (1 - dot) > EPS` on the quaternion.)
  const reportedPosition = camera.position.clone();
  const reportedQuaternion = camera.quaternion.clone();
  const EPS = 1e-6;
  let pending = deltaRad;
  let settledAt: number | null = null;
  let latchEndsAt = 0;
  const px: number[] = [];
  for (let frame = 0; frame < frames; frame += 1) {
    pose.theta += pending * DAMPING;
    pending *= 1 - DAMPING;
    camera.position.copy(new THREE.Vector3().setFromSpherical(pose).add(TARGET));
    camera.lookAt(TARGET);
    camera.updateMatrixWorld(true);
    if (
      reportedPosition.distanceToSquared(camera.position) > EPS
      || 8 * (1 - reportedQuaternion.dot(camera.quaternion)) > EPS
    ) {
      reportedPosition.copy(camera.position);
      reportedQuaternion.copy(camera.quaternion);
      latchEndsAt = frame + 1;
      noteOrbitCameraChange(gesture);
    }
    const driftPx = orbitCameraDriftPx(drift, camera, TARGET, VIEWPORT);
    px.push(driftPx);
    const moving = settleOrbitCameraFrame(gesture, driftPx);
    if (!moving && settledAt === null) settledAt = frame + 1;
  }
  return { settledAt, latchEndsAt, drift: px };
}

describe('the motion window closes when the picture is still', () => {
  it('reads one frame of camera change in CSS pixels at the target depth', () => {
    const camera = productionCamera();
    const drift = createOrbitCameraDrift();
    // The first frame has no previous pose to measure against, so it is
    // motion by definition rather than a silent zero.
    expect(orbitCameraDriftPx(drift, camera, TARGET, VIEWPORT))
      .toBe(Number.POSITIVE_INFINITY);
    expect(orbitCameraDriftPx(drift, camera, TARGET, VIEWPORT)).toBe(0);

    // A pose change of a known angle: the focal length at fov 50 over 1080 px
    // is 1,158 px per radian, so a milliradian of orbit is ~1.16 px.
    const pose = spherical(camera);
    pose.theta += 0.001;
    camera.position.copy(new THREE.Vector3().setFromSpherical(pose).add(TARGET));
    camera.lookAt(TARGET);
    camera.updateMatrixWorld(true);
    expect(orbitCameraDriftPx(drift, camera, TARGET, VIEWPORT))
      .toBeGreaterThan(1);
    expect(orbitCameraDriftPx(drift, camera, TARGET, VIEWPORT))
      .toBeLessThan(1.4);
  });

  it('closes a release of 0.02 to 1.0 radians long before the change latch does', () => {
    // The table the review's damping probe left, and what the drift rule
    // makes of it. The `latch` column is the review's own measurement
    // (104/122/135/151), reproduced here off the same run, so the pair is
    // read from one curve.
    //
    // ⭐ The settle column is NOT `focalPx x delta x 0.08 x 0.92^n < 1`. An
    // orbit moves the camera ON a sphere, so `poseDriftPx` counts the travel
    // AND the rotation that came with it — about twice the screen motion a
    // reader sees — and the threshold is therefore crossed ~8 frames later
    // than the pixel arithmetic suggests (ln 2 / ln (1/0.92)). The reading is
    // conservative on purpose and the error keeps the window open longer,
    // which is the safe direction for the hit index.
    const table = [
      { delta: 0.02, settled: 19, latch: 104 },
      { delta: 0.1, settled: 38, latch: 122 },
      { delta: 0.3, settled: 51, latch: 135 },
      { delta: 1.0, settled: 66, latch: 151 },
    ];
    for (const row of table) {
      const played = release(row.delta);
      expect(played.settledAt, `delta ${row.delta}`).toBe(row.settled);
      // The latch is the instrument the review measured, reproduced here so
      // the pair is read off one run.
      expect(played.latchEndsAt, `latch ${row.delta}`).toBe(row.latch);
      expect(played.settledAt!).toBeLessThan(played.latchEndsAt / 2);
      // The window closes on the drift being spent, not on a timer: the
      // frames before it are over the threshold and the settle frames are
      // under it.
      expect(played.drift[played.settledAt! - 2])
        .toBeLessThanOrEqual(ORBIT_CAMERA_REST_DRIFT_PX);
      expect(played.drift[played.settledAt! - 1 - ORBIT_CAMERA_SETTLE_FRAMES])
        .toBeGreaterThan(ORBIT_CAMERA_REST_DRIFT_PX);
    }
  });

  it('hands picking back on the frame the window closes', () => {
    const camera = productionCamera();
    const drift = createOrbitCameraDrift();
    const gesture = createOrbitGestureState();
    orbitCameraDriftPx(drift, camera, TARGET, VIEWPORT);
    const pose = spherical(camera);
    let pending = 0.1;
    let resumedAt: number | null = null;
    for (let frame = 0; frame < 240; frame += 1) {
      pose.theta += pending * DAMPING;
      pending *= 1 - DAMPING;
      camera.position.copy(new THREE.Vector3().setFromSpherical(pose).add(TARGET));
      camera.lookAt(TARGET);
      camera.updateMatrixWorld(true);
      noteOrbitCameraChange(gesture);
      settleOrbitCameraFrame(gesture, orbitCameraDriftPx(drift, camera, TARGET, VIEWPORT));
      if (!orbitCameraSuspendsPicking(gesture) && resumedAt === null) {
        resumedAt = frame + 1;
        // The sampler's window closes on the same frame — the two verdicts
        // differ only by the un-moved press, and the hand has let go.
        expect(orbitInMotion(gesture)).toBe(false);
      }
    }
    expect(resumedAt).toBe(38);
  });

  it('does not resume under a hand that is still holding the camera', () => {
    // A drag paused mid-gesture has no drift at all, and must stay suspended:
    // the index it resumes on has to be the one the drag started with.
    const gesture = createOrbitGestureState();
    gesture.active = true;
    gesture.revisionNoted = true;
    noteOrbitCameraChange(gesture);
    for (let frame = 0; frame < 10; frame += 1) {
      settleOrbitCameraFrame(gesture, 0);
      expect(orbitCameraSuspendsPicking(gesture)).toBe(true);
      expect(orbitInMotion(gesture)).toBe(true);
    }
  });

  it('is unmoved by a drift reading that does not exist', () => {
    // Every caller that cannot measure drift — a Lab with no sentinel, a test
    // that predates the reading — gets the latch rule it always had.
    const gesture = createOrbitGestureState();
    for (let frame = 0; frame < 200; frame += 1) {
      noteOrbitCameraChange(gesture);
      expect(settleOrbitCameraFrame(gesture)).toBe(true);
    }
    expect(settleOrbitCameraFrame(gesture)).toBe(false);
  });
});

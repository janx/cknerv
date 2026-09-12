import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  CONSTELLATION_CAMERA_MOTION_PX,
  CONSTELLATION_CAMERA_REST_PX,
  CONSTELLATION_CAMERA_SETTLE_FRAMES,
  CONSTELLATION_CAMERA_SETTLE_MS,
  createCellConstellationCameraMotion,
  settleCellConstellationCameraMotion,
} from '../../../src/components/hud/cellConstellationCameraMotion';

const VIEWPORT_H = 1080;
const DISTANCE = 100;
const FRAME_MS = 1000 / 60;

function cameraAtRest(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1_000);
  camera.position.set(0, 0, DISTANCE);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  return camera;
}

/** World units of sideways translation that read as `px` of drift at the
 * anchor's depth, for a camera that does not turn. */
function unitsFor(camera: THREE.PerspectiveCamera, px: number): number {
  const focalPx = Math.abs(camera.projectionMatrix.elements[5]) * VIEWPORT_H * 0.5;
  return (px / focalPx) * DISTANCE;
}

/** OrbitControls' damping: the release speed decays by 0.92 a frame. */
function* dampingTail(camera: THREE.PerspectiveCamera, releasePx: number, frames: number) {
  let px = releasePx;
  for (let frame = 0; frame < frames; frame += 1) {
    camera.position.x += unitsFor(camera, px);
    camera.updateMatrixWorld(true);
    yield px;
    px *= 0.92;
  }
}

describe('selected Cell camera-motion gate', () => {
  it('declares rest within the settle window of the tail dropping under the rest drift, and never withdraws it', () => {
    for (const releasePx of [1, 5, 20, 40]) {
      const camera = cameraAtRest();
      const state = createCellConstellationCameraMotion();
      const anchor = new THREE.Vector3();
      settleCellConstellationCameraMotion(state, camera, anchor, VIEWPORT_H, 0);
      let atMs = 0;
      let frame = 0;
      let underRestAt = -1;
      let restAt = -1;
      const verdicts: boolean[] = [];
      for (const px of dampingTail(camera, releasePx, 240)) {
        frame += 1;
        atMs += FRAME_MS;
        if (underRestAt < 0 && px <= CONSTELLATION_CAMERA_REST_PX) underRestAt = frame;
        const moving = settleCellConstellationCameraMotion(state, camera, anchor, VIEWPORT_H, atMs);
        verdicts.push(moving);
        if (!moving && restAt < 0 && frame > 1) restAt = frame;
      }
      if (releasePx > CONSTELLATION_CAMERA_MOTION_PX) {
        // A fling is motion from its first frame…
        expect(verdicts[0], `release ${releasePx}`).toBe(true);
        // …and rest follows the tail dropping under the rest drift by exactly
        // the settle window, not by the second or two the old 0.02 px rule cost.
        expect(restAt, `release ${releasePx}`).toBeGreaterThanOrEqual(underRestAt);
        expect(restAt - underRestAt, `release ${releasePx}`)
          .toBeLessThanOrEqual(CONSTELLATION_CAMERA_SETTLE_FRAMES);
      } else {
        // A one-pixel nudge is not motion at all; the drift path carries it.
        expect(verdicts.every((moving) => !moving), `release ${releasePx}`).toBe(true);
      }
      // Once at rest the tail cannot climb back over the motion threshold, so
      // the verdict never flips back on: no leader flashes off again.
      const from = Math.max(restAt, 1);
      expect(verdicts.slice(from).some(Boolean), `release ${releasePx}`).toBe(false);
    }
  });

  it('opens on one frame over the motion drift, and on a projection change', () => {
    const camera = cameraAtRest();
    const anchor = new THREE.Vector3();
    const state = createCellConstellationCameraMotion();
    settleCellConstellationCameraMotion(state, camera, anchor, VIEWPORT_H, 0);
    camera.position.x += unitsFor(camera, CONSTELLATION_CAMERA_MOTION_PX + 1);
    camera.updateMatrixWorld(true);
    expect(settleCellConstellationCameraMotion(state, camera, anchor, VIEWPORT_H, FRAME_MS)).toBe(true);

    const zoomed = createCellConstellationCameraMotion();
    const other = cameraAtRest();
    settleCellConstellationCameraMotion(zoomed, other, anchor, VIEWPORT_H, 0);
    other.fov = 58;
    other.updateProjectionMatrix();
    expect(settleCellConstellationCameraMotion(zoomed, other, anchor, VIEWPORT_H, FRAME_MS)).toBe(true);

    const turned = createCellConstellationCameraMotion();
    const third = cameraAtRest();
    settleCellConstellationCameraMotion(turned, third, anchor, VIEWPORT_H, 0);
    third.rotateY(0.005); // ≈ 4.7 px at this focal length
    third.updateMatrixWorld(true);
    expect(settleCellConstellationCameraMotion(turned, third, anchor, VIEWPORT_H, FRAME_MS)).toBe(true);
  });

  it('treats motion under the threshold as drift, not as a camera move', () => {
    // The canopy turns the anchor a few hundredths of a pixel a frame at
    // inspection tempo, and a slow deliberate orbit stays under the threshold
    // too: both are the drift path's, with the leaders up and re-anchored.
    const camera = cameraAtRest();
    const anchor = new THREE.Vector3();
    const state = createCellConstellationCameraMotion();
    settleCellConstellationCameraMotion(state, camera, anchor, VIEWPORT_H, 0);
    let atMs = 0;
    for (let frame = 1; frame <= 120; frame += 1) {
      camera.position.x += unitsFor(camera, CONSTELLATION_CAMERA_MOTION_PX - 0.5);
      camera.updateMatrixWorld(true);
      atMs += FRAME_MS;
      expect(settleCellConstellationCameraMotion(state, camera, anchor, VIEWPORT_H, atMs)).toBe(false);
    }
  });

  it('holds the motion window while the drift sits between rest and motion, then waits the full settle window', () => {
    const camera = cameraAtRest();
    const anchor = new THREE.Vector3();
    const state = createCellConstellationCameraMotion();
    settleCellConstellationCameraMotion(state, camera, anchor, VIEWPORT_H, 0);
    let atMs = 0;
    const step = (px: number) => {
      camera.position.x += unitsFor(camera, px);
      camera.updateMatrixWorld(true);
      atMs += FRAME_MS;
      return settleCellConstellationCameraMotion(state, camera, anchor, VIEWPORT_H, atMs);
    };
    expect(step(10)).toBe(true);
    // Hysteresis: 2.5 px a frame is under the motion drift but over the rest
    // drift, so an open window stays open.
    for (let frame = 0; frame < 10; frame += 1) expect(step(2.5)).toBe(true);
    // Under the rest drift: the settle window has to run its course.
    for (let frame = 1; frame < CONSTELLATION_CAMERA_SETTLE_FRAMES; frame += 1) {
      expect(step(CONSTELLATION_CAMERA_REST_PX)).toBe(true);
    }
    expect(step(CONSTELLATION_CAMERA_REST_PX)).toBe(false);
    expect(CONSTELLATION_CAMERA_SETTLE_FRAMES * FRAME_MS).toBeGreaterThanOrEqual(CONSTELLATION_CAMERA_SETTLE_MS);
  });

  it('will not settle on a burst of frames that spans no wall time', () => {
    const camera = cameraAtRest();
    const anchor = new THREE.Vector3();
    const state = createCellConstellationCameraMotion();
    settleCellConstellationCameraMotion(state, camera, anchor, VIEWPORT_H, 0);
    camera.position.x += unitsFor(camera, 10);
    camera.updateMatrixWorld(true);
    expect(settleCellConstellationCameraMotion(state, camera, anchor, VIEWPORT_H, 10)).toBe(true);
    // Queued animation frames after a tab comes back: three frames, one ms.
    for (let frame = 0; frame < CONSTELLATION_CAMERA_SETTLE_FRAMES + 2; frame += 1) {
      expect(settleCellConstellationCameraMotion(state, camera, anchor, VIEWPORT_H, 10.3 + frame * 0.1)).toBe(true);
    }
    expect(settleCellConstellationCameraMotion(
      state, camera, anchor, VIEWPORT_H, 10 + CONSTELLATION_CAMERA_SETTLE_MS + 1,
    )).toBe(false);
  });
});

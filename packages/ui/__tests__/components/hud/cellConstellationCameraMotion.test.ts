import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  CONSTELLATION_CAMERA_SETTLE_MS,
  createCellConstellationCameraMotion,
  settleCellConstellationCameraMotion,
} from '../../../src/components/hud/cellConstellationCameraMotion';

function cameraAtRest(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1_000);
  camera.position.set(0, 0, 100);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  return camera;
}

describe('selected Cell camera-motion gate', () => {
  it('covers a real damping tail and restores once without flashing back off', () => {
    const camera = cameraAtRest();
    const state = createCellConstellationCameraMotion();
    const anchor = new THREE.Vector3();
    expect(settleCellConstellationCameraMotion(state, camera, anchor, 1_080, 0)).toBe(false);

    let atMs = 16;
    let velocity = 0.2;
    let firstRestFrame = -1;
    const verdicts: boolean[] = [];
    for (let frame = 0; frame < 360; frame += 1) {
      camera.position.x += velocity;
      velocity *= 0.92;
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld(true);
      const moving = settleCellConstellationCameraMotion(
        state, camera, anchor, 1_080, atMs,
      );
      verdicts.push(moving);
      if (!moving && firstRestFrame < 0) firstRestFrame = frame;
      atMs += 1_000 / 60;
    }

    expect(verdicts[0]).toBe(true);
    expect(firstRestFrame).toBeGreaterThan(20);
    expect(verdicts.slice(firstRestFrame)).toEqual(
      Array(verdicts.length - firstRestFrame).fill(false),
    );
  });

  it('detects accumulated position, direction and projection changes', () => {
    const camera = cameraAtRest();
    const anchor = new THREE.Vector3();

    const slow = createCellConstellationCameraMotion();
    expect(settleCellConstellationCameraMotion(slow, camera, anchor, 1_080, 0)).toBe(false);
    let moving = false;
    for (let frame = 1; frame <= 10; frame += 1) {
      camera.position.x += 0.002;
      camera.updateMatrixWorld(true);
      moving = settleCellConstellationCameraMotion(
        slow, camera, anchor, 1_080, frame * 16,
      );
      if (moving) break;
    }
    expect(moving).toBe(true);

    const direction = createCellConstellationCameraMotion();
    camera.position.set(0, 0, 100);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    settleCellConstellationCameraMotion(direction, camera, anchor, 1_080, 0);
    camera.rotateY(0.001);
    camera.updateMatrixWorld(true);
    expect(settleCellConstellationCameraMotion(
      direction, camera, anchor, 1_080, 16,
    )).toBe(true);

    const projection = createCellConstellationCameraMotion();
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    settleCellConstellationCameraMotion(projection, camera, anchor, 1_080, 0);
    camera.fov = 58;
    camera.updateProjectionMatrix();
    expect(settleCellConstellationCameraMotion(
      projection, camera, anchor, 1_080, 16,
    )).toBe(true);
  });

  it('waits for the bounded stable window before declaring rest', () => {
    const camera = cameraAtRest();
    const state = createCellConstellationCameraMotion();
    const anchor = new THREE.Vector3();
    settleCellConstellationCameraMotion(state, camera, anchor, 900, 0);
    camera.position.x = 1;
    camera.updateMatrixWorld(true);
    expect(settleCellConstellationCameraMotion(state, camera, anchor, 900, 10)).toBe(true);

    expect(settleCellConstellationCameraMotion(state, camera, anchor, 900, 30)).toBe(true);
    expect(settleCellConstellationCameraMotion(state, camera, anchor, 900, 60)).toBe(true);
    expect(settleCellConstellationCameraMotion(
      state, camera, anchor, 900, 10 + CONSTELLATION_CAMERA_SETTLE_MS,
    )).toBe(false);
  });
});

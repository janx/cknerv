import { describe, expect, it } from 'vitest';
import {
  frameShapeTurned,
  reframeOwnedCameraForAspect,
} from '../src/CameraFraming';

function stage(distance: number, azimuth = Math.PI / 4, elevation = 0.55) {
  const target = { x: 0, y: 38, z: 0 };
  const position = {
    x: target.x + Math.cos(elevation) * Math.cos(azimuth) * distance,
    y: target.y + Math.sin(elevation) * distance,
    z: target.z + Math.cos(elevation) * Math.sin(azimuth) * distance,
    set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; },
  };
  let updates = 0;
  return {
    camera: { position, updateMatrixWorld() {} },
    controls: { target, update() { updates += 1; } },
    updates: () => updates,
    /** The reader\'s viewing angle, as a unit ray from the target. */
    ray() {
      const dx = position.x - target.x;
      const dy = position.y - target.y;
      const dz = position.z - target.z;
      const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
      return { dx: dx / length, dy: dy / length, dz: dz / length, length };
    },
  };
}

const landscape = { width: 1180, height: 763, hole: { left: 540, right: 1160 } };
const portrait = { width: 820, height: 1180, hole: { left: 20, right: 800 } };

describe('rotation re-frames a camera the reader owns', () => {
  it('changes the distance and NOTHING about the angle', () => {
    // The reader orbited, so `camera-hole-fit` has stopped fitting. Turning
    // the device is not a preference being overridden — it is the aperture
    // changing shape, and a pose composed for 1180x763 is not a composition
    // at all in 763x1180.
    const it_ = stage(171);
    const before = it_.ray();
    const moved = reframeOwnedCameraForAspect(
      it_.camera, it_.controls, portrait, landscape.width / landscape.height,
      portrait.width / portrait.height,
    );
    expect(moved).toBe(true);
    const after = it_.ray();
    expect(after.dx).toBeCloseTo(before.dx, 12);
    expect(after.dy).toBeCloseTo(before.dy, 12);
    expect(after.dz).toBeCloseTo(before.dz, 12);
    expect(after.length).not.toBeCloseTo(before.length, 1);
    // The target is what they chose to LOOK AT; sliding it would move the
    // subject out from under them.
    expect(it_.controls.target).toEqual({ x: 0, y: 38, z: 0, update: it_.controls.target.update });
    expect(it_.updates()).toBe(1);
  });

  it('ignores every frame change that is not the frame TURNING', () => {
    // A rail collapsing, a banner arriving, a one-pixel resize — and a
    // desktop window dragged from 16:9 to 16:10, which moves the aspect by
    // nearly two tenths and is emphatically not a rotation. A magnitude
    // would have caught that one; crossing 1 is a difference in kind.
    const it_ = stage(171);
    const before = it_.ray();
    const aspect = landscape.width / landscape.height;
    for (const other of [aspect, aspect + 0.001, 1920 / 1080, 1440 / 900, 1.0001]) {
      expect(reframeOwnedCameraForAspect(
        it_.camera, it_.controls, landscape, aspect, other,
      )).toBe(false);
    }
    expect(it_.ray().length).toBeCloseTo(before.length, 12);
    expect(it_.updates()).toBe(0);
  });

  it('names the line as a turn, not as a distance', () => {
    expect(frameShapeTurned(1920 / 1080, 1440 / 900)).toBe(false);
    expect(frameShapeTurned(1180 / 763, 763 / 1180)).toBe(true);
    expect(frameShapeTurned(0.9, 1.1)).toBe(true);
    // A square frame belongs to one side of the line and stays there.
    expect(frameShapeTurned(1, 1.4)).toBe(false);
    expect(frameShapeTurned(1, 0.7)).toBe(true);
    expect(frameShapeTurned(null, 0.7)).toBe(false);
    expect(frameShapeTurned(Number.NaN, 0.7)).toBe(false);
  });

  it('has nothing to compare against on the first frame it sees', () => {
    const it_ = stage(171);
    expect(reframeOwnedCameraForAspect(
      it_.camera, it_.controls, portrait, null, portrait.width / portrait.height,
    )).toBe(false);
  });

  it('refuses a distance the reader would not see move', () => {
    // Already standing where the new frame wants it: a sub-unit correction
    // reads as the view twitching and buys nothing.
    const it_ = stage(171);
    const fitted = stage(171);
    reframeOwnedCameraForAspect(
      fitted.camera, fitted.controls, portrait,
      landscape.width / landscape.height, portrait.width / portrait.height,
    );
    const settled = stage(fitted.ray().length);
    expect(reframeOwnedCameraForAspect(
      settled.camera, settled.controls, portrait,
      landscape.width / landscape.height, portrait.width / portrait.height,
    )).toBe(false);
    expect(it_.ray().length).toBeCloseTo(171, 9);
  });

  it('survives a degenerate frame without moving anything', () => {
    const it_ = stage(171);
    expect(reframeOwnedCameraForAspect(
      it_.camera, it_.controls, portrait, Number.NaN, portrait.width / portrait.height,
    )).toBe(false);
    expect(reframeOwnedCameraForAspect(
      it_.camera, it_.controls, portrait, 1.5, Number.NaN,
    )).toBe(false);
  });
});

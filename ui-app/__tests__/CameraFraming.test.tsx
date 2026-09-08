import { act, cleanup, render, renderHook } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { PerspectiveCamera, Vector3 } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CameraFraming, { useInitialStageCamera } from '../src/CameraFraming';
import { createOrbitGestureState } from '../src/orbit-gesture-state';
import { fitCameraToHole } from '../src/camera-hole-fit';
import { CELLS_Y, type HudCameraFrame } from '@cknerv/ui';

const runtime = vi.hoisted(() => ({
  camera: null as PerspectiveCamera | null,
  frame: null as (() => void) | null,
}));
vi.mock('@react-three/fiber', () => ({
  useThree: (selector: (state: { camera: PerspectiveCamera }) => unknown) => selector({ camera: runtime.camera! }),
  useFrame: (callback: () => void) => { runtime.frame = callback; },
}));

const wide: HudCameraFrame = { width: 1920, height: 1080, hole: { left: 384, right: 1574 } };
const narrow: HudCameraFrame = { width: 1440, height: 900, hole: { left: 312, right: 1186 } };

function expectPose(camera: PerspectiveCamera, target: Vector3, frame: HudCameraFrame) {
  const fit = fitCameraToHole({ hole: frame.hole, viewportWidth: frame.width, viewportHeight: frame.height, fov: 50 });
  expect(camera.position.toArray()).toEqual([fit.position[0], fit.position[1] + CELLS_Y, fit.position[2]]);
  expect(target.toArray()).toEqual([fit.targetX, CELLS_Y, 0]);
  const forward = target.clone().sub(camera.position).normalize();
  expect(camera.getWorldDirection(new Vector3()).distanceTo(forward)).toBeLessThan(1e-12);
  expect(camera.fov).toBe(50);
}

beforeEach(() => { runtime.camera = new PerspectiveCamera(50, 1920 / 1080, 1, 3000); });
afterEach(() => { cleanup(); });

describe('initial camera', () => {
  it.each([wide, narrow])('is already fitted before its first rendered frame ($width px)', (frame) => {
    const { result, rerender } = renderHook(({ layout }) => useInitialStageCamera(layout), {
      initialProps: { layout: null as HudCameraFrame | null },
    });
    expect(result.current).toBeNull();
    rerender({ layout: frame });
    const initial = result.current!;
    expectPose(initial.camera, new Vector3(...initial.target), frame);
    expect(initial.camera.aspect).toBe(frame.width / frame.height);
    expect(initial.camera.near).toBe(1);
    expect(initial.camera.far).toBe(3000);
    // Props used to initialize R3F and OrbitControls must remain stable even
    // when a later frame arrives: the controller decides whether it may fit.
    initial.camera.position.set(10, 20, 30);
    rerender({ layout: { ...frame, width: frame.width + 100 } });
    expect(result.current).toBe(initial);
    expect(initial.camera.position.toArray()).toEqual([10, 20, 30]);
  });
});

function setup() {
  const target = new Vector3();
  const update = vi.fn(() => { runtime.camera!.lookAt(target); });
  const controlsRef = { current: { target, update } } as unknown as ComponentProps<typeof CameraFraming>['controlsRef'];
  const props = {
    frame: wide,
    controlsRef,
    gestureRef: { current: createOrbitGestureState() },
    automationActiveRef: { current: false },
    manualRevision: 0,
  };
  return { props, target, update, view: render(<CameraFraming {...props} />) };
}

describe('subsequent camera framing', () => {
  it('fits before paint and remains still across rendering and data updates', () => {
    const { props, target, update, view } = setup();
    expectPose(runtime.camera!, target, wide);
    const position = runtime.camera!.position.clone();
    const quaternion = runtime.camera!.quaternion.clone();
    const projection = runtime.camera!.projectionMatrix.clone();
    view.rerender(<CameraFraming {...props} />);
    act(() => { for (let i = 0; i < 120; i++) runtime.frame!(); });
    expect(update).toHaveBeenCalledTimes(1);
    expect(runtime.camera!.position).toEqual(position);
    expect(runtime.camera!.quaternion.toArray()).toEqual(quaternion.toArray());
    expect(runtime.camera!.projectionMatrix).toEqual(projection);
    view.rerender(<CameraFraming {...props} frame={narrow} />);
    expectPose(runtime.camera!, target, narrow);
    expect(update).toHaveBeenCalledTimes(2);
  });

  it.each(['gesture', 'flight', 'completed gesture'] as const)('keeps user ownership after a %s ends', (kind) => {
    const { props, update, view } = setup();
    if (kind === 'gesture') props.gestureRef.current.active = true;
    if (kind === 'flight') props.automationActiveRef.current = true;
    if (kind === 'completed gesture') props.manualRevision = 1;
    view.rerender(<CameraFraming {...props} />);
    act(() => runtime.frame!());
    props.gestureRef.current.active = false;
    props.automationActiveRef.current = false;
    runtime.camera!.position.set(10, 20, 30);
    view.rerender(<CameraFraming {...props} frame={narrow} />);
    expect(runtime.camera!.position.toArray()).toEqual([10, 20, 30]);
    expect(update).toHaveBeenCalledTimes(1);
  });
});

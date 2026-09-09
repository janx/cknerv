import { useLayoutEffect, useRef } from 'react';
import type { ElementRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { OrbitControls } from '@react-three/drei';
import { PerspectiveCamera } from 'three';
import { CELLS_Y, type HudCameraFrame } from '@cknerv/ui';
import { fitCameraToHole } from './camera-hole-fit';
import type { OrbitGestureState } from './orbit-gesture-state';

const CAMERA_FOV = 50;

function cameraPose(frame: HudCameraFrame) {
  const fit = fitCameraToHole({
    hole: frame.hole,
    viewportWidth: frame.width,
    viewportHeight: frame.height,
    fov: CAMERA_FOV,
  });
  return {
    position: [fit.position[0], fit.position[1] + CELLS_Y, fit.position[2]] as const,
    target: [fit.targetX, CELLS_Y, 0] as const,
  };
}

/** Canvas and controls start from one fitted pose. Keep both identities for
 * the lifetime of the Canvas: new layout props must never overwrite a camera
 * the reader has taken over. CameraFraming owns subsequent permitted fits. */
export function useInitialStageCamera(frame: HudCameraFrame | null) {
  const initial = useRef<{
    camera: PerspectiveCamera;
    target: [number, number, number];
  } | null>(null);
  if (initial.current === null && frame !== null) {
    const pose = cameraPose(frame);
    const camera = new PerspectiveCamera(CAMERA_FOV, frame.width / frame.height, 1, 3000);
    camera.position.set(...pose.position);
    camera.lookAt(...pose.target);
    camera.updateMatrixWorld();
    initial.current = { camera, target: [...pose.target] };
  }
  return initial.current;
}

export default function CameraFraming({
  frame, controlsRef, gestureRef, automationActiveRef, manualRevision,
}: {
  frame: HudCameraFrame;
  controlsRef: { readonly current: ElementRef<typeof OrbitControls> | null };
  gestureRef: { readonly current: OrbitGestureState };
  automationActiveRef: { readonly current: boolean };
  manualRevision: number;
}) {
  const camera = useThree((state) => state.camera);
  const owned = useRef(false);
  const takeOwnership = () => {
    if (gestureRef.current.active || automationActiveRef.current || manualRevision > 0) {
      owned.current = true;
    }
    return owned.current;
  };
  // Route flights live in the frame loop. Latch their ownership even if a
  // whole flight finishes before the next window or panel-layout change.
  useFrame(() => { takeOwnership(); });
  const framedAspect = useRef<number | null>(null);
  useLayoutEffect(() => {
    const aspect = frame.height > 0 ? frame.width / frame.height : Number.NaN;
    const previousAspect = framedAspect.current;
    framedAspect.current = Number.isFinite(aspect) ? aspect : previousAspect;

    if (!takeOwnership()) {
      const pose = cameraPose(frame);
      camera.position.set(...pose.position);
      const controls = controlsRef.current;
      if (controls) {
        controls.target.set(...pose.target);
        controls.update();
      } else {
        camera.lookAt(...pose.target);
      }
      camera.updateMatrixWorld();
      return;
    }
    reframeOwnedCameraForAspect(
      camera,
      controlsRef.current,
      frame,
      previousAspect,
      aspect,
    );
  }, [frame, camera, controlsRef, gestureRef, automationActiveRef, manualRevision]);
  return null;
}

/**
 * Has the frame TURNED — gone from wider-than-tall to taller-than-wide, or
 * back.
 *
 * This is the whole test, and a magnitude would have been the wrong one. A
 * rail collapsing, a banner arriving, a window dragged from 16:9 to 16:10:
 * all of those publish a new frame and some of them move the aspect by more
 * than a tenth, and not one of them is an event that entitles this module to
 * touch a camera the reader has taken. Crossing 1 is different in kind, not
 * in degree — a composition solved against the hole's WIDTH cannot survive
 * the width becoming the short side — and on a tablet it is exactly what
 * turning the device does, every time, and the only thing that does it.
 *
 * A desktop reader who drags a window from landscape to portrait crosses it
 * too, and gets the same re-frame. That is the right answer for the same
 * reason: their frame turned.
 */
export function frameShapeTurned(
  previousAspect: number | null,
  aspect: number,
): boolean {
  if (previousAspect === null) return false;
  if (!Number.isFinite(aspect) || !Number.isFinite(previousAspect)) return false;
  return (previousAspect >= 1) !== (aspect >= 1);
}

/** How far the fitted distance must move before it is worth spending on a
 *  reader who has taken the camera: under this the subject would not visibly
 *  change size and the move would only read as the view twitching. */
const REFRAME_MIN_DISTANCE_DELTA = 1;

/**
 * ROTATION RE-FRAMES THE DISTANCE, AND NEVER THE READER'S ANGLE.
 *
 * `camera-hole-fit` stops fitting the moment a reader orbits, and that is
 * right for everything it was written against: a panel toggling, a banner
 * arriving, data landing. None of those are the reader changing their mind,
 * but none of them change the SHAPE of the frame either — and on a tablet one
 * event does. Turning the device is not a preference being overridden; it is
 * the picture's own aperture changing from 1180x763 to 763x1180, and a
 * composition fitted to the first is not a composition at all in the second.
 * Before this, a reader who had orbited once kept their pose for the session
 * and every rotation after it was uncomposed.
 *
 * So the aspect gets the one thing it is entitled to and nothing else: the
 * LENGTH of the view ray. Azimuth and elevation are the reader's — they chose
 * where to stand — and the target is what they chose to look AT, so sliding
 * it would move the subject out from under them. Both are preserved exactly;
 * only how far back the camera stands is re-solved, against the hole the new
 * frame leaves.
 */
export function reframeOwnedCameraForAspect(
  camera: { position: { x: number; y: number; z: number; set(x: number, y: number, z: number): void }; updateMatrixWorld(): void },
  controls: { target: { x: number; y: number; z: number }; update(): void } | null,
  frame: HudCameraFrame,
  previousAspect: number | null,
  aspect: number,
): boolean {
  if (!frameShapeTurned(previousAspect, aspect)) return false;

  const fit = fitCameraToHole({
    hole: frame.hole,
    viewportWidth: frame.width,
    viewportHeight: frame.height,
    fov: CAMERA_FOV,
  });
  // The reader's own target, not the fitted one: they chose what to look at.
  const targetX = controls ? controls.target.x : 0;
  const targetY = controls ? controls.target.y : CELLS_Y;
  const targetZ = controls ? controls.target.z : 0;
  const rayX = camera.position.x - targetX;
  const rayY = camera.position.y - targetY;
  const rayZ = camera.position.z - targetZ;
  const held = Math.sqrt(rayX * rayX + rayY * rayY + rayZ * rayZ);
  if (!(held > 0) || Math.abs(fit.distance - held) < REFRAME_MIN_DISTANCE_DELTA) {
    return false;
  }
  const scale = fit.distance / held;
  camera.position.set(
    targetX + rayX * scale,
    targetY + rayY * scale,
    targetZ + rayZ * scale,
  );
  controls?.update();
  camera.updateMatrixWorld();
  return true;
}

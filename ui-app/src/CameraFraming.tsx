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
  useLayoutEffect(() => {
    if (takeOwnership()) return;
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
  }, [frame, camera, controlsRef, gestureRef, automationActiveRef, manualRevision]);
  return null;
}

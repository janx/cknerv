import { useEffect, useRef, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useReducedMotion } from '../components/hud/useReducedMotion';
import { deriveConsensusRouteCameraPose, consensusRouteHopWorldPosition } from '../derives/consensusRouteCamera.derive';
import { useCellGalaxy } from '../hooks/cellGalaxyContext';
import { galaxyFrame } from '../tweaks/galaxyFrame';
import type { ConsensusMemoryRouteHopFocus } from './consensusMemoryTrace';

const CAMERA_RESPONSE = 6.5;
const POSITION_EPSILON_SQ = 0.0025;
const TARGET_EPSILON_SQ = 0.001;
export const CONSENSUS_ROUTE_CAMERA_RELEASE_HOLD_SECONDS = 0.32;

/** The small OrbitControls surface needed by the route camera. */
export interface ConsensusRouteCameraControls {
  target: THREE.Vector3;
  update: () => void;
}

export interface ConsensusRouteCameraProps {
  /** Only a persistent route lock belongs here; hover previews must not move the camera. */
  focus?: ConsensusMemoryRouteHopFocus | null;
  controlsRef: RefObject<ConsensusRouteCameraControls | null>;
  /** Incremented by the host whenever OrbitControls starts a manual gesture. */
  manualRevision?: number;
  /** Keep the verified framing while its route afterimage begins to recede. */
  releaseHoldSeconds?: number;
}

interface CameraPoseVectors {
  position: THREE.Vector3;
  target: THREE.Vector3;
}

interface CameraSession {
  returnPose: CameraPoseVectors;
  manuallyAdjusted: boolean;
}

interface CameraTransition {
  pose: CameraPoseVectors;
  restoring: boolean;
}

interface CameraReleaseHold {
  pose: CameraPoseVectors;
  remainingSeconds: number;
}

function poseVectors(
  position: readonly [number, number, number],
  target: readonly [number, number, number],
): CameraPoseVectors {
  return {
    position: new THREE.Vector3(...position),
    target: new THREE.Vector3(...target),
  };
}

/**
 * Frames a locked consensus route hop while leaving hover inspection passive.
 * A route-lock session remembers the incoming view and restores it on release,
 * unless the viewer has manually taken control in the meantime.
 */
export default function ConsensusRouteCamera({
  focus = null,
  controlsRef,
  manualRevision = 0,
  releaseHoldSeconds = CONSENSUS_ROUTE_CAMERA_RELEASE_HOLD_SECONDS,
}: ConsensusRouteCameraProps) {
  const reducedMotion = useReducedMotion();
  const camera = useThree((state) => state.camera);
  const cellsCache = useCellGalaxy();
  const sessionRef = useRef<CameraSession | null>(null);
  const transitionRef = useRef<CameraTransition | null>(null);
  const releaseHoldRef = useRef<CameraReleaseHold | null>(null);
  const manualRevisionRef = useRef(manualRevision);

  const focusedCell = focus ? cellsCache.cells.get(focus.cellId) ?? null : null;
  const cellX = focusedCell?.pos_seed[0] ?? null;
  const cellY = focusedCell?.pos_seed[1] ?? null;
  const cellZ = focusedCell?.pos_seed[2] ?? null;

  useEffect(() => {
    if (manualRevisionRef.current === manualRevision) return;
    manualRevisionRef.current = manualRevision;
    const session = sessionRef.current;
    if (!session) return;
    session.manuallyAdjusted = true;
    transitionRef.current = null;
    if (releaseHoldRef.current) {
      releaseHoldRef.current = null;
      sessionRef.current = null;
    }
  }, [manualRevision]);

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;

    if (focus && cellX !== null && cellY !== null && cellZ !== null) {
      releaseHoldRef.current = null;
      if (!sessionRef.current) {
        sessionRef.current = {
          returnPose: {
            position: camera.position.clone(),
            target: controls.target.clone(),
          },
          manuallyAdjusted: false,
        };
      }
      const hopWorld = consensusRouteHopWorldPosition(
        [cellX, cellY, cellZ],
        galaxyFrame.rotationY,
      );
      const pose = deriveConsensusRouteCameraPose(
        camera.position.toArray(),
        controls.target.toArray(),
        hopWorld,
      );
      transitionRef.current = {
        pose: poseVectors(pose.position, pose.target),
        restoring: false,
      };
      return;
    }

    const session = sessionRef.current;
    if (!session) return;
    if (session.manuallyAdjusted) {
      sessionRef.current = null;
      transitionRef.current = null;
      releaseHoldRef.current = null;
      return;
    }
    const holdSeconds = reducedMotion || !Number.isFinite(releaseHoldSeconds)
      ? 0
      : Math.max(0, releaseHoldSeconds);
    if (holdSeconds > 0) {
      transitionRef.current = null;
      releaseHoldRef.current = {
        pose: session.returnPose,
        remainingSeconds: holdSeconds,
      };
      return;
    }
    transitionRef.current = {
      pose: session.returnPose,
      restoring: true,
    };
  }, [
    camera,
    cellX,
    cellY,
    cellZ,
    controlsRef,
    focus?.cellId,
    focus?.hopIndex,
    focus?.sourceId,
    focus?.targetCellId,
    focus?.traceKey,
    reducedMotion,
    releaseHoldSeconds,
  ]);

  useFrame((_, deltaSeconds) => {
    const releaseHold = releaseHoldRef.current;
    if (releaseHold) {
      releaseHold.remainingSeconds -= Math.min(Math.max(deltaSeconds, 0), 0.1);
      if (releaseHold.remainingSeconds > 0) return;
      releaseHoldRef.current = null;
      transitionRef.current = {
        pose: releaseHold.pose,
        restoring: true,
      };
    }
    const transition = transitionRef.current;
    const controls = controlsRef.current;
    if (!transition || !controls) return;

    const alpha = 1 - Math.exp(-Math.min(deltaSeconds, 0.1) * CAMERA_RESPONSE);
    camera.position.lerp(transition.pose.position, alpha);
    controls.target.lerp(transition.pose.target, alpha);
    controls.update();

    if (
      camera.position.distanceToSquared(transition.pose.position) > POSITION_EPSILON_SQ
      || controls.target.distanceToSquared(transition.pose.target) > TARGET_EPSILON_SQ
    ) return;

    camera.position.copy(transition.pose.position);
    controls.target.copy(transition.pose.target);
    controls.update();
    transitionRef.current = null;
    if (transition.restoring) sessionRef.current = null;
  });

  return null;
}

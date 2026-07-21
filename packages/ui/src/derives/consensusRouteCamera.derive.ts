import { CELLS_Y } from '../layout';
import type { Vec3 } from '../types';

export const CONSENSUS_ROUTE_CAMERA_DISTANCE = 36;
export const CONSENSUS_RECORD_CAMERA_DISTANCE = 64;
export const CONSENSUS_RECORD_CAMERA_NEUTRAL_MIN_DISTANCE = 96;

export interface ConsensusRouteCameraPose {
  position: Vec3;
  target: Vec3;
}

export type ConsensusRecordCameraIntent = 'idle' | 'neutral' | 'record';

/**
 * A record switch is a composition change, never a route. The pending edge
 * enters neutral space once; only an exact old→new record identity change may
 * later frame the new record target.
 */
export function deriveConsensusRecordCameraIntent(
  previousRecordIdentity: string | null,
  recordIdentity: string | null,
  previousSwitchPending: boolean,
  switchPending: boolean,
  hasRecordTarget: boolean,
): ConsensusRecordCameraIntent {
  const recordChanged = previousRecordIdentity !== null
    && recordIdentity !== null
    && previousRecordIdentity !== recordIdentity
    && hasRecordTarget;
  if (recordChanged) return 'record';
  return switchPending && !previousSwitchPending ? 'neutral' : 'idle';
}

/** Project one Cell's rotating galaxy-local seed into current world space. */
export function consensusRouteHopWorldPosition(
  posSeed: Vec3,
  rotationY: number,
): Vec3 {
  const angle = Number.isFinite(rotationY) ? rotationY : 0;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return [
    posSeed[0] * cosine + posSeed[2] * sine,
    CELLS_Y + posSeed[1],
    -posSeed[0] * sine + posSeed[2] * cosine,
  ];
}

/** Preserve the current viewing direction while framing one route Cell. */
export function deriveConsensusRouteCameraPose(
  currentPosition: Vec3,
  currentTarget: Vec3,
  hopWorld: Vec3,
  distance = CONSENSUS_ROUTE_CAMERA_DISTANCE,
): ConsensusRouteCameraPose {
  let dx = currentPosition[0] - currentTarget[0];
  let dy = currentPosition[1] - currentTarget[1];
  let dz = currentPosition[2] - currentTarget[2];
  let length = Math.hypot(dx, dy, dz);
  if (!Number.isFinite(length) || length < 1e-6) {
    dx = 1;
    dy = 0.72;
    dz = 1;
    length = Math.hypot(dx, dy, dz);
  }
  const framedDistance = Number.isFinite(distance) && distance > 0
    ? distance
    : CONSENSUS_ROUTE_CAMERA_DISTANCE;
  const scale = framedDistance / length;
  return {
    target: [...hopWorld],
    position: [
      hopWorld[0] + dx * scale,
      hopWorld[1] + dy * scale,
      hopWorld[2] + dz * scale,
    ],
  };
}

/** Broadly frame one verified record target, without choosing a route hop. */
export function deriveConsensusRecordCameraPose(
  currentPosition: Vec3,
  currentTarget: Vec3,
  recordWorld: Vec3,
  distance = CONSENSUS_RECORD_CAMERA_DISTANCE,
): ConsensusRouteCameraPose {
  return deriveConsensusRouteCameraPose(
    currentPosition,
    currentTarget,
    recordWorld,
    distance,
  );
}

/**
 * Return to the pre-session target and widen along the current view ray. No
 * Cell position participates, so this pose cannot imply an A→B relationship.
 */
export function deriveConsensusRecordNeutralCameraPose(
  currentPosition: Vec3,
  currentTarget: Vec3,
  returnPosition: Vec3,
  returnTarget: Vec3,
  minimumDistance = CONSENSUS_RECORD_CAMERA_NEUTRAL_MIN_DISTANCE,
): ConsensusRouteCameraPose {
  const returnDistance = Math.hypot(
    returnPosition[0] - returnTarget[0],
    returnPosition[1] - returnTarget[1],
    returnPosition[2] - returnTarget[2],
  );
  const safeMinimum = Number.isFinite(minimumDistance) && minimumDistance > 0
    ? minimumDistance
    : CONSENSUS_RECORD_CAMERA_NEUTRAL_MIN_DISTANCE;
  const distance = Number.isFinite(returnDistance)
    ? Math.max(returnDistance, safeMinimum)
    : safeMinimum;
  return deriveConsensusRouteCameraPose(
    currentPosition,
    currentTarget,
    returnTarget,
    distance,
  );
}

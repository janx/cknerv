import { CELLS_Y } from '../layout';
import type { Vec3 } from '../types';

export const CONSENSUS_ROUTE_CAMERA_DISTANCE = 36;

export interface ConsensusRouteCameraPose {
  position: Vec3;
  target: Vec3;
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

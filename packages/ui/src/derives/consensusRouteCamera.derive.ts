import { CELLS_Y } from '../layout';
import type { Vec3 } from '../types';

export const CONSENSUS_ROUTE_CAMERA_DISTANCE = 36;
export const CONSENSUS_RECORD_CAMERA_DISTANCE = 64;
export const CONSENSUS_RECORD_CAMERA_NEUTRAL_MIN_DISTANCE = 96;
export const CONSENSUS_RECORD_CAMERA_SAFE_WIDTH_PX = 192;
export const CONSENSUS_RECORD_CAMERA_SAFE_HEIGHT_PX = 144;
export const CONSENSUS_RECORD_CAMERA_SAFE_MARGIN_PX = 18;
export const CONSENSUS_RECORD_CAMERA_HUD_GAP_PX = 14;
export const CONSENSUS_RECORD_CAMERA_PREFERRED_Y_RATIO = 0.44;

export interface ConsensusRouteCameraPose {
  position: Vec3;
  target: Vec3;
}

export interface ConsensusRecordCameraScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface ConsensusRecordCameraComposition {
  viewportWidth: number;
  viewportHeight: number;
  verticalFovDegrees: number;
  anchor: readonly [number, number];
  cameraUp?: Vec3;
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

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function rectOverlapArea(
  left: ConsensusRecordCameraScreenRect,
  right: ConsensusRecordCameraScreenRect,
): number {
  return Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left))
    * Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top));
}

/**
 * Find the nearest open composition point around the upper visual centre.
 * Obstacles are measured HUD rectangles; the expanded Cell footprint keeps
 * both the record core and its short endpoint copy out from under the panels.
 */
export function deriveConsensusRecordSafeAnchor(
  viewportWidth: number,
  viewportHeight: number,
  obstacles: readonly ConsensusRecordCameraScreenRect[] = [],
): [number, number] {
  const width = Number.isFinite(viewportWidth) && viewportWidth > 0
    ? viewportWidth
    : 1;
  const height = Number.isFinite(viewportHeight) && viewportHeight > 0
    ? viewportHeight
    : 1;
  const margin = Math.min(
    CONSENSUS_RECORD_CAMERA_SAFE_MARGIN_PX,
    width / 2,
    height / 2,
  );
  const halfWidth = Math.min(
    CONSENSUS_RECORD_CAMERA_SAFE_WIDTH_PX / 2,
    Math.max(0, width / 2 - margin),
  );
  const halfHeight = Math.min(
    CONSENSUS_RECORD_CAMERA_SAFE_HEIGHT_PX / 2,
    Math.max(0, height / 2 - margin),
  );
  const minimumX = margin + halfWidth;
  const maximumX = Math.max(minimumX, width - margin - halfWidth);
  const minimumY = margin + halfHeight;
  const maximumY = Math.max(minimumY, height - margin - halfHeight);
  const preferredX = clamp(width / 2, minimumX, maximumX);
  const preferredY = clamp(
    height * CONSENSUS_RECORD_CAMERA_PREFERRED_Y_RATIO,
    minimumY,
    maximumY,
  );
  const validObstacles = obstacles.flatMap((obstacle) => {
    const left = Number.isFinite(obstacle.left) ? obstacle.left : 0;
    const top = Number.isFinite(obstacle.top) ? obstacle.top : 0;
    const right = Number.isFinite(obstacle.right) ? obstacle.right : 0;
    const bottom = Number.isFinite(obstacle.bottom) ? obstacle.bottom : 0;
    return right > left && bottom > top
      ? [{ left, top, right, bottom }]
      : [];
  });
  const candidateXs = new Set<number>([preferredX, minimumX, maximumX]);
  const candidateYs = new Set<number>([preferredY, minimumY, maximumY]);
  for (const obstacle of validObstacles) {
    candidateXs.add(clamp(
      obstacle.left - CONSENSUS_RECORD_CAMERA_HUD_GAP_PX - halfWidth,
      minimumX,
      maximumX,
    ));
    candidateXs.add(clamp(
      obstacle.right + CONSENSUS_RECORD_CAMERA_HUD_GAP_PX + halfWidth,
      minimumX,
      maximumX,
    ));
    candidateYs.add(clamp(
      obstacle.top - CONSENSUS_RECORD_CAMERA_HUD_GAP_PX - halfHeight,
      minimumY,
      maximumY,
    ));
    candidateYs.add(clamp(
      obstacle.bottom + CONSENSUS_RECORD_CAMERA_HUD_GAP_PX + halfHeight,
      minimumY,
      maximumY,
    ));
  }

  let best: [number, number] = [preferredX, preferredY];
  let bestScore = Number.POSITIVE_INFINITY;
  for (const x of candidateXs) {
    for (const y of candidateYs) {
      const footprint: ConsensusRecordCameraScreenRect = {
        left: x - halfWidth,
        top: y - halfHeight,
        right: x + halfWidth,
        bottom: y + halfHeight,
      };
      let collisionCount = 0;
      let overlapArea = 0;
      for (const obstacle of validObstacles) {
        const expanded = {
          left: obstacle.left - CONSENSUS_RECORD_CAMERA_HUD_GAP_PX,
          top: obstacle.top - CONSENSUS_RECORD_CAMERA_HUD_GAP_PX,
          right: obstacle.right + CONSENSUS_RECORD_CAMERA_HUD_GAP_PX,
          bottom: obstacle.bottom + CONSENSUS_RECORD_CAMERA_HUD_GAP_PX,
        };
        const overlap = rectOverlapArea(footprint, expanded);
        if (overlap > 1e-6) collisionCount += 1;
        overlapArea += overlap;
      }
      const horizontalShift = (x - preferredX) / Math.max(1, width);
      const verticalShift = (y - preferredY) / Math.max(1, height);
      const score = collisionCount * 1e12
        + overlapArea * 1e6
        + horizontalShift * horizontalShift
        + verticalShift * verticalShift * 1.35;
      if (score < bestScore) {
        best = [x, y];
        bestScore = score;
      }
    }
  }
  return best;
}

function normalize(
  value: Vec3,
  fallback: Vec3,
): Vec3 {
  const length = Math.hypot(value[0], value[1], value[2]);
  if (!Number.isFinite(length) || length < 1e-6) return [...fallback];
  return [value[0] / length, value[1] / length, value[2] / length];
}

function cross(left: Vec3, right: Vec3): Vec3 {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
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
  composition?: ConsensusRecordCameraComposition,
): ConsensusRouteCameraPose {
  const centered = deriveConsensusRouteCameraPose(
    currentPosition,
    currentTarget,
    recordWorld,
    distance,
  );
  if (!composition) return centered;
  const width = composition.viewportWidth;
  const height = composition.viewportHeight;
  const fov = composition.verticalFovDegrees;
  const anchorX = composition.anchor[0];
  const anchorY = composition.anchor[1];
  if (
    !Number.isFinite(width)
    || width <= 0
    || !Number.isFinite(height)
    || height <= 0
    || !Number.isFinite(fov)
    || fov <= 1
    || fov >= 179
    || !Number.isFinite(anchorX)
    || !Number.isFinite(anchorY)
  ) return centered;

  const backward = normalize([
    currentPosition[0] - currentTarget[0],
    currentPosition[1] - currentTarget[1],
    currentPosition[2] - currentTarget[2],
  ], [1, 0.72, 1]);
  const forward: Vec3 = [-backward[0], -backward[1], -backward[2]];
  const requestedUp = normalize(composition.cameraUp ?? [0, 1, 0], [0, 1, 0]);
  let right = normalize(cross(forward, requestedUp), [1, 0, 0]);
  if (Math.abs(
    right[0] * forward[0]
    + right[1] * forward[1]
    + right[2] * forward[2]
  ) > 1e-4) {
    const fallbackUp: Vec3 = Math.abs(forward[1]) < 0.98
      ? [0, 1, 0]
      : [0, 0, 1];
    right = normalize(cross(forward, fallbackUp), [1, 0, 0]);
  }
  const up = normalize(cross(right, forward), [0, 1, 0]);
  const ndcX = (clamp(anchorX, 0, width) / width) * 2 - 1;
  const ndcY = 1 - (clamp(anchorY, 0, height) / height) * 2;
  const tangent = Math.tan((fov * Math.PI) / 360);
  const ray = normalize([
    forward[0] + right[0] * ndcX * (width / height) * tangent
      + up[0] * ndcY * tangent,
    forward[1] + right[1] * ndcX * (width / height) * tangent
      + up[1] * ndcY * tangent,
    forward[2] + right[2] * ndcX * (width / height) * tangent
      + up[2] * ndcY * tangent,
  ], forward);
  const framedDistance = Number.isFinite(distance) && distance > 0
    ? distance
    : CONSENSUS_RECORD_CAMERA_DISTANCE;
  const position: Vec3 = [
    recordWorld[0] - ray[0] * framedDistance,
    recordWorld[1] - ray[1] * framedDistance,
    recordWorld[2] - ray[2] * framedDistance,
  ];
  const centralDepth = framedDistance * (
    ray[0] * forward[0]
    + ray[1] * forward[1]
    + ray[2] * forward[2]
  );
  return {
    position,
    target: [
      position[0] + forward[0] * centralDepth,
      position[1] + forward[1] * centralDepth,
      position[2] + forward[2] * centralDepth,
    ],
  };
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

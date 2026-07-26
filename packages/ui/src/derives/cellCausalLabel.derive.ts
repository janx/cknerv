export interface CellCausalScreenPoint {
  x: number;
  y: number;
}

export interface CellCausalScreenSize {
  width: number;
  height: number;
}

export interface CellCausalScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type CellCausalLabelPlacementStrategy =
  | 'outward'
  | 'outward-clockwise-35'
  | 'outward-counterclockwise-35'
  | 'outward-clockwise-70'
  | 'outward-counterclockwise-70'
  | 'outward-clockwise-110'
  | 'outward-counterclockwise-110'
  | 'inward-fallback';

export interface CellCausalLabelPlacement {
  offsetX: number;
  offsetY: number;
  rect: CellCausalScreenRect;
  strategy: CellCausalLabelPlacementStrategy;
  avoidedOcclusion: boolean;
  clampedToViewport: boolean;
}

export interface CellCausalLabelPlacementOptions {
  endpoint: CellCausalScreenPoint;
  hub: CellCausalScreenPoint;
  viewport: CellCausalScreenSize;
  label: CellCausalScreenSize;
  occlusions?: readonly CellCausalScreenRect[];
  gap?: number;
  margin?: number;
}

const CANDIDATES: readonly {
  strategy: CellCausalLabelPlacementStrategy;
  radians: number;
}[] = [
  { strategy: 'outward', radians: 0 },
  { strategy: 'outward-clockwise-35', radians: Math.PI * 35 / 180 },
  { strategy: 'outward-counterclockwise-35', radians: -Math.PI * 35 / 180 },
  { strategy: 'outward-clockwise-70', radians: Math.PI * 70 / 180 },
  { strategy: 'outward-counterclockwise-70', radians: -Math.PI * 70 / 180 },
  { strategy: 'outward-clockwise-110', radians: Math.PI * 110 / 180 },
  { strategy: 'outward-counterclockwise-110', radians: -Math.PI * 110 / 180 },
  { strategy: 'inward-fallback', radians: Math.PI },
];

const finiteOr = (value: number, fallback: number): number => (
  Number.isFinite(value) ? value : fallback
);

const positiveOr = (value: number, fallback: number): number => (
  Number.isFinite(value) && value > 0 ? value : fallback
);

const clamp = (value: number, minimum: number, maximum: number): number => (
  Math.max(minimum, Math.min(maximum, value))
);

function overlapArea(
  first: CellCausalScreenRect,
  second: CellCausalScreenRect,
): number {
  const width = Math.min(first.right, second.right)
    - Math.max(first.left, second.left);
  const height = Math.min(first.bottom, second.bottom)
    - Math.max(first.top, second.top);
  return width > 0 && height > 0 ? width * height : 0;
}

/**
 * Place the single hovered endpoint label in screen space.
 *
 * The first candidate always continues the endpoint → transaction-hub radial
 * direction. Angled candidates are considered only when the viewport, HUD, or
 * hub label makes that ray unusable. No world-space evidence geometry moves.
 */
export function deriveCellCausalLabelPlacement({
  endpoint,
  hub,
  viewport,
  label,
  occlusions = [],
  gap = 12,
  margin = 8,
}: CellCausalLabelPlacementOptions): CellCausalLabelPlacement {
  const viewportWidth = positiveOr(viewport.width, 1);
  const viewportHeight = positiveOr(viewport.height, 1);
  const safeMargin = Math.max(0, Math.min(
    finiteOr(margin, 8),
    viewportWidth * 0.5,
    viewportHeight * 0.5,
  ));
  const labelWidth = Math.min(
    positiveOr(label.width, 1),
    Math.max(1, viewportWidth - safeMargin * 2),
  );
  const labelHeight = Math.min(
    positiveOr(label.height, 1),
    Math.max(1, viewportHeight - safeMargin * 2),
  );
  const safeGap = Math.max(0, finiteOr(gap, 12));
  const anchorX = finiteOr(endpoint.x, viewportWidth * 0.5);
  const anchorY = finiteOr(endpoint.y, viewportHeight * 0.5);
  const hubX = finiteOr(hub.x, viewportWidth * 0.5);
  const hubY = finiteOr(hub.y, viewportHeight * 0.5);
  const radialX = anchorX - hubX;
  const radialY = anchorY - hubY;
  const radialLength = Math.hypot(radialX, radialY);
  // A coincident projection can occur when the camera looks directly down an
  // arc. The upper-right fallback stays deterministic and avoids hiding the
  // marker beneath its label.
  const outwardX = radialLength > 0.001
    ? radialX / radialLength
    : Math.SQRT1_2;
  const outwardY = radialLength > 0.001
    ? radialY / radialLength
    : -Math.SQRT1_2;
  const halfWidth = labelWidth * 0.5;
  const halfHeight = labelHeight * 0.5;
  const minCenterX = safeMargin + halfWidth;
  const maxCenterX = viewportWidth - safeMargin - halfWidth;
  const minCenterY = safeMargin + halfHeight;
  const maxCenterY = viewportHeight - safeMargin - halfHeight;
  const markerClearance = Math.max(4, Math.min(10, safeGap));
  const markerRect: CellCausalScreenRect = {
    left: anchorX - markerClearance,
    top: anchorY - markerClearance,
    right: anchorX + markerClearance,
    bottom: anchorY + markerClearance,
  };

  let best: CellCausalLabelPlacement | null = null;
  let bestScore = Infinity;
  for (let index = 0; index < CANDIDATES.length; index += 1) {
    const candidate = CANDIDATES[index];
    const cosine = Math.cos(candidate.radians);
    const sine = Math.sin(candidate.radians);
    const directionX = outwardX * cosine - outwardY * sine;
    const directionY = outwardX * sine + outwardY * cosine;
    const labelSupport = halfWidth * Math.abs(directionX)
      + halfHeight * Math.abs(directionY);
    const radialDistance = safeGap + labelSupport;
    const rawCenterX = anchorX + directionX * radialDistance;
    const rawCenterY = anchorY + directionY * radialDistance;
    const centerX = minCenterX <= maxCenterX
      ? clamp(rawCenterX, minCenterX, maxCenterX)
      : viewportWidth * 0.5;
    const centerY = minCenterY <= maxCenterY
      ? clamp(rawCenterY, minCenterY, maxCenterY)
      : viewportHeight * 0.5;
    const rect: CellCausalScreenRect = {
      left: centerX - halfWidth,
      top: centerY - halfHeight,
      right: centerX + halfWidth,
      bottom: centerY + halfHeight,
    };
    const clampedDistance = Math.hypot(
      centerX - rawCenterX,
      centerY - rawCenterY,
    );
    const markerOverlap = overlapArea(rect, markerRect);
    let collisionArea = markerOverlap;
    let collisionCount = markerOverlap > 0 ? 1 : 0;
    for (const occlusion of occlusions) {
      const area = overlapArea(rect, occlusion);
      collisionArea += area;
      if (area > 0) collisionCount += 1;
    }
    // A clean candidate always beats an occluded one. Within the same class,
    // preserve radial intent first, then minimize viewport correction.
    const score = collisionCount * 1_000_000
      + collisionArea * 1_000
      + index * 1_000
      + clampedDistance * 10;
    if (score >= bestScore) continue;
    bestScore = score;
    best = {
      offsetX: centerX - anchorX,
      offsetY: centerY - anchorY,
      rect,
      strategy: candidate.strategy,
      avoidedOcclusion: collisionCount === 0,
      clampedToViewport: clampedDistance > 0.01,
    };
  }

  return best ?? {
    offsetX: 0,
    offsetY: 0,
    rect: {
      left: anchorX - halfWidth,
      top: anchorY - halfHeight,
      right: anchorX + halfWidth,
      bottom: anchorY + halfHeight,
    },
    strategy: 'outward',
    avoidedOcclusion: false,
    clampedToViewport: false,
  };
}

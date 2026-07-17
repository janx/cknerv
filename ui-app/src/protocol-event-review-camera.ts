export type ProtocolReviewVec3 = readonly [number, number, number];

export interface ProtocolReviewCameraPose {
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
}

const NETWORK_POSITION: ProtocolReviewVec3 = [82, 74, 82];
const NETWORK_TARGET: ProtocolReviewVec3 = [0, 28, 0];

function smoothstep(from: number, to: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

function mixVec3(
  from: ProtocolReviewVec3,
  to: ProtocolReviewVec3,
  amount: number,
): [number, number, number] {
  return [
    from[0] + (to[0] - from[0]) * amount,
    from[1] + (to[1] - from[1]) * amount,
    from[2] + (to[2] - from[2]) * amount,
  ];
}

function mixPose(
  from: ProtocolReviewCameraPose,
  to: ProtocolReviewCameraPose,
  amount: number,
): ProtocolReviewCameraPose {
  return {
    position: mixVec3(from.position, to.position, amount),
    target: mixVec3(from.target, to.target, amount),
    fov: from.fov + (to.fov - from.fov) * amount,
  };
}

function framePosition(
  focus: ProtocolReviewVec3,
  offset: ProtocolReviewVec3,
  radius: number,
): [number, number, number] {
  if (radius <= 0) return [
    focus[0] + offset[0],
    focus[1] + offset[1],
    focus[2] + offset[2],
  ];
  const baseDistance = Math.hypot(offset[0], offset[1], offset[2]);
  const distance = Math.min(190, Math.max(baseDistance, radius * 3.2));
  return [
    focus[0] + offset[0] / baseDistance * distance,
    focus[1] + offset[1] / baseDistance * distance,
    focus[2] + offset[2] / baseDistance * distance,
  ];
}

function frameFov(baseFov: number, radius: number, positionDistance: number): number {
  if (radius <= 0) return baseFov;
  const required = Math.atan(radius * 1.15 / positionDistance) * 360 / Math.PI;
  return Math.min(47, Math.max(baseFov, required));
}

/**
 * Editorial camera choreography for the four semantic review stages. It starts
 * with the distributed network, follows the local vertical handoff, then moves
 * close enough to read the actual target Cell and its persistent write seal.
 */
export function protocolEventReviewCameraPose(
  elapsedS: number,
  localWorld: ProtocolReviewVec3 | null,
  focusWorld: ProtocolReviewVec3 | null,
  focusRadius: number = 0,
): ProtocolReviewCameraPose {
  const local = localWorld ?? [0, 22, 0];
  const focus = focusWorld ?? [0, 38, 0];
  const network: ProtocolReviewCameraPose = {
    position: [...NETWORK_POSITION],
    target: [...NETWORK_TARGET],
    fov: 47,
  };
  const carrierTarget: ProtocolReviewVec3 = [
    local[0],
    (local[1] + 38) * 0.5,
    local[2],
  ];
  const carrier: ProtocolReviewCameraPose = {
    position: [local[0] + 32, carrierTarget[1] + 22, local[2] + 28],
    target: [...carrierTarget],
    fov: 39,
  };
  const commitPosition = framePosition(focus, [10, 8, 12], focusRadius);
  const settledPosition = framePosition(focus, [6, 10, 8], focusRadius);
  const commit: ProtocolReviewCameraPose = {
    position: commitPosition,
    target: [focus[0], focus[1] + 0.4, focus[2]],
    fov: frameFov(34, focusRadius, Math.hypot(
      commitPosition[0] - focus[0],
      commitPosition[1] - focus[1],
      commitPosition[2] - focus[2],
    )),
  };
  const settled: ProtocolReviewCameraPose = {
    position: settledPosition,
    target: [focus[0], focus[1] + 0.2, focus[2]],
    fov: frameFov(29, focusRadius, Math.hypot(
      settledPosition[0] - focus[0],
      settledPosition[1] - focus[1],
      settledPosition[2] - focus[2],
    )),
  };

  if (elapsedS <= 0.4) return network;
  if (elapsedS < 0.95) {
    return mixPose(network, carrier, smoothstep(0.4, 0.95, elapsedS));
  }
  if (elapsedS <= 1.35) return carrier;
  if (elapsedS < 2.15) {
    return mixPose(carrier, commit, smoothstep(1.35, 2.15, elapsedS));
  }
  if (elapsedS <= 5.25) return commit;
  if (elapsedS < 6.05) {
    return mixPose(commit, settled, smoothstep(5.25, 6.05, elapsedS));
  }
  return settled;
}

import {
  CONSENSUS_RECORD_CAMERA_DISTANCE,
  CONSENSUS_RECORD_CAMERA_MAX_DISTANCE,
} from '../derives/consensusRouteCamera.derive';

export const CONSENSUS_MEMORY_COMPACT_LABEL_DISTANCE = 112;
export const CONSENSUS_MEMORY_SIGNAL_LABEL_DISTANCE = 196;

export type ConsensusMemoryLabelLod = 'full' | 'compact' | 'signal';

export interface ConsensusMemoryDistancePresentation {
  cameraDistance: number;
  distanceFactor: number;
  routeWidthScale: number;
  routeEnergyScale: number;
  spikeScale: number;
  labelLod: ConsensusMemoryLabelLod;
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smoothUnit(value: number): number {
  const clamped = clampUnit(value);
  return clamped * clamped * (3 - 2 * clamped);
}

/**
 * Preserve a stable screen signal as broad record framing moves away from the
 * Cell canopy. Route energy changes continuously; text sheds only subordinate
 * metadata, leaving every real source and retained target explicitly named.
 */
export function deriveConsensusMemoryDistancePresentation(
  cameraDistance: number,
): ConsensusMemoryDistancePresentation {
  const distance = Number.isFinite(cameraDistance) && cameraDistance > 0
    ? cameraDistance
    : CONSENSUS_RECORD_CAMERA_DISTANCE;
  const range = Math.max(
    1,
    CONSENSUS_RECORD_CAMERA_MAX_DISTANCE - CONSENSUS_RECORD_CAMERA_DISTANCE,
  );
  const distanceFactor = smoothUnit(
    (distance - CONSENSUS_RECORD_CAMERA_DISTANCE) / range,
  );
  const labelLod: ConsensusMemoryLabelLod = distance
    >= CONSENSUS_MEMORY_SIGNAL_LABEL_DISTANCE
    ? 'signal'
    : distance >= CONSENSUS_MEMORY_COMPACT_LABEL_DISTANCE
      ? 'compact'
      : 'full';

  return {
    cameraDistance: distance,
    distanceFactor,
    routeWidthScale: 1 + distanceFactor * 0.42,
    routeEnergyScale: 1 + distanceFactor * 0.24,
    spikeScale: 1 + distanceFactor * 0.2,
    labelLod,
  };
}

export const CONSENSUS_MEMORY_NEAR_PRESENTATION =
  deriveConsensusMemoryDistancePresentation(CONSENSUS_RECORD_CAMERA_DISTANCE);

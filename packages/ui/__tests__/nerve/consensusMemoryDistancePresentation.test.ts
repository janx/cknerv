import { describe, expect, it } from 'vitest';
import {
  CONSENSUS_RECORD_CAMERA_DISTANCE,
  CONSENSUS_RECORD_CAMERA_MAX_DISTANCE,
} from '../../src/derives/consensusRouteCamera.derive';
import {
  CONSENSUS_MEMORY_COMPACT_LABEL_DISTANCE,
  CONSENSUS_MEMORY_SIGNAL_LABEL_DISTANCE,
  deriveConsensusMemoryDistancePresentation,
} from '../../src/nerve/consensusMemoryDistancePresentation';

describe('consensus memory distance presentation', () => {
  it('preserves the authored near-record treatment', () => {
    const presentation = deriveConsensusMemoryDistancePresentation(
      CONSENSUS_RECORD_CAMERA_DISTANCE,
    );

    expect(presentation).toMatchObject({
      distanceFactor: 0,
      routeWidthScale: 1,
      routeEnergyScale: 1,
      spikeScale: 1,
      labelLod: 'full',
    });
  });

  it('continuously strengthens routes as broad framing moves farther away', () => {
    const near = deriveConsensusMemoryDistancePresentation(64);
    const broad = deriveConsensusMemoryDistancePresentation(160);
    const far = deriveConsensusMemoryDistancePresentation(
      CONSENSUS_RECORD_CAMERA_MAX_DISTANCE,
    );

    expect(broad.routeWidthScale).toBeGreaterThan(near.routeWidthScale);
    expect(far.routeWidthScale).toBeGreaterThan(broad.routeWidthScale);
    expect(broad.routeEnergyScale).toBeGreaterThan(near.routeEnergyScale);
    expect(far.routeEnergyScale).toBeGreaterThan(broad.routeEnergyScale);
    expect(far.routeWidthScale).toBeCloseTo(1.42, 8);
    expect(far.routeEnergyScale).toBeCloseTo(1.24, 8);
  });

  it('removes subordinate copy before reducing labels to endpoint signals', () => {
    expect(deriveConsensusMemoryDistancePresentation(
      CONSENSUS_MEMORY_COMPACT_LABEL_DISTANCE - 1,
    ).labelLod).toBe('full');
    expect(deriveConsensusMemoryDistancePresentation(
      CONSENSUS_MEMORY_COMPACT_LABEL_DISTANCE,
    ).labelLod).toBe('compact');
    expect(deriveConsensusMemoryDistancePresentation(
      CONSENSUS_MEMORY_SIGNAL_LABEL_DISTANCE,
    ).labelLod).toBe('signal');
  });

  it('uses the near treatment for an invalid camera distance', () => {
    expect(deriveConsensusMemoryDistancePresentation(Number.NaN))
      .toEqual(deriveConsensusMemoryDistancePresentation(
        CONSENSUS_RECORD_CAMERA_DISTANCE,
      ));
  });
});

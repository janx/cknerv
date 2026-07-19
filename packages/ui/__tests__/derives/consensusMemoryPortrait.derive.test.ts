import { describe, expect, it } from 'vitest';
import {
  consensusMemoryPortraitLayerOpacity,
  consensusMemoryPortraitResponse,
} from '../../src/derives/consensusMemoryPortrait.derive';
import { consensusBraidLayerOpacity } from '../../src/derives/consensusBraid.derive';
import type {
  ConsensusMemoryCellResponse,
  ConsensusMemoryTraceReadout,
} from '../../src/nerve/consensusMemoryTrace';

const readout = (
  overrides: Partial<ConsensusMemoryTraceReadout> = {},
): ConsensusMemoryTraceReadout => {
  const value = {
    key: '7:5:1',
    targetCellId: 5,
    sourceKind: 'witness' as const,
    stage: 'reading' as const,
    sourceCount: 2,
    arrivedSourceCount: 0,
    resolvedSourceCount: 0,
    ...overrides,
  };
  return {
    ...value,
    evidence: overrides.evidence ?? Array.from(
      { length: value.sourceCount },
      (_, index) => ({
        sourceId: index + 1,
        ordinal: index + 1,
        contentHash: `0x${String(index + 1).repeat(64)}`,
        state: index < value.resolvedSourceCount
          ? 'resolved' as const
          : index < value.arrivedSourceCount
            ? 'arrived' as const
            : 'routing' as const,
        sourceOutPoint: {
          tx_hash: `0x${String(index + 1).repeat(64)}`,
          index,
        },
        sourceBirthBlock: 100 + index,
        route: [index + 1, 5],
        hopCount: 1,
        routeDurationMs: 480 + index * 40,
      }),
    ),
  };
};

describe('consensusMemoryPortraitResponse', () => {
  it('uses the main Canvas frame response without altering its clock', () => {
    const frame: ConsensusMemoryCellResponse = {
      role: 'target',
      strength: 0.72,
      phase: 0.37,
      convergence: 0.48,
    };
    expect(consensusMemoryPortraitResponse(readout(), frame)).toBe(frame);
  });

  it('provides semantic reduced-motion poses for every readout stage', () => {
    expect(consensusMemoryPortraitResponse(readout(), null)).toMatchObject({
      role: 'target',
      strength: 1,
      phase: 0.16,
      convergence: 0,
    });
    expect(consensusMemoryPortraitResponse(readout({
      stage: 'converging',
      arrivedSourceCount: 1,
    }), null)).toMatchObject({
      role: 'target',
      convergence: 0.275,
    });
    expect(consensusMemoryPortraitResponse(readout({
      stage: 'locked',
      arrivedSourceCount: 2,
      resolvedSourceCount: 2,
    }), null)).toMatchObject({
      role: 'target',
      phase: 0.88,
      convergence: 1,
      evidence: expect.arrayContaining([
        expect.objectContaining({ convergence: 1 }),
      ]),
    });
    expect(consensusMemoryPortraitResponse(null, null)).toBeNull();
  });

  it('hands visual priority from contributor paths to verified agreements', () => {
    const base = consensusBraidLayerOpacity(null, 3);
    const reading = consensusMemoryPortraitLayerOpacity(base, 1, 0);
    const locked = consensusMemoryPortraitLayerOpacity(base, 1, 1);

    expect(reading.ribbon).toBeLessThan(base.ribbon);
    expect(reading.streamCore).toBeLessThan(base.streamCore);
    expect(reading.packet).toBeLessThan(base.packet);
    expect(locked.agreementCore).toBeGreaterThan(reading.agreementCore);
    expect(locked.knotCore).toBeGreaterThan(reading.knotCore);
    expect(consensusMemoryPortraitLayerOpacity(base, 0, 0)).toEqual(base);
  });
});

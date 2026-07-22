import { describe, expect, it } from 'vitest';
import {
  CONSENSUS_MEMORY_HANDOFF_END,
  CONSENSUS_MEMORY_HANDOFF_START,
  consensusMemoryCompactVisibility,
  consensusMemoryExpandedVisibility,
} from '../../src/derives/consensusMemoryLod.derive';

describe('consensus memory LOD handoff', () => {
  it('keeps compact and expanded representations complementary', () => {
    for (const detail of [0, 0.38, 0.5, 0.68, 0.82, 1]) {
      expect(
        consensusMemoryCompactVisibility(detail)
          + consensusMemoryExpandedVisibility(detail),
      ).toBeCloseTo(1, 10);
    }
  });

  it('hands off smoothly only inside the authored detail interval', () => {
    expect(consensusMemoryExpandedVisibility(
      CONSENSUS_MEMORY_HANDOFF_START,
    )).toBe(0);
    expect(consensusMemoryExpandedVisibility(0.68)).toBeGreaterThan(0);
    expect(consensusMemoryExpandedVisibility(0.68)).toBeLessThan(1);
    expect(consensusMemoryExpandedVisibility(
      CONSENSUS_MEMORY_HANDOFF_END,
    )).toBe(1);
    expect(consensusMemoryExpandedVisibility(Number.NaN)).toBe(0);
  });
});

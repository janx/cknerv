import { describe, expect, it } from 'vitest';
import { PASSIVE_EDGE_BUDGET } from '../../src/geometry/passiveNeighborGraph';
import {
  FABRIC_SAMPLES_PER_EDGE,
  MAX_FABRIC_SEGMENTS,
  MAX_PASSIVE_EDGE_GENERATIONS,
} from '../../src/nerve/fabricCapacity';

describe('fabric capacity', () => {
  it('preserves enough samples for an organic passive-fabric curve', () => {
    expect(FABRIC_SAMPLES_PER_EDGE).toBeGreaterThanOrEqual(4);
  });

  it('holds the live passive graph plus bounded fading generations', () => {
    expect(MAX_PASSIVE_EDGE_GENERATIONS).toBeGreaterThanOrEqual(3);
    expect(MAX_FABRIC_SEGMENTS).toBe(
      PASSIVE_EDGE_BUDGET
      * MAX_PASSIVE_EDGE_GENERATIONS
      * FABRIC_SAMPLES_PER_EDGE,
    );
  });
});

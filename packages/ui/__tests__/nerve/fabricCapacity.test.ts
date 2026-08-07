import { describe, expect, it } from 'vitest';
import { PASSIVE_EDGE_BUDGET } from '../../src/geometry/passiveNeighborGraph';
import {
  FABRIC_SAMPLES_PER_EDGE,
  MAX_FABRIC_SEGMENTS,
  MAX_PASSIVE_EDGE_GENERATIONS,
  MAX_WARM_FABRIC_SEGMENTS,
} from '../../src/nerve/fabricCapacity';
import { QUALITY_PRESETS } from '../../src/tweaks/qualityPresets';

describe('fabric capacity', () => {
  it('preserves enough samples for an organic passive-fabric curve', () => {
    expect(FABRIC_SAMPLES_PER_EDGE).toBeGreaterThanOrEqual(4);
    for (const preset of Object.values(QUALITY_PRESETS)) {
      expect(preset.passiveSamplesPerEdge).toBeGreaterThanOrEqual(2);
      expect(preset.passiveSamplesPerEdge)
        .toBeLessThanOrEqual(FABRIC_SAMPLES_PER_EDGE);
      expect(preset.passiveEdgeCap).toBeLessThanOrEqual(PASSIVE_EDGE_BUDGET);
    }
  });

  it('holds the live passive graph plus bounded fading generations', () => {
    expect(MAX_PASSIVE_EDGE_GENERATIONS).toBeGreaterThanOrEqual(3);
    expect(MAX_FABRIC_SEGMENTS).toBe(
      PASSIVE_EDGE_BUDGET
      * MAX_PASSIVE_EDGE_GENERATIONS
      * FABRIC_SAMPLES_PER_EDGE,
    );
  });

  it('bounds the sparse warm overlay to one live graph generation', () => {
    expect(MAX_WARM_FABRIC_SEGMENTS).toBe(
      PASSIVE_EDGE_BUDGET * FABRIC_SAMPLES_PER_EDGE,
    );
    expect(MAX_WARM_FABRIC_SEGMENTS).toBeLessThan(MAX_FABRIC_SEGMENTS);
  });
});

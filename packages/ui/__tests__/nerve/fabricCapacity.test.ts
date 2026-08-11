import { describe, expect, it } from 'vitest';
import {
  PASSIVE_EDGE_CEILING,
  passiveEdgeBudget,
} from '../../src/geometry/passiveNeighborGraph';
import { AUTO_CELL_DISPLAY_BUDGETS } from '../../src/tweaks/cellDisplay';
import {
  FABRIC_ALLOCATION_EDGE_CLASSES,
  FABRIC_SAMPLES_PER_EDGE,
  fabricAllocationEdges,
  fabricSegmentAllocation,
  MAX_FABRIC_SEGMENTS,
  MAX_PASSIVE_EDGE_GENERATIONS,
  MAX_WARM_FABRIC_SEGMENTS,
  warmSegmentAllocation,
} from '../../src/nerve/fabricCapacity';

describe('fabric capacity', () => {
  it('preserves enough samples for an organic passive-fabric curve', () => {
    expect(FABRIC_SAMPLES_PER_EDGE).toBe(4);
  });

  it('holds the live passive graph plus bounded fading generations', () => {
    expect(MAX_PASSIVE_EDGE_GENERATIONS).toBeGreaterThanOrEqual(3);
    expect(MAX_FABRIC_SEGMENTS).toBe(
      PASSIVE_EDGE_CEILING
      * MAX_PASSIVE_EDGE_GENERATIONS
      * FABRIC_SAMPLES_PER_EDGE,
    );
  });

  it('bounds the sparse warm overlay to one live graph generation', () => {
    expect(MAX_WARM_FABRIC_SEGMENTS).toBe(
      PASSIVE_EDGE_CEILING * FABRIC_SAMPLES_PER_EDGE,
    );
    expect(MAX_WARM_FABRIC_SEGMENTS).toBeLessThan(MAX_FABRIC_SEGMENTS);
  });

  it('derives one allocation class per AUTO tier nerve budget', () => {
    // Low keeps the historical 8K field; higher tiers scale by the same
    // 4/3 nerves-per-Cell ratio that keeps the picture equally neural.
    // Round classes fall straight out of the 4/3 ratio on the new ladder.
    expect(FABRIC_ALLOCATION_EDGE_CLASSES).toEqual([
      8_000, 20_000, 40_000, 66_667,
    ]);
    // Tier budgets derive the lower classes; the full-field ceiling closes
    // the ladder for manual fields beyond the top AUTO rung.
    expect(FABRIC_ALLOCATION_EDGE_CLASSES.slice(0, 3)).toEqual(
      Object.values(AUTO_CELL_DISPLAY_BUDGETS)
        .map((cells) => passiveEdgeBudget(cells))
        .sort((a, b) => a - b),
    );
  });

  it('quantizes any display limit to the smallest fitting class', () => {
    expect(fabricAllocationEdges(100)).toBe(8_000);
    expect(fabricAllocationEdges(6_000)).toBe(8_000);
    expect(fabricAllocationEdges(6_001)).toBe(20_000);
    expect(fabricAllocationEdges(15_000)).toBe(20_000);
    expect(fabricAllocationEdges(15_001)).toBe(40_000);
    expect(fabricAllocationEdges(30_000)).toBe(40_000);
    expect(fabricAllocationEdges(30_001)).toBe(66_667);
    expect(fabricAllocationEdges(50_000)).toBe(66_667);
    // Beyond the renderer ceiling still lands on the top class.
    expect(fabricAllocationEdges(99_999)).toBe(66_667);
  });

  it('sizes per-class segment allocations by the shared sample math', () => {
    for (const edges of FABRIC_ALLOCATION_EDGE_CLASSES) {
      expect(fabricSegmentAllocation(edges)).toBe(
        edges * MAX_PASSIVE_EDGE_GENERATIONS * FABRIC_SAMPLES_PER_EDGE,
      );
      expect(warmSegmentAllocation(edges)).toBe(
        edges * FABRIC_SAMPLES_PER_EDGE,
      );
    }
  });
});

import { describe, expect, it } from 'vitest';
import {
  NERVE_SCREEN_BUDGET,
  NERVE_SCREEN_BUDGET_MAX,
  PASSIVE_EDGE_CEILING,
  passiveEdgeBudget,
} from '../../src/geometry/passiveNeighborGraph';
import { AUTO_CELL_DISPLAY_BUDGET } from '../../src/tweaks/cellDisplay';
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

  it('derives the default class from the fixed screen budget', () => {
    // The nerve budget is a fixed screen-composition constant, so the
    // default class serves every field (AUTO and manual alike); the
    // ceiling class exists only for a raised live-tuning knob.
    expect(FABRIC_ALLOCATION_EDGE_CLASSES).toEqual([8_000, 20_000]);
    expect(FABRIC_ALLOCATION_EDGE_CLASSES[0]).toBe(NERVE_SCREEN_BUDGET);
    expect(PASSIVE_EDGE_CEILING).toBe(NERVE_SCREEN_BUDGET_MAX);
    // The fixed AUTO field and a maxed manual field both resolve to the
    // default class at the default screen budget.
    expect(fabricAllocationEdges(passiveEdgeBudget(AUTO_CELL_DISPLAY_BUDGET)))
      .toBe(NERVE_SCREEN_BUDGET);
    expect(fabricAllocationEdges(passiveEdgeBudget(50_000)))
      .toBe(NERVE_SCREEN_BUDGET);
  });

  it('quantizes any resolved edge need to the smallest fitting class', () => {
    expect(fabricAllocationEdges(100)).toBe(8_000);
    expect(fabricAllocationEdges(8_000)).toBe(8_000);
    expect(fabricAllocationEdges(8_001)).toBe(20_000);
    expect(fabricAllocationEdges(20_000)).toBe(20_000);
    // Beyond the ceiling still lands on the top class.
    expect(fabricAllocationEdges(99_999)).toBe(20_000);
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

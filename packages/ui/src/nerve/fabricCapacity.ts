// Geometry budget for the bounded persistent resting-fibre layer.

import {
  NERVE_SCREEN_BUDGET,
  PASSIVE_EDGE_CEILING,
} from '../geometry/passiveNeighborGraph';

/** Four samples preserve the quadratic silhouette of one organic fibre. */
export const FABRIC_SAMPLES_PER_EDGE = 4;

/** The current graph plus two rapidly superseded generations may coexist
 * during the quiet decay window. Current edges are ordered first, so even an
 * adversarial sequence degrades by clipping old afterimages, never live form. */
export const MAX_PASSIVE_EDGE_GENERATIONS = 3;

/** Passive-layer segment allocation for an edge-allocation class. */
export function fabricSegmentAllocation(edges: number): number {
  return edges * MAX_PASSIVE_EDGE_GENERATIONS * FABRIC_SAMPLES_PER_EDGE;
}

/** Warm-overlay segment allocation: one live graph's maximum, so superseded
 * warm afterimages may clip under adversarial churn instead of expanding the
 * permanent GPU allocation. */
export function warmSegmentAllocation(edges: number): number {
  return edges * FABRIC_SAMPLES_PER_EDGE;
}

/**
 * Discrete GPU-allocation classes for the fabric layers. The nerve budget is
 * a fixed screen-composition constant (default 8,000, live-tunable up to the
 * 20,000 ceiling), so the default class serves every field — AUTO and manual
 * alike — and the ceiling class exists only for a raised live-tuning knob.
 * ALLOCATIONS quantize to these classes so buffer sizes change only when the
 * resolved budget crosses a class boundary.
 */
export const FABRIC_ALLOCATION_EDGE_CLASSES: readonly number[] = [
  ...new Set([NERVE_SCREEN_BUDGET, PASSIVE_EDGE_CEILING]),
].sort((a, b) => a - b);

/** Smallest allocation class that fits a resolved passive edge budget
 * (callers pass `passiveEdgeBudget(displayLimit, liveScreenBudget)`). */
export function fabricAllocationEdges(edgeNeed: number): number {
  for (const edgeClass of FABRIC_ALLOCATION_EDGE_CLASSES) {
    if (edgeClass >= edgeNeed) return edgeClass;
  }
  return FABRIC_ALLOCATION_EDGE_CLASSES[FABRIC_ALLOCATION_EDGE_CLASSES.length - 1];
}

/** Absolute passive-layer ceiling (the top class): 20,000 edges × 3
 * generations × 4 segments. Kept as the hard upper bound; per-mount
 * allocations use `fabricSegmentAllocation(fabricAllocationEdges(...))`. */
export const MAX_FABRIC_SEGMENTS = fabricSegmentAllocation(PASSIVE_EDGE_CEILING);

/** Absolute warm-overlay ceiling at the top class. */
export const MAX_WARM_FABRIC_SEGMENTS = warmSegmentAllocation(PASSIVE_EDGE_CEILING);

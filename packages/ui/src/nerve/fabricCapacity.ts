// Geometry budget for the bounded persistent resting-fibre layer.

import {
  PASSIVE_EDGE_CEILING,
  passiveEdgeBudget,
} from '../geometry/passiveNeighborGraph';
import { AUTO_CELL_DISPLAY_BUDGETS } from '../tweaks/cellDisplay';

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
 * Discrete GPU-allocation classes for the fabric layers, one per AUTO tier's
 * derived nerve budget (Low 8,000 / Med 26,667 / High 66,667 edges). Nerve
 * BUDGETS follow the visible Cell count continuously; ALLOCATIONS quantize to
 * these classes so buffer sizes change only when the display budget crosses a
 * tier-scale boundary — a weak machine that settles on the Low tier never
 * holds High-tier buffers.
 */
export const FABRIC_ALLOCATION_EDGE_CLASSES: readonly number[] = [
  ...new Set([
    ...Object.values(AUTO_CELL_DISPLAY_BUDGETS).map(
      (cells) => passiveEdgeBudget(cells),
    ),
    // Manual fields may exceed the top AUTO rung (the 50K upper bound lives
    // on the slider); the full-field ceiling closes the class ladder so a
    // 50K manual field never gets a clipped allocation.
    PASSIVE_EDGE_CEILING,
  ]),
].sort((a, b) => a - b);

/** Smallest allocation class that fits the nerve budget of `displayLimit`
 * visible Cells (manual fields quantize the same way). */
export function fabricAllocationEdges(displayLimit: number): number {
  const need = passiveEdgeBudget(displayLimit);
  for (const edgeClass of FABRIC_ALLOCATION_EDGE_CLASSES) {
    if (edgeClass >= need) return edgeClass;
  }
  return FABRIC_ALLOCATION_EDGE_CLASSES[FABRIC_ALLOCATION_EDGE_CLASSES.length - 1];
}

/** Absolute passive-layer ceiling (the High-tier class): 66,667 edges × 3
 * generations × 4 segments. Kept as the hard upper bound; per-mount
 * allocations use `fabricSegmentAllocation(fabricAllocationEdges(...))`. */
export const MAX_FABRIC_SEGMENTS = fabricSegmentAllocation(PASSIVE_EDGE_CEILING);

/** Absolute warm-overlay ceiling at the High-tier class. */
export const MAX_WARM_FABRIC_SEGMENTS = warmSegmentAllocation(PASSIVE_EDGE_CEILING);

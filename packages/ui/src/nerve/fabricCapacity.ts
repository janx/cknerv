// Geometry budget for the bounded persistent resting-fibre layer.

import { PASSIVE_EDGE_BUDGET } from '../geometry/passiveNeighborGraph';

/** Allocation ceiling per edge. Runtime quality presets use two or three
 * samples; keeping four slots preserves headroom for diagnostics and fading
 * generations created by older visual policies. */
export const FABRIC_SAMPLES_PER_EDGE = 4;

/** The current graph plus two rapidly superseded generations may coexist
 * during the quiet decay window. Current edges are ordered first, so even an
 * adversarial sequence degrades by clipping old afterimages, never live form. */
export const MAX_PASSIVE_EDGE_GENERATIONS = 3;

/** 8,000 edges × 3 transition generations × 4 segments = 96,000 segments.
 * This remains well below the former full-routing-graph allocation of 528K
 * segments; routing stays complete in CPU data and active writes use separate
 * buffers. */
export const MAX_FABRIC_SEGMENTS =
  PASSIVE_EDGE_BUDGET
  * MAX_PASSIVE_EDGE_GENERATIONS
  * FABRIC_SAMPLES_PER_EDGE;

/** Reinforcement is a sparse overlay bounded to one live graph's maximum
 * segment count. Superseded warm afterimages may clip under adversarial churn
 * instead of expanding the permanent GPU allocation. */
export const MAX_WARM_FABRIC_SEGMENTS =
  PASSIVE_EDGE_BUDGET * FABRIC_SAMPLES_PER_EDGE;

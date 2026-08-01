// Geometry budget for the bounded persistent resting-fibre layer.

import { PASSIVE_EDGE_BUDGET } from '../geometry/passiveNeighborGraph';

/** Four samples preserve the quadratic silhouette of one organic fibre. */
export const FABRIC_SAMPLES_PER_EDGE = 4;

/** The current graph plus two rapidly superseded generations may coexist
 * during the quiet decay window. Current edges are ordered first, so even an
 * adversarial sequence degrades by clipping old afterimages, never live form. */
export const MAX_PASSIVE_EDGE_GENERATIONS = 3;

/** 1,800 edges × 3 transition generations × 4 segments = 21,600 segments.
 * This replaces the former full-routing-graph allocation of 528K segments;
 * routing remains complete in CPU data and active writes use separate buffers. */
export const MAX_FABRIC_SEGMENTS =
  PASSIVE_EDGE_BUDGET
  * MAX_PASSIVE_EDGE_GENERATIONS
  * FABRIC_SAMPLES_PER_EDGE;

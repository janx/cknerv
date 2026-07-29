// Fabric geometry budget for the persistent neighbour-graph layer.
// Separated from NeuralFabric so the "buffer holds the full graph at
// capacity" invariant is unit-testable without importing three.js.

/** Sub-segments emitted per passive fabric edge at every quality preset.
 *  Four is the visual floor for the organic quadratic-Bezier silhouette:
 *  one segment samples only the endpoints and degenerates into a straight
 *  chord. Adaptive quality sheds other capacity instead of this identity. */
export const FABRIC_SAMPLES_PER_EDGE = 4;

/** Upper bound on the cells the graph can be built over in one frame.
 *  The live set is bounded by the backend cell_cap (5000 alive) plus a
 *  short death-tail / burst margin; INSTANCE_CAPACITY (6000 drawn
 *  points) plus headroom is a safe ceiling. The buffer is sized for
 *  this worst case so the full k-NN graph never truncates in normal
 *  operation. */
export const MAX_GRAPH_CELLS = 7000;

/** Upper bound on the *mean* cell degree for k=5 symmetrised k-NN. The
 *  buffer is sized from edges ≈ cells × mean-degree / 2, so it is the
 *  mean — not any single cell — that the cap must cover; individual hub
 *  cells far exceed this after the lifeline/stitch passes. The real mean
 *  is ~9.5 at capacity with the live k=5 / maxEdgeLength=42 config; 12 is a
 *  safe ceiling. Guarded by fabricCapacity.test.ts, which builds the real graph
 *  over helix positions and asserts it fits — raise this (the buffer grows with
 *  it) if that test ever fails. */
export const AVG_DEGREE_BOUND = 12;

/** Hard segment cap for the fabric layer. Sized to hold every edge of
 *  the full graph at capacity: edges ≈ cells × degree / 2, each edge
 *  FABRIC_SAMPLES_PER_EDGE segments. The complete mesh therefore
 *  renders rather than a truncated spanning-tree prefix at every quality.
 *    7000 × 9 / 2 × 4 = 126000 segments (~5.8 MB across pos+col buffers). */
export const MAX_FABRIC_SEGMENTS = Math.ceil(
  ((MAX_GRAPH_CELLS * AVG_DEGREE_BOUND) / 2) * FABRIC_SAMPLES_PER_EDGE,
);

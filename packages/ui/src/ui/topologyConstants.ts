// Shared topology-level constants used by CellGalaxy and related systems.
// Previously housed in nervePulseScheduler.ts alongside the old NervePulses
// machinery; extracted here so CellGalaxy does not depend on deleted modules.

/** New-block delivery timeline. NOTE: the `BEAM_*` names are legacy (from the
 *  retired BlockBeam) — they now drive protocol-carrier timing. Kept as-is; a
 *  rename is deferred since they're load-bearing across CellGalaxy + the delivery
 *  layer + tests. Sub-phases, relative to a node's own arrival:
 *
 *    t = −BEAM_CHARGE_DUR_S             field gather — the octagonal carrier
 *                                       forms at the node. Arrival is scheduled
 *                                       in the future, so this fills the idle window.
 *    t = 0                              the carrier launches toward the Cell field.
 *    t = BEAM_GROW_DUR_S                the carrier reaches the field boundary and
 *                                       commits (contracts + illuminates nearby Cells).
 *    t = BLOCK_COMMIT_DELAY_S
 *      = BEAM_GROW_DUR_S + BEAM_STRIKE_DUR_S
 *                                       the Cell ledger acknowledges the block.
 *
 * The peer-network brightness shockwave starts at the raw P2P pulse and is not
 * delayed by this Cell-delivery timeline. */
export const BEAM_GROW_DUR_S = 1.00;
export const BEAM_STRIKE_DUR_S = 1.20;
/** Pre-roll gather window (s) before a carrier launches. Arrival (`firedAt`) is
 *  scheduled in the future (latency-derived), so this renders in the idle
 *  window age ∈ [−BEAM_CHARGE_DUR_S, 0): the energy-field plates form at the
 *  node, then launch at age 0. With no lead time (firedAt ≈ now), it is skipped. */
export const BEAM_CHARGE_DUR_S = 0.4;
export const BLOCK_COMMIT_DELAY_S = BEAM_GROW_DUR_S + BEAM_STRIKE_DUR_S;
/** Legacy public name retained for downstream compatibility. The visible
 * shockwave moved to the peer network; new Cell code should use
 * BLOCK_COMMIT_DELAY_S. */
export const SHOCKWAVE_FIRE_DELAY_S = BLOCK_COMMIT_DELAY_S;

/**
 * Delay from the raw peer-network block pulse until the local protocol carrier
 * reaches the Cell field. Live Cell-to-Cell nerve traffic must not start before
 * this boundary: the local node first receives the block, then the carrier
 * crosses into the field.
 */
export function cellFieldContactDelayS(localReceiveDelayS: number): number {
  const receiveDelayS = Number.isFinite(localReceiveDelayS)
    ? Math.max(0, localReceiveDelayS)
    : 0;
  return receiveDelayS + BEAM_GROW_DUR_S;
}

// Single calculation path: the Cell commit delay is derived, not free.
// If anyone retunes one of the beam phases they must keep the identity
// holding; the runtime assert + unit test guard against drift.
console.assert(
  Math.abs(BLOCK_COMMIT_DELAY_S - (BEAM_GROW_DUR_S + BEAM_STRIKE_DUR_S)) < 1e-9,
  'BLOCK_COMMIT_DELAY_S must equal BEAM_GROW_DUR_S + BEAM_STRIKE_DUR_S',
);

/** Speed (world-units / second) at which the peer-node brightness shockwave
 * expands from the block's network entry point. */
export const SHOCKWAVE_SPEED = 36;

/** Eviction ceiling for the per-block cell-highlight write loop.
 *  A pathological block touching > MAX_BLOCK_HIGHLIGHTS distinct cells
 *  would otherwise stall the highlight write loop on a large freshLinks
 *  ring. */
export const MAX_BLOCK_HIGHLIGHTS = 256;

/** Local-ignition feature — at the strike moment (block trigger +
 *  BEAM_GROW_DUR_S), cells geographically within LOCAL_IGNITION_RADIUS
 *  of the impact xz ignite in a fast radial sweep at
 *  LOCAL_IGNITION_SPEED. Bridges the "beam → cells" narrative
 *  directly: cells visibly *receive* the injected energy at the strike
 *  moment. Independent from the existing freshLinks-based exact
 *  per-cell acknowledgements. */
export const LOCAL_IGNITION_RADIUS = 14;
export const LOCAL_IGNITION_SPEED = 60;
export const MAX_LOCAL_IGNITIONS = 128;

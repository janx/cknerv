// Shared topology-level constants used by CellGalaxy and related systems.
// Previously housed in nervePulseScheduler.ts alongside the old NervePulses
// machinery; extracted here so CellGalaxy does not depend on deleted modules.

/** New-block animation breaks into four sub-phases, two inside the
 *  grow window and two inside the strike window:
 *
 *    t = 0                              block trigger; miner
 *                                       icosahedron flashes; a
 *                                       charging "light point" begins
 *                                       gathering energy at the miner.
 *    t = BEAM_CHARGE_DUR_S              charge complete; the beam
 *                                       bursts (rapid ease-out) from
 *                                       the miner toward the galaxy.
 *    t = BEAM_GROW_DUR_S                column reaches the cell plane;
 *                                       strike-splash sprite blooms at
 *                                       the impact point; column holds
 *                                       at full extension.
 *    t = BEAM_GROW_DUR_S + BEAM_HOLD_DUR_S
 *                                       hold ends; column begins to
 *                                       gradually retract — tip stays
 *                                       anchored at the impact while
 *                                       the base drains upward.
 *    t = SHOCKWAVE_FIRE_DELAY_S
 *      = BEAM_GROW_DUR_S + BEAM_STRIKE_DUR_S
 *                                       beam animation completes; the
 *                                       canopy brightness shockwave
 *                                       departs from (miner.x,
 *                                       miner.z). Per-cell highlight
 *                                       timestamps were scheduled at
 *                                       block-trigger time to ignite
 *                                       as the wavefront sweeps each
 *                                       cell. */
export const BEAM_CHARGE_DUR_S = 0.80;
export const BEAM_GROW_DUR_S = 1.00;
export const BEAM_HOLD_DUR_S = 0.90;
export const BEAM_STRIKE_DUR_S = 1.20;
export const SHOCKWAVE_FIRE_DELAY_S = BEAM_GROW_DUR_S + BEAM_STRIKE_DUR_S;

// Single calculation path: the shockwave delay is derived, not free.
// If anyone retunes one of the beam phases they must keep the identity
// holding; the runtime assert + unit test guard against drift.
console.assert(
  Math.abs(SHOCKWAVE_FIRE_DELAY_S - (BEAM_GROW_DUR_S + BEAM_STRIKE_DUR_S)) < 1e-9,
  'SHOCKWAVE_FIRE_DELAY_S must equal BEAM_GROW_DUR_S + BEAM_STRIKE_DUR_S',
);

/** Speed (world-units / second) at which the canopy shockwave ring
 *  expands. Equals PULSE_PROPAGATION_VELOCITY (36) so timing formulas
 *  in CellGalaxy line up with where the visible ring actually is. */
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
 *  moment, before the slower canopy shockwave wavefront begins its
 *  much wider sweep. Independent from the existing freshLinks-based
 *  per-cell highlights (which align with the canopy shockwave). */
export const LOCAL_IGNITION_RADIUS = 14;
export const LOCAL_IGNITION_SPEED = 60;
export const MAX_LOCAL_IGNITIONS = 128;

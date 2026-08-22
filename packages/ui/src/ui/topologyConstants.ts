// Shared topology-level constants used by CellGalaxy and related systems.
// Previously housed in nervePulseScheduler.ts alongside the old NervePulses
// machinery; extracted here so CellGalaxy does not depend on deleted modules.

/** New-block delivery timeline. NOTE: the `BEAM_*` names are legacy (from the
 *  retired BlockBeam) — they now drive protocol-carrier timing. Kept as-is; a
 *  rename is deferred since they're load-bearing across CellGalaxy + the delivery
 *  layer + tests. Sub-phases, relative to a node's own arrival:
 *
 *    t = −BEAM_CHARGE_DUR_S             gather — the worker holds still while its
 *                                       glyph tightens. Arrival is scheduled in
 *                                       the future, so this fills the idle window.
 *    t = 0                              the glyph rises toward the Cell field,
 *                                       contracting and heating as it goes.
 *    t = BEAM_GROW_DUR_S                contact: the glyph is released as a front
 *                                       that races out flat through the tissue,
 *                                       igniting Cells near the landing.
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
 *  window age ∈ [−BEAM_CHARGE_DUR_S, 0): the glyph tightens in place at the
 *  node, then rises at age 0. With no lead time (firedAt ≈ now), it is skipped. */
export const BEAM_CHARGE_DUR_S = 0.4;
export const BLOCK_COMMIT_DELAY_S = BEAM_GROW_DUR_S + BEAM_STRIKE_DUR_S;
/** Legacy public name retained for downstream compatibility. The visible
 * shockwave moved to the peer network; new Cell code should use
 * BLOCK_COMMIT_DELAY_S. */
export const SHOCKWAVE_FIRE_DELAY_S = BLOCK_COMMIT_DELAY_S;

/** Cell birth/death visual timing offset (s) — applied to each cell's
 *  born/death scene timestamp so the shader starts the birth scale-up (or the
 *  death fade-out) at the end of the delivery/commit choreography, plus 150 ms
 *  of readability. Every ledger-visible acknowledgement of a block lands here:
 *  the touched-Cell highlight, the newborn's arrival, and the corpse's fade.
 *  Lives with the timeline it is derived from rather than with the one
 *  component that first needed it — the pulse layer phase-locks to it too.
 *
 *  Cross-language contract: this delay plus `DEATH_DURATION_MS` is the whole
 *  death rite, and the server's `CORPSE_HOLD_MS` must outlast it. The sum is
 *  pinned in `tests/fixtures/death_rite.json` by
 *  `packages/ui/__tests__/geometry/deathRiteFixture.test.ts`; retuning this
 *  number fails that test until the fixture and the Rust hold follow. */
export const BLOCK_HIGHLIGHT_DELAY_S = BLOCK_COMMIT_DELAY_S + 0.15;

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

/**
 * The Cell-field contact front is a SCALED-DOWN version of that peer-plane
 * wave: same shape, same pacing, its reach divided by this number. Every
 * spatial constant of the front — speed, reach, start radius, crest width,
 * falloff reference — is divided by it, so the two planes still run one
 * synchronised event and the released ring stays a local ripple in the tissue
 * rather than a galaxy-wide sweep.
 *
 * Change it and the whole front rescales without changing its pacing: speed
 * and reach move together, so a front's lifetime — and with it the beat of
 * the release — is untouched, and the 1/r falloff is scale-invariant by
 * construction (reference and radius divide by the same number), so the
 * smaller ring is the same picture at a smaller size rather than a dimmer
 * one. Lives beside SHOCKWAVE_SPEED because the two numbers together ARE the
 * two-plane relationship.
 *
 * 4 → 8 on 2026-08-15: the expanding ring reached too far across the tissue,
 * so its maximum radius was halved — hero 11.4 → 5.7 world units after the
 * window clamp (contactFrontReachCeiling), peer 8.5 → 4.25.
 */
export const CONTACT_WAVE_SCALE = 8;

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

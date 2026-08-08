// Pure cohort planner for oversized setFabric reconciliations.
//
// A composition/reorg whole-graph replacement pushes ~16k adds + ~16k
// gc-fades through one diff; admitting them all at once puts every slot in
// the animating set for the full growth/decay window (whole-prefix rewrites
// and multi-MB uploads every frame). Instead, when a diff's churn
// (added + dying) exceeds the stagger threshold, only a threshold-sized
// prefix is applied synchronously and the remainder is sliced into delayed
// cohorts the emit loop admits as their startAt comes due — a DELAYED
// INSERTION queue, deliberately NOT future-bornAt staggering: a queued edge
// costs nothing per frame until it is admitted (a future-born edge would
// still sit in the animating set and be rewritten every frame).
//
// This module is pure maths so the plan shape is unit-testable; the queue
// itself (which holds edges + a cells snapshot) lives in NeuralFabric.
// tweakSchema imports the three defaults below so the live-tuning panel has
// ONE authority, not a shadowed copy.

/** Diff churn (added + dying) above which a setFabric reconciliation is
 *  staggered. At or below it every edge is applied synchronously — the
 *  historical path, byte-identical. */
export const FABRIC_STAGGER_THRESHOLD = 1500;
/** Adds admitted — and gc-fades applied — per side per cohort. */
export const FABRIC_COHORT_SIZE = 750;
/** Sim-seconds between consecutive cohort admissions. */
export const FABRIC_COHORT_INTERVAL_S = 0.25;

/** One delayed slice over the DEFERRED remainder arrays (indices are
 *  relative to the queued lists, not the full candidate lists). */
export interface FabricCohortSlice {
  /** Absolute sim-second at/after which this cohort is admitted. */
  startAt: number;
  /** [addStart, addEnd) into the deferred adds list. */
  addStart: number;
  addEnd: number;
  /** [killStart, killEnd) into the deferred kills list. */
  killStart: number;
  killEnd: number;
}

export interface FabricCohortPlan {
  /** Add candidates applied synchronously (a prefix of the list, so the
   *  traversal/renderOrder sequence is preserved). */
  immediateAdds: number;
  /** Dying candidates marked synchronously (a prefix likewise). */
  immediateKills: number;
  /** Delayed slices, startAt ascending, first at now + interval. */
  cohorts: FabricCohortSlice[];
}

export interface FabricCohortOptions {
  staggerThreshold: number;
  cohortSize: number;
  cohortIntervalS: number;
}

/**
 * Split one diff's churn into an immediate prefix plus delayed cohorts.
 * Returns null when the whole diff fits inside the threshold — the caller
 * must then take the historical fully-synchronous path unchanged.
 *
 * The immediate budget (exactly `staggerThreshold` entries) is split
 * proportionally between adds and kills so both the new structure and the
 * fading old one start moving on the same frame; the remainders are sliced
 * into up-to-`cohortSize` batches per side, paired index-wise on a shared
 * `cohortIntervalS` cadence (the shorter side simply exhausts earlier).
 */
export function planFabricCohorts(
  addCount: number,
  killCount: number,
  now: number,
  options: FabricCohortOptions,
): FabricCohortPlan | null {
  const threshold = Number.isFinite(options.staggerThreshold)
    ? Math.max(0, Math.floor(options.staggerThreshold))
    : FABRIC_STAGGER_THRESHOLD;
  const total = addCount + killCount;
  if (total <= threshold) return null;
  const size = Number.isFinite(options.cohortSize)
    ? Math.max(1, Math.floor(options.cohortSize))
    : FABRIC_COHORT_SIZE;
  const interval = Number.isFinite(options.cohortIntervalS)
    && options.cohortIntervalS > 0
    ? options.cohortIntervalS
    : FABRIC_COHORT_INTERVAL_S;
  // Proportional immediate split, clamped to each side's population. The
  // clamps redistribute leftover budget to the other side, so immediates
  // always sum to exactly `threshold` (total > threshold guarantees room).
  let immediateAdds = Math.round((threshold * addCount) / total);
  if (immediateAdds > addCount) immediateAdds = addCount;
  let immediateKills = threshold - immediateAdds;
  if (immediateKills > killCount) {
    immediateKills = killCount;
    immediateAdds = Math.min(addCount, threshold - immediateKills);
  }
  const deferredAdds = addCount - immediateAdds;
  const deferredKills = killCount - immediateKills;
  const cohortCount = Math.max(
    Math.ceil(deferredAdds / size),
    Math.ceil(deferredKills / size),
  );
  const cohorts: FabricCohortSlice[] = [];
  for (let i = 0; i < cohortCount; i += 1) {
    cohorts.push({
      startAt: now + (i + 1) * interval,
      addStart: Math.min(deferredAdds, i * size),
      addEnd: Math.min(deferredAdds, (i + 1) * size),
      killStart: Math.min(deferredKills, i * size),
      killEnd: Math.min(deferredKills, (i + 1) * size),
    });
  }
  return { immediateAdds, immediateKills, cohorts };
}

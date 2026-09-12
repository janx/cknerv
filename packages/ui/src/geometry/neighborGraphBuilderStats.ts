// Dev-observable counters for the topology worker pipeline: paths that used
// to fail silently, and the chain-integrity bookkeeping a live session has to
// be readable on. A cooperative fallback re-runs the FULL canonical topology
// build across main-thread tasks — worth seeing in a profile session, not a hard
// failure; a `stale` resend costs a full re-pack and a second round trip; an
// unchained apply is a whole O(V) display rebuild.
//
// Pure module singleton — the `fabricStats` / `pulseStats` idiom: mutated
// directly by the builder, read by a snapshot, reset by a probe or a test,
// always on (an integer increment per build). Its own module rather than a
// corner of the builder so the fabric's window hook can carry it without
// importing the worker factory; the builder re-exports it under the name its
// tests have always used.

export interface NeighborGraphBuilderStatsSnapshot {
  /** Worker error / postMessage / deserialize failures → sliced recovery. */
  workerFallbacks: number;
  /** Builds below the worker threshold (expected, small fields). */
  belowThresholdBuilds: number;
  /** In-flight requests the watchdog had to give up on (worker gone). */
  workerTimeouts: number;
  /** Display graphs applied as an in-place patch against the graph the
   * requester held — the O(churn) steady state of a chained session. */
  patchedApplies: number;
  /** Display graphs rebuilt from a whole adjacency (bootstrap, fresh
   * worker, or a caller that cannot patch). */
  fullApplies: number;
  /** Whole applies forced by a generation gap — a superseded, dropped or
   * failed build between two applied ones broke the chain. Each one is a
   * whole O(V) display rebuild and, when a selection rides, a whole passive
   * list. */
  unchainedApplies: number;
  /** Delta requests the session refused (`stale`): each costs a full
   * re-pack and a second worker round trip before the graph lands. */
  staleResends: number;
  /** Passive selections merged in place from a patch — one per chained
   * build that carried a selection; the O(edges + churn) steady state. */
  passivePatchedApplies: number;
  /** Passive selections rebuilt from a whole edge list (bootstrap, fresh
   * worker, a caller that cannot patch, or the first selection after a build
   * without one). */
  passiveFullApplies: number;
  /** Surviving passive records the patch REPLACED because their distance or
   * arbor weight moved — the arbor rescale, which touches most of the list on
   * most chained builds and is the largest piece of the landing task. Sum
   * across the window; `rewrittenLast` is the most recent apply alone, so a
   * window total and a single block can be told apart. */
  rewritten: number;
  rewrittenLast: number;
  /** Macrotask slices used by canonical main-thread recovery. */
  recoverySlices: number;
  recoveryMaxSliceMs: number;
  recoveryMaxStepMs: number;
  recoveryCompleted: number;
  recoveryCancelled: number;
  /** Currently scheduled recovery callbacks; zero after cancel/dispose. */
  recoveryPendingTasks: number;
  recoveryMaxPendingTasks: number;
}

export const neighborGraphBuilderStats: NeighborGraphBuilderStatsSnapshot = {
  workerFallbacks: 0,
  belowThresholdBuilds: 0,
  workerTimeouts: 0,
  patchedApplies: 0,
  fullApplies: 0,
  unchainedApplies: 0,
  staleResends: 0,
  passivePatchedApplies: 0,
  passiveFullApplies: 0,
  rewritten: 0,
  rewrittenLast: 0,
  recoverySlices: 0,
  recoveryMaxSliceMs: 0,
  recoveryMaxStepMs: 0,
  recoveryCompleted: 0,
  recoveryCancelled: 0,
  recoveryPendingTasks: 0,
  recoveryMaxPendingTasks: 0,
};

export function snapshotNeighborGraphBuilderStats(): NeighborGraphBuilderStatsSnapshot {
  return { ...neighborGraphBuilderStats };
}

export function resetNeighborGraphBuilderStats(): void {
  neighborGraphBuilderStats.workerFallbacks = 0;
  neighborGraphBuilderStats.belowThresholdBuilds = 0;
  neighborGraphBuilderStats.workerTimeouts = 0;
  neighborGraphBuilderStats.patchedApplies = 0;
  neighborGraphBuilderStats.fullApplies = 0;
  neighborGraphBuilderStats.unchainedApplies = 0;
  neighborGraphBuilderStats.staleResends = 0;
  neighborGraphBuilderStats.passivePatchedApplies = 0;
  neighborGraphBuilderStats.passiveFullApplies = 0;
  neighborGraphBuilderStats.rewritten = 0;
  neighborGraphBuilderStats.rewrittenLast = 0;
  neighborGraphBuilderStats.recoverySlices = 0;
  neighborGraphBuilderStats.recoveryMaxSliceMs = 0;
  neighborGraphBuilderStats.recoveryMaxStepMs = 0;
  neighborGraphBuilderStats.recoveryCompleted = 0;
  neighborGraphBuilderStats.recoveryCancelled = 0;
  neighborGraphBuilderStats.recoveryPendingTasks = 0;
  neighborGraphBuilderStats.recoveryMaxPendingTasks = 0;
}

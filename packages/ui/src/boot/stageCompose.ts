/**
 * The boot readout's second chapter: is the stage still composing?
 *
 * A freshly started server announces its dashboard BEFORE it finishes putting
 * the CellGalaxy composition back together, and the page it auto-opens lands
 * inside that window. Measured against a warm datastore, one restart:
 *
 *   t+1.0s   canonical prefix on stage — 11,488 of 12,000 seats
 *   t+7.6s   the remembered composition lands — 12,000 seats, 9,008 curated
 *   t+19s    a fresh record from the source replaces it — 12,000 seats again
 *   t+19–40s top-up rounds keep swapping fill for curated members
 *            (curated 8,978 → 10,169, canonical fill 3,022 → 1,831)
 *
 * Every one of those lines re-wires the fabric and re-grows edges on screen,
 * and only the FIRST of them changes the seat count. That is what this module
 * exists to say, and it is why the count cannot be the thing it watches: from
 * t+7.6s the stage reads 12,000 / 12,000 while the work with the longest tail
 * has not started. The readout this decision drives used to resolve exactly
 * there — measured, its last painted frame was a full bar, drawn at the
 * instant the composition began.
 *
 * So the question is not "how full" but "is anything still moving", and three
 * different movements count as one answer:
 *
 *   FILLING     seats still short of the budget.
 *   LANDING     seats full, but the membership is still the canonical prefix
 *               the server stands up before its composition is ready.
 *   CONVERGING  composed, and the curated share is still setting new highs, or
 *               the source has published another record.
 *
 * The watch is a one-way ride per page: idle → watching → resolved, and
 * resolved is terminal — mid-session churn can never bring the readout back.
 * A page that opens onto a stage already full AND already composed resolves on
 * its first sample and never renders, which is every ordinary refresh.
 *
 * This module is the decision. `components/hud/StageComposingBanner.tsx` is
 * the form, and it is a chapter of the boot band rather than an object of its
 * own — the two are one instrument saying successive things.
 */

/** "Effectively full": per-block churn keeps a composed stage a few Cells
 *  shy of its budget at any instant, and waiting for exact equality would
 *  leave the readout flickering over noise. */
export const STAGE_FILL_FULL_RATIO = 0.995;

/** No movement for this long resolves a watch that never got composed: a chain
 *  that cannot fill the display budget (a sparse devnet) is not composing, and
 *  a deployment with no curated source never will be. The readout must not
 *  claim forever that either is. Generous on purpose — block cadence is
 *  Poisson and a quiet minute mid-convergence is ordinary, not conclusive. */
export const STAGE_FILL_QUIET_MS = 60_000;

/** …and once the stage IS full and composed, the shorter clock. Convergence
 *  arrives in bursts with gaps between them: measured across one warm restart
 *  the longest gap between two movements was 11.3s (a fresh record at t+19s,
 *  the next new high at t+30.5s), so this clears the widest observed gap with
 *  margin and still leaves within a block or two of the last thing that moved.
 *  It is a settling time, not a deadline — every burst re-arms it. */
export const STAGE_COMPOSE_SETTLE_MS = 15_000;

export interface StageComposeSample {
  nowMs: number;
  /** Alive server-stage members (`CellPopulationFieldModel.stagedLive`), or
   *  null while no model exists yet. */
  stagedLive: number | null;
  /** The display plane's Cell budget, or null without a plane. */
  budget: number | null;
  /** Staged members the server had to ship payloads for — the curated share,
   *  since a member inside the canonical retained window needs no payload.
   *  Rises as the top-up swaps fill for composition. */
  curatedLive: number | null;
  /** The membership is the composition rather than the canonical prefix
   *  (`displayProvenance.mode === 'composed'`). */
  composed: boolean;
  /** When that provenance was stamped. A new stamp is a new record: the
   *  server publishing another composition is movement even when both the
   *  seat count and the curated share happen to land on the same numbers. */
  composedAtMs: number | null;
}

export interface StageComposeWatch {
  phase: 'idle' | 'watching' | 'resolved';
  /** High-water marks; movement is measured against them so a per-block dip —
   *  or a fresh record that starts its refill lower than the last one finished
   *  — never re-arms the settle clock on the way back up to where it was. */
  peakStaged: number;
  peakCurated: number;
  composedAtMs: number | null;
  lastMovementAtMs: number;
  /** The readout renders while true (equal to `phase === 'watching'`). */
  visible: boolean;
}

export function createStageComposeWatch(): StageComposeWatch {
  return {
    phase: 'idle',
    peakStaged: 0,
    peakCurated: 0,
    composedAtMs: null,
    lastMovementAtMs: 0,
    visible: false,
  };
}

function count(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Math.max(0, Math.floor(value));
}

export function stageEffectivelyFull(stagedLive: number, budget: number): boolean {
  return stagedLive >= Math.ceil(budget * STAGE_FILL_FULL_RATIO);
}

/**
 * Advance the watch by one observation. Returns the SAME reference when
 * nothing changed, so a state setter fed with this is free on quiet samples.
 *
 * Deliberately NOT gated on the boot record. The watch starts observing the
 * moment there is something to observe, and the band decides separately when
 * to show it — because the two ends of this window are set by unrelated
 * clocks. Boot completes when the last stream goes live, which waits on the
 * next chain message and lands anywhere from two seconds to ten; the
 * composition lands when the datastore restore does. Arming only after boot
 * meant the watch could open its eyes on the far side of the very event it
 * exists to narrate — measured, that is exactly what happened, twice out of
 * three restarts.
 */
export function sampleStageCompose(
  watch: StageComposeWatch,
  sample: StageComposeSample,
): StageComposeWatch {
  if (watch.phase === 'resolved') return watch;
  if (!Number.isFinite(sample.nowMs)) return watch;
  const stagedLive = count(sample.stagedLive);
  const budget = count(sample.budget);
  const curatedLive = count(sample.curatedLive) ?? 0;

  if (watch.phase === 'idle') {
    // No model yet is not evidence of anything — stay armed until the first
    // real count arrives. (A page whose data never arrives keeps its boot
    // banner, so nothing is waiting on this.)
    if (stagedLive === null) return watch;
    // No display plane means no stage to compose; a stage that is already full
    // AND already composed was composed before this page opened. Both are
    // terminal: the readout exists only for the window between them.
    if (budget === null || budget <= 0) {
      return { ...watch, phase: 'resolved', visible: false };
    }
    if (stageEffectivelyFull(stagedLive, budget) && sample.composed) {
      return { ...watch, phase: 'resolved', visible: false };
    }
    return {
      phase: 'watching',
      peakStaged: stagedLive,
      peakCurated: curatedLive,
      composedAtMs: sample.composedAtMs,
      lastMovementAtMs: sample.nowMs,
      visible: true,
    };
  }

  // watching
  if (stagedLive === null) return watch;
  if (budget === null || budget <= 0) {
    return { ...watch, phase: 'resolved', visible: false };
  }

  const moved = stagedLive > watch.peakStaged
    || curatedLive > watch.peakCurated
    || sample.composedAtMs !== watch.composedAtMs;
  if (moved) {
    return {
      ...watch,
      peakStaged: Math.max(watch.peakStaged, stagedLive),
      peakCurated: Math.max(watch.peakCurated, curatedLive),
      composedAtMs: sample.composedAtMs,
      lastMovementAtMs: sample.nowMs,
    };
  }

  // Nothing moved. How long the readout waits before calling it over depends
  // on what it is still waiting FOR: a stage that is full and composed is
  // settling and answers within a block or two, while one still filling — or
  // one waiting for a composition that may never come — gets the long clock,
  // because on that side of the question silence is not evidence.
  const settled = stageEffectivelyFull(stagedLive, budget) && sample.composed;
  const quietMs = settled ? STAGE_COMPOSE_SETTLE_MS : STAGE_FILL_QUIET_MS;
  if (sample.nowMs - watch.lastMovementAtMs >= quietMs) {
    return { ...watch, phase: 'resolved', visible: false };
  }
  return watch;
}

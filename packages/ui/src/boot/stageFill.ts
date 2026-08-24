/**
 * The boot readout's tail: is the stage still composing?
 *
 * A freshly started server announces its dashboard BEFORE it finishes
 * restoring the remembered CellGalaxy composition (measured: dashboard at
 * t≈+1.4 s, restore lands t≈+7.9 s — and a first-ever cold datastore
 * converges over minutes). A page that opens in that window boots truthfully
 * against the smaller world, the readout completes, and then thousands of
 * Cells — with their fabric edges and bridges — sprout with no readout on
 * screen. Holding the boot banner for that would be wrong the other way:
 * stage convergence is the organism living, not the page booting, and on a
 * cold server it runs for minutes.
 *
 * So the slot hands over instead: after the boot record completes, a QUIET
 * chip discloses the staged membership against the display budget until the
 * stage is effectively full or stops growing. This module is the decision;
 * the chip beside the other HUD banners is the form.
 *
 * The watch is a one-way ride per page: idle → watching → resolved, and
 * resolved is terminal — mid-session churn can never resurrect the chip. A
 * boot that lands on an already-composed stage (any refresh after the
 * restore) resolves on its first sample and the chip never renders.
 */

/** "Effectively full": per-block churn keeps a composed stage a few Cells
 *  shy of its budget at any instant, and waiting for exact equality would
 *  leave the chip flickering over noise. */
export const STAGE_FILL_FULL_RATIO = 0.995;

/** No growth for this long resolves the watch anyway: a chain that cannot
 *  fill the display budget (a sparse devnet) is not composing, and the chip
 *  must not claim forever that it is. Generous on purpose — block cadence is
 *  Poisson and a quiet minute mid-convergence is ordinary, not conclusive. */
export const STAGE_FILL_QUIET_MS = 60_000;

export interface StageFillSample {
  nowMs: number;
  /** The boot record's `complete` — the watch arms only after it. */
  bootComplete: boolean;
  /** Alive server-stage members (`CellPopulationFieldModel.stagedLive`), or
   *  null while no model exists yet. */
  stagedLive: number | null;
  /** The display plane's Cell budget, or null without a plane. */
  budget: number | null;
}

export interface StageFillWatch {
  phase: 'idle' | 'watching' | 'resolved';
  /** High-water staged count; growth is measured against it so a per-block
   *  dip never re-arms the quiet timer. */
  peakStaged: number;
  lastGrowthAtMs: number;
  /** The chip renders while true (equal to `phase === 'watching'`). */
  visible: boolean;
}

export function createStageFillWatch(): StageFillWatch {
  return { phase: 'idle', peakStaged: 0, lastGrowthAtMs: 0, visible: false };
}

function count(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Math.max(0, Math.floor(value));
}

function effectivelyFull(stagedLive: number, budget: number): boolean {
  return stagedLive >= Math.ceil(budget * STAGE_FILL_FULL_RATIO);
}

/**
 * Advance the watch by one observation. Returns the SAME reference when
 * nothing changed, so a state setter fed with this is free on quiet samples.
 */
export function sampleStageFill(
  watch: StageFillWatch,
  sample: StageFillSample,
): StageFillWatch {
  if (watch.phase === 'resolved') return watch;
  if (!Number.isFinite(sample.nowMs)) return watch;
  const stagedLive = count(sample.stagedLive);
  const budget = count(sample.budget);

  if (watch.phase === 'idle') {
    if (!sample.bootComplete) return watch;
    // No model yet is not evidence of anything — stay armed until the first
    // real count arrives. (A failed boot never completes, so a faulted page
    // stays idle here forever and the banner keeps the slot.)
    if (stagedLive === null) return watch;
    // No display plane means no budget to fill; a stage already at its
    // budget means the composition landed before this page booted. Both are
    // terminal: the chip exists only for the window between them.
    if (budget === null || budget <= 0 || effectivelyFull(stagedLive, budget)) {
      return { ...watch, phase: 'resolved', visible: false };
    }
    return {
      phase: 'watching',
      peakStaged: stagedLive,
      lastGrowthAtMs: sample.nowMs,
      visible: true,
    };
  }

  // watching
  if (stagedLive === null) return watch;
  if (budget === null || budget <= 0 || effectivelyFull(stagedLive, budget)) {
    return { ...watch, phase: 'resolved', visible: false };
  }
  if (stagedLive > watch.peakStaged) {
    return {
      ...watch,
      peakStaged: stagedLive,
      lastGrowthAtMs: sample.nowMs,
    };
  }
  if (sample.nowMs - watch.lastGrowthAtMs >= STAGE_FILL_QUIET_MS) {
    return { ...watch, phase: 'resolved', visible: false };
  }
  return watch;
}

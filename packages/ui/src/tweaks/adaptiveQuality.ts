import type { QualityPreset } from './qualityPresets';

export const ADAPTIVE_SAMPLE_WINDOW_MS = 750;
export const ADAPTIVE_WARMUP_MS = 4_000;
export const ADAPTIVE_SWITCH_COOLDOWN_MS = 6_000;
export const ADAPTIVE_EMA_TIME_MS = 1_500;

/** Calibration ends once the tier has held this long without a switch. What is
 * decided at the door is the CEILING: no sample after the lock may raise the
 * tier, so this window only has to be long enough to catch a machine that
 * cannot carry the tier it started at. Falling further stays possible for the
 * life of the page — see {@link POST_LOCK_DOWN_HOLD_MUL}. */
export const QUALITY_LOCK_STABLE_MS = 10_000;

/** Absolute ceiling on calibration, measured from the end of warmup. Evidence
 * that oscillates without ever completing a hold would otherwise sample
 * forever; at this point the tier in hand is the answer. Wide enough that a
 * machine that needs `low` can still pass through `med` on the way — each step
 * re-arms its own stability window inside this cap. */
export const QUALITY_CALIBRATION_MAX_MS = 30_000;

const QUALITY_ORDER: readonly QualityPreset[] = ['low', 'med', 'high'];
const DOWN_FRAME_MS: Record<QualityPreset, number> = {
  high: 22,
  med: 30,
  low: Number.POSITIVE_INFINITY,
};
const DOWN_HOLD_MS: Record<QualityPreset, number> = {
  high: 5_000,
  med: 6_000,
  low: Number.POSITIVE_INFINITY,
};

/** Post-lock a downshift must clear a hold this many times longer than the
 * one calibration uses. Calibration is over ~34 s after a page opens, which on
 * a laptop falls entirely inside the GPU's cold-boost window; sustained load
 * then heats the silicon and drops the clocks by ~40% minutes later, and a
 * tier that fit at boost no longer fits. Measured 2026-08-22 on a 30 W iGPU:
 * `high` locked at 59 fps on cold silicon and ran 26-43 fps by minute five,
 * while `med` held 57-60. So the lock keeps listening downward. The stiffer
 * hold is the price of speaking after calibration already has: a settled page
 * gives up a tier only for pressure that is plainly the steady state, not for
 * one heavy minute. */
export const POST_LOCK_DOWN_HOLD_MUL = 2;

// There is no upshift, in any phase: during calibration only a downshift may
// fire, and after the lock only a downshift may fire — against the longer hold
// above. Each page therefore walks one way, and a monotone-down machine cannot
// limit-cycle, which is the whole reason the lock exists. The retired up/down
// controller oscillated six times in nine minutes at 4K because `high` sits ON
// the vsync deadline and a controller can only measure the tier it is in: at
// `med` it read fast, which says nothing about what `high` would have cost.

export interface AdaptiveQualityState {
  quality: QualityPreset;
  smoothedFrameMs: number;
  warmupRemainingMs: number;
  cooldownRemainingMs: number;
  slowEvidenceMs: number;
  /** Calibration is over — this tier is the page's ceiling. Sticky: once true
   * it never clears, and the tier may only step down from here. */
  locked: boolean;
  /** Sampled time since the last switch, warmup and cooldown excluded. */
  stableMs: number;
  /** Time advanced since the end of warmup, cooldown included. */
  calibrationMs: number;
}

export function createAdaptiveQualityState(
  quality: QualityPreset = 'high',
  warmupRemainingMs = ADAPTIVE_WARMUP_MS,
): AdaptiveQualityState {
  return {
    quality,
    smoothedFrameMs: 0,
    warmupRemainingMs: Math.max(0, warmupRemainingMs),
    cooldownRemainingMs: 0,
    slowEvidenceMs: 0,
    locked: false,
    stableMs: 0,
    calibrationMs: 0,
  };
}

/** Re-arm warmup and drop the evidence so far without giving up the lock. A
 * restart exists for frames the sampler must not trust — a replay storm and
 * the settle frames behind it — and untrustworthy evidence is no reason to
 * hand a settled page its ceiling back. `locked` therefore rides through, and
 * the fresh state may still only step down. */
export function restartAdaptiveQualityState(
  state: AdaptiveQualityState,
  quality: QualityPreset,
): AdaptiveQualityState {
  return { ...createAdaptiveQualityState(quality), locked: state.locked };
}

function lowerQuality(quality: QualityPreset): QualityPreset {
  const index = QUALITY_ORDER.indexOf(quality);
  return QUALITY_ORDER[Math.max(0, index - 1)];
}

/** The hold a downshift must complete, stiffened once calibration has spoken.
 * `low` holds `Infinity` at either multiple, so the floor stays a floor. */
function downHoldMs(state: AdaptiveQualityState): number {
  const hold = DOWN_HOLD_MS[state.quality];
  return state.locked ? hold * POST_LOCK_DOWN_HOLD_MUL : hold;
}

/**
 * Advance one window-average sample. Evidence grows only outside the deadband
 * and decays twice as fast inside it. A single event spike therefore disappears
 * before it can trigger a switch, while sustained pressure eventually does.
 *
 * Calibration runs from the end of warmup to the lock and admits downshifts
 * only. The lock ends calibration, not measurement: the same machinery keeps
 * advancing afterwards and the one action still open to it is a downshift,
 * against the longer {@link POST_LOCK_DOWN_HOLD_MUL} hold. The caller keeps
 * sampling for the life of the page.
 */
export function advanceAdaptiveQuality(
  state: AdaptiveQualityState,
  frameMs: number,
  sampleDurationMs: number,
): AdaptiveQualityState {
  if (!Number.isFinite(frameMs) || frameMs <= 0) return state;
  if (!Number.isFinite(sampleDurationMs) || sampleDurationMs <= 0) return state;

  // A delayed callback must not contribute an arbitrarily large block of
  // evidence. The live controller rejects hidden-tab windows as well.
  const duration = Math.min(sampleDurationMs, ADAPTIVE_SAMPLE_WINDOW_MS * 2);
  const alpha = 1 - Math.exp(-duration / ADAPTIVE_EMA_TIME_MS);
  const smoothedFrameMs = state.smoothedFrameMs > 0
    ? state.smoothedFrameMs + (frameMs - state.smoothedFrameMs) * alpha
    : frameMs;

  if (state.warmupRemainingMs > 0) {
    return {
      ...state,
      smoothedFrameMs,
      warmupRemainingMs: Math.max(0, state.warmupRemainingMs - duration),
      slowEvidenceMs: 0,
    };
  }

  const calibrationMs = state.calibrationMs + duration;

  if (state.cooldownRemainingMs > 0) {
    // Cooldown is calibration time but not stability time: evidence is
    // deliberately ignored here, so counting it would spend six of the ten
    // stable seconds on a window that could not have noticed pressure — and
    // lock every weak machine one tier above the one it needs. The hard cap
    // still applies, since it measures wall time and nothing else.
    return {
      ...state,
      smoothedFrameMs,
      cooldownRemainingMs: Math.max(0, state.cooldownRemainingMs - duration),
      slowEvidenceMs: 0,
      calibrationMs,
      locked: state.locked || calibrationMs >= QUALITY_CALIBRATION_MAX_MS,
    };
  }

  const slow = smoothedFrameMs > DOWN_FRAME_MS[state.quality];
  const slowEvidenceMs = slow
    ? state.slowEvidenceMs + duration
    : Math.max(0, state.slowEvidenceMs - duration * 2);

  // A completed hold outranks a completed stability window: at that moment the
  // tier is proven wrong, and locking a tier known to be wrong is the worse
  // outcome. The new tier then gets a stability window of its own. Past the
  // lock this is the only branch that can still act, and the tier it hands
  // back cools down exactly as one from calibration does — so a long hot
  // session may legitimately walk high -> med -> low, a step at a time.
  if (slowEvidenceMs >= downHoldMs(state)) {
    return {
      quality: lowerQuality(state.quality),
      smoothedFrameMs,
      warmupRemainingMs: 0,
      cooldownRemainingMs: ADAPTIVE_SWITCH_COOLDOWN_MS,
      slowEvidenceMs: 0,
      locked: state.locked || calibrationMs >= QUALITY_CALIBRATION_MAX_MS,
      stableMs: 0,
      calibrationMs,
    };
  }

  const stableMs = state.stableMs + duration;
  return {
    ...state,
    smoothedFrameMs,
    slowEvidenceMs,
    stableMs,
    calibrationMs,
    locked: state.locked
      || stableMs >= QUALITY_LOCK_STABLE_MS
      || calibrationMs >= QUALITY_CALIBRATION_MAX_MS,
  };
}

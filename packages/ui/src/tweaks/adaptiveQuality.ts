import type { QualityPreset } from './qualityPresets';

export const ADAPTIVE_SAMPLE_WINDOW_MS = 750;
export const ADAPTIVE_WARMUP_MS = 4_000;
export const ADAPTIVE_SWITCH_COOLDOWN_MS = 6_000;
export const ADAPTIVE_EMA_TIME_MS = 1_500;

/** Calibration ends once the tier has held this long without a switch. Quality
 * is decided at the door: the tier a page opens with is the tier it keeps
 * until the next reload, so this window only has to be long enough to catch a
 * machine that cannot carry the tier it started at. */
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

// There is no upshift. Under the lock no phase could act on fast evidence —
// during calibration only a downshift may fire, and after the lock nothing
// fires at all — so a page that opens `high` and never dips simply stays
// `high`, and one that dips settles lower and stays there.

export interface AdaptiveQualityState {
  quality: QualityPreset;
  smoothedFrameMs: number;
  warmupRemainingMs: number;
  cooldownRemainingMs: number;
  slowEvidenceMs: number;
  /** Calibration is over — the tier is final for this page. */
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

function lowerQuality(quality: QualityPreset): QualityPreset {
  const index = QUALITY_ORDER.indexOf(quality);
  return QUALITY_ORDER[Math.max(0, index - 1)];
}

/**
 * Advance one window-average sample. Evidence grows only outside the deadband
 * and decays twice as fast inside it. A single event spike therefore disappears
 * before it can trigger a switch, while sustained pressure eventually does.
 *
 * Calibration runs from the end of warmup to the lock and admits downshifts
 * only. Once locked the call is a no-op — the same state comes back — so the
 * caller may stop sampling entirely.
 */
export function advanceAdaptiveQuality(
  state: AdaptiveQualityState,
  frameMs: number,
  sampleDurationMs: number,
): AdaptiveQualityState {
  if (state.locked) return state;
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
      locked: calibrationMs >= QUALITY_CALIBRATION_MAX_MS,
    };
  }

  const slow = smoothedFrameMs > DOWN_FRAME_MS[state.quality];
  const slowEvidenceMs = slow
    ? state.slowEvidenceMs + duration
    : Math.max(0, state.slowEvidenceMs - duration * 2);

  // A completed hold outranks a completed stability window: at that moment the
  // tier is proven wrong, and locking a tier known to be wrong is the worse
  // outcome. The new tier then gets a stability window of its own.
  if (slowEvidenceMs >= DOWN_HOLD_MS[state.quality]) {
    return {
      quality: lowerQuality(state.quality),
      smoothedFrameMs,
      warmupRemainingMs: 0,
      cooldownRemainingMs: ADAPTIVE_SWITCH_COOLDOWN_MS,
      slowEvidenceMs: 0,
      locked: calibrationMs >= QUALITY_CALIBRATION_MAX_MS,
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
    locked: stableMs >= QUALITY_LOCK_STABLE_MS
      || calibrationMs >= QUALITY_CALIBRATION_MAX_MS,
  };
}

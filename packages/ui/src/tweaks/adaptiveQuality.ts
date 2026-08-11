import type { QualityPreset } from './qualityPresets';

export const ADAPTIVE_SAMPLE_WINDOW_MS = 750;
/** Boot grace before frames count as tier evidence. Sized for the FULL
 * first-composition storm at the High tier on a resumed session (initial
 * 50K kNN worker build, first 66K-nerve fabric growth, catch-up batches),
 * which lasts well past the old 4s and — measured live — knocked every
 * boot down a tier before steady state existed. Weak hardware still walks
 * down afterwards; it just starts judging from steady frames. */
export const ADAPTIVE_WARMUP_MS = 12_000;
export const ADAPTIVE_SWITCH_COOLDOWN_MS = 6_000;
/** Settle grace after an UPWARD switch. A promotion triggers a one-time
 * transition storm (tier-scale render-set rebuild, fabric reallocation and
 * regrowth) that outlives the ordinary cooldown and used to knock every
 * promotion straight back down — the tier was judged on its own arrival
 * cost, never on steady frames. Downward switches keep the short cooldown:
 * protective downshifts on weak hardware must stay fast. */
export const ADAPTIVE_UP_SETTLE_MS = 18_000;
export const ADAPTIVE_EMA_TIME_MS = 1_500;

const QUALITY_ORDER: readonly QualityPreset[] = ['low', 'med', 'high'];
const DOWN_FRAME_MS: Record<QualityPreset, number> = {
  high: 22,
  med: 30,
  low: Number.POSITIVE_INFINITY,
};
const UP_FRAME_MS: Record<QualityPreset, number> = {
  high: Number.NEGATIVE_INFINITY,
  // 18.5 leaves headroom over the vsync-locked 16.7 baseline so ordinary
  // jitter does not interrupt promotion evidence, while staying far below
  // the demotion thresholds (30/22) — the hysteresis band stays wide.
  med: 18.5,
  low: 20,
};
const DOWN_HOLD_MS: Record<QualityPreset, number> = {
  // Demotion must distinguish CONTINUOUS slowness (the tier exceeds the
  // machine — every frame slow, evidence accrues monotonically and trips
  // the hold quickly regardless of its length) from PER-BLOCK BURSTS
  // (data-event spikes that decay at 2x between blocks and can only reach
  // a long hold if blocks arrive faster than the decay — i.e., the burst
  // cost itself is chronic). 12s at High tolerates block bursts a strong
  // machine absorbs; a genuinely overwhelmed machine still demotes in
  // ~12s of wall time.
  high: 12_000,
  med: 6_000,
  low: Number.POSITIVE_INFINITY,
};
const UP_HOLD_MS: Record<QualityPreset, number> = {
  high: Number.POSITIVE_INFINITY,
  med: 15_000,
  low: 12_000,
};

export interface AdaptiveQualityState {
  quality: QualityPreset;
  smoothedFrameMs: number;
  warmupRemainingMs: number;
  cooldownRemainingMs: number;
  slowEvidenceMs: number;
  fastEvidenceMs: number;
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
    fastEvidenceMs: 0,
  };
}

function adjacentQuality(quality: QualityPreset, direction: -1 | 1): QualityPreset {
  const index = QUALITY_ORDER.indexOf(quality);
  const next = Math.max(0, Math.min(QUALITY_ORDER.length - 1, index + direction));
  return QUALITY_ORDER[next];
}

/**
 * Advance one window-average sample. Evidence grows only outside the deadband
 * and decays twice as fast inside it. A single event spike therefore disappears
 * before it can trigger a switch, while sustained pressure eventually does.
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
      fastEvidenceMs: 0,
    };
  }

  if (state.cooldownRemainingMs > 0) {
    return {
      ...state,
      smoothedFrameMs,
      cooldownRemainingMs: Math.max(0, state.cooldownRemainingMs - duration),
      slowEvidenceMs: 0,
      fastEvidenceMs: 0,
    };
  }

  const slow = smoothedFrameMs > DOWN_FRAME_MS[state.quality];
  const fast = smoothedFrameMs < UP_FRAME_MS[state.quality];
  const slowEvidenceMs = slow
    ? state.slowEvidenceMs + duration
    : Math.max(0, state.slowEvidenceMs - duration * 2);
  // Fast evidence decays at 1x: per-block work spikes are inherent at every
  // tier, and a 2x wipe made promotion a lottery against the block cadence.
  // The demotion side keeps its aggressive decay — protection stays fast.
  const fastEvidenceMs = fast
    ? state.fastEvidenceMs + duration
    : Math.max(0, state.fastEvidenceMs - duration);

  if (slowEvidenceMs >= DOWN_HOLD_MS[state.quality]) {
    return {
      quality: adjacentQuality(state.quality, -1),
      smoothedFrameMs,
      warmupRemainingMs: 0,
      cooldownRemainingMs: ADAPTIVE_SWITCH_COOLDOWN_MS,
      slowEvidenceMs: 0,
      fastEvidenceMs: 0,
    };
  }

  if (fastEvidenceMs >= UP_HOLD_MS[state.quality]) {
    return {
      quality: adjacentQuality(state.quality, 1),
      smoothedFrameMs,
      warmupRemainingMs: 0,
      cooldownRemainingMs: ADAPTIVE_UP_SETTLE_MS,
      slowEvidenceMs: 0,
      fastEvidenceMs: 0,
    };
  }

  return {
    ...state,
    smoothedFrameMs,
    slowEvidenceMs,
    fastEvidenceMs,
  };
}

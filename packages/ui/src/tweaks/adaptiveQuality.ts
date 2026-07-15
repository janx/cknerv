import type { QualityPreset } from './qualityPresets';

export const ADAPTIVE_SAMPLE_WINDOW_MS = 750;
export const ADAPTIVE_WARMUP_MS = 4_000;
export const ADAPTIVE_SWITCH_COOLDOWN_MS = 6_000;
export const ADAPTIVE_EMA_TIME_MS = 1_500;

const QUALITY_ORDER: readonly QualityPreset[] = ['low', 'med', 'high'];
const DOWN_FRAME_MS: Record<QualityPreset, number> = {
  high: 22,
  med: 30,
  low: Number.POSITIVE_INFINITY,
};
const UP_FRAME_MS: Record<QualityPreset, number> = {
  high: Number.NEGATIVE_INFINITY,
  med: 17.5,
  low: 20,
};
const DOWN_HOLD_MS: Record<QualityPreset, number> = {
  high: 5_000,
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
  const fastEvidenceMs = fast
    ? state.fastEvidenceMs + duration
    : Math.max(0, state.fastEvidenceMs - duration * 2);

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
      cooldownRemainingMs: ADAPTIVE_SWITCH_COOLDOWN_MS,
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

import { describe, expect, it } from 'vitest';
import {
  ADAPTIVE_SAMPLE_WINDOW_MS,
  ADAPTIVE_SWITCH_COOLDOWN_MS,
  advanceAdaptiveQuality,
  createAdaptiveQualityState,
  type AdaptiveQualityState,
} from '../../src/tweaks/adaptiveQuality';

function sample(
  state: AdaptiveQualityState,
  frameMs: number,
  count: number,
): AdaptiveQualityState {
  let next = state;
  for (let index = 0; index < count; index += 1) {
    next = advanceAdaptiveQuality(next, frameMs, ADAPTIVE_SAMPLE_WINDOW_MS);
  }
  return next;
}

describe('adaptive quality hysteresis', () => {
  it('ignores startup compilation and a short event spike', () => {
    let state = createAdaptiveQualityState('high');
    state = sample(state, 42, 6); // consumes the four-second warmup
    state = sample(state, 42, 5); // 3.75 s pressure: below the 5 s hold

    expect(state.quality).toBe('high');
    expect(state.slowEvidenceMs).toBeLessThan(5_000);
  });

  it('downgrades only one level after sustained pressure', () => {
    // High's hold is 12s of sustained evidence (burst spikes decay between
    // blocks and never reach it; continuous overload does): exactly 16
    // windows of 750ms.
    const state = sample(createAdaptiveQualityState('high', 0), 36, 16);

    expect(state.quality).toBe('med');
    expect(state.cooldownRemainingMs).toBe(ADAPTIVE_SWITCH_COOLDOWN_MS);
    expect(state.slowEvidenceMs).toBe(0);
  });

  it('requires a separate sustained window to move from med to low', () => {
    const state = sample(createAdaptiveQualityState('med', 0), 44, 8);

    expect(state.quality).toBe('low');
    expect(state.cooldownRemainingMs).toBe(ADAPTIVE_SWITCH_COOLDOWN_MS);
  });

  it('upgrades much more slowly and never skips a level', () => {
    const lowToMed = sample(createAdaptiveQualityState('low', 0), 12, 16);
    const medToHigh = sample(createAdaptiveQualityState('med', 0), 12, 20);

    expect(lowToMed.quality).toBe('med');
    expect(medToHigh.quality).toBe('high');
  });

  it('does not accumulate evidence while switch cooldown is active', () => {
    let state = sample(createAdaptiveQualityState('high', 0), 36, 16);
    state = sample(state, 12, 7);

    expect(state.quality).toBe('med');
    expect(state.fastEvidenceMs).toBe(0);
    expect(state.cooldownRemainingMs).toBeGreaterThan(0);
  });

  it('rejects invalid samples without corrupting state', () => {
    const state = createAdaptiveQualityState();
    expect(advanceAdaptiveQuality(state, Number.NaN, 750)).toBe(state);
    expect(advanceAdaptiveQuality(state, 16, 0)).toBe(state);
  });
});

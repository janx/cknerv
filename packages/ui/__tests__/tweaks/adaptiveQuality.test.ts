import { describe, expect, it } from 'vitest';
import {
  ADAPTIVE_SAMPLE_WINDOW_MS,
  ADAPTIVE_SWITCH_COOLDOWN_MS,
  ADAPTIVE_WARMUP_MS,
  QUALITY_CALIBRATION_MAX_MS,
  QUALITY_LOCK_STABLE_MS,
  advanceAdaptiveQuality,
  createAdaptiveQualityState,
  restartAdaptiveQualityState,
  type AdaptiveQualityState,
} from '../../src/tweaks/adaptiveQuality';

function sample(
  state: AdaptiveQualityState,
  frameMs: number,
  count: number,
  durationMs = ADAPTIVE_SAMPLE_WINDOW_MS,
): AdaptiveQualityState {
  let next = state;
  for (let index = 0; index < count; index += 1) {
    next = advanceAdaptiveQuality(next, frameMs, durationMs);
  }
  return next;
}

/** Sample until the tier locks, reporting the tiers it passed through. */
function calibrate(
  state: AdaptiveQualityState,
  frameMs: number,
  maxSamples = 200,
): { state: AdaptiveQualityState; tiers: string[]; samples: number } {
  let next = state;
  const tiers = [state.quality as string];
  for (let index = 1; index <= maxSamples; index += 1) {
    next = advanceAdaptiveQuality(next, frameMs, ADAPTIVE_SAMPLE_WINDOW_MS);
    if (next.quality !== tiers[tiers.length - 1]) tiers.push(next.quality);
    if (next.locked) return { state: next, tiers, samples: index };
  }
  throw new Error('calibration never locked');
}

/** A settled page: `high` carried through warmup and the stable window, so the
 * lock closed on it with a warm 16 ms EMA and no evidence in hand. */
function lockedAtHigh(): AdaptiveQualityState {
  const { state } = calibrate(createAdaptiveQualityState('high'), 16);
  return state;
}

describe('adaptive quality hysteresis', () => {
  it('ignores startup compilation and a short event spike', () => {
    let state = createAdaptiveQualityState('high');
    state = sample(state, 42, 6); // consumes the four-second warmup

    // Warmup is not calibration: no evidence, no stability, no clock.
    expect(state.slowEvidenceMs).toBe(0);
    expect(state.stableMs).toBe(0);
    expect(state.calibrationMs).toBe(0);
    expect(state.locked).toBe(false);

    state = sample(state, 42, 5); // 3.75 s pressure: below the 5 s hold

    expect(state.quality).toBe('high');
    expect(state.slowEvidenceMs).toBeLessThan(5_000);
  });

  it('downgrades only one level after sustained pressure', () => {
    const state = sample(createAdaptiveQualityState('high', 0), 36, 7);

    expect(state.quality).toBe('med');
    expect(state.cooldownRemainingMs).toBe(ADAPTIVE_SWITCH_COOLDOWN_MS);
    expect(state.slowEvidenceMs).toBe(0);
  });

  it('requires a separate sustained window to move from med to low', () => {
    const state = sample(createAdaptiveQualityState('med', 0), 44, 8);

    expect(state.quality).toBe('low');
    expect(state.cooldownRemainingMs).toBe(ADAPTIVE_SWITCH_COOLDOWN_MS);
  });

  it('never upgrades, in any phase of calibration', () => {
    // Frame times that used to buy a tier back: 12 ms is under every old
    // upshift threshold, and these runs are long enough to have cleared the
    // old 12-15 s holds twice over.
    const fromLow = sample(createAdaptiveQualityState('low', 0), 12, 40);
    const fromMed = sample(createAdaptiveQualityState('med', 0), 12, 40);
    const warmedLow = sample(createAdaptiveQualityState('low'), 12, 40);

    expect(fromLow.quality).toBe('low');
    expect(fromMed.quality).toBe('med');
    expect(warmedLow.quality).toBe('low');
  });

  it('does not accumulate evidence while switch cooldown is active', () => {
    let state = sample(createAdaptiveQualityState('high', 0), 36, 7);
    state = sample(state, 12, 7);

    expect(state.quality).toBe('med');
    expect(state.slowEvidenceMs).toBe(0);
    expect(state.cooldownRemainingMs).toBeGreaterThan(0);
  });

  it('rejects invalid samples without corrupting state', () => {
    const state = createAdaptiveQualityState();
    expect(advanceAdaptiveQuality(state, Number.NaN, 750)).toBe(state);
    expect(advanceAdaptiveQuality(state, 16, 0)).toBe(state);
  });
});

describe('the ceiling is measured once at the door', () => {
  it('locks the tier once it has held for the stable window after warmup', () => {
    const warmupSamples = Math.ceil(4_000 / ADAPTIVE_SAMPLE_WINDOW_MS);
    const stableSamples = Math.ceil(
      QUALITY_LOCK_STABLE_MS / ADAPTIVE_SAMPLE_WINDOW_MS,
    );
    const short = sample(
      createAdaptiveQualityState('high'), 16, warmupSamples + stableSamples - 1,
    );
    const locked = advanceAdaptiveQuality(short, 16, ADAPTIVE_SAMPLE_WINDOW_MS);

    expect(short.locked).toBe(false);
    expect(locked.locked).toBe(true);
    expect(locked.quality).toBe('high');
    expect(locked.stableMs).toBeGreaterThanOrEqual(QUALITY_LOCK_STABLE_MS);
    expect(locked.calibrationMs).toBeLessThan(QUALITY_CALIBRATION_MAX_MS);
  });

  it('re-arms the stability window at each downshift, so low stays reachable', () => {
    // 44 ms is slow at high and at med, so a machine that cannot carry either
    // must be able to take both steps before the cap ends calibration.
    const { state, tiers } = calibrate(createAdaptiveQualityState('high'), 44);

    expect(tiers).toEqual(['high', 'med', 'low']);
    expect(state.locked).toBe(true);
    expect(state.calibrationMs).toBeGreaterThanOrEqual(QUALITY_CALIBRATION_MAX_MS);
    // The cap ended it, not the stability window — two switches and their
    // cooldowns cost more calibration than one stable window is long.
    expect(state.stableMs).toBeLessThan(QUALITY_LOCK_STABLE_MS);
  });

  it('locks at the hard cap even when evidence never completes a hold', () => {
    // Alternating evidence never survives the 2x deadband decay, so no hold
    // completes and no switch re-arms stability: the cap is the only end.
    let state: AdaptiveQualityState = {
      ...createAdaptiveQualityState('high', 0),
      calibrationMs: QUALITY_CALIBRATION_MAX_MS - 4 * ADAPTIVE_SAMPLE_WINDOW_MS,
    };
    for (let index = 0; index < 4; index += 1) {
      state = advanceAdaptiveQuality(
        state, index % 2 === 0 ? 40 : 10, ADAPTIVE_SAMPLE_WINDOW_MS,
      );
      expect(state.quality).toBe('high');
    }

    expect(state.slowEvidenceMs).toBeLessThan(5_000);
    expect(state.stableMs).toBeLessThan(QUALITY_LOCK_STABLE_MS);
    expect(state.locked).toBe(true);
  });

  it('keeps measuring after the lock, and never finds a way back up', () => {
    const state = lockedAtHigh();

    expect(state.quality).toBe('high');
    // The machine this replaced answered every post-lock sample with the very
    // object it was handed. Evidence accrues again now.
    const slower = advanceAdaptiveQuality(
      state, 120, ADAPTIVE_SAMPLE_WINDOW_MS,
    );
    expect(slower).not.toBe(state);
    expect(slower.slowEvidenceMs).toBe(ADAPTIVE_SAMPLE_WINDOW_MS);
    // What the extra listening cannot do is climb: a locked tier is a ceiling
    // and no run of fast frames buys anything above it.
    expect(sample(state, 8, 200).quality).toBe('high');
  });
});

describe('a locked tier can still step down', () => {
  it('downshifts one step when a settled page slows for good', () => {
    // 40 ms is past DOWN_FRAME_MS.high (22) from the first window, so evidence
    // grows 750 ms a window: 5 s of hold is reached at 7, the post-lock 10 s
    // at 14.
    const locked = lockedAtHigh();
    const short = sample(locked, 40, 13);
    const stepped = sample(locked, 40, 14);

    expect(short.quality).toBe('high');
    expect(short.slowEvidenceMs).toBe(13 * ADAPTIVE_SAMPLE_WINDOW_MS);
    expect(stepped.quality).toBe('med');
    expect(stepped.locked).toBe(true);
    expect(stepped.cooldownRemainingMs).toBe(ADAPTIVE_SWITCH_COOLDOWN_MS);
    expect(stepped.slowEvidenceMs).toBe(0);
  });

  it('holds through the evidence that would have been enough in calibration', () => {
    // Five one-second windows: exactly DOWN_HOLD_MS.high of evidence, which is
    // the whole bar during calibration and half of it after the lock. The two
    // states differ in nothing else, so the stiffening is the only variable.
    const warm = {
      ...createAdaptiveQualityState('high', 0), smoothedFrameMs: 16,
    };
    const locked = { ...warm, locked: true };

    expect(sample(warm, 40, 5, 1_000).quality).toBe('med');

    const held = sample(locked, 40, 5, 1_000);
    expect(held.quality).toBe('high');
    expect(held.slowEvidenceMs).toBe(5_000);
    expect(held.locked).toBe(true);
  });

  it('lets a single post-lock spike decay instead of spending the tier', () => {
    // One 120 ms window drags the EMA over the deadband for four windows of
    // tail — 3 s of evidence, short of even the calibration hold — and the 2x
    // decay inside the band clears it two windows later.
    const spiked = advanceAdaptiveQuality(
      lockedAtHigh(), 120, ADAPTIVE_SAMPLE_WINDOW_MS,
    );
    const settled = sample(spiked, 12, 10);

    expect(settled.quality).toBe('high');
    expect(settled.slowEvidenceMs).toBe(0);
    expect(settled.locked).toBe(true);
  });

  it('walks a long hot session down a step at a time, and stops at low', () => {
    const first = sample(lockedAtHigh(), 40, 14);
    expect(first.quality).toBe('med');

    // 44 ms is slow at med too. The cooldown swallows eight windows of it
    // (evidence stays zero there), then the doubled 6 s med hold takes 16.
    const cooling = sample(first, 44, 8);
    expect(cooling.quality).toBe('med');
    expect(cooling.slowEvidenceMs).toBe(0);
    expect(cooling.cooldownRemainingMs).toBe(0);

    expect(sample(first, 44, 23).quality).toBe('med');
    const second = sample(first, 44, 24);
    expect(second.quality).toBe('low');
    expect(second.locked).toBe(true);

    // Low is the floor: no frame time is slow enough to go under it.
    expect(sample(second, 250, 200).quality).toBe('low');
  });

  it('never clears the lock, whatever the samples say', () => {
    const order = ['low', 'med', 'high'];
    const frameTimes = [16, 120, 12, 44, 250, 8, 33, 60];
    let state = lockedAtHigh();
    let ceiling = order.indexOf(state.quality);

    for (let index = 0; index < 240; index += 1) {
      state = advanceAdaptiveQuality(
        state, frameTimes[index % frameTimes.length], ADAPTIVE_SAMPLE_WINDOW_MS,
      );
      const tier = order.indexOf(state.quality);
      expect(state.locked).toBe(true);
      expect(tier).toBeLessThanOrEqual(ceiling);
      ceiling = tier;
    }

    // A rejected sample hands the state back untouched, lock included.
    expect(advanceAdaptiveQuality(state, Number.NaN, 750).locked).toBe(true);
    expect(advanceAdaptiveQuality(state, 16, 0).locked).toBe(true);
  });

  it('rides a restart out: fresh warmup, same ceiling', () => {
    const restarted = restartAdaptiveQualityState(lockedAtHigh(), 'high');

    expect(restarted).toMatchObject({
      quality: 'high',
      locked: true,
      warmupRemainingMs: ADAPTIVE_WARMUP_MS,
      slowEvidenceMs: 0,
      stableMs: 0,
      calibrationMs: 0,
    });

    // Six windows of warmup, then the post-lock hold: an unlocked restart
    // would have spent the tier at window 13 instead of 20.
    expect(sample(restarted, 40, 13).quality).toBe('high');
    expect(sample(restarted, 40, 20).quality).toBe('med');
  });
});

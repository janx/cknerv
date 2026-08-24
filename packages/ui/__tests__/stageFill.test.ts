import { describe, expect, it } from 'vitest';
import {
  createStageFillWatch,
  sampleStageFill,
  STAGE_FILL_FULL_RATIO,
  STAGE_FILL_QUIET_MS,
  type StageFillSample,
} from '../src/boot/stageFill';

const BUDGET = 12_000;

function sample(over: Partial<StageFillSample>): StageFillSample {
  return {
    nowMs: 0,
    bootComplete: true,
    stagedLive: 9_298,
    budget: BUDGET,
    ...over,
  };
}

describe('stageFill', () => {
  it('stays idle until the boot record completes', () => {
    const idle = createStageFillWatch();
    const next = sampleStageFill(idle, sample({ bootComplete: false }));
    expect(next).toBe(idle);
    expect(next.visible).toBe(false);
  });

  it('stays idle (armed) while no model exists yet', () => {
    const idle = createStageFillWatch();
    expect(sampleStageFill(idle, sample({ stagedLive: null }))).toBe(idle);
  });

  it('resolves immediately on an already-composed stage — the refresh case', () => {
    const next = sampleStageFill(
      createStageFillWatch(),
      sample({ stagedLive: 12_000 }),
    );
    expect(next.phase).toBe('resolved');
    expect(next.visible).toBe(false);
  });

  it('treats effectively-full as full — per-block churn is not composing', () => {
    const nearlyFull = Math.ceil(BUDGET * STAGE_FILL_FULL_RATIO);
    const next = sampleStageFill(
      createStageFillWatch(),
      sample({ stagedLive: nearlyFull }),
    );
    expect(next.phase).toBe('resolved');
  });

  it('resolves without a display plane — no budget to fill', () => {
    expect(
      sampleStageFill(createStageFillWatch(), sample({ budget: null })).phase,
    ).toBe('resolved');
    expect(
      sampleStageFill(createStageFillWatch(), sample({ budget: 0 })).phase,
    ).toBe('resolved');
  });

  it('watches a partial stage and resolves when the restore flood lands', () => {
    let watch = sampleStageFill(createStageFillWatch(), sample({ nowMs: 5_000 }));
    expect(watch.phase).toBe('watching');
    expect(watch.visible).toBe(true);
    // the flood arrives in bursts
    watch = sampleStageFill(watch, sample({ nowMs: 8_000, stagedLive: 10_500 }));
    expect(watch.phase).toBe('watching');
    expect(watch.lastGrowthAtMs).toBe(8_000);
    watch = sampleStageFill(watch, sample({ nowMs: 9_000, stagedLive: 12_000 }));
    expect(watch.phase).toBe('resolved');
    expect(watch.visible).toBe(false);
  });

  it('a per-block dip never re-arms the quiet timer', () => {
    let watch = sampleStageFill(createStageFillWatch(), sample({ nowMs: 0 }));
    watch = sampleStageFill(watch, sample({ nowMs: 1_000, stagedLive: 10_000 }));
    const armed = watch.lastGrowthAtMs;
    watch = sampleStageFill(watch, sample({ nowMs: 2_000, stagedLive: 9_990 }));
    expect(watch.lastGrowthAtMs).toBe(armed);
    expect(watch.peakStaged).toBe(10_000);
  });

  it('resolves after the quiet window on a chain that cannot fill the budget', () => {
    let watch = sampleStageFill(createStageFillWatch(), sample({ nowMs: 0, stagedLive: 800 }));
    expect(watch.phase).toBe('watching');
    watch = sampleStageFill(
      watch,
      sample({ nowMs: STAGE_FILL_QUIET_MS - 1, stagedLive: 800 }),
    );
    expect(watch.phase).toBe('watching');
    watch = sampleStageFill(
      watch,
      sample({ nowMs: STAGE_FILL_QUIET_MS, stagedLive: 800 }),
    );
    expect(watch.phase).toBe('resolved');
  });

  it('growth keeps the watch alive through a slow convergence', () => {
    let watch = sampleStageFill(createStageFillWatch(), sample({ nowMs: 0, stagedLive: 3_000 }));
    for (let round = 1; round <= 5; round += 1) {
      watch = sampleStageFill(watch, sample({
        nowMs: round * (STAGE_FILL_QUIET_MS - 5_000),
        stagedLive: 3_000 + round * 500,
      }));
      expect(watch.phase).toBe('watching');
    }
  });

  it('is terminal: nothing resurrects a resolved watch', () => {
    let watch = sampleStageFill(createStageFillWatch(), sample({ stagedLive: 12_000 }));
    expect(watch.phase).toBe('resolved');
    const resolved = watch;
    watch = sampleStageFill(watch, sample({ nowMs: 99_000, stagedLive: 100 }));
    expect(watch).toBe(resolved);
  });

  it('returns the same reference on a no-change sample', () => {
    const watching = sampleStageFill(createStageFillWatch(), sample({ nowMs: 0 }));
    const again = sampleStageFill(watching, sample({ nowMs: 1_000 }));
    expect(again).toBe(watching);
  });

  it('ignores a non-finite clock and non-finite counts', () => {
    const idle = createStageFillWatch();
    expect(sampleStageFill(idle, sample({ nowMs: Number.NaN }))).toBe(idle);
    expect(sampleStageFill(idle, sample({ stagedLive: Number.NaN }))).toBe(idle);
    const watching = sampleStageFill(idle, sample({ nowMs: 0 }));
    // a NaN budget mid-watch reads as "no plane" — resolve, never NaN math
    expect(
      sampleStageFill(watching, sample({ nowMs: 1, budget: Number.NaN })).phase,
    ).toBe('resolved');
  });
});

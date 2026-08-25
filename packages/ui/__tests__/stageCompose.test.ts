import { describe, expect, it } from 'vitest';
import {
  createStageComposeWatch,
  sampleStageCompose,
  STAGE_COMPOSE_SETTLE_MS,
  STAGE_FILL_FULL_RATIO,
  STAGE_FILL_QUIET_MS,
  type StageComposeSample,
} from '../src/boot/stageCompose';

const BUDGET = 12_000;

function sample(over: Partial<StageComposeSample>): StageComposeSample {
  return {
    nowMs: 0,
    stagedLive: 9_298,
    budget: BUDGET,
    curatedLive: 0,
    composed: false,
    composedAtMs: 1,
    ...over,
  };
}

/** Feed a sequence and hand back the watch it ends on. */
function run(
  overs: Array<Partial<StageComposeSample>>,
  from = createStageComposeWatch(),
) {
  return overs.reduce(
    (watch, over) => sampleStageCompose(watch, sample(over)),
    from,
  );
}

describe('stageCompose — arming', () => {
  it('stays idle (armed) while no model exists yet', () => {
    const idle = createStageComposeWatch();
    expect(sampleStageCompose(idle, sample({ stagedLive: null }))).toBe(idle);
  });

  it('arms before the boot record completes, because the window can close first', () => {
    // The two ends of the composing window are set by unrelated clocks: boot
    // finishes when the last stream goes live (which waits on the next chain
    // message), and the composition lands when the datastore restore does.
    // Measured across three restarts, boot finished AFTER the restore twice.
    // Nothing in this sample says anything about the boot record — that is the
    // point, and the band decides separately when to show the chapter.
    const next = sampleStageCompose(createStageComposeWatch(), sample({}));
    expect(next.phase).toBe('watching');
    expect(next.visible).toBe(true);
  });

  it('resolves on a stage that booted full AND composed — the refresh case', () => {
    const next = run([{ stagedLive: BUDGET, composed: true, curatedLive: 9_000 }]);
    expect(next.phase).toBe('resolved');
    expect(next.visible).toBe(false);
  });

  it('does NOT resolve on a full stage that is still the canonical prefix', () => {
    // The measured warm restart: 12,000 seats of canonical fill, and the
    // composition the server means to show still seconds away.
    const next = run([{ stagedLive: BUDGET, composed: false }]);
    expect(next.phase).toBe('watching');
  });

  it('treats effectively-full as full — per-block churn is not composing', () => {
    const nearlyFull = Math.ceil(BUDGET * STAGE_FILL_FULL_RATIO);
    expect(run([{ stagedLive: nearlyFull, composed: true }]).phase)
      .toBe('resolved');
  });

  it('resolves without a display plane — there is no stage to compose', () => {
    expect(run([{ budget: null }]).phase).toBe('resolved');
    expect(run([{ budget: 0 }]).phase).toBe('resolved');
  });
});

describe('stageCompose — what counts as movement', () => {
  it('holds while seats are still being filled', () => {
    const watch = run([
      { nowMs: 0, stagedLive: 9_298 },
      { nowMs: 1_000, stagedLive: 9_400 },
    ]);
    expect(watch.phase).toBe('watching');
    expect(watch.peakStaged).toBe(9_400);
    expect(watch.lastMovementAtMs).toBe(1_000);
  });

  it('holds when the seat count tops out but the curated share climbs', () => {
    // The measured restart, compressed: seats hit the budget at t+7.6s and stay
    // there for the whole of the work with the longest tail.
    const watch = run([
      { nowMs: 0, stagedLive: 11_488, composed: false },
      { nowMs: 7_600, stagedLive: BUDGET, composed: true, curatedLive: 9_008, composedAtMs: 2 },
      { nowMs: 30_500, stagedLive: BUDGET, composed: true, curatedLive: 10_132, composedAtMs: 2 },
    ]);
    expect(watch.phase).toBe('watching');
    expect(watch.peakCurated).toBe(10_132);
    expect(watch.lastMovementAtMs).toBe(30_500);
  });

  it('counts a fresh composition record as movement on its own', () => {
    // A second record can start its refill lower than the last one finished:
    // measured, curated went 9,907 → 8,978 when the source published again.
    // Neither high-water mark moves, and the stage is anything but settled.
    const watch = run([
      { nowMs: 0, stagedLive: 11_488, composed: false },
      { nowMs: 16_900, stagedLive: BUDGET, composed: true, curatedLive: 9_907, composedAtMs: 2 },
      { nowMs: 19_200, stagedLive: BUDGET, composed: true, curatedLive: 8_978, composedAtMs: 3 },
    ]);
    expect(watch.phase).toBe('watching');
    expect(watch.lastMovementAtMs).toBe(19_200);
    expect(watch.composedAtMs).toBe(3);
  });

  it('does not re-arm on a dip back toward a mark it already passed', () => {
    const watch = run([
      { nowMs: 0, stagedLive: 11_488, composed: false },
      { nowMs: 1_000, stagedLive: BUDGET, composed: true, curatedLive: 10_169, composedAtMs: 2 },
      { nowMs: 5_000, stagedLive: BUDGET, composed: true, curatedLive: 10_100, composedAtMs: 2 },
    ]);
    expect(watch.lastMovementAtMs).toBe(1_000);
    expect(watch.peakCurated).toBe(10_169);
  });
});

describe('stageCompose — endings', () => {
  it('ends a settled composition on the short clock', () => {
    const armed = run([
      { nowMs: 0, stagedLive: 11_488, composed: false },
      { nowMs: 1_000, stagedLive: BUDGET, composed: true, curatedLive: 10_169, composedAtMs: 2 },
    ]);
    const stillWaiting = sampleStageCompose(armed, sample({
      nowMs: 1_000 + STAGE_COMPOSE_SETTLE_MS - 1,
      stagedLive: BUDGET,
      composed: true,
      curatedLive: 10_169,
      composedAtMs: 2,
    }));
    expect(stillWaiting.phase).toBe('watching');

    const done = sampleStageCompose(stillWaiting, sample({
      nowMs: 1_000 + STAGE_COMPOSE_SETTLE_MS,
      stagedLive: BUDGET,
      composed: true,
      curatedLive: 10_169,
      composedAtMs: 2,
    }));
    expect(done.phase).toBe('resolved');
    expect(done.visible).toBe(false);
  });

  it('gives a stage that never fills the long clock — silence is not evidence', () => {
    // A sparse devnet cannot fill the budget, and a deployment with no curated
    // source will never compose. Both end, and neither ends quickly: block
    // cadence is Poisson and a quiet minute mid-fill is ordinary.
    const armed = run([{ nowMs: 0, stagedLive: 4_000 }]);
    const mid = sampleStageCompose(armed, sample({
      nowMs: STAGE_COMPOSE_SETTLE_MS + 1,
      stagedLive: 4_000,
    }));
    expect(mid.phase).toBe('watching');
    const late = sampleStageCompose(mid, sample({
      nowMs: STAGE_FILL_QUIET_MS,
      stagedLive: 4_000,
    }));
    expect(late.phase).toBe('resolved');
  });

  it('gives a full-but-uncomposed stage the long clock too', () => {
    const armed = run([{ nowMs: 0, stagedLive: BUDGET, composed: false }]);
    expect(sampleStageCompose(armed, sample({
      nowMs: STAGE_COMPOSE_SETTLE_MS + 1,
      stagedLive: BUDGET,
      composed: false,
    })).phase).toBe('watching');
    expect(sampleStageCompose(armed, sample({
      nowMs: STAGE_FILL_QUIET_MS,
      stagedLive: BUDGET,
      composed: false,
    })).phase).toBe('resolved');
  });

  it('is terminal: nothing brings the chapter back', () => {
    const resolved = run([{ stagedLive: BUDGET, composed: true, curatedLive: 9_000 }]);
    expect(resolved.phase).toBe('resolved');
    const after = sampleStageCompose(resolved, sample({
      nowMs: 90_000,
      stagedLive: 3_000,
      composed: false,
      composedAtMs: 9,
    }));
    expect(after).toBe(resolved);
  });

  it('holds a watch with no model rather than ending it', () => {
    const armed = run([{ nowMs: 0, stagedLive: 9_298 }]);
    const next = sampleStageCompose(armed, sample({
      nowMs: STAGE_FILL_QUIET_MS,
      stagedLive: null,
    }));
    expect(next).toBe(armed);
  });

  it('returns the same reference when nothing changed', () => {
    const armed = run([{ nowMs: 0, stagedLive: 9_298 }]);
    expect(sampleStageCompose(armed, sample({ nowMs: 1_000, stagedLive: 9_298 })))
      .toBe(armed);
  });

  it('ignores an unusable clock', () => {
    const armed = run([{ nowMs: 0, stagedLive: 9_298 }]);
    expect(sampleStageCompose(armed, sample({ nowMs: Number.NaN })))
      .toBe(armed);
  });
});

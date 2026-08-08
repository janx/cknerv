import { describe, expect, it } from 'vitest';
import {
  FABRIC_COHORT_INTERVAL_S,
  FABRIC_COHORT_SIZE,
  FABRIC_STAGGER_THRESHOLD,
  planFabricCohorts,
  type FabricCohortPlan,
} from '../../src/nerve/fabricCohorts';

const OPTS = {
  staggerThreshold: FABRIC_STAGGER_THRESHOLD,
  cohortSize: FABRIC_COHORT_SIZE,
  cohortIntervalS: FABRIC_COHORT_INTERVAL_S,
};

/** Slices must tile the deferred remainders exactly: contiguous from 0,
 *  no overlap, no hole, and per-side batches never exceed cohortSize. */
function expectTiling(
  plan: FabricCohortPlan,
  addCount: number,
  killCount: number,
  cohortSize: number,
): void {
  const deferredAdds = addCount - plan.immediateAdds;
  const deferredKills = killCount - plan.immediateKills;
  let addCursor = 0;
  let killCursor = 0;
  for (const slice of plan.cohorts) {
    expect(slice.addStart).toBe(addCursor);
    expect(slice.addEnd).toBeGreaterThanOrEqual(slice.addStart);
    expect(slice.addEnd - slice.addStart).toBeLessThanOrEqual(cohortSize);
    addCursor = slice.addEnd;
    expect(slice.killStart).toBe(killCursor);
    expect(slice.killEnd).toBeGreaterThanOrEqual(slice.killStart);
    expect(slice.killEnd - slice.killStart).toBeLessThanOrEqual(cohortSize);
    killCursor = slice.killEnd;
  }
  expect(addCursor).toBe(deferredAdds);
  expect(killCursor).toBe(deferredKills);
}

describe('planFabricCohorts', () => {
  it('returns null at or below the threshold (historical path untouched)', () => {
    expect(planFabricCohorts(0, 0, 10, OPTS)).toBeNull();
    expect(planFabricCohorts(800, 700, 10, OPTS)).toBeNull(); // == threshold
    expect(planFabricCohorts(1500, 0, 10, OPTS)).toBeNull();
    expect(planFabricCohorts(0, 1500, 10, OPTS)).toBeNull();
  });

  it('triggers strictly above the threshold', () => {
    expect(planFabricCohorts(801, 700, 10, OPTS)).not.toBeNull();
    expect(planFabricCohorts(1501, 0, 10, OPTS)).not.toBeNull();
  });

  it('spends exactly the threshold immediately, split proportionally', () => {
    const plan = planFabricCohorts(3000, 1500, 0, OPTS)!;
    expect(plan.immediateAdds + plan.immediateKills)
      .toBe(FABRIC_STAGGER_THRESHOLD);
    expect(plan.immediateAdds).toBe(1000); // 1500 × 3000/4500
    expect(plan.immediateKills).toBe(500);
    expectTiling(plan, 3000, 1500, FABRIC_COHORT_SIZE);
  });

  it('redistributes budget when one side is smaller than its share', () => {
    const plan = planFabricCohorts(100, 10000, 0, OPTS)!;
    expect(plan.immediateAdds + plan.immediateKills)
      .toBe(FABRIC_STAGGER_THRESHOLD);
    expect(plan.immediateAdds).toBeLessThanOrEqual(100);
    expectTiling(plan, 100, 10000, FABRIC_COHORT_SIZE);

    const inverse = planFabricCohorts(10000, 100, 0, OPTS)!;
    expect(inverse.immediateAdds + inverse.immediateKills)
      .toBe(FABRIC_STAGGER_THRESHOLD);
    expect(inverse.immediateKills).toBeLessThanOrEqual(100);
    expectTiling(inverse, 10000, 100, FABRIC_COHORT_SIZE);
  });

  it('schedules cohorts on the interval cadence starting one interval out', () => {
    const now = 42;
    const plan = planFabricCohorts(4000, 0, now, OPTS)!;
    expect(plan.cohorts.length).toBeGreaterThan(0);
    plan.cohorts.forEach((slice, i) => {
      expect(slice.startAt).toBeCloseTo(
        now + (i + 1) * FABRIC_COHORT_INTERVAL_S,
        10,
      );
    });
  });

  it('pairs both sides on one cadence; the shorter side exhausts early', () => {
    const plan = planFabricCohorts(
      2000,
      5000,
      0,
      { staggerThreshold: 1000, cohortSize: 500, cohortIntervalS: 0.25 },
    )!;
    // deferred: adds ~1714+, kills the rest — kills need more batches.
    const addBatches = plan.cohorts.filter((s) => s.addEnd > s.addStart);
    const killBatches = plan.cohorts.filter((s) => s.killEnd > s.killStart);
    expect(killBatches.length).toBe(plan.cohorts.length);
    expect(addBatches.length).toBeLessThan(plan.cohorts.length);
    // Once adds run out, later slices are kill-only with empty add ranges.
    for (const slice of plan.cohorts.slice(addBatches.length)) {
      expect(slice.addEnd).toBe(slice.addStart);
    }
    expectTiling(plan, 2000, 5000, 500);
  });

  it('covers the whole-replacement scale the design targets', () => {
    // ~16k adds + ~16k gc-fades: immediate 750/750, remainder in ≤750
    // slices — a bounded animating set instead of 32k keys at t0.
    const plan = planFabricCohorts(16000, 16000, 0, OPTS)!;
    expect(plan.immediateAdds).toBe(750);
    expect(plan.immediateKills).toBe(750);
    const expectedBatches = Math.ceil((16000 - 750) / FABRIC_COHORT_SIZE);
    expect(plan.cohorts).toHaveLength(expectedBatches);
    expectTiling(plan, 16000, 16000, FABRIC_COHORT_SIZE);
  });

  it('sanitizes degenerate knob values instead of misplanning', () => {
    const plan = planFabricCohorts(10, 0, 0, {
      staggerThreshold: 4,
      cohortSize: 0,          // → clamped to 1 edge per cohort
      cohortIntervalS: -1,    // → falls back to the shipped interval
    })!;
    expect(plan.immediateAdds).toBe(4);
    expect(plan.cohorts).toHaveLength(6);
    expectTiling(plan, 10, 0, 1);
    expect(plan.cohorts[0].startAt).toBeCloseTo(FABRIC_COHORT_INTERVAL_S, 10);
    expect(planFabricCohorts(10, 0, 0, {
      staggerThreshold: Number.NaN,
      cohortSize: FABRIC_COHORT_SIZE,
      cohortIntervalS: FABRIC_COHORT_INTERVAL_S,
    })).toBeNull(); // NaN threshold → shipped default 1500 → 10 ≤ 1500
  });
});

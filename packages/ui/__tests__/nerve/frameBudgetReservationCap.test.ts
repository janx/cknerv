// A promise about a later frame may not own more than half of this one.
//
// `announceFrameBudgetWork` is the cross-frame reservation: work that is known
// to be pending and will ask again on the frames after this one. The panel
// solver announces its first-paint allowance there, and while a full solve was
// pending — up to ~234 frames for four instruments — that 8 ms sat in front of
// every lower-ranked consumer on every one of those frames. Measured by lane
// L2 on the ledger itself: a block landing's drain went from frame 2 to frame
// 12, the bridge from 6 to 21, and seven frames in two hundred went over the
// heavy budget because the starvation escape had to fire to get anything done.
//
// So a pending reservation is capped at half the budget. A consumer whose own
// estimate fits in the other half is then admitted on the frame it asks, and
// the escape is back to being insurance rather than the mechanism.
import { beforeEach, describe, expect, it } from 'vitest';

import {
  FRAME_BUDGET_BRIDGE_STEP,
  FRAME_BUDGET_FABRIC_DRAIN,
  FRAME_BUDGET_PANEL_SOLVE,
  FRAME_BUDGET_PLAN_SLICE,
  FRAME_HEAVY_BUDGET_MS,
  MAX_PENDING_RESERVATION_MS,
  announceFrameBudgetWork,
  beginFrameBudget,
  clearFrameBudgetWork,
  frameBudgetRemainingMs,
  mayStartFrameWork,
  reserveFrameBudget,
  resetFrameBudget,
  snapshotFrameBudget,
  spendFrameBudget,
} from '../../src/nerve/frameBudget';

/** The measured grains of the consumers this ledger serves, from the wave's
 *  own gates: the plan's self-tracked slice, a fabric drain step, a bridge
 *  slice, and the panel cursor's interaction slice. */
const PLAN_MS = 2;
const DRAIN_STEP_MS = 4;
const DRAIN_WORK_MS = 20;
const BRIDGE_STEP_MS = 2;
const PANEL_SLICE_MS = 1.6;

interface Simulation {
  /** The first frame the drain was allowed to start. */
  drainStartedAt: number;
  /** The frame the drain's work was finished on. */
  drainLandedAt: number;
  bridgeLandedAt: number;
  framesOverBudget: number;
  worstFrameMs: number;
  forcedByStarvation: number;
  forcedByReservation: number;
}

/**
 * Two hundred frames with a full panel solve pending throughout.
 *
 * The asking order is the one the module documents: the fabric drain rides the
 * owner's raw priority −1 frame and asks first, the bridge step asks from a
 * child component, the panel cursor asks from the inspection overlay, and the
 * live plan — the one consumer with a departure clock — asks last against a
 * reservation the owner made for it before any of them ran.
 */
function simulate(announceMs: number): Simulation {
  resetFrameBudget();
  let drainLeft = DRAIN_WORK_MS;
  let bridgeLeft = DRAIN_WORK_MS;
  const out: Simulation = {
    drainStartedAt: 0,
    drainLandedAt: 0,
    bridgeLandedAt: 0,
    framesOverBudget: 0,
    worstFrameMs: 0,
    forcedByStarvation: 0,
    forcedByReservation: 0,
  };
  for (let frame = 1; frame <= 200; frame += 1) {
    beginFrameBudget(frame);
    reserveFrameBudget(FRAME_BUDGET_PLAN_SLICE, PLAN_MS);
    // The panel's solve is pending on every one of these frames and says so.
    announceFrameBudgetWork(FRAME_BUDGET_PANEL_SOLVE, announceMs);
    if (drainLeft > 0 && mayStartFrameWork(FRAME_BUDGET_FABRIC_DRAIN, DRAIN_STEP_MS)) {
      if (out.drainStartedAt === 0) out.drainStartedAt = frame;
      const step = Math.min(DRAIN_STEP_MS, drainLeft);
      spendFrameBudget(FRAME_BUDGET_FABRIC_DRAIN, step);
      drainLeft -= step;
      if (drainLeft === 0) out.drainLandedAt = frame;
    }
    if (bridgeLeft > 0 && mayStartFrameWork(FRAME_BUDGET_BRIDGE_STEP, BRIDGE_STEP_MS)) {
      const step = Math.min(BRIDGE_STEP_MS, bridgeLeft);
      spendFrameBudget(FRAME_BUDGET_BRIDGE_STEP, step);
      bridgeLeft -= step;
      if (bridgeLeft === 0) out.bridgeLandedAt = frame;
    }
    if (mayStartFrameWork(FRAME_BUDGET_PANEL_SOLVE, PANEL_SLICE_MS)) {
      spendFrameBudget(FRAME_BUDGET_PANEL_SOLVE, PANEL_SLICE_MS);
    }
    if (mayStartFrameWork(FRAME_BUDGET_PLAN_SLICE, PLAN_MS)) {
      spendFrameBudget(FRAME_BUDGET_PLAN_SLICE, PLAN_MS);
    }
    const spent = snapshotFrameBudget().totalSpentMs;
    if (spent > out.worstFrameMs) out.worstFrameMs = spent;
    if (spent > FRAME_HEAVY_BUDGET_MS) out.framesOverBudget += 1;
  }
  // The window folds the frame that just ended, so one more opens it.
  beginFrameBudget(201);
  const { window } = snapshotFrameBudget();
  out.forcedByStarvation = window.forcedByStarvation;
  out.forcedByReservation = window.forcedByReservation;
  return out;
}

beforeEach(() => {
  resetFrameBudget();
  beginFrameBudget();
});

describe('a pending reservation, capped', () => {
  it('is half the heavy budget, and carries anything smaller whole', () => {
    expect(MAX_PENDING_RESERVATION_MS).toBe(FRAME_HEAVY_BUDGET_MS / 2);
    announceFrameBudgetWork(FRAME_BUDGET_PANEL_SOLVE, 8);
    beginFrameBudget(1);
    expect(snapshotFrameBudget().reservedMs[FRAME_BUDGET_PANEL_SOLVE])
      .toBe(MAX_PENDING_RESERVATION_MS);
    expect(frameBudgetRemainingMs(FRAME_BUDGET_FABRIC_DRAIN)).toBe(6);

    clearFrameBudgetWork(FRAME_BUDGET_PANEL_SOLVE);
    announceFrameBudgetWork(FRAME_BUDGET_PANEL_SOLVE, 1.6);
    beginFrameBudget(2);
    expect(snapshotFrameBudget().reservedMs[FRAME_BUDGET_PANEL_SOLVE]).toBe(1.6);
  });

  it('leaves the panel its own first-paint allowance', () => {
    // The cap is about what a reservation takes from OTHERS. What the reserving
    // consumer may then spend is `frameBudgetRemainingMs`, which never counted
    // its own reservation, so a solve held for three frames still gets its 8 ms.
    announceFrameBudgetWork(FRAME_BUDGET_PANEL_SOLVE, 8);
    beginFrameBudget(1);
    expect(frameBudgetRemainingMs(FRAME_BUDGET_PANEL_SOLVE))
      .toBe(FRAME_HEAVY_BUDGET_MS);
    expect(Math.min(8, frameBudgetRemainingMs(FRAME_BUDGET_PANEL_SOLVE))).toBe(8);
  });

  it('lets a block landing drain on the frame it asks, with a full solve pending', () => {
    const capped = simulate(8);
    expect(capped.drainStartedAt).toBe(1);
    expect(capped.drainLandedAt).toBeLessThanOrEqual(5);
    expect(capped.framesOverBudget).toBe(0);
    expect(capped.worstFrameMs).toBeLessThanOrEqual(FRAME_HEAVY_BUDGET_MS);
  });

  it('does not need the starvation escape to land a block', () => {
    // The escape exists so that nothing waits forever; it is not how a drain
    // is meant to run. With the cap the drain never needs it, and the only
    // consumer that does is the bridge — the lowest rank, whose strokes have a
    // 1.2 s growth window and which nothing waits on.
    const capped = simulate(8);
    const announcedSmall = simulate(1.6);
    expect(capped.drainStartedAt).toBe(announcedSmall.drainStartedAt);
    expect(capped.drainLandedAt).toBe(announcedSmall.drainLandedAt);
    expect(capped.forcedByStarvation).toBeLessThanOrEqual(1);
    expect(capped.forcedByReservation).toBe(0);
  });
});

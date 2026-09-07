// The one rule above the three per-frame budgets: who may start, on a frame
// that has already spent. Everything here is arithmetic on an explicit ledger
// — no clock, no component — because the whole module IS the arithmetic.
import { beforeEach, describe, expect, it } from 'vitest';

import {
  FRAME_BUDGET_BRIDGE_STEP,
  FRAME_BUDGET_FABRIC_DRAIN,
  FRAME_BUDGET_PLAN_SLICE,
  FRAME_HEAVY_BUDGET_MS,
  MAX_DEFER_FRAMES,
  beginFrameBudget,
  frameBudgetRemainingMs,
  mayStartFrameWork,
  resetFrameBudget,
  snapshotFrameBudget,
  spendFrameBudget,
} from '../../src/nerve/frameBudget';

describe('the frame budget', () => {
  beforeEach(() => {
    resetFrameBudget();
    beginFrameBudget();
  });

  it('lets the first heavy consumer of a frame start, whatever it costs', () => {
    // A frame cannot do better than one grain: refusing the first piece of
    // work would only move it to a frame that is no emptier, and both of the
    // budgets below this one already work that way (a zero budget still lands
    // one drain step, and a slice always takes one planner step).
    expect(mayStartFrameWork(FRAME_BUDGET_BRIDGE_STEP, 40)).toBe(true);
    expect(FRAME_HEAVY_BUDGET_MS).toBe(12);
  });

  it('starts a consumer whose estimate still fits under the budget', () => {
    spendFrameBudget(FRAME_BUDGET_PLAN_SLICE, 4);
    expect(mayStartFrameWork(FRAME_BUDGET_BRIDGE_STEP, 6)).toBe(true);
    spendFrameBudget(FRAME_BUDGET_BRIDGE_STEP, 6);
    // Exactly on the line is inside it.
    beginFrameBudget();
    spendFrameBudget(FRAME_BUDGET_PLAN_SLICE, 2);
    expect(mayStartFrameWork(FRAME_BUDGET_BRIDGE_STEP, 10)).toBe(true);
  });

  it('defers a consumer whose estimate would overrun a frame already spending', () => {
    // The measured case: the drain and the plan slice have had the frame after
    // a landing, and the bridge's 15 ms selection is what would turn it into
    // three vsyncs.
    spendFrameBudget(FRAME_BUDGET_PLAN_SLICE, 3);
    spendFrameBudget(FRAME_BUDGET_FABRIC_DRAIN, 5);
    expect(mayStartFrameWork(FRAME_BUDGET_BRIDGE_STEP, 15)).toBe(false);
    // And a small consumer behind a big one is not blocked by it: the ledger
    // is a running total, not a queue.
    expect(mayStartFrameWork(FRAME_BUDGET_BRIDGE_STEP, 3)).toBe(true);
  });

  it('runs a consumer regardless once it has been held three frames in a row', () => {
    expect(MAX_DEFER_FRAMES).toBe(3);
    for (let held = 1; held <= MAX_DEFER_FRAMES; held += 1) {
      beginFrameBudget();
      spendFrameBudget(FRAME_BUDGET_FABRIC_DRAIN, 11);
      expect(mayStartFrameWork(FRAME_BUDGET_BRIDGE_STEP, 15)).toBe(false);
      expect(snapshotFrameBudget().deferredFrames[FRAME_BUDGET_BRIDGE_STEP])
        .toBe(held);
    }
    // Nothing here may starve: a bridge build has a growth window behind it,
    // a plan slice a departure clock, a drain a fabric the bridge waits on.
    beginFrameBudget();
    spendFrameBudget(FRAME_BUDGET_FABRIC_DRAIN, 11);
    expect(mayStartFrameWork(FRAME_BUDGET_BRIDGE_STEP, 15)).toBe(true);
    // ...and the streak is spent by the run, not carried into the next one.
    expect(snapshotFrameBudget().deferredFrames[FRAME_BUDGET_BRIDGE_STEP])
      .toBe(0);
    beginFrameBudget();
    spendFrameBudget(FRAME_BUDGET_FABRIC_DRAIN, 11);
    expect(mayStartFrameWork(FRAME_BUDGET_BRIDGE_STEP, 15)).toBe(false);
  });

  it('counts frames IN A ROW, so a consumer that stopped asking comes back fresh', () => {
    for (let held = 0; held < 2; held += 1) {
      beginFrameBudget();
      spendFrameBudget(FRAME_BUDGET_FABRIC_DRAIN, 11);
      expect(mayStartFrameWork(FRAME_BUDGET_BRIDGE_STEP, 15)).toBe(false);
    }
    // Eight seconds of idle frames — no build armed, so nothing asked.
    for (let idle = 0; idle < 8; idle += 1) beginFrameBudget();
    beginFrameBudget();
    spendFrameBudget(FRAME_BUDGET_FABRIC_DRAIN, 11);
    // Two deferrals a block apart are two ordinary busy frames, not a consumer
    // being starved — the next block's build starts its own streak.
    expect(mayStartFrameWork(FRAME_BUDGET_BRIDGE_STEP, 15)).toBe(false);
    expect(snapshotFrameBudget().deferredFrames[FRAME_BUDGET_BRIDGE_STEP])
      .toBe(1);
  });

  it('resets what was spent on every frame serial, and nothing else', () => {
    spendFrameBudget(FRAME_BUDGET_FABRIC_DRAIN, 11);
    expect(mayStartFrameWork(FRAME_BUDGET_BRIDGE_STEP, 15)).toBe(false);
    const before = snapshotFrameBudget();
    expect(before.spentMs[FRAME_BUDGET_FABRIC_DRAIN]).toBe(11);

    beginFrameBudget();
    const after = snapshotFrameBudget();
    expect(after.serial).toBe(before.serial + 1);
    expect(after.spentMs).toEqual([0, 0, 0]);
    // The deferral streak deliberately SURVIVES the frame boundary: it is the
    // only thing that stops a consumer being held forever, and a new frame is
    // not a reason to forget one.
    expect(after.deferredFrames[FRAME_BUDGET_BRIDGE_STEP]).toBe(1);
    // The same ask that was refused a moment ago now starts.
    expect(mayStartFrameWork(FRAME_BUDGET_BRIDGE_STEP, 15)).toBe(true);
  });

  it('charges a consumer against its own precedence and everything above it', () => {
    // ⭐ The ladder. The three consumers do not ask in the order they should
    // be served — the drain rides the priority −1 frame and asks first, the
    // live-plan slice has the only hard deadline and asks last — so a plain
    // running total would let whatever asked first spend the deadline out of
    // its own frame.
    spendFrameBudget(FRAME_BUDGET_FABRIC_DRAIN, 8);
    spendFrameBudget(FRAME_BUDGET_BRIDGE_STEP, 20);
    // The bridge's 20 ms and the drain's 8 are invisible to the plan slice.
    expect(mayStartFrameWork(FRAME_BUDGET_PLAN_SLICE, 9)).toBe(true);
    spendFrameBudget(FRAME_BUDGET_PLAN_SLICE, 9);
    // The drain sees the plan's 9 and its own 8, but not the bridge's 20.
    expect(frameBudgetRemainingMs(FRAME_BUDGET_FABRIC_DRAIN)).toBe(0);
    expect(mayStartFrameWork(FRAME_BUDGET_FABRIC_DRAIN, 3)).toBe(false);
    // ...and the bridge, at the bottom, is charged for all three.
    expect(frameBudgetRemainingMs(FRAME_BUDGET_BRIDGE_STEP)).toBe(0);

    beginFrameBudget();
    spendFrameBudget(FRAME_BUDGET_PLAN_SLICE, 4);
    expect(frameBudgetRemainingMs(FRAME_BUDGET_PLAN_SLICE))
      .toBe(FRAME_HEAVY_BUDGET_MS - 4);
    expect(frameBudgetRemainingMs(FRAME_BUDGET_FABRIC_DRAIN))
      .toBe(FRAME_HEAVY_BUDGET_MS - 4);
    expect(frameBudgetRemainingMs(FRAME_BUDGET_BRIDGE_STEP))
      .toBe(FRAME_HEAVY_BUDGET_MS - 4);
  });

  it('serves the three in precedence order when they all ask on one frame', () => {
    // The frame after a landing, in the order the callbacks actually run:
    // drain (priority −1), bridge step (a child's sim frame), plan slice.
    expect(mayStartFrameWork(FRAME_BUDGET_FABRIC_DRAIN, 3)).toBe(true);
    spendFrameBudget(FRAME_BUDGET_FABRIC_DRAIN, 6);
    // The bridge's selection would take the frame to three vsyncs: held.
    expect(mayStartFrameWork(FRAME_BUDGET_BRIDGE_STEP, 15)).toBe(false);
    // The deadline consumer is served anyway — that is what the ladder buys.
    expect(mayStartFrameWork(FRAME_BUDGET_PLAN_SLICE, 9)).toBe(true);
  });

  it('ignores a reported cost that is not a positive number', () => {
    spendFrameBudget(FRAME_BUDGET_PLAN_SLICE, Number.NaN);
    spendFrameBudget(FRAME_BUDGET_PLAN_SLICE, -5);
    spendFrameBudget(FRAME_BUDGET_PLAN_SLICE, Number.POSITIVE_INFINITY);
    expect(snapshotFrameBudget().spentMs).toEqual([0, 0, 0]);
    // A consumer with no measurement behind it (an estimate of NaN, a first
    // ask on a scene that never ran) is treated as costing nothing, never as
    // costing everything.
    spendFrameBudget(FRAME_BUDGET_PLAN_SLICE, 11);
    expect(mayStartFrameWork(FRAME_BUDGET_BRIDGE_STEP, Number.NaN)).toBe(true);
  });

  it('zeroes every streak and every spend on reset', () => {
    spendFrameBudget(FRAME_BUDGET_FABRIC_DRAIN, 11);
    mayStartFrameWork(FRAME_BUDGET_BRIDGE_STEP, 15);
    resetFrameBudget();
    expect(snapshotFrameBudget()).toEqual({
      serial: 0,
      spentMs: [0, 0, 0],
      deferredFrames: [0, 0, 0],
    });
  });
});

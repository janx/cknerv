// The one rule above the per-frame budgets: who may start, on a frame
// that has already spent. Everything here is arithmetic on an explicit ledger
// — no clock, no component — because the whole module IS the arithmetic.
import { beforeEach, describe, expect, it } from 'vitest';

import {
  FRAME_BUDGET_PANEL_SOLVE,
  FRAME_BUDGET_BRIDGE_STEP,
  FRAME_BUDGET_FABRIC_DRAIN,
  FRAME_BUDGET_PLAN_SLICE,
  FRAME_HEAVY_BUDGET_MS,
  MAX_DEFER_FRAMES,
  beginFrameBudget,
  announceFrameBudgetWork,
  clearFrameBudgetWork,
  frameBudgetRemainingMs,
  mayStartFrameWork,
  releaseFrameBudget,
  reserveFrameBudget,
  resetFrameBudget,
  resetFrameBudgetStats,
  snapshotFrameBudget,
  spendFrameBudget,
  onFrameBudgetOpened,
} from '../../src/nerve/frameBudget';

describe('the frame budget', () => {
  beforeEach(() => {
    resetFrameBudget();
    beginFrameBudget();
  });

  it('defers a first grain whose estimate already exceeds the shared budget', () => {
    expect(mayStartFrameWork(FRAME_BUDGET_BRIDGE_STEP, 40)).toBe(false);
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
    expect(after.spentMs).toEqual([0, 0, 0, 0]);
    // The deferral streak deliberately SURVIVES the frame boundary: it is the
    // only thing that stops a consumer being held forever, and a new frame is
    // not a reason to forget one.
    expect(after.deferredFrames[FRAME_BUDGET_BRIDGE_STEP]).toBe(1);
    // A fresh frame clears spend, but an estimate larger than the entire
    // budget still waits for the bounded starvation escape.
    expect(mayStartFrameWork(FRAME_BUDGET_BRIDGE_STEP, 15)).toBe(false);
    expect(snapshotFrameBudget().deferredFrames[FRAME_BUDGET_BRIDGE_STEP]).toBe(2);
  });

  it('charges every consumer against the shared frame total', () => {
    spendFrameBudget(FRAME_BUDGET_FABRIC_DRAIN, 8);
    spendFrameBudget(FRAME_BUDGET_BRIDGE_STEP, 20);
    expect(mayStartFrameWork(FRAME_BUDGET_PLAN_SLICE, 9)).toBe(false);
    expect(frameBudgetRemainingMs(FRAME_BUDGET_FABRIC_DRAIN)).toBe(0);
    expect(mayStartFrameWork(FRAME_BUDGET_FABRIC_DRAIN, 3)).toBe(false);
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

  it('reserves a later plan slice before earlier callbacks spend the frame', () => {
    reserveFrameBudget(FRAME_BUDGET_PLAN_SLICE, 4);
    expect(frameBudgetRemainingMs(FRAME_BUDGET_FABRIC_DRAIN)).toBe(8);
    spendFrameBudget(FRAME_BUDGET_FABRIC_DRAIN, 8);
    expect(mayStartFrameWork(FRAME_BUDGET_BRIDGE_STEP, 3)).toBe(false);
    expect(mayStartFrameWork(FRAME_BUDGET_PLAN_SLICE, 4)).toBe(true);
    spendFrameBudget(FRAME_BUDGET_PLAN_SLICE, 4);
    const snapshot = snapshotFrameBudget();
    expect(snapshot.totalSpentMs).toBe(12);
    expect(snapshot.overspendMs).toBe(0);
    expect(snapshot.reservedMs).toEqual([0, 0, 0, 0]);
  });

  it('reserves a pending panel cursor before block consumers on the next frame', () => {
    announceFrameBudgetWork(FRAME_BUDGET_PANEL_SOLVE, 2);
    beginFrameBudget(42);
    reserveFrameBudget(FRAME_BUDGET_PLAN_SLICE, 4);
    expect(frameBudgetRemainingMs(FRAME_BUDGET_FABRIC_DRAIN)).toBe(6);
    expect(mayStartFrameWork(FRAME_BUDGET_FABRIC_DRAIN, 7)).toBe(false);
    spendFrameBudget(FRAME_BUDGET_FABRIC_DRAIN, 6);
    expect(mayStartFrameWork(FRAME_BUDGET_PANEL_SOLVE, 2)).toBe(true);
    spendFrameBudget(FRAME_BUDGET_PANEL_SOLVE, 2);
    expect(mayStartFrameWork(FRAME_BUDGET_PLAN_SLICE, 4)).toBe(true);
    spendFrameBudget(FRAME_BUDGET_PLAN_SLICE, 4);
    expect(snapshotFrameBudget().totalSpentMs).toBe(12);
    clearFrameBudgetWork(FRAME_BUDGET_PANEL_SOLVE);
    beginFrameBudget(43);
    expect(snapshotFrameBudget().reservedMs[FRAME_BUDGET_PANEL_SOLVE]).toBe(0);
  });

  it('lets a standalone Lab and the scene owner open the same frame once', () => {
    beginFrameBudget(77);
    const serial = snapshotFrameBudget().serial;
    spendFrameBudget(FRAME_BUDGET_PANEL_SOLVE, 2);
    beginFrameBudget(77);
    expect(snapshotFrameBudget().serial).toBe(serial);
    expect(snapshotFrameBudget().spentMs[FRAME_BUDGET_PANEL_SOLVE]).toBe(2);
  });

  it('keeps a reserved deadline slice after an earlier estimate undershoots', () => {
    reserveFrameBudget(FRAME_BUDGET_PLAN_SLICE, 4);
    expect(mayStartFrameWork(FRAME_BUDGET_FABRIC_DRAIN, 6)).toBe(true);
    spendFrameBudget(FRAME_BUDGET_FABRIC_DRAIN, 10);
    expect(mayStartFrameWork(FRAME_BUDGET_PLAN_SLICE, 4)).toBe(true);
    spendFrameBudget(FRAME_BUDGET_PLAN_SLICE, 4);
    const snapshot = snapshotFrameBudget();
    expect(snapshot.totalSpentMs).toBe(14);
    expect(snapshot.overspendMs).toBe(2);
    expect(snapshot.forcedByReservation).toBe(1);
    expect(snapshot.forcedByStarvation).toBe(0);
    expect(snapshot.estimateOvershootMs).toBe(4);
  });

  it('releases and resets reservations that no longer have pending work', () => {
    reserveFrameBudget(FRAME_BUDGET_PLAN_SLICE, 4);
    expect(frameBudgetRemainingMs(FRAME_BUDGET_BRIDGE_STEP)).toBe(8);
    releaseFrameBudget(FRAME_BUDGET_PLAN_SLICE);
    expect(frameBudgetRemainingMs(FRAME_BUDGET_BRIDGE_STEP)).toBe(12);
    reserveFrameBudget(FRAME_BUDGET_PLAN_SLICE, 4);
    beginFrameBudget();
    expect(snapshotFrameBudget().reservedMs).toEqual([0, 0, 0, 0]);
  });

  it('ignores a reported cost that is not a positive number', () => {
    spendFrameBudget(FRAME_BUDGET_PLAN_SLICE, Number.NaN);
    spendFrameBudget(FRAME_BUDGET_PLAN_SLICE, -5);
    spendFrameBudget(FRAME_BUDGET_PLAN_SLICE, Number.POSITIVE_INFINITY);
    expect(snapshotFrameBudget().spentMs).toEqual([0, 0, 0, 0]);
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
      spentMs: [0, 0, 0, 0],
      deferredFrames: [0, 0, 0, 0],
      reservedMs: [0, 0, 0, 0],
      totalSpentMs: 0,
      overspendMs: 0,
      forcedByReservation: 0,
      forcedByStarvation: 0,
      estimateOvershootMs: 0,
      window: {
        frames: 0,
        forcedByReservation: 0,
        forcedByStarvation: 0,
        estimateOvershootMs: 0,
        overspendMs: 0,
      },
    });
  });
});

// WHY THESE EXIST AT ALL: the four counters above are cleared by every
// `beginFrameBudget`, so the only way to catch one live was to stop the world
// inside the frame it fired in. The window totals are the same four folded
// forward, which is what a probe that resets once and reads once needs.
describe('the frame budget, over a window of frames', () => {
  beforeEach(() => {
    resetFrameBudget();
  });

  it('folds each finished frame\u2019s forced admissions forward', () => {
    // Frame 1: a reserved consumer admitted over a ledger an earlier, honest
    // estimate had already filled.
    beginFrameBudget(1);
    reserveFrameBudget(FRAME_BUDGET_PLAN_SLICE, 3);
    expect(mayStartFrameWork(FRAME_BUDGET_FABRIC_DRAIN, 8)).toBe(true);
    spendFrameBudget(FRAME_BUDGET_FABRIC_DRAIN, 11);
    expect(mayStartFrameWork(FRAME_BUDGET_PLAN_SLICE, 3)).toBe(true);
    expect(snapshotFrameBudget().forcedByReservation).toBe(1);
    // Nothing is folded until the frame it belongs to has ended.
    expect(snapshotFrameBudget().window.frames).toBe(0);
    expect(snapshotFrameBudget().window.forcedByReservation).toBe(0);
    spendFrameBudget(FRAME_BUDGET_PLAN_SLICE, 5);

    beginFrameBudget(2);
    const folded = snapshotFrameBudget().window;
    expect(folded.frames).toBe(1);
    expect(folded.forcedByReservation).toBe(1);
    // 11 + 5 against a 12 ms budget; 11 against an estimate of 8 and 5
    // against one of 3.
    expect(folded.overspendMs).toBe(4);
    expect(folded.estimateOvershootMs).toBe(5);
    // …and the per-frame counters started the new frame at zero regardless.
    expect(snapshotFrameBudget().forcedByReservation).toBe(0);

    // Frames 2-4: the bridge is held, and on frame 5 it advances regardless.
    spendFrameBudget(FRAME_BUDGET_FABRIC_DRAIN, 12);
    for (let attempt = 0; attempt < MAX_DEFER_FRAMES; attempt += 1) {
      expect(mayStartFrameWork(FRAME_BUDGET_BRIDGE_STEP, 4)).toBe(false);
      beginFrameBudget(3 + attempt);
      spendFrameBudget(FRAME_BUDGET_FABRIC_DRAIN, 12);
    }
    expect(mayStartFrameWork(FRAME_BUDGET_BRIDGE_STEP, 4)).toBe(true);
    expect(snapshotFrameBudget().forcedByStarvation).toBe(1);

    beginFrameBudget(99);
    const window = snapshotFrameBudget().window;
    expect(window.frames).toBe(5);
    expect(window.forcedByStarvation).toBe(1);
    expect(window.forcedByReservation).toBe(1);
  });

  it('zeroes the window without disturbing the frame in progress', () => {
    beginFrameBudget(1);
    reserveFrameBudget(FRAME_BUDGET_PLAN_SLICE, 3);
    spendFrameBudget(FRAME_BUDGET_FABRIC_DRAIN, 11);
    mayStartFrameWork(FRAME_BUDGET_PLAN_SLICE, 3);
    beginFrameBudget(2);
    expect(snapshotFrameBudget().window.forcedByReservation).toBe(1);

    spendFrameBudget(FRAME_BUDGET_FABRIC_DRAIN, 7);
    resetFrameBudgetStats();
    const after = snapshotFrameBudget();
    expect(after.window).toEqual({
      frames: 0,
      forcedByReservation: 0,
      forcedByStarvation: 0,
      estimateOvershootMs: 0,
      overspendMs: 0,
    });
    // The ledger the frame is being kept on is untouched by a probe's reset.
    expect(after.spentMs[FRAME_BUDGET_FABRIC_DRAIN]).toBe(7);
    expect(after.serial).toBe(2);
  });
});

describe('the frame a ledger opens on', () => {
  beforeEach(() => {
    resetFrameBudget();
  });

  it('tells a consumer that had no room that it may have some now', () => {
    let woken = 0;
    const stop = onFrameBudgetOpened(() => { woken += 1; });
    expect(woken).toBe(0);
    beginFrameBudget();
    expect(woken).toBe(1);
    beginFrameBudget();
    expect(woken).toBe(2);
    // …and the same frame, asked twice by token, is one frame.
    beginFrameBudget(7);
    beginFrameBudget(7);
    expect(woken).toBe(3);
    stop();
    beginFrameBudget();
    expect(woken).toBe(3);
  });

  it('wakes a listener that re-arms itself exactly once a frame', () => {
    // ⚠️⚠️ The whole reason the walk copies the listeners out first. The one
    // consumer this signal exists for — main-thread topology recovery —
    // re-subscribes the instant it is woken if the ledger is still closed,
    // and a Set's iterator VISITS entries added during the walk: iterating it
    // directly woke the listener, saw its new registration, woke it again,
    // for ever, inside one call. The counter below bails at fifty so a
    // regression fails fast instead of hanging the suite.
    let woken = 0;
    const armed: { stop: (() => void) | null } = { stop: null };
    const arm = () => {
      armed.stop = onFrameBudgetOpened(() => {
        woken += 1;
        armed.stop?.();
        if (woken < 50) arm();
      });
    };
    arm();
    beginFrameBudget();
    expect(woken).toBe(1);
    beginFrameBudget();
    expect(woken).toBe(2);
    armed.stop?.();
  });
});

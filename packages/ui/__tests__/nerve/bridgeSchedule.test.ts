// The rule that decides which frame the bridge's selection runs on.
//
// The whole of the deferral is here: the component's frame reads its slot,
// asks this, and either runs the old body or does nothing. So this is where
// the four properties the deferral has to keep are pinned — that a selection
// never reads a fabric that is behind its own build, that an arm runs once,
// that a newer build supersedes a pending one, and that a fabric which has
// run PAST the pending version satisfies it rather than stranding it.
import { describe, expect, it } from 'vitest';

import {
  BRIDGE_PRE_BUILD_VERSION,
  bridgeRunDecision,
  type PendingBridgeBuild,
} from '../../src/nerve/bridgeSchedule';

/** What a React commit writes into the slot. */
function arm(version: number, serial: number): PendingBridgeBuild {
  return { version, arm: serial };
}

describe('the bridge run decision', () => {
  it('does not run before the fabric of its own build has landed', () => {
    const pending = arm(7, 1);
    // The commit that published build 7 armed this; the owner is still
    // draining 7's grows across the next frames. Selecting now would pick
    // hosts by a fabric that is one to three frames behind the Cells.
    expect(bridgeRunDecision(pending, 5, 0)).toBe(false);
    expect(bridgeRunDecision(pending, 6, 0)).toBe(false);
    // The frame the drain finishes 7 is the bridge frame.
    expect(bridgeRunDecision(pending, 7, 0)).toBe(true);
  });

  it('runs an arm once, and the same slot read again is not a second build', () => {
    const pending = arm(7, 1);
    expect(bridgeRunDecision(pending, 7, 0)).toBe(true);
    // The owner consumes the arm as it fires. Whatever it does with the slot,
    // the arm itself cannot be spent twice.
    expect(bridgeRunDecision(pending, 7, 1)).toBe(false);
    expect(bridgeRunDecision(pending, 99, 1)).toBe(false);
  });

  it('lets a re-anchored build at the SAME version have its own run', () => {
    // The halo placement publishes once, part-way through boot, and the
    // anchor index it builds re-anchors the selection with no topology build
    // behind it. Keyed on the version that arm would look spent; keyed on the
    // arm it is what it is — a second thing to select for.
    expect(bridgeRunDecision(arm(7, 2), 7, 1)).toBe(true);
  });

  it('runs the newer of two arms and never the one it superseded', () => {
    // Build 8 landed while 7's fabric was still draining: the commit replaced
    // the slot, so 7 is not pending any more and cannot run at all.
    const superseded = arm(7, 1);
    const newest = arm(8, 2);
    expect(bridgeRunDecision(newest, 7, 0)).toBe(false);
    expect(bridgeRunDecision(newest, 8, 0)).toBe(true);
    // And once 8 has run, 7 is not reachable through the arm serial either.
    expect(bridgeRunDecision(superseded, 8, 2)).toBe(false);
  });

  it('takes a fabric that has run PAST the pending version, not only one that matches', () => {
    // ⭐ Why `>=` and not `===`. A build can be superseded between the arm and
    // the frame — the fabric queue drains 9 while the slot still names 8 (the
    // commit for 9 has not run yet). A fabric AHEAD of the pending build is
    // not the hazard the rule guards: the selection reads the registry and
    // the drawn fabric as they are NOW, and both are newer than the version
    // the arm carries. `===` would strand that arm until the next block.
    expect(bridgeRunDecision(arm(8, 1), 9, 0)).toBe(true);
    expect(bridgeRunDecision(arm(8, 1), 1_000, 0)).toBe(true);
  });

  it('has nothing to run when nothing is armed', () => {
    // The idle frame, which is every frame between two blocks.
    expect(bridgeRunDecision(null, 7, 0)).toBe(false);
    expect(bridgeRunDecision(null, -1, 0)).toBe(false);
  });

  it('does not hold the pre-build mount pass behind the owner sentinel', () => {
    // The owner publishes version 0 for an empty graph and `-1` for "no
    // fabric has landed" — the SAME state, two sentinels. The mount pass over
    // an empty host map has no fabric to wait for; held back, it would never
    // prime the anchor it compares against and the boot build would run one
    // selection fewer than master's.
    expect(BRIDGE_PRE_BUILD_VERSION).toBe(0);
    expect(bridgeRunDecision(arm(BRIDGE_PRE_BUILD_VERSION, 1), -1, 0)).toBe(true);
    // It is still only one run.
    expect(bridgeRunDecision(arm(BRIDGE_PRE_BUILD_VERSION, 1), -1, 1)).toBe(false);
    // And the first real build is gated again.
    expect(bridgeRunDecision(arm(1, 2), -1, 1)).toBe(false);
    expect(bridgeRunDecision(arm(1, 2), 1, 1)).toBe(true);
  });

  it('treats a scene with no fabric behind it as always caught up', () => {
    // The lab scenes mount the layer without the owner's ref; the component
    // reads `+Infinity` for them, so the first frame after a build runs it.
    expect(bridgeRunDecision(arm(42, 1), Number.POSITIVE_INFINITY, 0)).toBe(true);
  });
});

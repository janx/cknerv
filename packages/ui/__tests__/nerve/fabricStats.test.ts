import { afterEach, describe, expect, it } from 'vitest';
import {
  fabricStats,
  resetFabricStats,
  snapshotFabricStats,
} from '../../src/nerve/fabricStats';

afterEach(() => {
  resetFabricStats();
});

describe('fabricStats', () => {
  it('accumulates diffs, frame paths, and animating extents', () => {
    fabricStats.observeDiff({
      atSec: 1, kind: 'setFabric', added: 120, revived: 4, dying: 80, stable: 7800, totalStates: 8000,
    });
    fabricStats.observeDiff({
      atSec: 2, kind: 'growEdges', added: 12, revived: 1, dying: 0, stable: 0, totalStates: 8012,
    });
    fabricStats.observeDiff({
      atSec: 3, kind: 'killEdges', added: 0, revived: 0, dying: 9, stable: 0, totalStates: 8012,
    });
    fabricStats.observeSkipFrame();
    fabricStats.observeSkipFrame();
    fabricStats.observeInspectionOnlyFrame();
    fabricStats.observeIncrementalFrame(132, 132);
    fabricStats.observeIncrementalFrame(90, 90);
    fabricStats.observeReapInPlace();
    fabricStats.observeReapInPlace();
    fabricStats.observeReapInPlace();
    fabricStats.observeFullWalk('structural', 8000, 200);
    fabricStats.observeFullWalk('mass-churn-guard', 8000, 5200);

    const s = snapshotFabricStats();
    expect(s.diffCalls).toEqual({ setFabric: 1, growEdges: 1, killEdges: 1 });
    expect(s.added).toBe(132);
    expect(s.revived).toBe(5);
    expect(s.dying).toBe(89);
    expect(s.recentDiffs).toHaveLength(3);
    expect(s.recentDiffs[0].kind).toBe('setFabric');
    expect(s.frames).toEqual({ skip: 2, inspectionOnly: 1, incremental: 2, fullWalk: 2 });
    expect(s.fullWalkReasons.structural).toBe(1);
    expect(s.fullWalkReasons['mass-churn-guard']).toBe(1);
    expect(s.incrementalSlotsWritten).toBe(222);
    expect(s.reapsInPlace).toBe(3);
    expect(s.fullWalkEdgesWritten).toBe(16000);
    expect(s.animatingLast).toBe(5200);
    expect(s.animatingMax).toBe(5200);
    expect(s.usedSlotsLast).toBe(8000);
  });

  it('caps the recent-diff ring and resets cleanly', () => {
    for (let i = 0; i < 40; i += 1) {
      fabricStats.observeDiff({
        atSec: i, kind: 'growEdges', added: 1, revived: 0, dying: 0, stable: 0, totalStates: i,
      });
    }
    expect(snapshotFabricStats().recentDiffs).toHaveLength(32);
    expect(snapshotFabricStats().recentDiffs[0].atSec).toBe(8); // oldest dropped

    resetFabricStats();
    const s = snapshotFabricStats();
    expect(s.added).toBe(0);
    expect(s.recentDiffs).toHaveLength(0);
    expect(s.frames.fullWalk).toBe(0);
    expect(s.reapsInPlace).toBe(0);
    expect(s.animatingMax).toBe(0);
  });

  it('snapshot returns copies, not live references', () => {
    fabricStats.observeDiff({
      atSec: 1, kind: 'setFabric', added: 1, revived: 0, dying: 0, stable: 0, totalStates: 1,
    });
    const s = snapshotFabricStats();
    s.diffCalls.setFabric = 99;
    s.recentDiffs[0].added = 99;
    expect(snapshotFabricStats().diffCalls.setFabric).toBe(1);
    expect(snapshotFabricStats().recentDiffs[0].added).toBe(1);
  });
});

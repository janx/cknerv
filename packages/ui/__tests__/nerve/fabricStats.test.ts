import { afterEach, describe, expect, it } from 'vitest';
import {
  fabricStats,
  fabricUploadBytes,
  resetFabricStats,
  snapshotFabricStats,
} from '../../src/nerve/fabricStats';
import { FABRIC_SLOT_SEGMENTS } from '../../src/nerve/fabricSlots';

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
    expect(s.uploadedBytes).toBe(0);
    expect(s.uploadedBytesLast).toBe(0);
    expect(s.uploadedBytesMax).toBe(0);
  });

  it('accumulates upload bytes with last-commit and peak readings', () => {
    fabricStats.observeUpload(4096);
    fabricStats.observeUpload(256);
    let s = snapshotFabricStats();
    expect(s.uploadedBytes).toBe(4352);
    expect(s.uploadedBytesLast).toBe(256);
    expect(s.uploadedBytesMax).toBe(4096);

    // Empty commits upload nothing and must not disturb the readings.
    fabricStats.observeUpload(0);
    fabricStats.observeUpload(-64);
    s = snapshotFabricStats();
    expect(s.uploadedBytes).toBe(4352);
    expect(s.uploadedBytesLast).toBe(256);
    expect(s.uploadedBytesMax).toBe(4096);
  });

  it('computes upload bytes per actually-flagged buffer', () => {
    // One segment: positions 6 floats + colours 6 floats + two inspection
    // buffers × 2 floats, × 4 bytes — the fabric layer's 64 B/segment.
    expect(fabricUploadBytes(1, { positions: true, colors: true, inspection: 2 }))
      .toBe(64);
    // One full fabric slot = 4 segments × 64 B = 256 B.
    expect(fabricUploadBytes(FABRIC_SLOT_SEGMENTS, {
      positions: true, colors: true, inspection: 2,
    })).toBe(256);
    // Colours-only global repaint skips the position floats.
    expect(fabricUploadBytes(1, { positions: false, colors: true, inspection: 2 }))
      .toBe(40);
    // Inspection-only selection rewrite touches just the two 2-float buffers.
    expect(fabricUploadBytes(1, { positions: false, colors: false, inspection: 2 }))
      .toBe(16);
    // Layers without inspection attributes upload none of those bytes.
    expect(fabricUploadBytes(1, { positions: true, colors: true, inspection: 0 }))
      .toBe(48);
    expect(fabricUploadBytes(0, { positions: true, colors: true, inspection: 2 }))
      .toBe(0);
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

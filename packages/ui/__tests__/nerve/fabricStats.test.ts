import { afterEach, describe, expect, it } from 'vitest';
import {
  fabricStats,
  fabricUploadBytes,
  resetFabricStats,
  snapshotFabricStats,
} from '../../src/nerve/fabricStats';
import { FABRIC_SLOT_SEGMENTS } from '../../src/nerve/fabricSlots';
import {
  BRIDGE_SLOT_UPLOAD_BYTES,
  bridgeStats,
} from '../../src/nerve/bridgeStats';
import {
  resetGpuUploads,
  snapshotGpuUploads,
} from '../../src/tweaks/gpuUploadLedger';

afterEach(() => {
  resetFabricStats();
  resetGpuUploads();
});

describe('fabricStats', () => {
  it('carries the bridge layer counters and resets them with its own', () => {
    bridgeStats.observeBuild(true, 0);
    bridgeStats.observeBuild(false, 6);
    bridgeStats.observeAdmission(6, 6 * BRIDGE_SLOT_UPLOAD_BYTES, 1600, 0);
    bridgeStats.observeMovingFrame(6, 6 * BRIDGE_SLOT_UPLOAD_BYTES);
    bridgeStats.observeFullWalk('repaint', 1600, 358_400, 1600);
    const s = snapshotFabricStats();
    expect(s.bridge.builds).toBe(2);
    expect(s.bridge.selectionsSkipped).toBe(1);
    expect(s.bridge.selectionsRun).toBe(1);
    expect(s.bridge.strokesMoved).toBe(6);
    expect(s.bridge.admissionFrames).toBe(1);
    expect(s.bridge.fullWalks).toBe(1);
    expect(s.bridge.fullWalkReasons).toEqual({ repaint: 1, overflow: 0 });
    expect(s.bridge.strokesWritten).toBe(6 + 6 + 1600);
    expect(s.bridge.strokesWrittenLastBuild).toBe(1600);
    expect(s.bridge.uploadedBytes).toBe(12 * BRIDGE_SLOT_UPLOAD_BYTES + 358_400);
    expect(s.bridge.uploadedBytesLastBuild).toBe(358_400);
    expect(s.bridge.usedSlotsLast).toBe(1600);
    expect(s.bridge.freeSlotsLast).toBe(0);
    // One span: positions and colours at six floats, the width lane at two.
    expect(BRIDGE_SLOT_UPLOAD_BYTES).toBe(FABRIC_SLOT_SEGMENTS * 14 * 4);
    // Copies, not live references — and one reset clears both layers.
    s.bridge.fullWalkReasons.repaint = 99;
    expect(snapshotFabricStats().bridge.fullWalkReasons.repaint).toBe(1);
    resetFabricStats();
    expect(snapshotFabricStats().bridge.builds).toBe(0);
    expect(snapshotFabricStats().bridge.strokesWritten).toBe(0);
  });

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
    expect(s.frames).toEqual({ skip: 2, incremental: 2, fullWalk: 2 });
    expect(s.fullWalkReasons.structural).toBe(1);
    expect(s.fullWalkReasons['mass-churn-guard']).toBe(1);
    expect(s.incrementalSlotsWritten).toBe(222);
    expect(s.reapsInPlace).toBe(3);
    expect(s.fullWalkEdgesWritten).toBe(16000);
    expect(s.animatingLast).toBe(5200);
    expect(s.animatingMax).toBe(5200);
    expect(s.usedSlotsLast).toBe(8000);
    // Only the setFabric build sets the churn gauge: (added 120 + dying 80)
    // over its 8,000 drawn states. The later grow/kill diffs are live
    // lifecycle, not a build, so they leave it exactly where the build left it.
    expect(s.selectionChurn).toBeCloseTo(200 / 8000, 12);
  });

  it('selectionChurn tracks the last build only, ignoring grow/kill lifecycle', () => {
    fabricStats.observeDiff({
      atSec: 1, kind: 'setFabric', added: 500, revived: 0, dying: 500, stable: 7000, totalStates: 8000,
    });
    expect(snapshotFabricStats().selectionChurn).toBeCloseTo(0.125, 12);
    // A live grow and a live kill move a lot of edges but are NOT a build:
    // the gauge must not budge.
    fabricStats.observeDiff({
      atSec: 2, kind: 'growEdges', added: 900, revived: 0, dying: 0, stable: 0, totalStates: 8900,
    });
    fabricStats.observeDiff({
      atSec: 3, kind: 'killEdges', added: 0, revived: 0, dying: 900, stable: 0, totalStates: 8900,
    });
    expect(snapshotFabricStats().selectionChurn).toBeCloseTo(0.125, 12);
    // The next build replaces the reading with its own turnover.
    fabricStats.observeDiff({
      atSec: 4, kind: 'setFabric', added: 40, revived: 0, dying: 60, stable: 7900, totalStates: 8000,
    });
    expect(snapshotFabricStats().selectionChurn).toBeCloseTo(100 / 8000, 12);
  });

  it('weightedSelectionEdges is a snapshot gauge that reset zeroes', () => {
    fabricStats.weightedSelectionEdges = 21;
    expect(snapshotFabricStats().weightedSelectionEdges).toBe(21);
    resetFabricStats();
    expect(snapshotFabricStats().weightedSelectionEdges).toBe(0);
  });

  it('caps the recent-diff ring and resets cleanly', () => {
    for (let i = 0; i < 40; i += 1) {
      fabricStats.observeDiff({
        atSec: i, kind: 'growEdges', added: 1, revived: 0, dying: 0, stable: 0, totalStates: i,
      });
    }
    expect(snapshotFabricStats().recentDiffs).toHaveLength(32);
    expect(snapshotFabricStats().recentDiffs[0].atSec).toBe(8); // oldest dropped

    // Arm the build gauges so the reset has something to clear.
    fabricStats.observeDiff({
      atSec: 99, kind: 'setFabric', added: 100, revived: 0, dying: 100, stable: 7800, totalStates: 8000,
    });
    fabricStats.weightedSelectionEdges = 21;
    expect(snapshotFabricStats().selectionChurn).toBeGreaterThan(0);

    resetFabricStats();
    const s = snapshotFabricStats();
    expect(s.added).toBe(0);
    expect(s.recentDiffs).toHaveLength(0);
    expect(s.selectionChurn).toBe(0);
    expect(s.weightedSelectionEdges).toBe(0);
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

  it('feeds the scene-wide upload ledger from both layers, by lane', () => {
    resetGpuUploads();
    fabricStats.observeUpload(4096);
    fabricStats.observeUpload(0); // an empty commit reaches neither counter
    bridgeStats.observeMovingFrame(6, 6 * BRIDGE_SLOT_UPLOAD_BYTES);
    bridgeStats.observeAdmission(2, 2 * BRIDGE_SLOT_UPLOAD_BYTES, 1600, 0);
    bridgeStats.observeFullWalk('repaint', 1600, 358_400, 1600);
    const ledger = snapshotGpuUploads();
    expect(ledger.lanes.fabric).toEqual({
      bytes: 4096, commits: 1, bytesLast: 4096, bytesMax: 4096,
    });
    expect(ledger.lanes.bridge.bytes).toBe(8 * BRIDGE_SLOT_UPLOAD_BYTES + 358_400);
    expect(ledger.lanes.bridge.commits).toBe(3);
    expect(ledger.lanes.cells.bytes).toBe(0);
    // The fabric's own readings are unchanged by the ledger riding along.
    expect(snapshotFabricStats().uploadedBytes).toBe(4096);
    expect(snapshotFabricStats().bridge.uploadedBytes)
      .toBe(8 * BRIDGE_SLOT_UPLOAD_BYTES + 358_400);
  });

  it('computes upload bytes per actually-flagged buffer', () => {
    // One segment: positions 6 floats + colours 6 floats, × 4 bytes —
    // 48 B/segment.
    expect(fabricUploadBytes(1, { positions: true, colors: true }))
      .toBe(48);
    // One full fabric slot = 4 segments × 48 B = 192 B.
    expect(fabricUploadBytes(FABRIC_SLOT_SEGMENTS, {
      positions: true, colors: true,
    })).toBe(192);
    // Colours-only global repaint skips the position floats.
    expect(fabricUploadBytes(1, { positions: false, colors: true }))
      .toBe(24);
    expect(fabricUploadBytes(0, { positions: true, colors: true }))
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

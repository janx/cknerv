// Dev instrumentation: measures HOW MUCH the passive fabric churns — how big
// each graph diff is (setFabric reconciliations vs live grow/kill), how often
// emitFabric takes each path (skip / incremental slots / full walk, and WHY
// a full walk fired), and how large the animating set is.
// Pure module singleton — same idiom as `pulseStats` / `simClock`: read and
// mutated directly, reset by tests. Always-on (a handful of integer
// increments per diff/frame — negligible). The WINDOW hook that surfaces this
// lives in ui-app, so the library stays free of `window` coupling.
//
// The bridge layer's counters (`bridgeStats`) ride along in the snapshot as
// `bridge`: it is the fabric's sibling, built from the fabric's parts, and a
// live probe reading one hook should see both layers' churn side by side.

import { bridgeStats, type BridgeStatsSnapshot } from './bridgeStats';
import { observeGpuUpload } from '../tweaks/gpuUploadLedger';

export type FabricDiffKind = 'setFabric' | 'growEdges' | 'killEdges';

export interface FabricDiffSample {
  /** Sim seconds at the diff. */
  atSec: number;
  kind: FabricDiffKind;
  /** Fresh edge states created (enter the growth window). */
  added: number;
  /** Dying edges revived back to stable. */
  revived: number;
  /** Edges newly marked dying (gc fade or death retract). */
  dying: number;
  /** Existing edges left untouched (setFabric reconciliation only). */
  stable: number;
  /** edgeStates size after the call. */
  totalStates: number;
}

export type FabricFullWalkReason =
  | 'reap'
  | 'structural'
  | 'global-repaint'
  | 'mass-churn-guard';

/** Which interleaved buffers one passive-fabric commit actually flags for
 *  upload. Positions and colours are 6 floats per segment each. */
export interface FabricUploadBuffers {
  positions: boolean;
  colors: boolean;
}

/** Bytes gl.bufferSubData will move for `segments` segment entries across
 *  the buffers a commit actually uploads: 6 floats × 4 B per flagged
 *  position/colour buffer — e.g. one 4-segment slot with both = 192 B. */
export function fabricUploadBytes(
  segments: number,
  buffers: FabricUploadBuffers,
): number {
  if (segments <= 0) return 0;
  const floatsPerSegment = (buffers.positions ? 6 : 0)
    + (buffers.colors ? 6 : 0);
  return segments * floatsPerSegment * 4;
}

export interface FabricStatsSnapshot {
  diffCalls: Record<FabricDiffKind, number>;
  /** Totals across every diff. */
  added: number;
  revived: number;
  dying: number;
  /** Last N diffs, oldest first — the per-block churn shape. */
  recentDiffs: FabricDiffSample[];
  /** emitFabric frames by taken path. */
  frames: {
    skip: number;
    incremental: number;
    fullWalk: number;
  };
  fullWalkReasons: Record<FabricFullWalkReason, number>;
  /** Slots rewritten by the incremental path (Σ per-frame animating writes). */
  incrementalSlotsWritten: number;
  /** Fully-decayed edges whose slot was freed in place (no compaction walk). */
  reapsInPlace: number;
  /** Edges written by full walks (Σ per-walk slot count). */
  fullWalkEdgesWritten: number;
  /** Animating-set size: at the last emit, and the observed maximum. */
  animatingLast: number;
  animatingMax: number;
  /** Slot count of the last full walk (≈ renderOrder length). */
  usedSlotsLast: number;
  /** Diagnostic gauges for the tier pipeline: the mounted fabric layer's
   * edge-allocation class, the last applied passive selection size, and the
   * LIVE edge-state count (updated every emit frame — unlike usedSlotsLast,
   * which only full walks refresh and which goes stale on the delta path). */
  allocationEdges: number;
  passiveSelectionEdges: number;
  liveEdges: number;
  /** Width tier (中央神经): edges the last resolved threshold promotes to the
   * wide pass, and the threshold itself. Against `passiveSelectionEdges` this
   * is the promoted SHARE — the number the tier is tuned by. */
  trunkTierEdges: number;
  trunkTierThreshold: number;
  /** Passive-fabric bytes handed to bufferSubData (Σ across every commit —
   *  incremental slot ranges and full-walk prefix uploads). */
  uploadedBytes: number;
  /** Bytes of the most recent uploading fabric commit. */
  uploadedBytesLast: number;
  /** Largest single-commit upload observed. */
  uploadedBytesMax: number;
  /** The bridge layer (次级神经): builds skipped by its host registry,
   *  strokes moved per selection, writes and uploads per build frame. */
  bridge: BridgeStatsSnapshot;
}

const RECENT_DIFF_CAP = 32;

function zeroDiffCalls(): Record<FabricDiffKind, number> {
  return { setFabric: 0, growEdges: 0, killEdges: 0 };
}
function zeroFullWalkReasons(): Record<FabricFullWalkReason, number> {
  return {
    reap: 0,
    structural: 0,
    'global-repaint': 0,
    'mass-churn-guard': 0,
  };
}

interface FabricStatsState {
  diffCalls: Record<FabricDiffKind, number>;
  added: number;
  revived: number;
  dying: number;
  recentDiffs: FabricDiffSample[];
  frames: FabricStatsSnapshot['frames'];
  fullWalkReasons: Record<FabricFullWalkReason, number>;
  incrementalSlotsWritten: number;
  reapsInPlace: number;
  fullWalkEdgesWritten: number;
  animatingLast: number;
  animatingMax: number;
  usedSlotsLast: number;
  /** Diagnostic gauges for the tier pipeline: the mounted fabric layer's
   * edge-allocation class, the last applied passive selection size, and the
   * LIVE edge-state count (updated every emit frame — unlike usedSlotsLast,
   * which only full walks refresh and which goes stale on the delta path). */
  allocationEdges: number;
  passiveSelectionEdges: number;
  liveEdges: number;
  /** Width tier (中央神经): edges the last resolved threshold promotes to the
   * wide pass, and the threshold itself. Against `passiveSelectionEdges` this
   * is the promoted SHARE — the number the tier is tuned by. */
  trunkTierEdges: number;
  trunkTierThreshold: number;
  uploadedBytes: number;
  uploadedBytesLast: number;
  uploadedBytesMax: number;
  observeDiff(sample: FabricDiffSample): void;
  observeSkipFrame(): void;
  observeIncrementalFrame(slotsWritten: number, animating: number): void;
  observeReapInPlace(): void;
  observeFullWalk(
    reason: FabricFullWalkReason,
    edgesWritten: number,
    animating: number,
  ): void;
  observeUpload(bytes: number): void;
  snapshot(): FabricStatsSnapshot;
  reset(): void;
}

function noteAnimating(state: FabricStatsState, animating: number): void {
  state.animatingLast = animating;
  if (animating > state.animatingMax) state.animatingMax = animating;
}

export const fabricStats: FabricStatsState = {
  diffCalls: zeroDiffCalls(),
  added: 0,
  revived: 0,
  dying: 0,
  recentDiffs: [],
  frames: { skip: 0, incremental: 0, fullWalk: 0 },
  fullWalkReasons: zeroFullWalkReasons(),
  incrementalSlotsWritten: 0,
  reapsInPlace: 0,
  fullWalkEdgesWritten: 0,
  animatingLast: 0,
  animatingMax: 0,
  usedSlotsLast: 0,
  allocationEdges: 0,
  passiveSelectionEdges: 0,
  liveEdges: 0,
  trunkTierEdges: 0,
  trunkTierThreshold: 0,
  uploadedBytes: 0,
  uploadedBytesLast: 0,
  uploadedBytesMax: 0,

  observeDiff(sample) {
    this.diffCalls[sample.kind] += 1;
    this.added += sample.added;
    this.revived += sample.revived;
    this.dying += sample.dying;
    this.recentDiffs.push(sample);
    if (this.recentDiffs.length > RECENT_DIFF_CAP) this.recentDiffs.shift();
  },
  observeSkipFrame() {
    this.frames.skip += 1;
  },
  observeIncrementalFrame(slotsWritten, animating) {
    this.frames.incremental += 1;
    this.incrementalSlotsWritten += slotsWritten;
    noteAnimating(this, animating);
  },
  observeReapInPlace() {
    this.reapsInPlace += 1;
  },
  observeFullWalk(reason, edgesWritten, animating) {
    this.frames.fullWalk += 1;
    this.fullWalkReasons[reason] += 1;
    this.fullWalkEdgesWritten += edgesWritten;
    this.usedSlotsLast = edgesWritten;
    noteAnimating(this, animating);
  },
  observeUpload(bytes) {
    // Empty commits (no flagged buffer / zero prefix) upload nothing and
    // must not clobber the "last uploading commit" reading.
    if (bytes <= 0) return;
    this.uploadedBytes += bytes;
    this.uploadedBytesLast = bytes;
    if (bytes > this.uploadedBytesMax) this.uploadedBytesMax = bytes;
    // The scene-wide ledger GL·08 samples; the bridge feeds it from its own
    // counters, so the two lanes stay distinguishable there.
    observeGpuUpload('fabric', bytes);
  },

  snapshot() {
    return {
      diffCalls: { ...this.diffCalls },
      added: this.added,
      revived: this.revived,
      dying: this.dying,
      recentDiffs: this.recentDiffs.map((sample) => ({ ...sample })),
      frames: { ...this.frames },
      fullWalkReasons: { ...this.fullWalkReasons },
      incrementalSlotsWritten: this.incrementalSlotsWritten,
      reapsInPlace: this.reapsInPlace,
      fullWalkEdgesWritten: this.fullWalkEdgesWritten,
      animatingLast: this.animatingLast,
      animatingMax: this.animatingMax,
      usedSlotsLast: this.usedSlotsLast,
      allocationEdges: this.allocationEdges,
      passiveSelectionEdges: this.passiveSelectionEdges,
      trunkTierEdges: this.trunkTierEdges,
      trunkTierThreshold: this.trunkTierThreshold,
      liveEdges: this.liveEdges,
      uploadedBytes: this.uploadedBytes,
      uploadedBytesLast: this.uploadedBytesLast,
      uploadedBytesMax: this.uploadedBytesMax,
      bridge: bridgeStats.snapshot(),
    };
  },

  reset() {
    this.diffCalls = zeroDiffCalls();
    this.added = 0;
    this.revived = 0;
    this.dying = 0;
    this.recentDiffs = [];
    this.frames = { skip: 0, incremental: 0, fullWalk: 0 };
    this.fullWalkReasons = zeroFullWalkReasons();
    this.incrementalSlotsWritten = 0;
    this.reapsInPlace = 0;
    this.fullWalkEdgesWritten = 0;
    this.animatingLast = 0;
    this.animatingMax = 0;
    this.usedSlotsLast = 0;
    this.uploadedBytes = 0;
    this.uploadedBytesLast = 0;
    this.uploadedBytesMax = 0;
    bridgeStats.reset();
  },
};

export function snapshotFabricStats(): FabricStatsSnapshot {
  return fabricStats.snapshot();
}
export function resetFabricStats(): void {
  fabricStats.reset();
}

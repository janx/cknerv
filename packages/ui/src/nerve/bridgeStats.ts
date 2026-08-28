// Dev instrumentation for the bridge layer (次级神经): how many topology
// builds the host registry let through unchanged, how many strokes each
// selection actually moved, and what the layer wrote and uploaded for it.
//
// Same idiom as `fabricStats` / `pulseStats` — a pure module singleton, read
// and mutated directly, reset by tests, always on (a few integer increments
// per build and per moving frame). Surfaced INSIDE the fabric's snapshot
// (`__fabricStats().bridge` in ui-app) rather than through a global of its
// own: the layer borrows the fabric's parts, and it borrows its window hook.

import { FABRIC_SAMPLES_PER_EDGE } from './fabricCapacity';

/** Why a build frame rewrote every span instead of only the moved ones. */
export type BridgeFullWalkReason = 'repaint' | 'overflow';

/** Bytes gl.bufferSubData moves for `segments` of this layer: positions and
 *  colours at 6 floats each, plus the width lane no other layer carries. */
export function bridgeUploadBytes(segments: number): number {
  return segments <= 0 ? 0 : segments * (6 + 6 + 2) * 4;
}

/** Bytes one stroke's span costs to upload. */
export const BRIDGE_SLOT_UPLOAD_BYTES = bridgeUploadBytes(FABRIC_SAMPLES_PER_EDGE);

export interface BridgeStatsSnapshot {
  /** Completed topology builds the layer saw against a placed halo. */
  builds: number;
  /** Builds whose host set and anchors matched the last selection's: no
   *  selection ran, no reconcile, nothing was written or uploaded. */
  selectionsSkipped: number;
  selectionsRun: number;
  /** Strokes the selections moved — births, revivals and deaths, Σ. */
  strokesMoved: number;
  /** Frames that admitted a build's moved strokes into their own spans. */
  admissionFrames: number;
  fullWalks: number;
  fullWalkReasons: Record<BridgeFullWalkReason, number>;
  /** Strokes written into the layer, Σ over every path — the per-frame
   *  growth and retract writes included. */
  strokesWritten: number;
  /** Strokes written on the last frame that landed a build (an admission or
   *  a full walk), and the bytes that frame flagged for upload. */
  strokesWrittenLastBuild: number;
  uploadedBytesLastBuild: number;
  /** Bytes flagged for bufferSubData, Σ over every commit. */
  uploadedBytes: number;
  /** After the last build frame: the populated prefix in slots, and how many
   *  of those are parked holes waiting for the next birth. */
  usedSlotsLast: number;
  freeSlotsLast: number;
}

function zeroFullWalkReasons(): Record<BridgeFullWalkReason, number> {
  return { repaint: 0, overflow: 0 };
}

interface BridgeStatsState extends BridgeStatsSnapshot {
  observeBuild(skipped: boolean, strokesMoved: number): void;
  observeAdmission(
    strokesWritten: number,
    bytes: number,
    usedSlots: number,
    freeSlots: number,
  ): void;
  observeFullWalk(
    reason: BridgeFullWalkReason,
    strokesWritten: number,
    bytes: number,
    usedSlots: number,
  ): void;
  observeMovingFrame(strokesWritten: number, bytes: number): void;
  snapshot(): BridgeStatsSnapshot;
  reset(): void;
}

export const bridgeStats: BridgeStatsState = {
  builds: 0,
  selectionsSkipped: 0,
  selectionsRun: 0,
  strokesMoved: 0,
  admissionFrames: 0,
  fullWalks: 0,
  fullWalkReasons: zeroFullWalkReasons(),
  strokesWritten: 0,
  strokesWrittenLastBuild: 0,
  uploadedBytesLastBuild: 0,
  uploadedBytes: 0,
  usedSlotsLast: 0,
  freeSlotsLast: 0,

  observeBuild(skipped, strokesMoved) {
    this.builds += 1;
    if (skipped) this.selectionsSkipped += 1;
    else this.selectionsRun += 1;
    this.strokesMoved += strokesMoved;
  },
  observeAdmission(strokesWritten, bytes, usedSlots, freeSlots) {
    this.admissionFrames += 1;
    this.strokesWritten += strokesWritten;
    this.strokesWrittenLastBuild = strokesWritten;
    this.uploadedBytesLastBuild = bytes;
    this.uploadedBytes += bytes;
    this.usedSlotsLast = usedSlots;
    this.freeSlotsLast = freeSlots;
  },
  observeFullWalk(reason, strokesWritten, bytes, usedSlots) {
    this.fullWalks += 1;
    this.fullWalkReasons[reason] += 1;
    this.strokesWritten += strokesWritten;
    this.strokesWrittenLastBuild = strokesWritten;
    this.uploadedBytesLastBuild = bytes;
    this.uploadedBytes += bytes;
    this.usedSlotsLast = usedSlots;
    // A full walk hands every span out afresh: no holes survive it.
    this.freeSlotsLast = 0;
  },
  observeMovingFrame(strokesWritten, bytes) {
    this.strokesWritten += strokesWritten;
    this.uploadedBytes += bytes;
  },

  snapshot() {
    return {
      builds: this.builds,
      selectionsSkipped: this.selectionsSkipped,
      selectionsRun: this.selectionsRun,
      strokesMoved: this.strokesMoved,
      admissionFrames: this.admissionFrames,
      fullWalks: this.fullWalks,
      fullWalkReasons: { ...this.fullWalkReasons },
      strokesWritten: this.strokesWritten,
      strokesWrittenLastBuild: this.strokesWrittenLastBuild,
      uploadedBytesLastBuild: this.uploadedBytesLastBuild,
      uploadedBytes: this.uploadedBytes,
      usedSlotsLast: this.usedSlotsLast,
      freeSlotsLast: this.freeSlotsLast,
    };
  },

  reset() {
    this.builds = 0;
    this.selectionsSkipped = 0;
    this.selectionsRun = 0;
    this.strokesMoved = 0;
    this.admissionFrames = 0;
    this.fullWalks = 0;
    this.fullWalkReasons = zeroFullWalkReasons();
    this.strokesWritten = 0;
    this.strokesWrittenLastBuild = 0;
    this.uploadedBytesLastBuild = 0;
    this.uploadedBytes = 0;
    this.usedSlotsLast = 0;
    this.freeSlotsLast = 0;
  },
};

export function snapshotBridgeStats(): BridgeStatsSnapshot {
  return bridgeStats.snapshot();
}
export function resetBridgeStats(): void {
  bridgeStats.reset();
}

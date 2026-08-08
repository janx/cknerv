// Fixed-slot layout for the passive fabric layer.
//
// Every renderOrder edge owns a fixed run of FABRIC_SLOT_SEGMENTS segment
// slots in the fat-line buffers. Unused slot entries are parked as zero-colour
// degenerate segments far outside the frustum, so a lifecycle-animating edge
// can rewrite ONLY its own slot without shifting any other edge's segments —
// the whole-fabric per-frame rewrite while any single edge grows or dies
// becomes a per-edge dirty-range update instead.

import { FABRIC_SAMPLES_PER_EDGE } from './fabricCapacity';

/** Segments reserved per edge — exactly the passive curve sample budget. */
export const FABRIC_SLOT_SEGMENTS = FABRIC_SAMPLES_PER_EDGE;

/** Off-frustum parking height for unused slot segments. Their colours are
 *  zero as well, so even a driver that rasterized them would add nothing
 *  under the screen-accumulation blend. */
export const FABRIC_SLOT_FILLER_Y = 1e9;

/** One contiguous run of SEGMENT indices to upload. */
export interface FabricSlotRange {
  start: number;
  count: number;
}

/** Merge adjacent dirty runs whose slot gap is at most this many parked
 *  slots. Bridging a small gap uploads a few filler slots' bytes but saves
 *  one bufferSubData call — cheap. Large gaps stay separate so a scattered
 *  dirty set can never balloon into a near-whole-prefix upload (the
 *  historical unconditional collapse moved ~4 MB/frame during per-block
 *  growth windows). */
export const FABRIC_UPLOAD_GAP_MAX_SLOTS = 64;
/** Hard cap on upload ranges per commit. When fragmentation still exceeds
 *  it after gap bridging, the SMALLEST remaining inter-run gaps are bridged
 *  first until the count fits — never an unconditional collapse into one
 *  spanning range. */
export const FABRIC_UPLOAD_MAX_RANGES = 128;

/**
 * Merge dirty SLOT indices (deduped, any order) into contiguous segment
 * ranges. Runs separated by at most `gapMaxSlots` parked slots coalesce
 * (uploading the bridge is cheaper than another bufferSubData call); if the
 * result still exceeds `maxRanges`, the smallest remaining gaps are bridged
 * first until it fits. The upload therefore stays a bounded number of calls
 * with bounded overshoot — a fragmented frame never degenerates into
 * re-uploading the whole populated prefix.
 */
export function mergeFabricSlotRanges(
  slots: readonly number[],
  maxRanges = FABRIC_UPLOAD_MAX_RANGES,
  gapMaxSlots = FABRIC_UPLOAD_GAP_MAX_SLOTS,
): FabricSlotRange[] {
  if (slots.length === 0) return [];
  const cap = Math.max(1, maxRanges);
  const sorted = [...slots].sort((a, b) => a - b);
  // Pass 1: build dirty runs in SLOT units, coalescing across gaps of at
  // most gapMaxSlots parked slots (a gap of 0 is plain adjacency).
  const runStarts: number[] = [];
  const runEnds: number[] = [];
  let runStart = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i < sorted.length; i += 1) {
    const slot = sorted[i];
    if (slot === prev) continue; // dedupe
    if (slot - prev - 1 <= gapMaxSlots) {
      prev = slot;
      continue;
    }
    runStarts.push(runStart);
    runEnds.push(prev);
    runStart = slot;
    prev = slot;
  }
  runStarts.push(runStart);
  runEnds.push(prev);
  // Pass 2: enforce the range cap by bridging the smallest gaps first.
  // Merging two neighbouring runs never changes any OTHER gap's size, so
  // marking the k smallest gaps (ties leftmost-first for determinism) and
  // coalescing across the marks is exact — no iteration needed.
  const excess = runStarts.length - cap;
  let bridgeGapBeforeRun: boolean[] | null = null;
  if (excess > 0) {
    const gapOrder: number[] = [];
    for (let i = 1; i < runStarts.length; i += 1) gapOrder.push(i);
    gapOrder.sort((a, b) => (
      (runStarts[a] - runEnds[a - 1]) - (runStarts[b] - runEnds[b - 1])
    ) || a - b);
    bridgeGapBeforeRun = new Array<boolean>(runStarts.length).fill(false);
    for (let i = 0; i < excess; i += 1) bridgeGapBeforeRun[gapOrder[i]] = true;
  }
  const ranges: FabricSlotRange[] = [];
  let mergedStart = runStarts[0];
  let mergedEnd = runEnds[0];
  for (let i = 1; i < runStarts.length; i += 1) {
    if (bridgeGapBeforeRun?.[i]) {
      mergedEnd = runEnds[i];
      continue;
    }
    ranges.push({
      start: mergedStart * FABRIC_SLOT_SEGMENTS,
      count: (mergedEnd - mergedStart + 1) * FABRIC_SLOT_SEGMENTS,
    });
    mergedStart = runStarts[i];
    mergedEnd = runEnds[i];
  }
  ranges.push({
    start: mergedStart * FABRIC_SLOT_SEGMENTS,
    count: (mergedEnd - mergedStart + 1) * FABRIC_SLOT_SEGMENTS,
  });
  return ranges;
}

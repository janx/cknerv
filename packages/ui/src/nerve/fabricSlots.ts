// Fixed-slot layout for the passive fabric layer.
//
// Every renderOrder edge owns a fixed run of FABRIC_SLOT_SEGMENTS segment
// slots in the fat-line buffers. Unused slot entries are parked as zero-colour
// degenerate segments far outside the frustum, so a lifecycle-animating edge
// can rewrite ONLY its own slot without shifting any other edge's segments —
// the whole-fabric per-frame rewrite while any single edge grows or dies
// becomes a per-edge dirty-range update instead.
//
// The second half of this module is the upload cost model every slot-ranged
// commit in the scene shares: the passive fabric's lifecycle and aperture
// lanes, the bridge layer, and the Cell attribute family. Slot order is
// spatially random (boot order is id-sorted over hashed positions; reaps
// recycle holes LIFO), so a spatially clustered dirty set is uniformly
// scattered in slot space and the merge policy alone decides how many bytes
// and how many bufferSubData calls a frame costs.

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

/** One contiguous run of SLOT indices (a segment-agnostic dirty run). */
export interface SlotRunRange {
  start: number;
  count: number;
}

// ——— Upload cost model ———
//
// One gl.bufferSubData call is not free and one byte is not expensive:
// measured on the review machine (Radeon 890M, Chrome, 2026-08-28) with a
// buffer in use by the previous draw, exactly the app's situation —
//   ANGLE/GL  (the desktop Chrome path): 0.48 µs main-thread + 1.18 µs
//             GPU-process per call; 0.085 + 0.048 ns per byte;
//   ANGLE/Vulkan (RADV):                 0.90 µs + 1.88 µs per call;
//             0.28 + 0.27 ns per byte.
// So bridging a parked gap between two dirty runs — uploading bytes nobody
// changed to save one call — pays off only while the bridge is cheaper than
// the call it saves. The main-thread break-even is 5.7 KB (GL) / 3.3 KB
// (Vulkan) per call; counting the GPU process too it is 12 KB / 5 KB. The
// constant below sits at the geometric mean of the two main-thread figures,
// which errs toward fewer bytes: bytes also cost bandwidth and power that
// CPU time does not see, and on a discrete GPU they cost more than here.

/** Bytes one bufferSubData call is worth: a gap costing less than this is
 *  bridged, a larger one keeps its own call. */
export const UPLOAD_CALL_COST_BYTES = 4096;

/** Call budget for one commit of one lane family. The range cap is derived
 *  from it per policy, so a lane that marks three buffers per range gets a
 *  third of the ranges — 512 × ~1.7 µs ≈ 0.9 ms of CPU across both
 *  processes, a bound the cost model only reaches under mass churn. */
export const UPLOAD_MAX_CALLS_PER_COMMIT = 512;

/** How one upload path costs its ranges, and the merge parameters that
 *  follow from it. Build one per lane family with `slotUploadPolicy`. */
export interface SlotUploadPolicy {
  /** Bytes one slot moves across every buffer this path marks. */
  readonly bytesPerSlot: number;
  /** bufferSubData calls one range costs — one per marked buffer. */
  readonly callsPerRange: number;
  /** Largest run of parked slots worth bridging: bridging costs
   *  `gap × bytesPerSlot` and saves `callsPerRange` calls. */
  readonly gapMaxSlots: number;
  /** Range cap; past it the SMALLEST remaining gaps are bridged first. */
  readonly maxRanges: number;
}

/** Derive a lane's merge policy from what a slot costs it. */
export function slotUploadPolicy(
  bytesPerSlot: number,
  callsPerRange = 1,
  maxCalls = UPLOAD_MAX_CALLS_PER_COMMIT,
): SlotUploadPolicy {
  if (!Number.isFinite(bytesPerSlot) || bytesPerSlot <= 0) {
    throw new Error('slotUploadPolicy: bytesPerSlot must be positive');
  }
  if (!Number.isInteger(callsPerRange) || callsPerRange < 1) {
    throw new Error('slotUploadPolicy: callsPerRange must be a positive integer');
  }
  return {
    bytesPerSlot,
    callsPerRange,
    gapMaxSlots: Math.floor(
      (UPLOAD_CALL_COST_BYTES * callsPerRange) / bytesPerSlot,
    ),
    maxRanges: Math.max(1, Math.floor(maxCalls / callsPerRange)),
  };
}

/**
 * Bridge the parked gaps between dirty SLOT runs under a lane's policy.
 *
 * Precondition: `runs` are ascending by `start` and pairwise disjoint — every
 * producer in the scene (a sorted slot list, `coalesceSlots`,
 * `mergeCellFlashRanges`, `rangesFromSortedSlots`) already guarantees it, so
 * nothing is re-sorted here. Pass 1 coalesces across gaps of at most
 * `gapMaxSlots` parked slots (a gap of 0 is plain adjacency). Pass 2 enforces
 * `maxRanges` by bridging the smallest remaining gaps first (ties
 * leftmost-first for determinism): merging two neighbouring runs never changes
 * any OTHER gap's size, so marking the k smallest gaps and coalescing across
 * the marks is exact. The result covers every input slot, stays inside the
 * input's hull, and is ascending and non-overlapping.
 */
export function mergeSlotRuns(
  runs: readonly SlotRunRange[],
  policy: SlotUploadPolicy,
): SlotRunRange[] {
  if (runs.length === 0) return [];
  const gapMax = policy.gapMaxSlots;
  const cap = Math.max(1, policy.maxRanges);
  // Pass 1, in slot units with inclusive ends.
  const runStarts: number[] = [];
  const runEnds: number[] = [];
  let runStart = runs[0].start;
  let runEnd = runs[0].start + runs[0].count - 1;
  for (let i = 1; i < runs.length; i += 1) {
    const next = runs[i];
    const nextEnd = next.start + next.count - 1;
    if (next.start - runEnd - 1 <= gapMax) {
      if (nextEnd > runEnd) runEnd = nextEnd;
      continue;
    }
    runStarts.push(runStart);
    runEnds.push(runEnd);
    runStart = next.start;
    runEnd = nextEnd;
  }
  runStarts.push(runStart);
  runEnds.push(runEnd);
  // Pass 2: the cap.
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
  const ranges: SlotRunRange[] = [];
  let mergedStart = runStarts[0];
  let mergedEnd = runEnds[0];
  for (let i = 1; i < runStarts.length; i += 1) {
    if (bridgeGapBeforeRun?.[i]) {
      mergedEnd = runEnds[i];
      continue;
    }
    ranges.push({ start: mergedStart, count: mergedEnd - mergedStart + 1 });
    mergedStart = runStarts[i];
    mergedEnd = runEnds[i];
  }
  ranges.push({ start: mergedStart, count: mergedEnd - mergedStart + 1 });
  return ranges;
}

/**
 * Merge dirty SLOT indices (deduped, any order) into contiguous SEGMENT
 * ranges under a lane's policy — see `mergeSlotRuns` for the merge itself.
 * Gaps a call cannot pay for stay separate, so a scattered dirty set costs
 * its own calls rather than a near-whole-prefix upload; the cap bridges the
 * cheapest gaps first and can at worst reach the dirty set's hull, never
 * the populated prefix beyond it.
 */
export function mergeFabricSlotRanges(
  slots: readonly number[],
  policy: SlotUploadPolicy,
): FabricSlotRange[] {
  if (slots.length === 0) return [];
  const sorted = [...slots].sort((a, b) => a - b);
  // Adjacent and duplicate slots fold into runs before the policy sees them.
  const runs: SlotRunRange[] = [];
  let runStart = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i < sorted.length; i += 1) {
    const slot = sorted[i];
    if (slot === prev) continue;
    if (slot === prev + 1) {
      prev = slot;
      continue;
    }
    runs.push({ start: runStart, count: prev - runStart + 1 });
    runStart = slot;
    prev = slot;
  }
  runs.push({ start: runStart, count: prev - runStart + 1 });
  const merged = mergeSlotRuns(runs, policy);
  const ranges: FabricSlotRange[] = new Array(merged.length);
  for (let i = 0; i < merged.length; i += 1) {
    ranges[i] = {
      start: merged[i].start * FABRIC_SLOT_SEGMENTS,
      count: merged[i].count * FABRIC_SLOT_SEGMENTS,
    };
  }
  return ranges;
}

/** Bytes and bufferSubData calls a merged range set will cost under its
 *  policy — the two numbers the model trades against each other. */
export function slotRangesUploadCost(
  ranges: readonly SlotRunRange[],
  policy: SlotUploadPolicy,
): { slots: number; bytes: number; calls: number } {
  let slots = 0;
  for (const range of ranges) slots += range.count;
  return {
    slots,
    bytes: slots * policy.bytesPerSlot,
    calls: ranges.length * policy.callsPerRange,
  };
}

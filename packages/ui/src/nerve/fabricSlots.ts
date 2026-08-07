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

/**
 * Merge dirty SLOT indices (deduped, any order) into contiguous segment
 * ranges. Highly fragmented frames collapse to one spanning range so the
 * upload stays a bounded number of bufferSubData calls.
 */
export function mergeFabricSlotRanges(
  slots: readonly number[],
  maxRanges = 32,
): FabricSlotRange[] {
  if (slots.length === 0) return [];
  const sorted = [...slots].sort((a, b) => a - b);
  const ranges: FabricSlotRange[] = [];
  let runStart = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i < sorted.length; i += 1) {
    const slot = sorted[i];
    if (slot === prev || slot === prev + 1) {
      prev = slot;
      continue;
    }
    ranges.push({
      start: runStart * FABRIC_SLOT_SEGMENTS,
      count: (prev - runStart + 1) * FABRIC_SLOT_SEGMENTS,
    });
    runStart = slot;
    prev = slot;
  }
  ranges.push({
    start: runStart * FABRIC_SLOT_SEGMENTS,
    count: (prev - runStart + 1) * FABRIC_SLOT_SEGMENTS,
  });
  if (ranges.length > maxRanges) {
    const first = ranges[0];
    const last = ranges[ranges.length - 1];
    return [{
      start: first.start,
      count: last.start + last.count - first.start,
    }];
  }
  return ranges;
}

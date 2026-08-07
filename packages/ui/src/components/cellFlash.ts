import type { MutableRefObject } from 'react';
import type { CellRenderRange } from '../geometry/cellRenderSet';

/** Exact Cell ids whose flash timestamp changed since the last GPU commit. */
export type CellFlashDirtyIdsRef = MutableRefObject<Set<number>>;

/** Publish one flash-map mutation to both the compatibility boolean gate and
 * the optional exact-id journal. Callers without a journal retain the old
 * full-buffer fallback in CellGalaxy. */
export function markCellFlashDirty(
  cellId: number,
  dirtyRef?: MutableRefObject<boolean>,
  dirtyIdsRef?: CellFlashDirtyIdsRef,
): void {
  dirtyIdsRef?.current.add(cellId);
  if (dirtyRef) dirtyRef.current = true;
}

function rangesFromSortedSlots(sortedSlots: readonly number[]): CellRenderRange[] {
  if (sortedSlots.length === 0) return [];
  const ranges: CellRenderRange[] = [];
  let start = sortedSlots[0];
  let previous = start;
  for (let index = 1; index < sortedSlots.length; index += 1) {
    const slot = sortedSlots[index];
    if (slot === previous) continue;
    if (slot === previous + 1) {
      previous = slot;
      continue;
    }
    ranges.push({ start, count: previous - start + 1 });
    start = slot;
    previous = slot;
  }
  ranges.push({ start, count: previous - start + 1 });
  return ranges;
}

/** Write only dirty, currently visible Cell flash slots and return coalesced
 * scalar GPU ranges. Hidden ids are deliberately consumed without a write:
 * if they later enter the display prefix, the ordinary static-slot path reads
 * their authoritative timestamp from `flashMap`. */
export function writeDirtyCellFlashSlots(
  dirtyIds: ReadonlySet<number>,
  visibleIndexById: ReadonlyMap<number, number>,
  visibleCount: number,
  flashMap: ReadonlyMap<number, number>,
  flashArray: Float32Array,
): CellRenderRange[] {
  const count = Math.min(
    flashArray.length,
    Number.isFinite(visibleCount)
      ? Math.max(0, Math.floor(visibleCount))
      : 0,
  );
  const slots: number[] = [];
  for (const cellId of dirtyIds) {
    const slot = visibleIndexById.get(cellId);
    if (slot === undefined || slot < 0 || slot >= count) continue;
    flashArray[slot] = flashMap.get(cellId) ?? -1e9;
    slots.push(slot);
  }
  slots.sort((a, b) => a - b);
  return rangesFromSortedSlots(slots);
}

/** Merge static-slot and flash-only writes before registering Three.js update
 * ranges. This prevents a later sparse flash mark from clearing an earlier
 * static aFlashAt range in the same frame. */
export function mergeCellFlashRanges(
  staticRanges: readonly CellRenderRange[],
  dirtyRanges: readonly CellRenderRange[],
  visibleCount: number,
): CellRenderRange[] {
  const limit = Number.isFinite(visibleCount)
    ? Math.max(0, Math.floor(visibleCount))
    : 0;
  const normalized: CellRenderRange[] = [];
  for (const range of [...staticRanges, ...dirtyRanges]) {
    const start = Math.max(0, Math.floor(range.start));
    const end = Math.min(limit, Math.ceil(range.start + range.count));
    if (end > start) normalized.push({ start, count: end - start });
  }
  if (normalized.length <= 1) return normalized;
  normalized.sort((a, b) => a.start - b.start);

  const merged: CellRenderRange[] = [];
  let start = normalized[0].start;
  let end = start + normalized[0].count;
  for (let index = 1; index < normalized.length; index += 1) {
    const range = normalized[index];
    const rangeEnd = range.start + range.count;
    if (range.start <= end) {
      end = Math.max(end, rangeEnd);
      continue;
    }
    merged.push({ start, count: end - start });
    start = range.start;
    end = rangeEnd;
  }
  merged.push({ start, count: end - start });
  return merged;
}

export interface ActiveCellFlashIndexWrite {
  count: number;
  changed: boolean;
}

/** Compact visible flash slots into an indexed Points draw. The shader keeps
 * its exact birth/death/age gates; this list only removes vertices that are
 * provably outside the same half-open flash interval. */
export function writeActiveCellFlashIndices(
  flashArray: Float32Array,
  visibleCount: number,
  nowSeconds: number,
  durationSeconds: number,
  indexArray: Uint16Array | Uint32Array,
  previousCount: number,
): ActiveCellFlashIndexWrite {
  const count = Math.min(
    flashArray.length,
    Number.isFinite(visibleCount)
      ? Math.max(0, Math.floor(visibleCount))
      : 0,
  );
  if (
    !Number.isFinite(nowSeconds)
    || !Number.isFinite(durationSeconds)
    || durationSeconds <= 0
  ) {
    return { count: 0, changed: previousCount !== 0 };
  }

  let written = 0;
  let changed = false;
  for (let slot = 0; slot < count && written < indexArray.length; slot += 1) {
    const age = nowSeconds - flashArray[slot];
    if (age < 0 || age >= durationSeconds) continue;
    if (indexArray[written] !== slot) {
      indexArray[written] = slot;
      changed = true;
    }
    written += 1;
  }
  return {
    count: written,
    changed: changed || written !== previousCount,
  };
}

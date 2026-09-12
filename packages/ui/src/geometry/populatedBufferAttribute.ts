/** Minimal structural contract shared by Three's BufferAttribute and
 * InterleavedBuffer. Update-range counts are scalar array components, not
 * logical vertices or instances. */
export interface PopulatedBufferUpdateTarget {
  readonly array: { readonly length: number };
  clearUpdateRanges(): void;
  addUpdateRange(start: number, count: number): void;
  needsUpdate: boolean;
}

/** Upload only the populated prefix of a reusable dynamic buffer. An empty
 * draw needs only its draw count cleared, so it deliberately leaves the
 * attribute version unchanged and schedules no zero-length GPU transfer. */
export function markPopulatedBufferUpdate(
  attribute: PopulatedBufferUpdateTarget,
  usedComponents: number,
): boolean {
  attribute.clearUpdateRanges();
  const count = Number.isFinite(usedComponents)
    ? Math.min(
      attribute.array.length,
      Math.max(0, Math.floor(usedComponents)),
    )
    : 0;
  if (count === 0) return false;
  attribute.addUpdateRange(0, count);
  attribute.needsUpdate = true;
  return true;
}

/** One run inside a reusable buffer, in ITEMS — a vertex, a node — not in the
 *  scalar components three's update ranges are counted in. */
export interface BufferItemSpan {
  start: number;
  count: number;
}

function addClampedRange(
  attribute: PopulatedBufferUpdateTarget,
  startItem: number,
  endItem: number,
  itemSize: number,
): boolean {
  const components = attribute.array.length;
  const from = Math.max(0, Math.min(components, startItem * itemSize));
  const to = Math.max(from, Math.min(components, endItem * itemSize));
  if (to <= from) return false;
  attribute.addUpdateRange(from, to - from);
  return true;
}

/** Upload only the runs of a populated prefix that changed.
 *
 *  `spanCount` says how much of `spans` is in use: the array is a pool owned by
 *  the caller, so its length says nothing. Spans must be ascending — the writer
 *  that produces them walks the buffer in order — and runs that touch or
 *  overlap are merged, because one range covering two neighbours is one
 *  `bufferSubData` instead of two.
 *
 *  Nothing to upload leaves the attribute's version alone, exactly as an empty
 *  prefix does in `markPopulatedBufferUpdate`: a refresh in which no entry
 *  moved must not cost a transfer. */
export function markPopulatedBufferItemSpans(
  attribute: PopulatedBufferUpdateTarget,
  spans: readonly BufferItemSpan[],
  spanCount: number,
  itemSize: number,
): boolean {
  attribute.clearUpdateRanges();
  let flagged = false;
  let open = false;
  let start = 0;
  let end = 0;
  const limit = Math.min(spanCount, spans.length);
  for (let index = 0; index < limit; index += 1) {
    const span = spans[index];
    if (!Number.isFinite(span.start) || !(span.count > 0)) continue;
    const spanStart = Math.max(0, Math.floor(span.start));
    const spanEnd = spanStart + Math.floor(span.count);
    if (!open) {
      start = spanStart;
      end = spanEnd;
      open = true;
      continue;
    }
    if (spanStart <= end) {
      if (spanEnd > end) end = spanEnd;
      continue;
    }
    if (addClampedRange(attribute, start, end, itemSize)) flagged = true;
    start = spanStart;
    end = spanEnd;
  }
  if (open && addClampedRange(attribute, start, end, itemSize)) flagged = true;
  if (flagged) attribute.needsUpdate = true;
  return flagged;
}

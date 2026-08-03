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

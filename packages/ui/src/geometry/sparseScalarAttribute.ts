import type { BufferAttribute } from 'three';

export interface ScalarAttributeSlotWrite {
  index: number;
  value: number;
}

function scalarAttributeValue(value: number): number {
  return Number.isFinite(value) ? Math.fround(value) : 0;
}

/** Apply a sparse scalar attribute snapshot and upload only slots whose final
 * value changed. `previousSlots` tracks the non-zero footprint, allowing a
 * released focus/recall to clear its old slots without filling the complete
 * backing array. */
export function writeSparseScalarAttribute(
  attribute: BufferAttribute,
  previousSlots: number[],
  writes: readonly ScalarAttributeSlotWrite[],
): boolean {
  const values = attribute.array as Float32Array;
  const dirtySlots: number[] = [];

  for (const index of previousSlots) {
    if (index < 0 || index >= attribute.count) continue;
    let retained = false;
    for (const write of writes) {
      if (write.index === index && scalarAttributeValue(write.value) !== 0) {
        retained = true;
        break;
      }
    }
    if (!retained && values[index] !== 0) {
      values[index] = 0;
      dirtySlots.push(index);
    }
  }

  const nextSlots: number[] = [];
  for (const write of writes) {
    const index = write.index;
    if (!Number.isInteger(index) || index < 0 || index >= attribute.count) {
      continue;
    }
    const value = scalarAttributeValue(write.value);
    if (values[index] !== value) {
      values[index] = value;
      dirtySlots.push(index);
    }
    if (value !== 0 && !nextSlots.includes(index)) {
      nextSlots.push(index);
    }
  }
  previousSlots.length = 0;
  previousSlots.push(...nextSlots);

  if (dirtySlots.length === 0) return false;
  dirtySlots.sort((left, right) => left - right);
  attribute.clearUpdateRanges();
  let start = dirtySlots[0];
  let end = start + 1;
  for (let i = 1; i < dirtySlots.length; i += 1) {
    const index = dirtySlots[i];
    if (index === end || index === end - 1) {
      if (index === end) end += 1;
      continue;
    }
    attribute.addUpdateRange(
      start * attribute.itemSize,
      (end - start) * attribute.itemSize,
    );
    start = index;
    end = index + 1;
  }
  attribute.addUpdateRange(
    start * attribute.itemSize,
    (end - start) * attribute.itemSize,
  );
  attribute.needsUpdate = true;
  return true;
}

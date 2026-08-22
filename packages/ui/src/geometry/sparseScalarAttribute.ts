import type { BufferAttribute } from 'three';

export interface ScalarAttributeSlotWrite {
  index: number;
  value: number;
}

/** Some readers of a scalar lane only ever ask it a yes/no question — "is this
 * slot past the line?" — and `attribute.version` is far too loud for them: an
 * easing envelope moves every one of its slots on every frame while the answer
 * they read stays the same the whole time. Handing one of these to the writer
 * turns the value comparison it already performs into a crossing test and bumps
 * `epoch` at most once per batch, so a threshold reader can gate on the epoch
 * and sleep through every write that only moves a magnitude it never reads. */
export interface ScalarThresholdEpoch {
  readonly threshold: number;
  epoch: number;
}

function scalarAttributeValue(value: number): number {
  return Number.isFinite(value) ? Math.fround(value) : 0;
}

/** Whether a slot changed sides. Both arguments are already-stored (fround'd)
 * values, so this is exactly the comparison the threshold reader will make. */
function crossesScalarThreshold(
  previous: number,
  next: number,
  threshold: number,
): boolean {
  return (previous > threshold) !== (next > threshold);
}

/** Apply a sparse scalar attribute snapshot and upload only slots whose final
 * value changed. `previousSlots` tracks the non-zero footprint, allowing a
 * released focus/recall to clear its old slots without filling the complete
 * backing array. Pass `thresholdEpoch` when a consumer reads this lane as a
 * boolean; it is bumped once per batch in which any slot crossed the line. */
export function writeSparseScalarAttribute(
  attribute: BufferAttribute,
  previousSlots: number[],
  writes: readonly ScalarAttributeSlotWrite[],
  thresholdEpoch?: ScalarThresholdEpoch,
): boolean {
  const values = attribute.array as Float32Array;
  const dirtySlots: number[] = [];
  let crossedThreshold = false;

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
      if (
        thresholdEpoch
        && crossesScalarThreshold(values[index], 0, thresholdEpoch.threshold)
      ) {
        crossedThreshold = true;
      }
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
      if (
        thresholdEpoch
        && crossesScalarThreshold(values[index], value, thresholdEpoch.threshold)
      ) {
        crossedThreshold = true;
      }
      values[index] = value;
      dirtySlots.push(index);
    }
    if (value !== 0 && !nextSlots.includes(index)) {
      nextSlots.push(index);
    }
  }
  previousSlots.length = 0;
  previousSlots.push(...nextSlots);

  if (crossedThreshold && thresholdEpoch) thresholdEpoch.epoch += 1;

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

// Write-on-change bookkeeping for the frame-rate DOM chips.
//
// The recall overlays publish their state onto `dataset.*` so a live session
// can read what the scene believes. Recomputing those strings every frame and
// assigning them back is pure churn: a recall focus can be held or parked
// indefinitely, and while it rests every value is identical to the one
// already on the element. A ledger remembers what was published and lets the
// caller write only real changes.
//
// The sink is typed as a plain string record — `DOMStringMap` satisfies it —
// so the whole thing is exercisable without a DOM.

/** Anything shaped like `HTMLElement.dataset`. */
export type FrameDatasetSink = Record<string, string | undefined>;

export interface FrameDatasetLedger {
  /** Element the recorded values belong to; React remounts invalidate them. */
  owner: object | null;
  /** Commit the records belong to; a React render may rewrite the same
   *  attributes from the markup, and then the element no longer carries what
   *  this ledger published. */
  epoch: number;
  /** Last published text per key. A recorded `undefined` means "deleted". */
  values: Map<string, string | undefined>;
  /** Last published number per numeric key. */
  published: Map<string, number>;
  /** Last number OFFERED per numeric key, published or not. */
  seen: Map<string, number>;
  /** Last published quantized components per joined-numeric key. */
  vectors: Map<string, number[]>;
}

export function makeFrameDatasetLedger(): FrameDatasetLedger {
  return {
    owner: null,
    epoch: -1,
    values: new Map(),
    published: new Map(),
    seen: new Map(),
    vectors: new Map(),
  };
}

/**
 * Point the ledger at the element it is about to write, as of `epoch`. A
 * different element (React remounted the chip, or a ref landed for the first
 * time) carries the markup's own initial attributes, and so does the same
 * element after a render that rewrote them — in both cases every recorded
 * value is void. Returns whether the ledger was reset.
 */
export function frameDatasetBind(
  ledger: FrameDatasetLedger,
  owner: object | null,
  epoch = 0,
): boolean {
  if (ledger.owner === owner && ledger.epoch === epoch) return false;
  ledger.owner = owner;
  ledger.epoch = epoch;
  ledger.values.clear();
  ledger.published.clear();
  ledger.seen.clear();
  ledger.vectors.clear();
  return true;
}

/** Drop the numeric records for a key whose publication mode changed. */
function forgetNumeric(ledger: FrameDatasetLedger, key: string): void {
  ledger.published.delete(key);
  ledger.seen.delete(key);
  ledger.vectors.delete(key);
}

/** Publish a state-level value, writing only when it actually changed. */
export function frameDatasetWrite(
  ledger: FrameDatasetLedger,
  sink: FrameDatasetSink,
  key: string,
  value: string,
): boolean {
  if (ledger.values.has(key) && ledger.values.get(key) === value) return false;
  ledger.values.set(key, value);
  // Several keys alternate between a literal ('none') and a number; dropping
  // the numeric record keeps the next numeric write from matching a value
  // that is no longer what the element carries.
  forgetNumeric(ledger, key);
  sink[key] = value;
  return true;
}

/** Remove a value, writing only when it is not already absent. */
export function frameDatasetDelete(
  ledger: FrameDatasetLedger,
  sink: FrameDatasetSink,
  key: string,
): boolean {
  if (ledger.values.has(key) && ledger.values.get(key) === undefined) {
    return false;
  }
  ledger.values.set(key, undefined);
  forgetNumeric(ledger, key);
  delete sink[key];
  return true;
}

const quantize = (value: number, quantum: number): number => (
  Number.isFinite(value) ? Math.round(value / quantum) : Number.NaN
);

/**
 * Decide whether a number is worth publishing, and record the offer either
 * way. Two reasons to publish:
 *
 *  - it crossed a quantum, so the reader would see a different figure;
 *  - it SETTLED — twice the same value, and not the one on the element. An
 *    animation that stops between quanta must still leave its exact final
 *    value behind, or a rested chip would read `0.995` forever.
 */
function shouldPublish(
  ledger: FrameDatasetLedger,
  key: string,
  value: number,
  quantum: number,
): boolean {
  const seen = ledger.seen.get(key);
  ledger.seen.set(key, value);
  if (!ledger.published.has(key)) return true;
  const published = ledger.published.get(key) as number;
  if (!Object.is(quantize(value, quantum), quantize(published, quantum))) {
    return true;
  }
  return Object.is(seen, value) && !Object.is(published, value);
}

/**
 * Publish a numeric value at `digits` decimals, comparing on `quantum`. The
 * published string always carries full `toFixed` precision — the quantum only
 * decides WHEN to publish, so a sweep costs one write per step it crosses
 * instead of one per frame.
 */
export function frameDatasetWriteNumber(
  ledger: FrameDatasetLedger,
  sink: FrameDatasetSink,
  key: string,
  value: number,
  digits: number,
  quantum: number,
): boolean {
  if (!shouldPublish(ledger, key, value, quantum)) return false;
  ledger.published.set(key, value);
  ledger.vectors.delete(key);
  const text = value.toFixed(digits);
  ledger.values.set(key, text);
  sink[key] = text;
  return true;
}

/**
 * Publish a joined numeric series (`0.120,0.940`). Comparison is component
 * -wise on the quantized values, so the joined string is built only when one
 * of them moves; an exact vector compare cannot mistake two different series
 * for each other the way a hashed digest could.
 */
export function frameDatasetWriteVector(
  ledger: FrameDatasetLedger,
  sink: FrameDatasetSink,
  key: string,
  values: readonly number[],
  digits: number,
  quantum: number,
  separator = ',',
): boolean {
  let recorded = ledger.vectors.get(key);
  if (recorded && recorded.length === values.length) {
    let changed = false;
    for (let index = 0; index < values.length; index += 1) {
      if (!Object.is(recorded[index], quantize(values[index], quantum))) {
        changed = true;
        break;
      }
    }
    if (!changed) return false;
  }
  if (!recorded) {
    recorded = [];
    ledger.vectors.set(key, recorded);
  }
  ledger.published.delete(key);
  ledger.seen.delete(key);
  recorded.length = values.length;
  let text = '';
  for (let index = 0; index < values.length; index += 1) {
    recorded[index] = quantize(values[index], quantum);
    if (index > 0) text += separator;
    text += values[index].toFixed(digits);
  }
  ledger.values.set(key, text);
  sink[key] = text;
  return true;
}

/** Style properties share the ledger under their own namespace. */
const styleKey = (property: string): string => `style:${property}`;

/**
 * Record a discriminant and report whether it moved, publishing nothing.
 * For writes whose VALUE costs more to build than to compare — build it only
 * when this says the inputs changed.
 */
export function frameLedgerMarkNumber(
  ledger: FrameDatasetLedger,
  key: string,
  value: number,
): boolean {
  const marked = `mark:${key}`;
  if (
    ledger.published.has(marked)
    && Object.is(ledger.published.get(marked), value)
  ) return false;
  ledger.published.set(marked, value);
  return true;
}

/** Write-on-change for a style property. */
export function frameStyleWrite(
  ledger: FrameDatasetLedger,
  style: CSSStyleDeclaration,
  property: string,
  value: string,
): boolean {
  const key = styleKey(property);
  if (ledger.values.has(key) && ledger.values.get(key) === value) return false;
  ledger.values.set(key, value);
  forgetNumeric(ledger, key);
  style.setProperty(property, value);
  return true;
}

/**
 * Write-on-change for a numeric style property. Unlike the telemetry
 * readouts these are visible, so the quantum must match the published
 * precision (1e-3 against three decimals): the guard may only skip writes
 * that would have produced the very same string.
 */
export function frameStyleWriteNumber(
  ledger: FrameDatasetLedger,
  style: CSSStyleDeclaration,
  property: string,
  value: number,
  digits: number,
  quantum: number,
): boolean {
  const key = styleKey(property);
  if (!shouldPublish(ledger, key, value, quantum)) return false;
  ledger.published.set(key, value);
  const text = value.toFixed(digits);
  ledger.values.set(key, text);
  style.setProperty(property, text);
  return true;
}

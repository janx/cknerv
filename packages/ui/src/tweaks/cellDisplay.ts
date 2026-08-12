import { useSyncExternalStore } from 'react';
import { INSTANCE_CAPACITY } from '../geometry/cellPositions';

export type CellDisplayMode = 'auto' | 'manual';

export interface CellDisplayRuntimeSnapshot {
  mode: CellDisplayMode;
  /** Requested manual cap. It is retained while AUTO owns the live cap. */
  manualLimit: number;
}

export const CELL_DISPLAY_MIN = 100;
export const CELL_DISPLAY_MAX = INSTANCE_CAPACITY;
export const CELL_DISPLAY_STEP = 100;
/** Keep the lower field precise, then spend fewer physical slider pixels on
 * large-count changes where 250-Cell increments are visually equivalent. */
export const CELL_DISPLAY_FINE_MAX = 5_000;
export const CELL_DISPLAY_COARSE_STEP = 250;
/**
 * The single AUTO structural budget (explicit product decision, 2026-08-11:
 * Galaxy membership is FIXED — render quality adjusts presentation only, DPR
 * / effects / sampling, never composition). 12,000 sits below the reference
 * iGPU's measured rock-solid 20,000 with margin for average hardware; the
 * cost is that weak machines no longer shed membership, only presentation.
 * The 50K upper bound lives on in the retained reservoir and the manual
 * slider — user intent, not quality adaptation.
 */
export const AUTO_CELL_DISPLAY_BUDGET = 12_000;

const listeners = new Set<() => void>();
let runtimeSnapshot: CellDisplayRuntimeSnapshot = {
  mode: 'auto',
  manualLimit: CELL_DISPLAY_MAX,
};

/** Clamp a server-provided capacity to what the bundled renderer can hold. */
export function normalizeCellDisplayCapacity(capacity: number): number {
  if (!Number.isFinite(capacity)) return CELL_DISPLAY_MAX;
  return Math.max(
    CELL_DISPLAY_MIN,
    Math.min(CELL_DISPLAY_MAX, Math.floor(capacity)),
  );
}

export function normalizeCellDisplayLimit(
  limit: number,
  capacity = CELL_DISPLAY_MAX,
): number {
  const maximum = normalizeCellDisplayCapacity(capacity);
  if (!Number.isFinite(limit)) return maximum;
  if (limit <= CELL_DISPLAY_MIN) return CELL_DISPLAY_MIN;
  if (limit >= maximum) return maximum;
  const stepped = limit <= CELL_DISPLAY_FINE_MAX
    ? Math.round(limit / CELL_DISPLAY_STEP) * CELL_DISPLAY_STEP
    : CELL_DISPLAY_FINE_MAX
      + Math.round(
        (limit - CELL_DISPLAY_FINE_MAX) / CELL_DISPLAY_COARSE_STEP,
      ) * CELL_DISPLAY_COARSE_STEP;
  return Math.max(CELL_DISPLAY_MIN, Math.min(maximum, stepped));
}

function fineSliderStepCount(maximum: number): number {
  const fineMaximum = Math.min(maximum, CELL_DISPLAY_FINE_MAX);
  return Math.ceil(
    (fineMaximum - CELL_DISPLAY_MIN) / CELL_DISPLAY_STEP,
  );
}

/** Range-input domain size for a capacity. The first 4,900 Cells get
 * 100-Cell steps; the remaining range uses 250-Cell steps. At the default
 * 20,000 cap this is 0…109 instead of a visually cramped 100…20,000 rail. */
export function cellDisplaySliderMaximum(
  capacity = CELL_DISPLAY_MAX,
): number {
  const maximum = normalizeCellDisplayCapacity(capacity);
  const fineMaximum = Math.min(maximum, CELL_DISPLAY_FINE_MAX);
  const coarseSteps = Math.ceil(
    (maximum - fineMaximum) / CELL_DISPLAY_COARSE_STEP,
  );
  return fineSliderStepCount(maximum) + coarseSteps;
}

export function cellDisplaySliderValueToLimit(
  value: number,
  capacity = CELL_DISPLAY_MAX,
): number {
  const maximum = normalizeCellDisplayCapacity(capacity);
  const sliderMaximum = cellDisplaySliderMaximum(maximum);
  const index = Number.isFinite(value)
    ? Math.max(0, Math.min(sliderMaximum, Math.round(value)))
    : sliderMaximum;
  if (index >= sliderMaximum) return maximum;

  const fineSteps = fineSliderStepCount(maximum);
  const fineMaximum = Math.min(maximum, CELL_DISPLAY_FINE_MAX);
  const limit = index <= fineSteps
    ? CELL_DISPLAY_MIN + index * CELL_DISPLAY_STEP
    : fineMaximum + (index - fineSteps) * CELL_DISPLAY_COARSE_STEP;
  return normalizeCellDisplayLimit(limit, maximum);
}

export function cellDisplayLimitToSliderValue(
  limit: number,
  capacity = CELL_DISPLAY_MAX,
): number {
  const maximum = normalizeCellDisplayCapacity(capacity);
  const normalized = normalizeCellDisplayLimit(limit, maximum);
  const sliderMaximum = cellDisplaySliderMaximum(maximum);
  if (normalized >= maximum) return sliderMaximum;

  const fineSteps = fineSliderStepCount(maximum);
  if (normalized <= CELL_DISPLAY_FINE_MAX) {
    return Math.min(
      fineSteps,
      Math.round((normalized - CELL_DISPLAY_MIN) / CELL_DISPLAY_STEP),
    );
  }
  return Math.min(
    sliderMaximum,
    fineSteps + Math.round(
      (normalized - CELL_DISPLAY_FINE_MAX) / CELL_DISPLAY_COARSE_STEP,
    ),
  );
}

/** AUTO's display budget is quality-independent: the server-owned display
 * budget when one is streaming (`cache.displayBudget.cells`), the fixed
 * structural constant otherwise — both bounded by the server's retained
 * capacity. The complete browser cache remains intact; the budget only
 * bounds what the Galaxy renders. */
export function automaticCellDisplayLimit(
  capacity = CELL_DISPLAY_MAX,
  serverBudget?: number | null,
): number {
  const maximum = normalizeCellDisplayCapacity(capacity);
  const budget =
    serverBudget !== undefined
    && serverBudget !== null
    && Number.isFinite(serverBudget)
      ? Math.max(0, Math.floor(serverBudget))
      : AUTO_CELL_DISPLAY_BUDGET;
  return Math.min(maximum, budget);
}

/** AUTO stays within both its resolved visual budget and the server's
 * retained capacity. Manual mode remains a presentation clamp up to the
 * renderer's hard ceiling — render the first N of the staged list, no
 * policy semantics — so an older low-cap config does not silently shrink
 * the slider's range. */
export function resolveCellDisplayLimit(
  snapshot: CellDisplayRuntimeSnapshot,
  automaticCapacity = CELL_DISPLAY_MAX,
  serverBudget?: number | null,
): number {
  return snapshot.mode === 'auto'
    ? automaticCellDisplayLimit(automaticCapacity, serverBudget)
    : normalizeCellDisplayLimit(snapshot.manualLimit);
}

function publish(next: CellDisplayRuntimeSnapshot): void {
  if (
    next.mode === runtimeSnapshot.mode
    && next.manualLimit === runtimeSnapshot.manualLimit
  ) return;
  runtimeSnapshot = next;
  for (const listener of listeners) listener();
}

/** Dragging the top-bar range takes ownership from AUTO immediately. */
export function setCellDisplayLimit(limit: number): void {
  publish({
    mode: 'manual',
    manualLimit: normalizeCellDisplayLimit(limit),
  });
}

/** Returning to AUTO preserves the last manual cap for a later adjustment. */
export function setCellDisplayMode(mode: CellDisplayMode): void {
  publish({ ...runtimeSnapshot, mode });
}

export function getCellDisplayRuntimeSnapshot(): CellDisplayRuntimeSnapshot {
  return runtimeSnapshot;
}

export function subscribeCellDisplayRuntime(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useCellDisplayRuntime(): CellDisplayRuntimeSnapshot {
  return useSyncExternalStore(
    subscribeCellDisplayRuntime,
    getCellDisplayRuntimeSnapshot,
    getCellDisplayRuntimeSnapshot,
  );
}

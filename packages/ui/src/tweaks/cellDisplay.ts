import { useSyncExternalStore } from 'react';
import { INSTANCE_CAPACITY } from '../geometry/cellPositions';
import type { QualityPreset } from './qualityPresets';

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
 * Per-quality structural budgets for AUTO mode (explicit product decision,
 * 2026-08-10: quality MAY adjust Galaxy membership within these rungs).
 * `low` preserves the historical single stable budget, so the weakest
 * hardware keeps its long-proven behavior; higher tiers spend measured
 * headroom on field density. Rung changes ride the adaptive-quality
 * hysteresis (evidence windows + switch cooldown), and the render set
 * treats a budget change as one canonical rebuild — cells revealed this
 * way render in their settled lifecycle state (born long ago), never as
 * fake births. Smaller retained fields still show every Cell.
 */
export const AUTO_CELL_DISPLAY_BUDGETS: Record<QualityPreset, number> = {
  low: 6_000,
  med: 20_000,
  // Positioned at the measured HOLD point, not the renderer ceiling: a tier
  // a strong machine oscillates in and out of (50,000 measured ~25% high
  // share on the reference iGPU) is a worse steady experience than one it
  // keeps. The 50K upper bound lives on in the retained reservoir and the
  // manual slider; AUTO's top rung sits between the rock-solid 20K anchor
  // and the un-holdable 50K.
  high: 35_000,
};

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

/** AUTO resolves the display budget from the effective quality tier —
 * membership varies between the tier rungs by explicit product decision
 * (see AUTO_CELL_DISPLAY_BUDGETS). The complete browser cache remains
 * intact at every tier; the budget only bounds what the Galaxy renders. */
export function automaticCellDisplayLimit(
  quality: QualityPreset,
  capacity = CELL_DISPLAY_MAX,
): number {
  const maximum = normalizeCellDisplayCapacity(capacity);
  return Math.min(maximum, AUTO_CELL_DISPLAY_BUDGETS[quality]);
}

/** AUTO stays within both its stable visual budget and the server's retained
 * capacity. Manual mode remains a renderer request up to the 20K hard ceiling,
 * so an older low-cap config does not silently shrink the slider's range. */
export function resolveCellDisplayLimit(
  snapshot: CellDisplayRuntimeSnapshot,
  quality: QualityPreset,
  automaticCapacity = CELL_DISPLAY_MAX,
): number {
  return snapshot.mode === 'auto'
    ? automaticCellDisplayLimit(quality, automaticCapacity)
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

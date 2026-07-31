import { useSyncExternalStore } from 'react';
import { INSTANCE_CAPACITY } from '../geometry/cellPositions';
import {
  QUALITY_PRESETS,
  type QualityPreset,
} from './qualityPresets';

export type CellDisplayMode = 'auto' | 'manual';

export interface CellDisplayRuntimeSnapshot {
  mode: CellDisplayMode;
  /** Requested manual cap. It is retained while AUTO owns the live cap. */
  manualLimit: number;
}

export const CELL_DISPLAY_MIN = 100;
export const CELL_DISPLAY_MAX = INSTANCE_CAPACITY;
export const CELL_DISPLAY_STEP = 100;

const listeners = new Set<() => void>();
let runtimeSnapshot: CellDisplayRuntimeSnapshot = {
  mode: 'auto',
  manualLimit: CELL_DISPLAY_MAX,
};

export function normalizeCellDisplayLimit(limit: number): number {
  if (!Number.isFinite(limit)) return CELL_DISPLAY_MAX;
  const stepped = Math.round(limit / CELL_DISPLAY_STEP) * CELL_DISPLAY_STEP;
  return Math.max(CELL_DISPLAY_MIN, Math.min(CELL_DISPLAY_MAX, stepped));
}

/** AUTO shares the adaptive quality controller's measured performance tier.
 * It changes only visual capacity; the complete browser cache remains intact. */
export function automaticCellDisplayLimit(quality: QualityPreset): number {
  return Math.max(
    CELL_DISPLAY_MIN,
    Math.min(
      CELL_DISPLAY_MAX,
      Math.floor(INSTANCE_CAPACITY * QUALITY_PRESETS[quality].cellGalaxyMul),
    ),
  );
}

export function resolveCellDisplayLimit(
  snapshot: CellDisplayRuntimeSnapshot,
  quality: QualityPreset,
): number {
  return snapshot.mode === 'auto'
    ? automaticCellDisplayLimit(quality)
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

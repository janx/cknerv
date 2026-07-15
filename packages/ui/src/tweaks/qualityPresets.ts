import { useSyncExternalStore } from 'react';

export type QualityPreset = 'high' | 'med' | 'low';
export type QualityMode = 'auto' | QualityPreset;

export interface QualityCascade {
  /** Runtime DPR ceiling. Unlike WebGL antialias, this changes without remounting Canvas. */
  maxDpr: number;
  starsCount: number;
  particleCapMul: number;
  cellGalaxyMul: number;
  dischargeArms: number;
  /** Curvature resolution for the passive consensus fabric. Background
   * structure yields first; active writes retain a separate, higher budget. */
  fabricSamplesPerEdge: number;
  activeSamplesPerHop: number;
  /** Expanded A-braid identities admitted around the camera. Focused Cells are
   * sorted ahead of this cap and therefore remain visible at every preset. */
  nucleusNearCap: number;
}

/** High preserves the pre-adaptive production output (Canvas' default DPR cap
 * and 2,000 stars). Med/low reduce only visual capacity, never chain data. */
export const QUALITY_PRESETS: Record<QualityPreset, QualityCascade> = {
  high: {
    maxDpr: 2, starsCount: 2000, particleCapMul: 1, cellGalaxyMul: 1,
    dischargeArms: 3, fabricSamplesPerEdge: 4, activeSamplesPerHop: 12,
    nucleusNearCap: 12,
  },
  med: {
    maxDpr: 1.5, starsCount: 600, particleCapMul: 0.5, cellGalaxyMul: 0.7,
    dischargeArms: 2, fabricSamplesPerEdge: 2, activeSamplesPerHop: 10,
    nucleusNearCap: 8,
  },
  low: {
    maxDpr: 1, starsCount: 200, particleCapMul: 0.25, cellGalaxyMul: 0.3,
    dischargeArms: 1, fabricSamplesPerEdge: 1, activeSamplesPerHop: 8,
    nucleusNearCap: 4,
  },
};

/** Shared Leva input. `auto` owns only the effective rendering preset; selecting
 * high/med/low is an explicit manual override. */
export const QUALITY_MODE_CONTROL = {
  quality: {
    value: 'auto' as QualityMode,
    options: ['auto', 'high', 'med', 'low'] as const,
    label: 'quality',
  },
} as const;

export interface QualityRuntimeSnapshot {
  mode: QualityMode;
  effective: QualityPreset;
  source: 'startup' | 'adaptive' | 'manual';
}

const listeners = new Set<() => void>();
let runtimeSnapshot: QualityRuntimeSnapshot = {
  mode: 'auto',
  effective: 'high',
  source: 'startup',
};

function publish(next: QualityRuntimeSnapshot): void {
  if (
    next.mode === runtimeSnapshot.mode
    && next.effective === runtimeSnapshot.effective
    && next.source === runtimeSnapshot.source
  ) return;
  runtimeSnapshot = next;
  for (const listener of listeners) listener();
}

/** Synchronize the manual/auto intent. Manual mode applies immediately; auto
 * retains the current fidelity until the sampled state machine has evidence. */
export function setQualityMode(mode: QualityMode): void {
  publish({
    mode,
    effective: mode === 'auto' ? runtimeSnapshot.effective : mode,
    source: mode === 'auto' ? 'adaptive' : 'manual',
  });
}

/** Publish a state-machine transition only while auto still owns the setting. */
export function setAdaptiveQuality(effective: QualityPreset): void {
  if (runtimeSnapshot.mode !== 'auto') return;
  publish({ mode: 'auto', effective, source: 'adaptive' });
}

export function getQualityRuntimeSnapshot(): QualityRuntimeSnapshot {
  return runtimeSnapshot;
}

export function subscribeQualityRuntime(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Rare updates only (mode/preset transitions), so a plain external-store hook
 * is preferable to per-frame React state. */
export function useQualityRuntime(): QualityRuntimeSnapshot {
  return useSyncExternalStore(
    subscribeQualityRuntime,
    getQualityRuntimeSnapshot,
    getQualityRuntimeSnapshot,
  );
}

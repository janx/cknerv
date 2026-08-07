import { useSyncExternalStore } from 'react';

export type QualityPreset = 'high' | 'med' | 'low';
export type QualityMode = 'auto' | QualityPreset;

export interface QualityCascade {
  /** Runtime DPR ceiling. Unlike WebGL antialias, this changes without remounting Canvas. */
  maxDpr: number;
  starsCount: number;
  particleCapMul: number;
  dischargeArms: number;
  /** Resting fibres are a visual sampling of the complete routing graph. The
   * Cell display set stays stable while lower presets submit fewer transparent
   * fat-line triangles. */
  passiveEdgeCap: number;
  /** Two samples are the minimum that preserves a quadratic fibre's bend. */
  passiveSamplesPerEdge: number;
  /** Expensive CPU-side lifecycle/mask rebuilds do not need display refresh
   * cadence; active packet layers remain frame-rate driven. */
  passiveAnimationFps: number;
  /** Active writes shed tessellation separately from the resting fabric. */
  activeSamplesPerHop: number;
  /** Expanded A-braid identities admitted around the camera. Focused Cells are
   * sorted ahead of this cap and therefore remain visible at every preset. */
  nucleusNearCap: number;
  /** Semantic memory marks retain one CSS-space footprint at every preset.
   * Lower sample density gets a slightly broader, dimmer filter rather than
   * dropping checksum lanes or allowing one-pixel glare. */
  memorySignal: {
    coreMinPx: number;
    compactLinePx: number;
    energyScale: number;
    expandedLineScale: number;
  };
}

/** High preserves the production DPR and ambience ceiling. Every preset trims
 * only visual sampling, never chain data, Cell membership, or the minimum
 * readable footprint of a retained record. */
export const QUALITY_PRESETS: Record<QualityPreset, QualityCascade> = {
  high: {
    maxDpr: 2, starsCount: 2000, particleCapMul: 1,
    dischargeArms: 3, activeSamplesPerHop: 12,
    passiveEdgeCap: 3000, passiveSamplesPerEdge: 3,
    passiveAnimationFps: 30,
    nucleusNearCap: 12,
    memorySignal: {
      coreMinPx: 24, compactLinePx: 0.55, energyScale: 1,
      expandedLineScale: 1,
    },
  },
  med: {
    maxDpr: 1.5, starsCount: 600, particleCapMul: 0.5,
    dischargeArms: 2, activeSamplesPerHop: 10,
    passiveEdgeCap: 1600, passiveSamplesPerEdge: 2,
    passiveAnimationFps: 24,
    nucleusNearCap: 8,
    memorySignal: {
      coreMinPx: 24, compactLinePx: 0.62, energyScale: 0.94,
      expandedLineScale: 1.06,
    },
  },
  low: {
    maxDpr: 1, starsCount: 200, particleCapMul: 0.25,
    dischargeArms: 1, activeSamplesPerHop: 8,
    passiveEdgeCap: 800, passiveSamplesPerEdge: 2,
    passiveAnimationFps: 15,
    nucleusNearCap: 4,
    memorySignal: {
      coreMinPx: 24, compactLinePx: 0.72, energyScale: 0.86,
      expandedLineScale: 1.15,
    },
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

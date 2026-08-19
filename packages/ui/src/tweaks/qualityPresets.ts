import { useSyncExternalStore } from 'react';

export type QualityPreset = 'high' | 'med' | 'low';
export type QualityMode = 'auto' | QualityPreset;

export interface QualityCascade {
  /** Runtime DPR ceiling. Unlike WebGL antialias, this changes without remounting Canvas.
   *
   * ⚠️ This is a CEILING, not a scale: `resolveCanvasDpr` takes
   * `min(devicePixelRatio, maxDpr)`. On a display at scale 1.0 the device
   * ratio is already 1, so every preset resolves to 1 and this knob does
   * NOTHING — including on a 4K monitor, which is the case that needs it
   * most. There the drawing buffer is 3840x2160 at every tier and the whole
   * cascade rests on the content knobs below. */
  maxDpr: number;
  starsCount: number;
  particleCapMul: number;
  dischargeArms: number;
  /** Active writes shed tessellation separately from the resting fabric. */
  activeSamplesPerHop: number;
  /** Expanded A-braid identities admitted around the camera. Focused Cells are
   * sorted ahead of this cap and therefore remain visible at every preset. */
  nucleusNearCap: number;
  /** Share of the placed halo drawn, as a prefix of the placement buffer.
   *
   * Measured 2026-08-19 with `EXT_disjoint_timer_query_webgl2` at 3840x2160:
   * the halo's two draws cost 4.77 ms of GPU per frame (points 2.80, fibres
   * 1.97) against 0.60 ms for every other draw in the scene combined — 89% of
   * the frame's GPU time in the one layer no preset could reach. High and low
   * measured 5.38 ms and 5.36 ms, so stepping the whole cascade down bought
   * 0.4%: the controller could dim the picture but not speed it up, which is
   * how a machine that dips once ends up parked at `low`.
   *
   * Cost is linear in primitive count and near-flat in sprite area (halving
   * the count halves the time; 4.6x the area costs 12%), so the count is the
   * only lever and a prefix is the whole of it. The placement emits complete
   * filaments seeded by rejection sampling against the density law, so a
   * prefix is the same field at a lower sample density — never a partial one.
   * It is drawn dimmer for the same reason `starsCount` is: it is a coarser
   * sample, and the population's amount is printed by the HUD, not by the
   * light.
   *
   * ⚠️ The GPU-timer figures above were taken while galaxy composition was
   * BROKEN — provenance `canonical`, zero residents — so the stage was a
   * static prefix and nothing churned. Re-measured on the reference 4K
   * monitor (3840x2160 buffer, `devicePixelRatio` 1, so `maxDpr` is inert)
   * with composition live (provenance `composed`, 12,000 members, ~5.5K
   * residents staging and the topology worker rebuilding against them), as
   * wall-clock frame interval — the quantity the controller actually acts on
   * — in a PAIRED A/B that toggles the tier in place on one page load,
   * 45-second windows, four cycles:
   *
   *   cycle       0      1      2      3
   *   high mean  22.99  34.00  33.08  17.83   p50  16.7  33.3  33.3  16.7
   *   med  mean  25.14  23.90  20.30  17.11   p50  16.7  16.7  16.7  16.7
   *
   * The means are noisy — a developer desktop shares this integrated GPU —
   * but the p50 is not, and it is the whole story: those are vsync
   * intervals. `high` at 4K sits ON the 16.67 ms deadline, so when it misses,
   * vsync halves it to 33.3 ms and 30 fps; it missed in two windows of four.
   * `med` made the deadline in all four. Main-thread JS per frame overlaps
   * between the two (4.3-9.6 ms against 3.5-10.0 ms), so what the prefix buys
   * is GPU time, not script time.
   *
   * So on a 4K display `AUTO` reading `med` is not a ratchet and not a
   * regression: it is the controller buying the vsync deadline with the only
   * lever that still moves at `devicePixelRatio` 1. Watched from a cold load
   * for nine minutes at that geometry it stepped down six times and climbed
   * back every time — each recovery at the floor the constants set
   * (`UP_HOLD_MS` 15 s + `ADAPTIVE_SWITCH_COOLDOWN_MS` 6 s = 21 s), touching
   * `low` once — and finished the window at `high`. It holds `high` 47% of
   * the time, `med` 45%, `low` 8%, so which letter a screenshot catches is
   * close to a coin flip.
   *
   * ⚠️ It oscillates because `high` sits ON the deadline rather than past it,
   * and the controller decides by measuring the tier it is currently IN: at
   * `med` it comfortably reads under `UP_FRAME_MS`, which says nothing about
   * what `high` would cost. Any hardware where `high` exceeds
   * `DOWN_FRAME_MS.high` while `med` stays under `UP_FRAME_MS.med` will limit
   * cycle by construction. Damping that is a product call, not a bug in the
   * evidence — the halo visibly doubles and halves across the transition. */
  populationCapMul: number;
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
    nucleusNearCap: 12, populationCapMul: 1,
    memorySignal: {
      coreMinPx: 24, compactLinePx: 0.55, energyScale: 1,
      expandedLineScale: 1,
    },
  },
  med: {
    maxDpr: 1.5, starsCount: 600, particleCapMul: 0.5,
    dischargeArms: 2, activeSamplesPerHop: 10,
    nucleusNearCap: 8, populationCapMul: 0.5,
    memorySignal: {
      coreMinPx: 24, compactLinePx: 0.62, energyScale: 0.94,
      expandedLineScale: 1.06,
    },
  },
  low: {
    maxDpr: 1, starsCount: 200, particleCapMul: 0.25,
    dischargeArms: 1, activeSamplesPerHop: 8,
    nucleusNearCap: 4, populationCapMul: 0.25,
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

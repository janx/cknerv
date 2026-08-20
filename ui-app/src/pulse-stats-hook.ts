// Dev affordance: surface @cknerv/ui's dev counters on `window` so they can
// be read live in devtools:
//   window.__pulseStats()        → { linkReasons, pathFails, origins,
//                                    recallOutcomes, rescues, ringEvicted,
//                                    blocks*, firedRatePct, recalledRatePct }
//   window.__pulseStatsReset()   → zero the pulse counters for a clean observation
//   window.__fabricStats()       → { diffCalls, recentDiffs, frames, fullWalkReasons, animating* }
//   window.__fabricStatsReset()  → zero the fabric-churn counters
// Read-only; safe to leave attached. The library itself stays window-free.
import {
  snapshotPulseStats,
  resetPulseStats,
  snapshotFabricStats,
  resetFabricStats,
} from '@cknerv/ui';

declare global {
  interface Window {
    __pulseStats?: typeof snapshotPulseStats;
    __pulseStatsReset?: typeof resetPulseStats;
    __fabricStats?: typeof snapshotFabricStats;
    __fabricStatsReset?: typeof resetFabricStats;
  }
}

export function installPulseStatsHook(): void {
  if (typeof window === 'undefined') return;
  window.__pulseStats = snapshotPulseStats;
  window.__pulseStatsReset = resetPulseStats;
  window.__fabricStats = snapshotFabricStats;
  window.__fabricStatsReset = resetFabricStats;
}

// Dev affordance: surface @cknerv/ui's nerve-pulse drop counters on `window`
// so they can be read live in devtools:
//   window.__pulseStats()       → { linkReasons, pathFails, blocks* , firedRatePct }
//   window.__pulseStatsReset()  → zero the counters for a clean observation
// Read-only; safe to leave attached. The library itself stays window-free.
import { snapshotPulseStats, resetPulseStats } from '@cknerv/ui';

declare global {
  interface Window {
    __pulseStats?: typeof snapshotPulseStats;
    __pulseStatsReset?: typeof resetPulseStats;
  }
}

export function installPulseStatsHook(): void {
  if (typeof window === 'undefined') return;
  window.__pulseStats = snapshotPulseStats;
  window.__pulseStatsReset = resetPulseStats;
}

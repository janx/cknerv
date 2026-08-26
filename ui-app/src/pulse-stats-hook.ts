// Dev affordance: surface @cknerv/ui's dev counters on `window` so they can
// be read live in devtools:
//   window.__pulseStats()        → { linkReasons, pathFails, origins,
//                                    recallOutcomes, rescues, ringEvicted,
//                                    blocks*, firedRatePct, recalledRatePct }
//   window.__pulseStatsReset()   → zero the pulse counters for a clean observation
//   window.__fabricStats()       → { diffCalls, recentDiffs, frames, fullWalkReasons, animating* }
//   window.__fabricStatsReset()  → zero the fabric-churn counters
//   window.__qualityStats()      → { mode, effective, source, locked, switches }
//                                  — after `locked` the tier is monotone
//                                    non-increasing: read `switches` twice
//                                    around a load spike and any growth is a
//                                    step down, never a climb back.
//   window.__producerOriginStats()      → { waves, attested, anonymous,
//                                    suppressed, byProducer, attestedRatePct }
//                                  — where each colony block wave STARTED.
//                                    Reset, wait out a few dozen blocks, and
//                                    `byProducer[key] / waves` should approach
//                                    that producer's share of the window: the
//                                    origin change's only observable, and the
//                                    one thing a live pass cannot see by
//                                    looking at the scene.
//   window.__producerOriginStatsReset() → zero the origin counters
//   window.__renderPerformanceStats()   → bounded p50/p95/p99 CPU/GPU/frame data
//   window.__renderPerformanceStatsJson() → versioned JSON export
//   window.__renderPerformanceStatsReset() → clean measurement window
// Read-only; safe to leave attached. The library itself stays window-free.
import {
  getQualityRuntimeSnapshot,
  snapshotPulseStats,
  resetPulseStats,
  snapshotFabricStats,
  resetFabricStats,
  snapshotProducerOriginStats,
  resetProducerOriginStats,
  snapshotPerformanceProbe,
  exportPerformanceProbeJson,
  resetPerformanceProbe,
} from '@cknerv/ui';

declare global {
  interface Window {
    __pulseStats?: typeof snapshotPulseStats;
    __pulseStatsReset?: typeof resetPulseStats;
    __fabricStats?: typeof snapshotFabricStats;
    __fabricStatsReset?: typeof resetFabricStats;
    __qualityStats?: typeof getQualityRuntimeSnapshot;
    __producerOriginStats?: typeof snapshotProducerOriginStats;
    __producerOriginStatsReset?: typeof resetProducerOriginStats;
    __renderPerformanceStats?: typeof snapshotPerformanceProbe;
    __renderPerformanceStatsJson?: typeof exportPerformanceProbeJson;
    __renderPerformanceStatsReset?: typeof resetPerformanceProbe;
  }
}

export function installPulseStatsHook(): void {
  if (typeof window === 'undefined') return;
  window.__pulseStats = snapshotPulseStats;
  window.__pulseStatsReset = resetPulseStats;
  window.__fabricStats = snapshotFabricStats;
  window.__fabricStatsReset = resetFabricStats;
  window.__qualityStats = getQualityRuntimeSnapshot;
  window.__producerOriginStats = snapshotProducerOriginStats;
  window.__producerOriginStatsReset = resetProducerOriginStats;
  window.__renderPerformanceStats = snapshotPerformanceProbe;
  window.__renderPerformanceStatsJson = exportPerformanceProbeJson;
  window.__renderPerformanceStatsReset = resetPerformanceProbe;
}

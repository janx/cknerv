// Dev affordance: surface @cknerv/ui's dev counters on `window` so they can
// be read live in devtools:
//   window.__pulseStats()        → { linkReasons, pathFails, origins,
//                                    recallOutcomes, rescues, ringEvicted,
//                                    blocks*, firedRatePct, recalledRatePct }
//   window.__pulseStatsReset()   → zero the pulse counters for a clean observation
//   window.__fabricStats()       → { diffCalls, recentDiffs, frames, fullWalkReasons,
//                                    animating*, bridge, topology }
//                                  — `bridge` is the bridge layer's own churn
//                                    (selections skipped/run, strokes moved,
//                                    uploads); `topology` is the worker
//                                    pipeline every build came through
//                                    (patched vs whole applies, chain breaks:
//                                    `unchainedApplies`, `staleResends`,
//                                    fallbacks)
//   window.__fabricStatsReset()  → zero the fabric-churn counters (bridge and
//                                  topology included)
//   window.__blockFrameStats()   → { count, bridgeCount, recent, max } — per
//                                  landed topology build, the wall time of the
//                                  worker LANDING task (`landingMs`), of the
//                                  BRIDGE commit that followed it
//                                  (`bridgeMs`), and of the rAF interval that
//                                  contained the landing (`frameGapMs`), as a
//                                  ring of the last 32 with running maxima.
//                                  Reset, wait out 30 blocks, and read `max`:
//                                  that is the block frame, task by task.
//   window.__blockFrameStatsReset() → zero the block-frame gauges
//   window.__uploadStats()       → { lanes: { fabric, bridge, cells }, bytes,
//                                    commits } — bytes flagged for
//                                    bufferSubData by lane (Σ, last, max)
//   window.__uploadStatsReset()  → zero the upload ledger
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
//   window.__colonyStats()       → { topologyBuilds, scaffoldHits, scaffoldMisses,
//                                    floods, edgeGeometryBuilds, courierSchedules,
//                                    deliveryPlans } — how often the colony
//                                    REBUILT, and how much each rebuild
//                                    dragged with it. Reset, wait out a few
//                                    peer polls and blocks, and read.
//   window.__colonyStatsReset()  → zero the colony rebuild counters
//   window.__cellPickStats()     → { raycasts, suspendedSkips, reuses, rebuilds,
//                                    rebuildReasons, padRefreshes, hits } — the
//                                    Cell picker's index rebuilds and which
//                                    gate tripped each one. Reset, sweep the
//                                    pointer or drag the camera, and read.
//   window.__cellPickStatsReset() → zero the picker counters
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
  snapshotBlockFrameStats,
  resetBlockFrameStats,
  snapshotGpuUploads,
  resetGpuUploads,
  snapshotProducerOriginStats,
  resetProducerOriginStats,
  snapshotColonyStats,
  resetColonyStats,
  snapshotCellPickStats,
  resetCellPickStats,
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
    __blockFrameStats?: typeof snapshotBlockFrameStats;
    __blockFrameStatsReset?: typeof resetBlockFrameStats;
    __uploadStats?: typeof snapshotGpuUploads;
    __uploadStatsReset?: typeof resetGpuUploads;
    __qualityStats?: typeof getQualityRuntimeSnapshot;
    __producerOriginStats?: typeof snapshotProducerOriginStats;
    __producerOriginStatsReset?: typeof resetProducerOriginStats;
    __colonyStats?: typeof snapshotColonyStats;
    __colonyStatsReset?: typeof resetColonyStats;
    __cellPickStats?: typeof snapshotCellPickStats;
    __cellPickStatsReset?: typeof resetCellPickStats;
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
  window.__blockFrameStats = snapshotBlockFrameStats;
  window.__blockFrameStatsReset = resetBlockFrameStats;
  window.__uploadStats = snapshotGpuUploads;
  window.__uploadStatsReset = resetGpuUploads;
  window.__qualityStats = getQualityRuntimeSnapshot;
  window.__producerOriginStats = snapshotProducerOriginStats;
  window.__producerOriginStatsReset = resetProducerOriginStats;
  window.__colonyStats = snapshotColonyStats;
  window.__colonyStatsReset = resetColonyStats;
  window.__cellPickStats = snapshotCellPickStats;
  window.__cellPickStatsReset = resetCellPickStats;
  window.__renderPerformanceStats = snapshotPerformanceProbe;
  window.__renderPerformanceStatsJson = exportPerformanceProbeJson;
  window.__renderPerformanceStatsReset = resetPerformanceProbe;
}

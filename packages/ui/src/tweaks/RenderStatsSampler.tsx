import { useEffect, useRef } from 'react';
import { useSyncExternalStore } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import {
  computeRuntimeStats, getStatsDemand, setStats, subscribeStatsDemand,
} from './renderStatsStore';
import {
  PERFORMANCE_PROBE_LABELS,
  observePerformanceProbeSample,
  retainPerformanceProbe,
} from './performanceProbeStore';
import {
  attachGpuTimerQueryContext,
  pollGpuTimerQueries,
} from './gpuTimerQuery';
import { gpuUploadedBytes } from './gpuUploadLedger';

const UPDATE_INTERVAL_MS = 250;

export interface RenderStatsSamplerProps {
  /** Enable sampling independently of panel demand. Intended for deterministic
   *  review/performance routes; ordinary dashboards sample while GL·08 is mounted. */
  forceEnabled?: boolean;
}

/** Samples gl.info every 250ms into the render-stats store while a reader
 *  demands it — the GL·08 panel retains a demand for exactly its lifetime —
 *  or while a review route explicitly forces it.
 *  Mount once inside <Canvas>. Off by default:
 *  useFrame early-returns and gl.info.autoReset is left at R3F's default, so
 *  it costs nothing and mutates no renderer state until enabled. Uses raw
 *  useFrame (not useSimFrame) — perf must ignore pause/time-scale. */
export default function RenderStatsSampler({ forceEnabled = false }: RenderStatsSamplerProps): null {
  const demanded = useSyncExternalStore(subscribeStatsDemand, getStatsDemand, getStatsDemand);
  const enabled = forceEnabled || demanded;
  const gl = useThree((s) => s.gl);
  const frames = useRef(0);
  const lastAt = useRef(0);
  const previousFrameAt = useRef(0);
  /** Ledger reading at the start of the current sampling window. */
  const uploadedAtWindowStart = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    const releasePerformanceProbe = retainPerformanceProbe();
    const detachGpuTimer = attachGpuTimerQueryContext(gl.getContext());
    // Accumulate render counters across the frame's multiple passes; we reset
    // manually each sample. Restore the prior mode + disarm the window (lastAt=0)
    // when toggled off/unmounted, so the next enable re-arms via the guard below.
    const prev = gl.info.autoReset;
    gl.info.autoReset = false;
    return () => {
      // Detach while the retain is still live so the final availability state
      // is observable in an export captured immediately after panel close.
      detachGpuTimer();
      releasePerformanceProbe();
      gl.info.autoReset = prev;
      lastAt.current = 0;
      previousFrameAt.current = 0;
    };
  }, [enabled, gl]);

  useFrame(() => {
    if (!enabled) return;
    const now = performance.now();
    if (previousFrameAt.current !== 0) {
      observePerformanceProbeSample(
        'frame',
        PERFORMANCE_PROBE_LABELS.frameInterval,
        now - previousFrameAt.current,
      );
    }
    previousFrameAt.current = now;
    // Results are intentionally polled before this frame renders. Queries
    // completed by prior draws can resolve without synchronising this frame's
    // command stream; unavailable results stay queued for a later tick.
    pollGpuTimerQueries();
    // First tick after each (re)enable: arm the sampling window and skip. A
    // frame can beat the enable effect's flush; without this it would divide by
    // a bogus multi-second elapsed (lastAt still 0) and emit a garbage first
    // reading (fps ~ 0) that only self-heals after one interval.
    if (lastAt.current === 0) {
      lastAt.current = now;
      frames.current = 0;
      uploadedAtWindowStart.current = gpuUploadedBytes();
      return;
    }
    frames.current += 1;
    const elapsed = now - lastAt.current;
    if (elapsed < UPDATE_INTERVAL_MS) return;
    const uploaded = gpuUploadedBytes();
    setStats(computeRuntimeStats(
      frames.current,
      elapsed,
      gl.info,
      uploaded - uploadedAtWindowStart.current,
    ));
    gl.info.reset();
    frames.current = 0;
    lastAt.current = now;
    uploadedAtWindowStart.current = uploaded;
  });

  return null;
}

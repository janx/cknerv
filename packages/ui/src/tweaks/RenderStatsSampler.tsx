import { useEffect, useRef } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { useControls } from 'leva';
import { RENDER_STATS_TOGGLE, computeRuntimeStats, setStats } from './renderStatsStore';

const UPDATE_INTERVAL_MS = 250;

/** Samples gl.info every 250ms into the render-stats store WHEN the ` panel's
 *  "render stats" toggle is on. Mount once inside <Canvas>. Off by default:
 *  useFrame early-returns and gl.info.autoReset is left at R3F's default, so
 *  it costs nothing and mutates no renderer state until enabled. Uses raw
 *  useFrame (not useSimFrame) — perf must ignore pause/time-scale. */
export default function RenderStatsSampler(): null {
  const { renderStats } = useControls(RENDER_STATS_TOGGLE);
  const gl = useThree((s) => s.gl);
  const frames = useRef(0);
  const lastAt = useRef(0);

  useEffect(() => {
    if (!renderStats) return;
    // Accumulate render counters across the frame's multiple passes; we reset
    // manually each sample. Restore the prior mode + disarm the window (lastAt=0)
    // when toggled off/unmounted, so the next enable re-arms via the guard below.
    const prev = gl.info.autoReset;
    gl.info.autoReset = false;
    return () => { gl.info.autoReset = prev; lastAt.current = 0; };
  }, [renderStats, gl]);

  useFrame(() => {
    if (!renderStats) return;
    const now = performance.now();
    // First tick after each (re)enable: arm the sampling window and skip. A
    // frame can beat the enable effect's flush; without this it would divide by
    // a bogus multi-second elapsed (lastAt still 0) and emit a garbage first
    // reading (fps ~ 0) that only self-heals after one interval.
    if (lastAt.current === 0) { lastAt.current = now; frames.current = 0; return; }
    frames.current += 1;
    const elapsed = now - lastAt.current;
    if (elapsed < UPDATE_INTERVAL_MS) return;
    setStats(computeRuntimeStats(frames.current, elapsed, gl.info));
    gl.info.reset();
    frames.current = 0;
    lastAt.current = now;
  });

  return null;
}

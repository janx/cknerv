import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useControls } from 'leva';
import {
  QUALITY_MODE_CONTROL,
  getQualityRuntimeSnapshot,
  setAdaptiveQuality,
  setAdaptiveQualityLocked,
  setQualityMode,
  type QualityMode,
} from './qualityPresets';
import {
  ADAPTIVE_SAMPLE_WINDOW_MS,
  advanceAdaptiveQuality,
  createAdaptiveQualityState,
} from './adaptiveQuality';

const MAX_VALID_WINDOW_MS = ADAPTIVE_SAMPLE_WINDOW_MS * 4;

export interface AdaptiveQualityControllerProps {
  /** True while historical hydration/replay is in flight (cells backfill).
   * Replay is not renderer evidence — same rule as hidden tabs: frames
   * rendered under a catch-up storm say nothing about steady capability,
   * and counting them locks weak-looking boots into a lower tier. */
  hydrationActiveRef?: { readonly current: boolean };
}

/** Frame-time controller for the page's first seconds. It samples window
 * averages, never gl.info, and runs on raw render time so pause/time-scale
 * cannot disguise performance. Quality is measured once at the door: the state
 * machine locks after calibration and the sampler goes silent for the rest of
 * the page's life. React state changes only when the preset or the lock does. */
export default function AdaptiveQualityController({
  hydrationActiveRef,
}: AdaptiveQualityControllerProps = {}): null {
  const { quality } = useControls('Time', QUALITY_MODE_CONTROL);
  const mode = quality as QualityMode;
  const adaptiveState = useRef(createAdaptiveQualityState());
  const frames = useRef(0);
  const lastAt = useRef(0);
  const hydrationSeen = useRef(false);

  // Changing the Leva mode is a deliberate user act, so auto -> manual -> auto
  // starts a fresh calibration exactly as reopening the page would. This is
  // the ONLY way back into sampling once the tier is locked.
  useEffect(() => {
    setQualityMode(mode);
    adaptiveState.current = createAdaptiveQualityState(
      getQualityRuntimeSnapshot().effective,
    );
    frames.current = 0;
    lastAt.current = 0;
  }, [mode]);

  useFrame(() => {
    if (mode !== 'auto') return;
    // Calibration is over, so the sampler owes this page nothing further —
    // not even a clock read. Everything below (including the hydration
    // restart) is therefore unreachable after the lock: a late replay or lag
    // storm cannot reopen calibration, by directive the tier is fixed until
    // the next reload.
    if (adaptiveState.current.locked) return;
    if (typeof document !== 'undefined' && document.hidden) {
      frames.current = 0;
      lastAt.current = 0;
      return;
    }
    if (hydrationActiveRef?.current) {
      hydrationSeen.current = true;
      frames.current = 0;
      lastAt.current = 0;
      return;
    }
    if (hydrationSeen.current) {
      // Replay just finished: restart with a fresh warmup so the settle
      // frames right after hydration do not count as evidence either.
      hydrationSeen.current = false;
      adaptiveState.current = createAdaptiveQualityState(
        getQualityRuntimeSnapshot().effective,
      );
      frames.current = 0;
      lastAt.current = 0;
      return;
    }

    const now = performance.now();
    if (lastAt.current === 0) {
      lastAt.current = now;
      frames.current = 0;
      return;
    }
    frames.current += 1;
    const elapsedMs = now - lastAt.current;
    if (elapsedMs < ADAPTIVE_SAMPLE_WINDOW_MS) return;

    // Background throttling / debugger pauses are not renderer performance.
    if (elapsedMs > MAX_VALID_WINDOW_MS) {
      frames.current = 0;
      lastAt.current = now;
      return;
    }

    const averageFrameMs = elapsedMs / Math.max(1, frames.current);
    const previous = adaptiveState.current;
    const next = advanceAdaptiveQuality(previous, averageFrameMs, elapsedMs);
    adaptiveState.current = next;
    if (next.quality !== previous.quality) setAdaptiveQuality(next.quality);
    if (next.locked !== previous.locked) setAdaptiveQualityLocked(next.locked);
    frames.current = 0;
    lastAt.current = now;
  });

  return null;
}

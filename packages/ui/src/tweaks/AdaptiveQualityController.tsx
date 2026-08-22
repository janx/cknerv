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
  restartAdaptiveQualityState,
} from './adaptiveQuality';

const MAX_VALID_WINDOW_MS = ADAPTIVE_SAMPLE_WINDOW_MS * 4;

export interface AdaptiveQualityControllerProps {
  /** True while historical hydration/replay is in flight (cells backfill).
   * Replay is not renderer evidence — same rule as hidden tabs: frames
   * rendered under a catch-up storm say nothing about steady capability,
   * and counting them locks weak-looking boots into a lower tier. */
  hydrationActiveRef?: { readonly current: boolean };
}

/** Frame-time controller for the page's whole life. It samples window
 * averages, never gl.info, and runs on raw render time so pause/time-scale
 * cannot disguise performance. The opening seconds calibrate a ceiling, and the
 * lock ends calibration but not sampling: the tier a cold GPU carries is not
 * the tier it carries once the silicon is hot, so the sampler keeps listening
 * for the one move still open to it, which is downward. The cost of listening
 * is a clock read per frame. React state changes only when the preset or the
 * lock does. */
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
  // the ONLY way a page gets its ceiling back: nothing the sampler measures
  // can raise a tier.
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
    // Both rejections below outlive the lock, because the sampler does: a
    // hidden tab's frames and a replay storm's frames are not renderer
    // evidence at minute forty either, and a downshift bought with them would
    // be as wrong as a locked-in tier bought with them.
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
      // frames right after hydration do not count as evidence either. The
      // restart drops evidence, never the lock — a late replay must not hand
      // a settled page a ceiling it has already been measured out of.
      hydrationSeen.current = false;
      adaptiveState.current = restartAdaptiveQualityState(
        adaptiveState.current,
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

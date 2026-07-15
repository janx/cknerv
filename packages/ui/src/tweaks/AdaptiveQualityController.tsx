import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useControls } from 'leva';
import {
  QUALITY_MODE_CONTROL,
  getQualityRuntimeSnapshot,
  setAdaptiveQuality,
  setQualityMode,
  type QualityMode,
} from './qualityPresets';
import {
  ADAPTIVE_SAMPLE_WINDOW_MS,
  advanceAdaptiveQuality,
  createAdaptiveQualityState,
} from './adaptiveQuality';

const MAX_VALID_WINDOW_MS = ADAPTIVE_SAMPLE_WINDOW_MS * 4;

/** Always-on, low-overhead frame-time controller. It samples window averages,
 * never gl.info, and runs on raw render time so pause/time-scale cannot disguise
 * performance. React state changes only when the effective preset changes. */
export default function AdaptiveQualityController(): null {
  const { quality } = useControls('Time', QUALITY_MODE_CONTROL);
  const mode = quality as QualityMode;
  const adaptiveState = useRef(createAdaptiveQualityState());
  const frames = useRef(0);
  const lastAt = useRef(0);

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
    if (typeof document !== 'undefined' && document.hidden) {
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
    frames.current = 0;
    lastAt.current = now;
  });

  return null;
}

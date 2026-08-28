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
  /** True for frames inside a MOTION WINDOW: a pointer gesture is held
   * (`start` to `end`), the camera moved during the last settled frame (a
   * drag, or the damping tail OrbitControls runs after a release), or a
   * route-camera flight owns the camera. Such frames are transient by
   * construction — a moving camera re-projects the field, rebuilds LOD and
   * hit indexes, and ends when the hand or the flight does — so they say
   * nothing about the steady state the tier is chosen for. Measured
   * 2026-08-28: a 4 s orbit drag at 35 fps, counted, stepped a settled page
   * MED -> LOW and the page stayed there. Same rule as hydration and the
   * hidden tab: not renderer evidence, in calibration or after the lock. */
  motionActiveRef?: { readonly current: boolean };
}

/** Frame-time controller for the page's whole life. It samples window
 * averages, never gl.info, and runs on raw render time so pause/time-scale
 * cannot disguise performance. The opening seconds calibrate a ceiling, and the
 * lock ends calibration but not sampling: the tier a cold GPU carries is not
 * the tier it carries once the silicon is hot, so the sampler keeps listening
 * for the one move still open to it, which is downward. The cost of listening
 * is a clock read per frame. React state changes only when the preset or the
 * lock does.
 *
 * Three kinds of frame are never evidence, in either phase: a hidden tab's,
 * a replay storm's, and a motion window's (`motionActiveRef`). All three take
 * the same exit — the partial sample window is dropped and the next admitted
 * frame primes a fresh one — and only replay adds a restart on top, because
 * only replay leaves the seconds after it untrustworthy. */
export default function AdaptiveQualityController({
  hydrationActiveRef,
  motionActiveRef,
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
    // Every rejection below outlives the lock, because the sampler does: a
    // hidden tab's frames, a replay storm's frames and a drag's frames are
    // not renderer evidence at minute forty either, and a downshift bought
    // with them would be as wrong as a locked-in tier bought with them.
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
    if (motionActiveRef?.current) {
      // A motion window. The same exit as a hidden tab: the partial window
      // is dropped — the frames before the motion with it — and the first
      // at-rest frame primes a fresh one, so no interval that touches motion
      // is ever averaged. Deliberately NOT the hydration restart: a re-armed
      // warmup zeroes stability and evidence, and drags are frequent where
      // replay storms are rare — a hand on the camera every few seconds
      // would never let calibration lock, and after the lock would shield a
      // tier the machine cannot carry for as long as the hand kept moving.
      // Dropping the window costs the sampler nothing it has learned.
      //
      // No settle constant, on purpose. The sentinel that writes this ref
      // runs after this callback in the same frame, so the verdict read here
      // is the previous frame's: the first at-rest frame still reads as
      // motion and is dropped, the second only primes, and the first interval
      // averaged runs from the second at-rest frame to the third — two frames
      // of pipeline drain absorbed structurally. Beyond that the 1.5 s EMA
      // and the 5-12 s holds with 2x decay make a single slow frame invisible
      // (one 30 ms frame moves a 45-frame window's mean by 0.3 ms). Checked
      // after the hydration branches above so a replay that ends mid-drag
      // still takes its restart on the first frame after it.
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

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
  ADAPTIVE_STALL_FRAME_MS,
  advanceAdaptiveQuality,
  createAdaptiveQualityState,
  restartAdaptiveQualityState,
} from './adaptiveQuality';

const MAX_VALID_WINDOW_MS = ADAPTIVE_SAMPLE_WINDOW_MS * 4;

/** How many windows `window.__cknervQualitySamples` keeps. Twenty minutes of
 *  them at the sampler's own cadence — enough to read a whole calibration and
 *  the hour after it, small enough that nobody has to remember to turn it off. */
const QUALITY_SAMPLE_RING = 1600;

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
  /** True for frames inside a POST-BLOCK WINDOW: ~1.5 s after a block landed
   * (the cells cache's `lastPulseAtMs` advanced). A block's arrival runs a
   * main-thread burst — the pulse reducer, the colony reflow, the delivery and
   * courier layers arming their waves — that stretches a handful of rAF
   * intervals the sampler would otherwise read as slowness. But the tier
   * cascade only lowers GPU cost, so a step bought with a main-thread burst
   * buys nothing: the next block costs the machine exactly the same. Same rule
   * as a motion window and a hidden tab — not renderer evidence, in
   * calibration or after the lock. Settled once per frame by App from
   * `lastPulseAtMs`, exactly as `motionActiveRef` is by `CameraMotionSentinel`. */
  recentBlockActiveRef?: { readonly current: boolean };
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
 * Four kinds of frame are never evidence, in either phase: a hidden tab's, a
 * replay storm's, a motion window's (`motionActiveRef`) and a post-block
 * window's (`recentBlockActiveRef`). All four take the same exit — the partial
 * sample window is dropped and the next admitted frame primes a fresh one —
 * and only replay adds a restart on top, because only replay leaves the
 * seconds after it untrustworthy. */
export default function AdaptiveQualityController({
  hydrationActiveRef,
  motionActiveRef,
  recentBlockActiveRef,
}: AdaptiveQualityControllerProps = {}): null {
  const { quality } = useControls('Time', QUALITY_MODE_CONTROL);
  const mode = quality as QualityMode;
  const adaptiveState = useRef(createAdaptiveQualityState());
  const frames = useRef(0);
  const lastAt = useRef(0);
  /** The window's own longest frame, so one stall cannot hide inside a mean. */
  const lastFrameAt = useRef(0);
  const maxFrameMs = useRef(0);
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
    maxFrameMs.current = 0;
  }, [mode]);

  useFrame(() => {
    if (mode !== 'auto') return;
    // Every rejection below outlives the lock, because the sampler does: a
    // hidden tab's frames, a replay storm's frames and a drag's frames are
    // not renderer evidence at minute forty either, and a downshift bought
    // with them would be as wrong as a locked-in tier bought with them.
    // ⚠️ AND THIS IS WHY A HEADLESS CAPTURE USUALLY MEASURES NOTHING HERE. A
    // CDP-created target reports `document.hidden === true` unless the driver
    // turns on focus emulation, so the sampler drops every window and the tier
    // cannot move — a capture that wants to observe AUTO has to make the page
    // visible first. The rule itself is right: a tab nobody is looking at is
    // not evidence about a renderer.
    if (typeof document !== 'undefined' && document.hidden) {
      frames.current = 0;
      lastAt.current = 0;
      maxFrameMs.current = 0;
      return;
    }
    if (hydrationActiveRef?.current) {
      hydrationSeen.current = true;
      frames.current = 0;
      lastAt.current = 0;
      maxFrameMs.current = 0;
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
      maxFrameMs.current = 0;
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
      maxFrameMs.current = 0;
      return;
    }
    if (recentBlockActiveRef?.current) {
      // A post-block window. Dropped exactly as a motion window is: the partial
      // sample is discarded — the frames before the block with it — and the
      // first frame past the window primes a fresh one, so no interval that
      // touches a block's main-thread burst is ever averaged. The cascade only
      // lowers GPU cost and a block's cost is on the main thread, so a step
      // bought here would buy nothing and the next block would pay it again.
      // Checked after the hydration branches for the same reason motion is: a
      // replay that ends as a block lands still takes its restart first. Like
      // motion it needs no settle constant of its own — App's sentinel writes
      // this ref after this callback, so the verdict read here is last frame's
      // and the ~1.5 s window already absorbs the one-frame lag.
      frames.current = 0;
      lastAt.current = 0;
      maxFrameMs.current = 0;
      return;
    }

    const now = performance.now();
    if (lastAt.current === 0) {
      lastAt.current = now;
      lastFrameAt.current = now;
      frames.current = 0;
      maxFrameMs.current = 0;
      return;
    }
    frames.current += 1;
    maxFrameMs.current = Math.max(maxFrameMs.current, now - lastFrameAt.current);
    lastFrameAt.current = now;
    const elapsedMs = now - lastAt.current;
    if (elapsedMs < ADAPTIVE_SAMPLE_WINDOW_MS) return;

    // Background throttling / debugger pauses are not renderer performance.
    if (elapsedMs > MAX_VALID_WINDOW_MS) {
      frames.current = 0;
      lastAt.current = now;
      maxFrameMs.current = 0;
      return;
    }

    // ——— A STALL IS NOT A SLOW FRAME ————————————————————————————————
    //
    // The controller acts on a window MEAN, and a mean cannot tell a machine
    // running at 40 fps from one running at 60 fps with a single half-second
    // stop in it. Both read ~25 ms, both clear `high`'s 22 ms deadband, and
    // only one of them is evidence. Measured in headless (E7): the AUTO
    // controller stepped `high` → `med` on a page whose frames were 16.7 ms
    // throughout, because a screenshot, a shader compile and a worker
    // delivery each parked the raf loop for hundreds of milliseconds and the
    // mean carried it.
    //
    // The window cap above (`MAX_VALID_WINDOW_MS`) only catches a stall long
    // enough to stretch the whole window past 3 s; anything shorter is
    // smeared across sixty frames and becomes indistinguishable from real
    // slowness. So the window remembers its LONGEST frame and drops itself
    // when that frame is plainly not a frame — the same exit a hidden tab, a
    // replay storm and a motion window take, for the same reason: it is not
    // renderer evidence.
    //
    // ⚠️ Read `ADAPTIVE_STALL_FRAME_MS` before believing this explains a tier
    // step you are looking at. Measured in headless: it fired ZERO times in
    // 117 windows, and the page stepped down anyway on windows that honestly
    // meant 25–49 ms.
    const stalled = maxFrameMs.current > ADAPTIVE_STALL_FRAME_MS;
    const averageFrameMs = elapsedMs / Math.max(1, frames.current);
    // The dev counter, on the `__pulseStats()` precedent: what the controller
    // was actually handed, so a live session can be read rather than guessed
    // at. It never affects a number the HUD prints.
    if (typeof window !== 'undefined') {
      const ring = ((window as unknown as Record<string, unknown>)
        .__cknervQualitySamples ??= []) as unknown[];
      ring.push({
        atMs: Math.round(now),
        windowMs: Math.round(elapsedMs),
        frames: frames.current,
        meanFrameMs: Number(averageFrameMs.toFixed(2)),
        maxFrameMs: Number(maxFrameMs.current.toFixed(1)),
        stalled,
        quality: adaptiveState.current.quality,
        smoothedFrameMs: Number(adaptiveState.current.smoothedFrameMs.toFixed(2)),
        slowEvidenceMs: Math.round(adaptiveState.current.slowEvidenceMs),
        locked: adaptiveState.current.locked,
      });
      if (ring.length > QUALITY_SAMPLE_RING) ring.shift();
    }
    if (stalled) {
      frames.current = 0;
      lastAt.current = now;
      maxFrameMs.current = 0;
      return;
    }
    const previous = adaptiveState.current;
    const next = advanceAdaptiveQuality(previous, averageFrameMs, elapsedMs);
    adaptiveState.current = next;
    if (next.quality !== previous.quality) setAdaptiveQuality(next.quality);
    if (next.locked !== previous.locked) setAdaptiveQualityLocked(next.locked);
    frames.current = 0;
    lastAt.current = now;
    maxFrameMs.current = 0;
  });

  return null;
}

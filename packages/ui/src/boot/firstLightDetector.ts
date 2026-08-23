/**
 * "The galaxy is on screen" — decided from frame deltas alone.
 *
 * The renderer has no event for this. A GL context exists long before the
 * first useful picture: the two dozen shader programs behind the galaxy
 * compile and link on the first frames that draw them, and that shows up as
 * one long frame, not as an error. So first light is measured the way the
 * visitor experiences it — the loop running steadily with something staged —
 * and a single stutter inside the run disqualifies it, because a boot that
 * flashed one frame and froze has not lit anything.
 *
 * Deltas in, latch out: no clock is read here and nothing is stored outside
 * the returned object, which is what lets the rule be tested without a
 * renderer (R3F frame callbacks cannot run in jsdom).
 */

/** 25 fps. Above this a frame is the compile/upload stutter this phase is
 *  waiting out, not the steady loop it is waiting for. */
export const FIRST_LIGHT_MAX_FRAME_SECONDS = 0.04;

/** Consecutive steady frames that count as lit — a sixth of a second at the
 *  threshold, short enough to be honest and long enough that the one fast
 *  frame between two stalls cannot claim it. */
export const FIRST_LIGHT_STEADY_FRAMES = 10;

export interface FirstLightDetector {
  /** Feed one rendered frame. Returns the latched state, so the first `true`
   *  is the frame first light happened on. */
  frame(deltaSeconds: number, populated: boolean): boolean;
  /** Latched once true — a later stall is the quality controller's business,
   *  not a boot that un-happens. */
  readonly lit: boolean;
}

export function createFirstLightDetector(): FirstLightDetector {
  let steadyRun = 0;
  let lit = false;
  return {
    get lit(): boolean {
      return lit;
    },
    frame(deltaSeconds: number, populated: boolean): boolean {
      if (lit) return true;
      // Written as "not fast enough" rather than "too slow" so a NaN delta —
      // a paused or reset clock — breaks the run instead of passing it.
      if (!populated || !(deltaSeconds < FIRST_LIGHT_MAX_FRAME_SECONDS)) {
        steadyRun = 0;
        return false;
      }
      steadyRun += 1;
      if (steadyRun < FIRST_LIGHT_STEADY_FRAMES) return false;
      lit = true;
      return true;
    },
  };
}

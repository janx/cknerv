import { useFrame } from '@react-three/fiber';
import type { RootState } from '@react-three/fiber';
import { useSimClockScope } from './SimClockScope';
import { productionTimeControls } from './timeControls';

/** A `useFrame` wrapper that:
 *   - Skips the callback entirely when paused or `timeScale === 0`.
 *   - Forwards the scoped ticker's exact bounded delta when one exists.
 *   - Otherwise forwards production `rawDelta * timeScale` unchanged.
 *  Time knobs are read from the SimClockTicker-published snapshot inside the
 *  frame callback — consumers hold no leva subscription of their own, so a
 *  knob drag re-renders the ticker, not every animated component.
 *  Use this for any animation whose progress should respect time controls.
 *  Do NOT use for input/UI behaviour (camera damping, billboarding, perf
 *  measurement) — those keep raw `useFrame`. */
export function useSimFrame(
  cb: (state: RootState, simDelta: number) => void,
): void {
  const scope = useSimClockScope();
  useFrame((state, rawDelta) => {
    if (scope) {
      if (scope.paused) return;
      cb(state, scope.frameDeltaSecRef.current ?? 0);
      return;
    }
    const effective = productionTimeControls.paused
      ? 0
      : productionTimeControls.timeScale;
    if (effective === 0) return;
    cb(state, rawDelta * effective);
  });
}

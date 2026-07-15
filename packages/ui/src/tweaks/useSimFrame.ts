import { useFrame } from '@react-three/fiber';
import type { RootState } from '@react-three/fiber';
import { useControls } from 'leva';
import { useSimClockScope } from './SimClockScope';

/** A `useFrame` wrapper that:
 *   - Skips the callback entirely when paused or `timeScale === 0`.
 *   - Forwards the scoped ticker's exact bounded delta when one exists.
 *   - Otherwise forwards production `rawDelta * timeScale` unchanged.
 *  Use this for any animation whose progress should respect time controls.
 *  Do NOT use for input/UI behaviour (camera damping, billboarding, perf
 *  measurement) — those keep raw `useFrame`. */
export function useSimFrame(
  cb: (state: RootState, simDelta: number) => void,
): void {
  const scope = useSimClockScope();
  const { paused, timeScale } = useControls('Time', {
    paused: { value: false },
    timeScale: {
      value: 1,
      options: [1, 0.5, 0.25] as const,
      label: 'time scale',
    },
  });
  useFrame((state, rawDelta) => {
    if (scope) {
      if (scope.paused) return;
      cb(state, scope.frameDeltaSecRef.current ?? 0);
      return;
    }
    const effective = paused ? 0 : timeScale;
    if (effective === 0) return;
    cb(state, rawDelta * effective);
  });
}

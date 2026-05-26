import { useFrame } from '@react-three/fiber';
import type { RootState } from '@react-three/fiber';
import { useControls } from 'leva';

/** A `useFrame` wrapper that:
 *   - Skips the callback entirely when paused or `timeScale === 0`.
 *   - Forwards `rawDelta * timeScale` as the second arg to the callback.
 *  Use this for any animation whose progress should respect time controls.
 *  Do NOT use for input/UI behaviour (camera damping, billboarding, perf
 *  measurement) — those keep raw `useFrame`. */
export function useSimFrame(
  cb: (state: RootState, simDelta: number) => void,
): void {
  const { paused, timeScale } = useControls('Time', {
    paused: { value: false },
    timeScale: {
      value: 1,
      options: [1, 0.5, 0.25] as const,
      label: 'time scale',
    },
  });
  useFrame((state, rawDelta) => {
    const effective = paused ? 0 : timeScale;
    if (effective === 0) return;
    cb(state, rawDelta * effective);
  });
}

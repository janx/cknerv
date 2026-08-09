import { useFrame } from '@react-three/fiber';
import { useControls } from 'leva';
import { tickSimClock } from './simClock';
import { useSimClockScope } from './SimClockScope';
import { productionTimeControls } from './timeControls';

/** Advance the nearest scoped clock, or the production singleton when no
 * scope exists. The negative priority publishes the exact bounded delta before
 * ordinary useSimFrame consumers run. Production still honors Leva Time.
 * This is also the ONE Time-knob subscriber: it registers the panel folder and
 * write-through publishes the snapshot every useSimFrame consumer reads. */
export default function SimClockTicker(): null {
  const scope = useSimClockScope();
  const { paused, timeScale } = useControls('Time', {
    paused: { value: false },
    timeScale: { value: 1, options: [1, 0.5, 0.25] as const, label: 'time scale' },
  });
  productionTimeControls.paused = paused;
  productionTimeControls.timeScale = timeScale;
  useFrame((_, rawDelta) => {
    if (scope) {
      const delta = scope.fixedDeltaSec ?? rawDelta;
      scope.frameDeltaSecRef.current = tickSimClock(
        delta,
        scope.paused ? 0 : scope.timeScale,
        scope.clock,
        scope.maxElapsedSec,
      );
      return;
    }
    tickSimClock(rawDelta, paused ? 0 : timeScale);
  }, -1000);
  return null;
}

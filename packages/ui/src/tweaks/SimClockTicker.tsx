import { useFrame } from '@react-three/fiber';
import { useControls } from 'leva';
import { tickSimClock } from './simClock';

/** Advances the module-level simClock once per frame, honoring the leva
 *  "Time" controls (paused / timeScale). Mount exactly once inside the
 *  <Canvas>. Reads the SAME leva folder+keys as useSimFrame (leva dedupes),
 *  so the two stay in lockstep. Returns null (no visual output). */
export default function SimClockTicker(): null {
  const { paused, timeScale } = useControls('Time', {
    paused: { value: false },
    timeScale: { value: 1, options: [1, 0.5, 0.25] as const, label: 'time scale' },
  });
  useFrame((_, rawDelta) => {
    tickSimClock(rawDelta, paused ? 0 : timeScale);
  });
  return null;
}

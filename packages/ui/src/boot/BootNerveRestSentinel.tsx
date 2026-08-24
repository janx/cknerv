import { useSimClock } from '../tweaks/SimClockScope';
import { useSimFrame } from '../tweaks/useSimFrame';
import { bootNerveRestDone, tickBootNerveRest } from './nerveRestGate';

/**
 * Ticks the nerve-rest gate once per sim frame, closing the boot record's
 * `fabric` line when the nerve tiers are at rest on screen.
 *
 * Lives beside `BootFrameSentinel` under the r3f context, mounted exactly
 * once, drawing nothing. It runs on `useSimFrame` deliberately: the growth it
 * waits out is drawn as a function of the sim clock, so a paused clock must
 * hold the gate exactly as it holds the pixels — a wall-clock timer here
 * would let the readout finish an animation that never played.
 */
export default function BootNerveRestSentinel(): null {
  const simClock = useSimClock();
  useSimFrame(() => {
    // Inert for the rest of the session after the line closes; the phase is
    // terminal in the record too, so nothing downstream re-reads this.
    if (bootNerveRestDone()) return;
    tickBootNerveRest(simClock.elapsedSec);
  });
  return null;
}

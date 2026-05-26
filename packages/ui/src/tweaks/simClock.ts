/** Module-level mutable singleton holding the simulator's logical clock.
 *  Components read `simClock.elapsedSec` directly inside their `useFrame` /
 *  `useSimFrame` body — no React state, no re-render, just a ref read.
 *  The clock is advanced once per frame by `<SimClockTicker />`, which
 *  reads `paused` and `timeScale` from the leva store and calls
 *  `tickSimClock(rawDelta, effectiveScale)`. */
export const simClock = {
  elapsedSec: 0,
};

/** Advance the sim clock by `rawDelta * timeScale` seconds. When called
 *  with `timeScale = 0` (i.e. paused), this is a no-op and `elapsedSec`
 *  stays put — exactly the freeze semantics we want. */
export function tickSimClock(rawDeltaSec: number, timeScale: number): void {
  if (timeScale === 0) return;
  simClock.elapsedSec += rawDeltaSec * timeScale;
}

/** Reset the clock to 0. Called by tests via beforeEach to isolate
 *  cases. The clock starts at 0 implicitly on module load; no
 *  per-mount reset is performed (Canvas remounts during quality
 *  changes intentionally preserve sim time). */
export function resetSimClock(): void {
  simClock.elapsedSec = 0;
}

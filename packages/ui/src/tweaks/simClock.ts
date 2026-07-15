export interface MutableSimClock {
  elapsedSec: number;
}

/** Create an isolated logical clock for review scenes and deterministic tests. */
export function createSimClock(initialS = 0): MutableSimClock {
  return { elapsedSec: initialS };
}

/** Default clock used by the production Canvas. Kept as a singleton so all
 * existing consumers retain their mount-independent timeline. */
export const simClock = createSimClock();

/** Advance the sim clock by `rawDelta * timeScale` seconds. When called
 *  with `timeScale = 0` (i.e. paused), this is a no-op and `elapsedSec`
 *  stays put — exactly the freeze semantics we want. */
export function tickSimClock(
  rawDeltaSec: number,
  timeScale: number,
  clock: MutableSimClock = simClock,
  maxElapsedSec: number | null = null,
): number {
  if (timeScale === 0) return 0;
  const previous = clock.elapsedSec;
  const next = previous + rawDeltaSec * timeScale;
  clock.elapsedSec = maxElapsedSec === null ? next : Math.min(next, maxElapsedSec);
  return clock.elapsedSec - previous;
}

/** Reset the clock to 0. Called by tests via beforeEach to isolate
 *  cases. The clock starts at 0 implicitly on module load; no
 *  per-mount reset is performed, so an incidental Canvas remount
 *  preserves simulation time. */
export function resetSimClock(
  clock: MutableSimClock = simClock,
  toS = 0,
): void {
  clock.elapsedSec = toS;
}

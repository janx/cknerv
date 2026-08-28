/** The landing-flash queue: the one channel through which a block landing
 *  reaches the Cell field's landing layer (`LandingFlashLayer`). The delivery
 *  layer pushes `(cellId, atSec, amp)` as it schedules each released front
 *  (`landingFlashSchedule`, peers.derive); the landing layer drains the queue
 *  on its next frame and resolves the Cell's position and presentation size
 *  from the cache THEN. Ids rather than positions cross the boundary on
 *  purpose: the writer stands outside the galaxy's rotating group and never
 *  needs to know the frame the flash is drawn in.
 *
 *  This is NOT `cellFlashRef`. That map drives `aFlashAt` on the shared Cell
 *  geometry — the protocol write seal — and a landing is not a write. A
 *  landing flashes plainly, on its own geometry, through this queue only.
 *
 *  Three parallel arrays instead of an array of objects: a pulse pushes up to
 *  a few hundred entries and the drain reads them positionally, so nothing is
 *  allocated per landing and `clear()` keeps the backing stores. */
export interface LandingFlashQueue {
  /** Pending Cell ids, in push order. */
  readonly ids: readonly number[];
  /** Sim seconds at which each pending flash begins (parallel to `ids`). */
  readonly ats: readonly number[];
  /** Amplitude of each pending flash in [0, 1] (parallel to `ids`). */
  readonly amps: readonly number[];
  /** Queue one flash. `amp` defaults to a full flash. */
  push(cellId: number, atSec: number, amp?: number): void;
  /** Drop every pending entry (the drain, and a review reset). */
  clear(): void;
}

export function createLandingFlashQueue(): LandingFlashQueue {
  const ids: number[] = [];
  const ats: number[] = [];
  const amps: number[] = [];
  return {
    ids,
    ats,
    amps,
    push(cellId: number, atSec: number, amp = 1): void {
      ids.push(cellId);
      ats.push(atSec);
      amps.push(amp);
    },
    clear(): void {
      ids.length = 0;
      ats.length = 0;
      amps.length = 0;
    },
  };
}

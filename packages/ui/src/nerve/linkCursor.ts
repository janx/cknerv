// Pure cursor over the cells cache's `pulseLinks` ring: decides which new
// links should fire nerve pulses, and how far to advance the consumed-seq
// cursor. While a backfill/catch-up is active, links are consumed (cursor
// advances) but none fire — suppressing the storm AND preventing the whole
// window from replaying the instant the flag clears.

import type { CellLink } from '@cknerv/types';

export interface LinkCursorResult {
  /** Links to plan pulses for. Empty while `backfillActive`. */
  toFire: CellLink[];
  /** The advanced cursor — the max seq seen, never below `lastSeq`. */
  nextSeq: number;
  /** New links consumed-but-not-fired because `backfillActive` (dev metric). */
  suppressed: number;
}

export function advanceLinkCursor(
  pulseLinks: CellLink[],
  lastSeq: number,
  backfillActive: boolean,
): LinkCursorResult {
  let nextSeq = lastSeq;
  let suppressed = 0;
  const toFire: CellLink[] = [];
  for (const link of pulseLinks) {
    if (link.seq <= lastSeq) continue;
    if (link.seq > nextSeq) nextSeq = link.seq;
    if (backfillActive) suppressed += 1;
    else toFire.push(link);
  }
  return { toFire, nextSeq, suppressed };
}

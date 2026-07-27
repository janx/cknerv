import type { Cell } from '@cknerv/types';

/** Duration of the one-shot invalidated-record echo. It is intentionally
 * shorter than a normal inspection gesture: canonical correction should read
 * clearly, then yield to the replacement data rather than becoming ambience. */
export const CANONICAL_REWRITE_ECHO_DURATION_S = 1.45;

/** Stable shader phase derived from the real content identity. */
export function canonicalRewriteEchoSeed(contentHash: string): number {
  let hash = 2166136261;
  for (let i = 0; i < contentHash.length; i += 1) {
    hash ^= contentHash.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

/** Find records that became canonical while a suffix correction is active.
 *
 * The previous map is the last map actually written to the GPU. A record is a
 * replacement arrival when it is new in the rewritten suffix, when the same
 * numeric slot now carries another content identity, or when an older Cell
 * spent by the orphan suffix is restored to live state. */
export function deriveCanonicalRewriteArrivals(
  previous: ReadonlyMap<number, Cell> | null,
  current: ReadonlyMap<number, Cell>,
  fromBlock: number,
): number[] {
  if (!previous) return [];
  const arrivals: number[] = [];
  for (const cell of current.values()) {
    const before = previous.get(cell.id);
    if (!before) {
      if (cell.birth_block >= fromBlock) arrivals.push(cell.id);
      continue;
    }
    if (
      before.content_hash !== cell.content_hash
      || (before.death_at_ms !== null && cell.death_at_ms === null)
    ) {
      arrivals.push(cell.id);
    }
  }
  return arrivals;
}

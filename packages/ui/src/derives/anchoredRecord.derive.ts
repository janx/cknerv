import type { ChainAnchor, EnrichmentSourceStatus } from '@cknerv/types';

export type AnchoredRecordVisualState = 'ready' | 'stale';

/** What every whole-chain aggregate the semantics stream carries has in
 *  common: the source it came from, the block it is exact at, and the clock
 *  it was fetched on. */
export interface AnchoredRecord {
  source: string;
  as_of: ChainAnchor;
  updated_at_ms: number;
}

/**
 * Whether an indexed aggregate may be shown at all, and whether dimmed.
 *
 * One law for every anchored record, spelled once: the source has to be
 * usable, the record has to be the source's own, its anchor has to sit at or
 * under the anchor the source proved against the local node — a record from
 * a block the node has not vouched for is a record from nowhere — and it
 * dims once the source is stale or its own refresh is older than the panel's
 * patience. Absence, not a fallback, for every failure above: a panel that
 * cannot prove its number prints nothing sooner than a wrong one.
 */
export function anchoredRecordVisualState(
  source: EnrichmentSourceStatus,
  record: AnchoredRecord,
  staleAfterMs: number,
  nowMs = Date.now(),
): AnchoredRecordVisualState | null {
  if (source.status !== 'ready' && source.status !== 'stale') return null;
  if (source.source !== record.source) return null;
  const anchor = source.validated_anchor;
  if (!anchor || record.as_of.block > anchor.block) return null;
  if (record.as_of.block === anchor.block && record.as_of.hash !== anchor.hash) {
    return null;
  }
  if (!Number.isSafeInteger(record.updated_at_ms) || record.updated_at_ms < 0) {
    return null;
  }
  const ageMs = Math.max(0, nowMs - record.updated_at_ms);
  return source.status === 'stale' || ageMs > staleAfterMs ? 'stale' : 'ready';
}

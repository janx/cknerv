import type {
  AssetEcosystemRecord,
  EnrichmentSourceStatus,
} from '@cknerv/types';

export type AssetEcosystemVisualState = 'ready' | 'stale';

export const ASSET_ECOSYSTEM_STALE_AFTER_MS = 90_000;

// The record's `capacity_breakdown` still arrives on the wire, validated by the
// adapter, and nothing on the HUD draws it any more. The chain section's bar
// splits the census's Cell COUNT (`chainClassShares`), because the capacity
// split — DAO 14%, TOKENS 0.08%, OBJECTS 0.03%, OTHER 85% — sat under a Cell
// count and read as a Cell mix, which it is not: a token Cell holds close to
// the least a Cell can hold, a balance Cell some three hundred times that,
// and the shares said only which Cells hold the CKB.

/** Only expose a sample while its source still has a compatible anchor. */
export function assetEcosystemVisualState(
  source: EnrichmentSourceStatus,
  record: AssetEcosystemRecord,
  nowMs = Date.now(),
): AssetEcosystemVisualState | null {
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
  const sampleAgeMs = Math.max(0, nowMs - record.updated_at_ms);
  return source.status === 'stale' || sampleAgeMs > ASSET_ECOSYSTEM_STALE_AFTER_MS
    ? 'stale'
    : 'ready';
}

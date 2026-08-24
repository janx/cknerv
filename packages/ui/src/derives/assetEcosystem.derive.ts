import type {
  AssetEcosystemRecord,
  EnrichmentSourceStatus,
} from '@cknerv/types';
import {
  ASSET_COLORS,
  CLASS_MIX_COLORS,
  CONTENT_BANDS,
} from '../components/hud/cellFormat';

export type AssetEcosystemVisualState = 'ready' | 'stale';

export const ASSET_ECOSYSTEM_STALE_AFTER_MS = 90_000;

export interface AssetEcosystemBucketVisual {
  category: string;
  capacityShannons: string;
  shareBps: number;
  color: string;
}

/** The whole-chain capacity bar and the stage's class-mix bars are one reading
 *  split in two places, so they are one palette read from one table: the
 *  content bands in `cellFormat.ts`. Objects take the same violet a spore
 *  asset chip wears, because they are the same thing counted differently. */
export const ECOSYSTEM_CATEGORY_COLORS: Record<string, string> = {
  dao: CLASS_MIX_COLORS.dao,
  tokens: CLASS_MIX_COLORS.typed,
  objects: ASSET_COLORS.spore,
  other: CLASS_MIX_COLORS.plain,
};

/** A capacity bucket the source named and this table does not. It used to take
 *  `#69e7ff`, a bright cyan 247 away from where it belongs — so the ONE
 *  segment nobody could say anything about was the loudest thing in the bar,
 *  and a new upstream category arriving would announce itself as if it were
 *  the most important reading on the panel. The table above is read from the
 *  bands and always was; this branch was not, which is how a comment claiming
 *  the whole file reads one source could sit there and be three-quarters
 *  right. */
export const ECOSYSTEM_UNLISTED_COLOR = CONTENT_BANDS.unlisted;

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

/** Validate the exact integer/basis-point contract before drawing a bar. */
export function deriveAssetEcosystemBuckets(
  record: AssetEcosystemRecord,
): AssetEcosystemBucketVisual[] | null {
  if (!/^\d+$/.test(record.total_live_capacity_shannons)) return null;
  const total = BigInt(record.total_live_capacity_shannons);
  if (total <= 0n || record.capacity_breakdown.length > 16) return null;

  const seen = new Set<string>();
  let capacitySum = 0n;
  let shareSum = 0;
  const buckets: AssetEcosystemBucketVisual[] = [];
  for (const bucket of record.capacity_breakdown) {
    const category = bucket.category.trim();
    if (!category || seen.has(category)) return null;
    if (!/^\d+$/.test(bucket.capacity_shannons)) return null;
    if (!Number.isSafeInteger(bucket.share_bps)
      || bucket.share_bps < 0
      || bucket.share_bps > 10_000) return null;
    const capacity = BigInt(bucket.capacity_shannons);
    capacitySum += capacity;
    shareSum += bucket.share_bps;
    if (capacitySum > total || shareSum > 10_000) return null;
    seen.add(category);
    buckets.push({
      category,
      capacityShannons: bucket.capacity_shannons,
      shareBps: bucket.share_bps,
      color: ECOSYSTEM_CATEGORY_COLORS[category.toLowerCase()]
        ?? ECOSYSTEM_UNLISTED_COLOR,
    });
  }
  return buckets;
}

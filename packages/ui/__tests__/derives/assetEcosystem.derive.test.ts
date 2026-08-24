import { describe, expect, it } from 'vitest';
import type {
  AssetEcosystemRecord,
  EnrichmentSourceStatus,
} from '@cknerv/types';
import {
  ASSET_ECOSYSTEM_STALE_AFTER_MS,
  assetEcosystemVisualState,
  deriveAssetEcosystemBuckets,
} from '../../src/derives/assetEcosystem.derive';
import { CLASS_MIX_COLORS, CONTENT_BANDS } from '../../src/components/hud/cellFormat';

const record: AssetEcosystemRecord = {
  source: 'ckbadger',
  as_of: { block: 100, hash: `0x${'aa'.repeat(32)}` },
  updated_at_ms: 1,
  total_live_capacity_shannons: '100000000000000',
  total_knowledge_bytes: 12345,
  capacity_breakdown: [
    { category: 'dao', capacity_shannons: '25000000000000', share_bps: 2500 },
    { category: 'tokens', capacity_shannons: '1000000000000', share_bps: 100 },
    { category: 'other', capacity_shannons: '74000000000000', share_bps: 7400 },
  ],
  top_assets: [],
};

const source: EnrichmentSourceStatus = {
  source: 'ckbadger',
  status: 'ready',
  capabilities: ['asset_ecosystem'],
  validated_anchor: { block: 101, hash: `0x${'bb'.repeat(32)}` },
};

describe('asset ecosystem visual derivation', () => {
  it('preserves exact indexed basis-point proportions', () => {
    const buckets = deriveAssetEcosystemBuckets(record);
    expect(buckets?.map((bucket) => bucket.shareBps)).toEqual([2500, 100, 7400]);
    // Named, not spelled: the chain-capacity bar and the stage's class-mix
    // bars are one reading in two places, so a hex typed here would be the
    // exact drift the shared table exists to prevent.
    expect(buckets?.map((bucket) => bucket.color)).toEqual([
      CLASS_MIX_COLORS.dao,
      CLASS_MIX_COLORS.typed,
      CLASS_MIX_COLORS.plain,
    ]);
  });

  it('does not shout about the bucket it knows least about', () => {
    // The branch that fires when the source names a class this table does not.
    // It used to be a bright cyan 247 from where it belongs, so a category
    // arriving from upstream announced itself as the loudest segment in the
    // bar — the exact inverse of what a bucket nobody can name should do.
    const buckets = deriveAssetEcosystemBuckets({
      ...record,
      capacity_breakdown: [
        { category: 'dao', capacity_shannons: '25000000000000', share_bps: 2500 },
        { category: 'restaking', capacity_shannons: '75000000000000', share_bps: 7500 },
      ],
    });
    expect(buckets?.map((bucket) => bucket.color)).toEqual([
      CLASS_MIX_COLORS.dao,
      CONTENT_BANDS.unlisted,
    ]);
  });

  it('rejects inconsistent totals instead of drawing a fallback', () => {
    expect(deriveAssetEcosystemBuckets({
      ...record,
      capacity_breakdown: [{
        category: 'dao',
        capacity_shannons: '100000000000001',
        share_bps: 2500,
      }],
    })).toBeNull();
    expect(deriveAssetEcosystemBuckets({
      ...record,
      capacity_breakdown: [
        { category: 'dao', capacity_shannons: '1', share_bps: 6000 },
        { category: 'tokens', capacity_shannons: '1', share_bps: 5000 },
      ],
    })).toBeNull();
  });

  it('requires a usable source and compatible anchor', () => {
    expect(assetEcosystemVisualState(source, record, 1)).toBe('ready');
    expect(assetEcosystemVisualState({ ...source, status: 'stale' }, record, 1))
      .toBe('stale');
    expect(assetEcosystemVisualState({ ...source, status: 'error' }, record, 1))
      .toBeNull();
    expect(assetEcosystemVisualState({
      ...source,
      validated_anchor: { block: 100, hash: `0x${'cc'.repeat(32)}` },
    }, record, 1)).toBeNull();
  });

  it('dims only the aggregate when its own refresh stops', () => {
    expect(assetEcosystemVisualState(
      source,
      record,
      record.updated_at_ms + ASSET_ECOSYSTEM_STALE_AFTER_MS + 1,
    )).toBe('stale');
  });
});

import { describe, expect, it } from 'vitest';
import type {
  AssetEcosystemRecord,
  EnrichmentSourceStatus,
} from '@cknerv/types';
import {
  ASSET_ECOSYSTEM_STALE_AFTER_MS,
  assetEcosystemVisualState,
} from '../../src/derives/assetEcosystem.derive';

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

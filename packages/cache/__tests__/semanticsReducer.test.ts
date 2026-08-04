import { describe, expect, it } from 'vitest';

import type {
  ActivityFeedRecord,
  AssetEcosystemRecord,
  CellSemanticRecord,
  EnrichmentSourceStatus,
  NetworkAtlasRecord,
} from '@cknerv/types';
import {
  applyRevisionedSemanticsDeltas,
  emptySemanticsCache,
  outPointKey,
} from '../src/semanticsReducer';

const ready: EnrichmentSourceStatus = {
  source: 'ckbadger',
  status: 'ready',
  capabilities: ['cell_detail'],
  validated_anchor: { block: 10, hash: '0xblock10' },
};

function cell(block: number, txHash: string): CellSemanticRecord {
  return {
    out_point: { tx_hash: txHash, index: 0 },
    source: 'ckbadger',
    as_of: { block, hash: `0xblock${block}` },
    observed_at_block: block,
    updated_at_ms: block,
    facets: [],
  };
}

function ecosystem(block: number): AssetEcosystemRecord {
  return {
    source: 'ckbadger',
    as_of: { block, hash: `0xblock${block}` },
    updated_at_ms: block,
    total_live_capacity_shannons: '100000000000000',
    total_knowledge_bytes: 12345,
    capacity_breakdown: [{
      category: 'dao',
      capacity_shannons: '25000000000000',
      share_bps: 2500,
    }],
    top_assets: [],
  };
}

function activityFeed(block: number): ActivityFeedRecord {
  return {
    source: 'ckbadger',
    as_of: { block, hash: `0xblock${block}` },
    updated_at_ms: block,
    activities: [{
      tx_hash: '0xactivity',
      block,
      timestamp_ms: block,
      category: 'script',
      label: 'Example Script',
      participant_count: 1,
    }],
  };
}

function networkAtlas(block: number): NetworkAtlasRecord {
  return {
    source: 'ckbadger',
    as_of: { block, hash: `0xblock${block}` },
    updated_at_ms: block,
    crawl_round: 7,
    crawl_finished_at_s: block,
    total_known: 42,
    last_round_dialed: 12,
    last_round_reachable: 9,
    new_nodes: 3,
    frontier_drained: true,
    sample_size: 2,
    sample_reachable: 1,
    sample_truncated: true,
    median_rtt_ms: 24,
    countries: [{ label: 'SG', count: 2 }],
    versions: [{ label: '0.119.0', count: 2 }],
  };
}

describe('semantics reducer', () => {
  it('keeps its own revision and upserts selected Cell context', () => {
    const record = cell(10, '0xcell');
    const next = applyRevisionedSemanticsDeltas(emptySemanticsCache(), [
      { revision: 1, delta: { type: 'source_status', source: ready } },
      { revision: 2, delta: { type: 'cell_upsert', cell: record } },
    ]);

    expect(next.revision).toBe(2);
    expect(next.source.status).toBe('ready');
    expect(next.cells.get(outPointKey(record.out_point))).toBe(record);
  });

  it('prunes reorg-unsafe records while preserving older semantics', () => {
    const old = cell(9, '0xold');
    const orphan = cell(10, '0xorphan');
    const seeded = applyRevisionedSemanticsDeltas(emptySemanticsCache(), [
      { revision: 1, delta: { type: 'cell_upsert', cell: old } },
      { revision: 2, delta: { type: 'cell_upsert', cell: orphan } },
    ]);
    const next = applyRevisionedSemanticsDeltas(seeded, [
      { revision: 3, delta: { type: 'prune', from_block: 10 } },
    ]);

    expect([...next.cells.keys()]).toEqual([outPointKey(old.out_point)]);
  });

  it('replaces and prunes the bounded asset ecosystem independently', () => {
    const record = ecosystem(10);
    const seeded = applyRevisionedSemanticsDeltas(emptySemanticsCache(), [{
      revision: 1,
      delta: { type: 'asset_ecosystem_replace', asset_ecosystem: record },
    }]);
    expect(seeded.assetEcosystem).toBe(record);

    const next = applyRevisionedSemanticsDeltas(seeded, [{
      revision: 2,
      delta: { type: 'prune', from_block: 10 },
    }]);
    expect(next.assetEcosystem).toBeNull();
  });

  it('replaces and prunes the bounded activity feed independently', () => {
    const record = activityFeed(10);
    const seeded = applyRevisionedSemanticsDeltas(emptySemanticsCache(), [{
      revision: 1,
      delta: { type: 'activity_feed_replace', activity_feed: record },
    }]);
    expect(seeded.activityFeed).toBe(record);

    const next = applyRevisionedSemanticsDeltas(seeded, [{
      revision: 2,
      delta: { type: 'prune', from_block: 10 },
    }]);
    expect(next.activityFeed).toBeNull();
  });

  it('replaces and prunes the bounded network atlas independently', () => {
    const record = networkAtlas(10);
    const seeded = applyRevisionedSemanticsDeltas(emptySemanticsCache(), [{
      revision: 1,
      delta: { type: 'network_atlas_replace', network_atlas: record },
    }]);
    expect(seeded.networkAtlas).toBe(record);

    const next = applyRevisionedSemanticsDeltas(seeded, [{
      revision: 2,
      delta: { type: 'prune', from_block: 10 },
    }]);
    expect(next.networkAtlas).toBeNull();
  });

  it('clears only network atlas when the crawler is disabled', () => {
    const record = networkAtlas(10);
    const seeded = applyRevisionedSemanticsDeltas(emptySemanticsCache(), [{
      revision: 1,
      delta: { type: 'network_atlas_replace', network_atlas: record },
    }]);
    const next = applyRevisionedSemanticsDeltas(seeded, [{
      revision: 2,
      delta: { type: 'network_atlas_clear' },
    }]);

    expect(next.networkAtlas).toBeNull();
    expect(next.cells).toBe(seeded.cells);
  });

  it('clear does not erase source health', () => {
    const seeded = applyRevisionedSemanticsDeltas(emptySemanticsCache(), [
      { revision: 1, delta: { type: 'source_status', source: ready } },
      { revision: 2, delta: { type: 'cell_upsert', cell: cell(10, '0xcell') } },
    ]);
    const next = applyRevisionedSemanticsDeltas(seeded, [
      { revision: 3, delta: { type: 'clear' } },
    ]);

    expect(next.source.status).toBe('ready');
    expect(next.cells.size).toBe(0);
  });
});

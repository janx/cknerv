import { describe, expect, it } from 'vitest';

import type {
  ActivityFeedRecord,
  AssetEcosystemRecord,
  CellSemanticRecord,
  DaoStateRecord,
  ForkWatchRecord,
  EnrichmentSourceStatus,
  NetworkAtlasRecord,
  ProtocolEraRecord,
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

function daoState(block: number): DaoStateRecord {
  return {
    source: 'ckbadger',
    as_of: { block, hash: `0xblock${block}` },
    statistics_block: block - 1,
    updated_at_ms: block,
    total_deposited_shannons: '837703738002110308',
    total_depositors: 16740,
    active_deposits: 22659,
    pending_withdrawal_shannons: '77523020877862416',
    unclaimed_compensation_shannons: '81345902996799859',
    estimated_apc_bps: 201,
    deposit_change_24h_shannons: '141530599353229',
    depositors_change_24h: 5,
  };
}

function forkWatch(block: number): ForkWatchRecord {
  return {
    source: 'ckbadger',
    as_of: { block, hash: `0xblock${block}` },
    updated_at_ms: block,
    recent_window_seconds: 86400,
    recent_reorg: {
      detected_at_ms: block,
      fork_point: block - 3,
      old_tip: block - 1,
      new_tip: block,
      depth: 2,
      orphaned_blocks: 2,
      orphaned_transactions: 7,
      kind: 'deep',
    },
    deep_fork: {
      detected_at_ms: block,
      fork_point: block - 3,
      indexed_tip: block - 1,
      chain_tip: block,
      depth: 2,
    },
  };
}

function protocolEra(block: number): ProtocolEraRecord {
  return {
    source: 'ckbadger',
    as_of: { block, hash: `0xblock${block}` },
    updated_at_ms: block,
    network: 'mainnet',
    indexed_tip_block: block,
    indexed_tip_epoch: 12_300,
    current: {
      name: 'Meepo',
      edition_year: 2024,
      activation_epoch: 12_293,
      activation_block: block - 1,
    },
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

  it('replaces and prunes the fixed DAO state independently', () => {
    const record = daoState(10);
    const seeded = applyRevisionedSemanticsDeltas(emptySemanticsCache(), [{
      revision: 1,
      delta: { type: 'dao_state_replace', dao_state: record },
    }]);
    expect(seeded.daoState).toBe(record);

    const next = applyRevisionedSemanticsDeltas(seeded, [{
      revision: 2,
      delta: { type: 'prune', from_block: 10 },
    }]);
    expect(next.daoState).toBeNull();
  });

  it('replaces and prunes the fixed fork watch independently', () => {
    const record = forkWatch(10);
    const seeded = applyRevisionedSemanticsDeltas(emptySemanticsCache(), [{
      revision: 1,
      delta: { type: 'fork_watch_replace', fork_watch: record },
    }]);
    expect(seeded.forkWatch).toBe(record);

    const next = applyRevisionedSemanticsDeltas(seeded, [{
      revision: 2,
      delta: { type: 'prune', from_block: 10 },
    }]);
    expect(next.forkWatch).toBeNull();
  });

  it('replaces and prunes fixed protocol-era context independently', () => {
    const record = protocolEra(10);
    const seeded = applyRevisionedSemanticsDeltas(emptySemanticsCache(), [{
      revision: 1,
      delta: { type: 'protocol_era_replace', protocol_era: record },
    }]);
    expect(seeded.protocolEra).toBe(record);

    const next = applyRevisionedSemanticsDeltas(seeded, [{
      revision: 2,
      delta: { type: 'prune', from_block: 10 },
    }]);
    expect(next.protocolEra).toBeNull();
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

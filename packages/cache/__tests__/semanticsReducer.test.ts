import { describe, expect, it } from 'vitest';

import type {
  ActivityFeedRecord,
  AssetEcosystemRecord,
  Cell,
  CellSemanticRecord,
  DaoStateRecord,
  ForkWatchRecord,
  GalaxyCompositionRecord,
  EnrichmentSourceStatus,
  NetworkAtlasRecord,
  ProtocolEraRecord,
  TransactionHorizonRecord,
} from '@cknerv/types';
import {
  applyRevisionedSemanticsDeltas,
  applySemanticsDelta,
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

function transactionHorizon(block: number): TransactionHorizonRecord {
  return {
    source: 'ckbadger',
    as_of: { block, hash: `0xblock${block}` },
    updated_at_ms: block,
    current_hour: 12,
    current_day: 345,
    hourly_counts: [7, 9, 12],
    daily_counts: [300, 321, 345],
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

function galaxyCell(id: number, overrides: Partial<Cell> = {}): Cell {
  return {
    id,
    born_at_ms: 0,
    death_at_ms: null,
    birth_block: 100 + id,
    tag: null,
    pos_seed: [id * 0.25, id * 0.5, id * 0.75],
    out_point: { tx_hash: `0xtx${id}`, index: id },
    capacity: 6_100_000_000 + id,
    data_hex: '0x',
    content_hash: `0xcontent${id}`,
    lock_kind: 'sighash',
    asset_kind: 'native',
    ...overrides,
  };
}

function galaxyComposition(
  block: number,
  buckets: Pick<GalaxyCompositionRecord, 'dao' | 'typed' | 'plain'> = {
    dao: [],
    typed: [],
    plain: [],
  },
): GalaxyCompositionRecord {
  return {
    source: 'ckbadger',
    as_of: { block, hash: `0xblock${block}` },
    updated_at_ms: block,
    ...buckets,
  };
}

/** Fresh objects, identical content — the shape of the enrichment source's
 *  periodic re-emit (only the freshness anchors advance). */
function seededGalaxyBuckets(): Pick<
  GalaxyCompositionRecord,
  'dao' | 'typed' | 'plain'
> {
  return {
    dao: [galaxyCell(1, { asset_kind: 'dao' })],
    typed: [
      galaxyCell(2, { asset_kind: 'sudt' }),
      galaxyCell(3, { asset_kind: 'xudt' }),
    ],
    plain: [galaxyCell(4)],
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

  it('replaces and prunes the bounded transaction horizon independently', () => {
    const record = transactionHorizon(10);
    const seeded = applyRevisionedSemanticsDeltas(emptySemanticsCache(), [{
      revision: 1,
      delta: {
        type: 'transaction_horizon_replace',
        transaction_horizon: record,
      },
    }]);
    expect(seeded.transactionHorizon).toBe(record);

    const next = applyRevisionedSemanticsDeltas(seeded, [{
      revision: 2,
      delta: { type: 'prune', from_block: 10 },
    }]);
    expect(next.transactionHorizon).toBeNull();
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

  it('replaces and prunes the additive CellGalaxy composition', () => {
    const record = galaxyComposition(10);
    const seeded = applyRevisionedSemanticsDeltas(emptySemanticsCache(), [{
      revision: 1,
      delta: {
        type: 'galaxy_composition_replace',
        galaxy_composition: record,
      },
    }]);
    expect(seeded.galaxyComposition).toBe(record);

    const next = applyRevisionedSemanticsDeltas(seeded, [{
      revision: 2,
      delta: { type: 'prune', from_block: 10 },
    }]);
    expect(next.galaxyComposition).toBeNull();
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

describe('galaxy composition identity reuse', () => {
  it('returns prev untouched when a replace carries content-identical Cells', () => {
    const seeded = applySemanticsDelta(emptySemanticsCache(), {
      type: 'galaxy_composition_replace',
      galaxy_composition: galaxyComposition(10, seededGalaxyBuckets()),
    });

    const next = applySemanticsDelta(seeded, {
      type: 'galaxy_composition_replace',
      galaxy_composition: galaxyComposition(20, seededGalaxyBuckets()),
    });

    expect(next).toBe(seeded);
    // The old freshness anchor is deliberately frozen with the old identity:
    // content-identical context stays valid at its original anchor.
    expect(next.galaxyComposition?.as_of.block).toBe(10);

    // Same dedup through the revisioned stream path: the revision advances
    // but the composition record keeps its identity.
    const bumped = applyRevisionedSemanticsDeltas(seeded, [{
      revision: 7,
      delta: {
        type: 'galaxy_composition_replace',
        galaxy_composition: galaxyComposition(30, seededGalaxyBuckets()),
      },
    }]);
    expect(bumped.revision).toBe(7);
    expect(bumped.galaxyComposition).toBe(seeded.galaxyComposition);
  });

  it('rebuilds only the changed Cell, reusing every untouched identity', () => {
    const prevRecord = galaxyComposition(10, seededGalaxyBuckets());
    const seeded = applySemanticsDelta(emptySemanticsCache(), {
      type: 'galaxy_composition_replace',
      galaxy_composition: prevRecord,
    });

    const incoming = seededGalaxyBuckets();
    const changedCell = galaxyCell(3, { asset_kind: 'xudt', capacity: 999 });
    incoming.typed[1] = changedCell;
    const next = applySemanticsDelta(seeded, {
      type: 'galaxy_composition_replace',
      galaxy_composition: galaxyComposition(20, incoming),
    });
    const record = next.galaxyComposition;

    expect(next).not.toBe(seeded);
    expect(record).not.toBe(prevRecord);
    // Untouched buckets keep their array identity outright.
    expect(record?.dao).toBe(prevRecord.dao);
    expect(record?.plain).toBe(prevRecord.plain);
    // The touched bucket is rebuilt, but its unchanged Cell keeps identity.
    expect(record?.typed).not.toBe(prevRecord.typed);
    expect(record?.typed[0]).toBe(prevRecord.typed[0]);
    expect(record?.typed[1]).toBe(changedCell);
    // A real change adopts the incoming freshness anchors.
    expect(record?.as_of.block).toBe(20);
    expect(record?.updated_at_ms).toBe(20);
  });

  it('still applies a replace after prune cleared the composition', () => {
    const seeded = applySemanticsDelta(emptySemanticsCache(), {
      type: 'galaxy_composition_replace',
      galaxy_composition: galaxyComposition(10, seededGalaxyBuckets()),
    });
    const pruned = applySemanticsDelta(seeded, {
      type: 'prune',
      from_block: 10,
    });
    expect(pruned.galaxyComposition).toBeNull();

    // Even content identical to the pre-prune record must land: dedup only
    // ever compares against the live prev record, never a pruned one.
    const restored = galaxyComposition(20, seededGalaxyBuckets());
    const next = applySemanticsDelta(pruned, {
      type: 'galaxy_composition_replace',
      galaxy_composition: restored,
    });
    expect(next.galaxyComposition).toBe(restored);
  });
});

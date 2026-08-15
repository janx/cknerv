import { describe, expect, it } from 'vitest';

import type {
  ActivityFeedRecord,
  AssetEcosystemRecord,
  CellSemanticRecord,
  ChainAnchor,
  ChainCensus,
  DaoStateRecord,
  ForkWatchRecord,
  EnrichmentSourceStatus,
  NetworkAtlasRecord,
  ProtocolEraRecord,
  ScriptRegistryRecord,
  SemanticsDelta,
  TransactionHorizonRecord,
  TransactionSemanticRecord,
} from '@cknerv/types';
import {
  applyRevisionedSemanticsDeltas,
  applySemanticsDelta,
  deepEqualsIgnoringAnchors,
  emptySemanticsCache,
  outPointKey,
  type SemanticsCache,
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

function census(block: number): ChainCensus {
  return {
    source: 'ckbadger',
    as_of: { block, hash: `0xblock${block}` },
    updated_at_ms: block,
    live_cells: 2_400_000,
    total_cells: 3_000_000,
    dead_cells: 600_000,
  };
}

function transaction(block: number, txHash: string): TransactionSemanticRecord {
  return {
    tx_hash: txHash,
    block,
    source: 'ckbadger',
    as_of: { block, hash: `0xblock${block}` },
    updated_at_ms: block,
    actions: [{ namespace: 'core', kind: 'transfer', attributes: [] }],
    participants: [],
    fee: '1000',
  };
}

/** Model the enrichment source's periodic re-emit: a structurally fresh
 *  record with identical content whose freshness anchors advanced. */
function reanchored<T extends { as_of: ChainAnchor; updated_at_ms: number }>(
  record: T,
  block: number,
): T {
  const clone = structuredClone(record);
  const anchors: { as_of: ChainAnchor; updated_at_ms: number } = clone;
  anchors.as_of = { block, hash: `0xblock${block}` };
  anchors.updated_at_ms = block;
  return clone;
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

function scriptRegistry(block: number): ScriptRegistryRecord {
  return {
    source: 'ckbadger',
    as_of: { block, hash: `0xblock${block}` },
    updated_at_ms: block,
    entries: [{
      code_hash: `0x${'9b'.repeat(32)}`,
      hash_type: 'type',
      name: 'Default Lock',
      deprecated: false,
    }],
    unresolved: 3,
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

  it('prune drops the script registry only when the reorg reaches its anchor', () => {
    const record = scriptRegistry(10);
    const seeded = applyRevisionedSemanticsDeltas(emptySemanticsCache(), [{
      revision: 1,
      delta: { type: 'script_registry_replace', script_registry: record },
    }]);
    expect(seeded.scriptRegistry).toBe(record);

    // Server parity (`enrichment.rs`, `Mutation::ChainReorganized`): a name
    // does not depend on the tip, but the record proving it came from a
    // compatible index does — so the anchor decides, exactly as it does for
    // every other record. Above the anchor the registry survives…
    expect(
      applySemanticsDelta(seeded, { type: 'prune', from_block: 15 })
        .scriptRegistry,
    ).toBe(record);
    // …at or below it, it drops and the next refresh re-proves it.
    expect(
      applySemanticsDelta(seeded, { type: 'prune', from_block: 10 })
        .scriptRegistry,
    ).toBeNull();
    expect(
      applySemanticsDelta(seeded, { type: 'prune', from_block: 9 })
        .scriptRegistry,
    ).toBeNull();
  });

  it('clear drops the script registry along with every other record', () => {
    const seeded = applyRevisionedSemanticsDeltas(emptySemanticsCache(), [
      { revision: 1, delta: { type: 'source_status', source: ready } },
      {
        revision: 2,
        delta: {
          type: 'script_registry_replace',
          script_registry: scriptRegistry(10),
        },
      },
    ]);
    expect(seeded.scriptRegistry).not.toBeNull();

    // Server parity (`clear_records()`): ChainRebuild / an incompatible
    // source may repoint at another network, and retained names would label
    // the next census's identities from the old chain.
    const next = applySemanticsDelta(seeded, { type: 'clear' });
    expect(next.scriptRegistry).toBeNull();
    expect(next.source.status).toBe('ready');
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

interface RefreshArm {
  name: string;
  /** Delta whose record content matches the seed, re-anchored at `block`. */
  make: (block: number) => SemanticsDelta;
  /** Delta re-anchored at `block` with one real content field changed. */
  makeChanged: (block: number) => SemanticsDelta;
  read: (cache: SemanticsCache) => { as_of: ChainAnchor } | null;
}

const refreshArms: RefreshArm[] = [
  {
    name: 'census_replace',
    make: (block) => ({
      type: 'census_replace',
      census: reanchored(census(10), block),
    }),
    makeChanged: (block) => ({
      type: 'census_replace',
      census: { ...reanchored(census(10), block), live_cells: 2_400_001 },
    }),
    read: (cache) => cache.census,
  },
  {
    name: 'asset_ecosystem_replace',
    make: (block) => ({
      type: 'asset_ecosystem_replace',
      asset_ecosystem: reanchored(ecosystem(10), block),
    }),
    makeChanged: (block) => {
      const record = reanchored(ecosystem(10), block);
      record.capacity_breakdown[0].share_bps = 2600;
      return { type: 'asset_ecosystem_replace', asset_ecosystem: record };
    },
    read: (cache) => cache.assetEcosystem,
  },
  {
    name: 'dao_state_replace',
    make: (block) => ({
      type: 'dao_state_replace',
      dao_state: reanchored(daoState(10), block),
    }),
    makeChanged: (block) => {
      const record = reanchored(daoState(10), block);
      record.total_depositors += 1;
      return { type: 'dao_state_replace', dao_state: record };
    },
    read: (cache) => cache.daoState,
  },
  {
    name: 'protocol_era_replace',
    make: (block) => ({
      type: 'protocol_era_replace',
      protocol_era: reanchored(protocolEra(10), block),
    }),
    makeChanged: (block) => {
      const record = reanchored(protocolEra(10), block);
      record.indexed_tip_epoch += 1;
      return { type: 'protocol_era_replace', protocol_era: record };
    },
    read: (cache) => cache.protocolEra,
  },
  {
    name: 'fork_watch_replace',
    make: (block) => ({
      type: 'fork_watch_replace',
      fork_watch: reanchored(forkWatch(10), block),
    }),
    makeChanged: (block) => {
      const record = reanchored(forkWatch(10), block);
      // Nested content change: the deep walk must see through sub-objects.
      record.recent_reorg!.depth = 5;
      return { type: 'fork_watch_replace', fork_watch: record };
    },
    read: (cache) => cache.forkWatch,
  },
  {
    name: 'activity_feed_replace',
    make: (block) => ({
      type: 'activity_feed_replace',
      activity_feed: reanchored(activityFeed(10), block),
    }),
    makeChanged: (block) => {
      const record = reanchored(activityFeed(10), block);
      record.activities[0].label = 'Renamed Script';
      return { type: 'activity_feed_replace', activity_feed: record };
    },
    read: (cache) => cache.activityFeed,
  },
  {
    name: 'transaction_horizon_replace',
    make: (block) => ({
      type: 'transaction_horizon_replace',
      transaction_horizon: reanchored(transactionHorizon(10), block),
    }),
    makeChanged: (block) => {
      const record = reanchored(transactionHorizon(10), block);
      record.hourly_counts[2] += 1;
      return { type: 'transaction_horizon_replace', transaction_horizon: record };
    },
    read: (cache) => cache.transactionHorizon,
  },
  {
    name: 'network_atlas_replace',
    make: (block) => ({
      type: 'network_atlas_replace',
      network_atlas: reanchored(networkAtlas(10), block),
    }),
    makeChanged: (block) => {
      const record = reanchored(networkAtlas(10), block);
      record.countries[0].count += 1;
      return { type: 'network_atlas_replace', network_atlas: record };
    },
    read: (cache) => cache.networkAtlas,
  },
];

describe('periodic refresh dedup', () => {
  // Only census dedups among the *_replace arms. The other seven feed HUD
  // staleness derives that read `nowMs - record.updated_at_ms` as a
  // liveness clock, so an anchor-only re-emit MUST adopt the fresh record —
  // freezing it would misreport a healthy poll with plateaued content as
  // STALE and erase the per-capability outage signal.
  const dedupedArms = new Set(['census_replace']);
  for (const arm of refreshArms) {
    if (dedupedArms.has(arm.name)) {
      it(`${arm.name}: anchor-only re-emit keeps the cache; content change replaces`, () => {
        const seeded = applySemanticsDelta(emptySemanticsCache(), arm.make(10));
        expect(arm.read(seeded)?.as_of.block).toBe(10);

        const next = applySemanticsDelta(seeded, arm.make(20));
        expect(next).toBe(seeded);
        // The frozen anchor stays semantically valid: this exact content
        // was already anchored at block 10.
        expect(arm.read(next)?.as_of.block).toBe(10);

        const changed = applySemanticsDelta(seeded, arm.makeChanged(30));
        expect(changed).not.toBe(seeded);
        expect(arm.read(changed)?.as_of.block).toBe(30);
      });
    } else {
      it(`${arm.name}: anchor-only re-emit still adopts the fresh record (staleness clock)`, () => {
        const seeded = applySemanticsDelta(emptySemanticsCache(), arm.make(10));
        expect(arm.read(seeded)?.as_of.block).toBe(10);

        const next = applySemanticsDelta(seeded, arm.make(20));
        expect(next).not.toBe(seeded);
        expect(arm.read(next)?.as_of.block).toBe(20);

        const changed = applySemanticsDelta(next, arm.makeChanged(30));
        expect(arm.read(changed)?.as_of.block).toBe(30);
      });
    }
  }

  it('advances only the revision through the revisioned stream path', () => {
    const seeded = applySemanticsDelta(emptySemanticsCache(), {
      type: 'census_replace',
      census: census(10),
    });
    const bumped = applyRevisionedSemanticsDeltas(seeded, [{
      revision: 7,
      delta: { type: 'census_replace', census: reanchored(census(10), 20) },
    }]);
    expect(bumped.revision).toBe(7);
    expect(bumped.census).toBe(seeded.census);
  });

  it('cell_upsert with retained content skips the Map copy', () => {
    const record = cell(10, '0xcell');
    const seeded = applySemanticsDelta(emptySemanticsCache(), {
      type: 'cell_upsert',
      cell: record,
    });
    const next = applySemanticsDelta(seeded, {
      type: 'cell_upsert',
      cell: reanchored(cell(10, '0xcell'), 20),
    });
    expect(next).toBe(seeded);
    expect(next.cells).toBe(seeded.cells);
    expect(next.cells.get(outPointKey(record.out_point))).toBe(record);

    // A content change (here: the observation block) still replaces.
    const moved = applySemanticsDelta(seeded, {
      type: 'cell_upsert',
      cell: { ...reanchored(cell(10, '0xcell'), 20), observed_at_block: 20 },
    });
    expect(moved).not.toBe(seeded);
    expect(
      moved.cells.get(outPointKey(record.out_point))?.observed_at_block,
    ).toBe(20);
  });

  it('transaction_upsert with retained content skips the Map copy', () => {
    const record = transaction(10, '0xtx');
    const seeded = applySemanticsDelta(emptySemanticsCache(), {
      type: 'transaction_upsert',
      transaction: record,
    });
    const next = applySemanticsDelta(seeded, {
      type: 'transaction_upsert',
      transaction: reanchored(transaction(10, '0xtx'), 20),
    });
    expect(next).toBe(seeded);
    expect(next.transactions).toBe(seeded.transactions);
    expect(next.transactions.get('0xtx')).toBe(record);

    const changed = applySemanticsDelta(seeded, {
      type: 'transaction_upsert',
      transaction: { ...reanchored(transaction(10, '0xtx'), 20), fee: '2000' },
    });
    expect(changed).not.toBe(seeded);
    expect(changed.transactions.get('0xtx')?.fee).toBe('2000');
  });

  it('source_status re-broadcast keeps the cache; liveness change replaces', () => {
    const seeded = applySemanticsDelta(emptySemanticsCache(), {
      type: 'source_status',
      source: ready,
    });
    const next = applySemanticsDelta(seeded, {
      type: 'source_status',
      source: structuredClone(ready),
    });
    expect(next).toBe(seeded);
    expect(next.source).toBe(ready);

    // `last_success_at_ms` is liveness content, not a freshness anchor: a
    // heartbeat-only status update must still replace.
    const heartbeat = { ...structuredClone(ready), last_success_at_ms: 1234 };
    const alive = applySemanticsDelta(seeded, {
      type: 'source_status',
      source: heartbeat,
    });
    expect(alive).not.toBe(seeded);
    expect(alive.source).toBe(heartbeat);
  });

  it('prune applies to the frozen anchor exactly as if never re-emitted', () => {
    const seeded = applySemanticsDelta(emptySemanticsCache(), {
      type: 'census_replace',
      census: census(10),
    });
    const deduped = applySemanticsDelta(seeded, {
      type: 'census_replace',
      census: reanchored(census(10), 20),
    });
    expect(deduped).toBe(seeded);

    // The retained anchor is block 10: a reorg above it keeps the record…
    const kept = applySemanticsDelta(deduped, { type: 'prune', from_block: 15 });
    expect(kept.census).toBe(seeded.census);
    // …and a reorg at/below it clears, same as before the re-emit.
    const cleared = applySemanticsDelta(deduped, { type: 'prune', from_block: 10 });
    expect(cleared.census).toBeNull();
  });

  it('replace lands again after prune and clear, even with identical content', () => {
    const seeded = applySemanticsDelta(emptySemanticsCache(), {
      type: 'census_replace',
      census: census(10),
    });
    const pruned = applySemanticsDelta(seeded, { type: 'prune', from_block: 10 });
    expect(pruned.census).toBeNull();
    const restored = reanchored(census(10), 20);
    const afterPrune = applySemanticsDelta(pruned, {
      type: 'census_replace',
      census: restored,
    });
    expect(afterPrune.census).toBe(restored);

    const clearedAll = applySemanticsDelta(afterPrune, { type: 'clear' });
    expect(clearedAll.census).toBeNull();
    const again = reanchored(census(10), 30);
    expect(
      applySemanticsDelta(clearedAll, { type: 'census_replace', census: again })
        .census,
    ).toBe(again);
  });
});

describe('deepEqualsIgnoringAnchors', () => {
  it('skips anchor keys at every depth but compares all content', () => {
    expect(deepEqualsIgnoringAnchors(
      { as_of: { block: 1, hash: '0xa' }, updated_at_ms: 1, rows: [{ n: 1 }] },
      { as_of: { block: 2, hash: '0xb' }, updated_at_ms: 2, rows: [{ n: 1 }] },
    )).toBe(true);
    expect(deepEqualsIgnoringAnchors(
      { rows: [{ updated_at_ms: 5, n: 1 }] },
      { rows: [{ updated_at_ms: 9, n: 1 }] },
    )).toBe(true);
    expect(deepEqualsIgnoringAnchors(
      { rows: [{ n: 1 }] },
      { rows: [{ n: 2 }] },
    )).toBe(false);
  });

  it('is order-sensitive for arrays and strict about extra content keys', () => {
    expect(deepEqualsIgnoringAnchors({ v: [1, 2] }, { v: [2, 1] })).toBe(false);
    expect(deepEqualsIgnoringAnchors({ v: [1, 2] }, { v: [1, 2, 3] })).toBe(false);
    expect(deepEqualsIgnoringAnchors({ n: 1 }, { n: 1, m: 2 })).toBe(false);
    expect(deepEqualsIgnoringAnchors({ n: 1, m: 2 }, { n: 1 })).toBe(false);
  });

  it('treats undefined-valued optionals as absent (JSON wire parity)', () => {
    expect(deepEqualsIgnoringAnchors({ n: 1, opt: undefined }, { n: 1 })).toBe(true);
    expect(deepEqualsIgnoringAnchors({ n: 1 }, { n: 1, opt: undefined })).toBe(true);
    expect(deepEqualsIgnoringAnchors({ n: 1, opt: 0 }, { n: 1 })).toBe(false);
  });
});

describe('unknown wire variants', () => {
  // A server ahead of this build can put a delta type on the wire that no
  // case here matches. Every reducer in this package owes the same contract:
  // a silent no-op, never a throw and never an undefined cache. Without a
  // default arm this reducer returned `undefined`, and the batch path below
  // then published `{ ...undefined, revision }` — a cache with no maps,
  // destroying the semantics pipeline for the rest of the session.
  const future = {
    type: 'from_the_future',
    payload: 7,
  } as unknown as SemanticsDelta;

  function seed(): SemanticsCache {
    return applyRevisionedSemanticsDeltas(emptySemanticsCache(), [
      { revision: 1, delta: { type: 'source_status', source: ready } },
      { revision: 2, delta: { type: 'cell_upsert', cell: cell(10, '0xcell') } },
      { revision: 3, delta: { type: 'census_replace', census: census(10) } },
    ]);
  }

  it('applySemanticsDelta returns the previous cache untouched', () => {
    const seeded = seed();
    expect(applySemanticsDelta(seeded, future)).toBe(seeded);
  });

  it('a batch of only unknown arms advances nothing but the revision', () => {
    const seeded = seed();
    expect(applyRevisionedSemanticsDeltas(seeded, [
      { revision: seeded.revision, delta: future },
    ])).toBe(seeded);

    const bumped = applyRevisionedSemanticsDeltas(seeded, [
      { revision: 9, delta: future },
    ]);
    expect(bumped.revision).toBe(9);
    expect(bumped.cells).toBe(seeded.cells);
    expect(bumped.transactions).toBe(seeded.transactions);
    expect(bumped.census).toBe(seeded.census);
    expect(bumped.source).toBe(seeded.source);
  });

  it('known arms after an unknown one in the same batch still land', () => {
    const record = cell(11, '0xafter');
    const next = applyRevisionedSemanticsDeltas(seed(), [
      { revision: 4, delta: future },
      { revision: 5, delta: { type: 'cell_upsert', cell: record } },
    ]);
    expect(next.revision).toBe(5);
    expect(next.cells.get(outPointKey(record.out_point))).toBe(record);
    expect(next.cells.size).toBe(2);
  });
});

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
  NetworkRosterRecord,
  ProtocolEraRecord,
  RevisionedSemanticsDelta,
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
  MAX_RETAINED_CELLS,
  MAX_RETAINED_TRANSACTIONS,
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
    candidate_peers: 61,
    last_round_reachable: 9,
    foreign_peers: 1,
    exhausted_candidates: 51,
    verified_unavailable_peers: 33,
    verified_retained_peers: 42,
    new_verified_peers: 3,
    indexed_peers: 42,
    countries: [{ label: 'SG', count: 42 }],
    versions: [{ label: '0.119.0', count: 42 }],
    asns: [{ label: 'AS1 Example', count: 42 }],
  };
}

function networkRoster(block: number, round: number): NetworkRosterRecord {
  return {
    source: 'ckbadger',
    as_of: { block, hash: `0xblock${block}` },
    updated_at_ms: block,
    crawl_round: round,
    truncated: true,
    entries: [{
      node_id: 'QmQHmapDhRnzHqcAJQ5geABWdMVRaa6qah9gEdBEF7ejyL',
      addr: '/ip4/203.0.113.7/tcp/8115',
      version: '0.209.0',
      country: 'DE',
      asn: 'AS24940 Hetzner Online GmbH',
      reachable: true,
      last_seen_ms: 1_699_999_940_000,
      rtt_ms: 41,
    }],
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

  it('replaces and prunes the bounded network roster independently', () => {
    const record = networkRoster(10, 7);
    const seeded = applyRevisionedSemanticsDeltas(emptySemanticsCache(), [{
      revision: 1,
      delta: { type: 'network_roster_replace', network_roster: record },
    }]);
    expect(seeded.networkRoster).toBe(record);

    // The dedup that spares a roster its own re-emit lives on the server,
    // which withholds a crawl round it already published. The client keeps
    // none of its own: whatever does arrive lands as the fresh object.
    const again = networkRoster(20, 7);
    expect(
      applySemanticsDelta(seeded, {
        type: 'network_roster_replace',
        network_roster: again,
      }).networkRoster,
    ).toBe(again);

    // A crawler's nodes outlive a reorg; the record's claim to have been
    // observed under this chain does not. Above the anchor it stands…
    expect(
      applySemanticsDelta(seeded, { type: 'prune', from_block: 15 })
        .networkRoster,
    ).toBe(record);
    // …at or below it, it drops on the atlas's rule.
    const next = applyRevisionedSemanticsDeltas(seeded, [{
      revision: 2,
      delta: { type: 'prune', from_block: 10 },
    }]);
    expect(next.networkRoster).toBeNull();
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

  it('an empty roster is a report; only the clear arm empties the slot', () => {
    const named = networkRoster(10, 7);
    const seeded = applySemanticsDelta(emptySemanticsCache(), {
      type: 'network_roster_replace',
      network_roster: named,
    });
    expect(seeded.networkRoster?.entries).toHaveLength(1);

    // A round that finished knowing nobody replaces the named set with an
    // empty one, and the record stays: "the crawler saw no one" is an answer
    // the stage can act on, and it is not the same news as having no crawler.
    const empty: NetworkRosterRecord = { ...networkRoster(20, 8), entries: [] };
    const reported = applySemanticsDelta(seeded, {
      type: 'network_roster_replace',
      network_roster: empty,
    });
    expect(reported.networkRoster).toBe(empty);
    expect(reported.networkRoster?.entries).toEqual([]);

    // Losing the capability is that other news, and only it returns null.
    const cleared = applySemanticsDelta(reported, {
      type: 'network_roster_clear',
    });
    expect(cleared.networkRoster).toBeNull();
    expect(cleared.cells).toBe(seeded.cells);
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
  // NO *_replace arm dedups. Seven feed HUD staleness derives that read
  // `nowMs - record.updated_at_ms` as a liveness clock; the eighth, census,
  // has a panel that PRINTS its anchor beside a whole-chain count. For all
  // of them an anchor-only re-emit MUST adopt the fresh record — freezing it
  // would misreport a healthy poll with plateaued content as STALE, or keep
  // printing an old block height under a count just re-proved at a newer one.
  for (const arm of refreshArms) {
    it(`${arm.name}: anchor-only re-emit still adopts the fresh record`, () => {
      const seeded = applySemanticsDelta(emptySemanticsCache(), arm.make(10));
      expect(arm.read(seeded)?.as_of.block).toBe(10);

      const next = applySemanticsDelta(seeded, arm.make(20));
      expect(next).not.toBe(seeded);
      expect(arm.read(next)?.as_of.block).toBe(20);

      const changed = applySemanticsDelta(next, arm.makeChanged(30));
      expect(arm.read(changed)?.as_of.block).toBe(30);
    });
  }

  it('carries a re-anchored census through the revisioned stream path', () => {
    const seeded = applySemanticsDelta(emptySemanticsCache(), {
      type: 'census_replace',
      census: census(10),
    });
    const refreshed = reanchored(census(10), 20);
    const bumped = applyRevisionedSemanticsDeltas(seeded, [{
      revision: 7,
      delta: { type: 'census_replace', census: refreshed },
    }]);
    expect(bumped.revision).toBe(7);
    // Identical counts, newer proof: the record the panel reads its
    // `AS OF #<block>` from has to be the one just validated.
    expect(bumped.census).toBe(refreshed);
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

  it('prune applies to the census anchor the last re-emit carried', () => {
    const seeded = applySemanticsDelta(emptySemanticsCache(), {
      type: 'census_replace',
      census: census(10),
    });
    const refreshed = applySemanticsDelta(seeded, {
      type: 'census_replace',
      census: reanchored(census(10), 20),
    });
    expect(refreshed.census?.as_of.block).toBe(20);

    // The record is invalidated by any reorg at or below the anchor it
    // claims. That anchor is now 20, so only a boundary above it keeps it…
    const kept = applySemanticsDelta(refreshed, { type: 'prune', from_block: 21 });
    expect(kept.census).toBe(refreshed.census);
    // …and one at the fresh anchor clears it.
    expect(
      applySemanticsDelta(refreshed, { type: 'prune', from_block: 20 }).census,
    ).toBeNull();
    // A reorg at 15 clears it too, and that is the point: the record claims
    // block 20, so it is exactly as invalid as anything else anchored there.
    // Under the old frozen-anchor dedup it would have survived here on a
    // stale block-10 claim it had already stopped making.
    expect(
      applySemanticsDelta(refreshed, { type: 'prune', from_block: 15 }).census,
    ).toBeNull();
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

/** Count the Map allocations one call makes. `new Map(...)` in the reducer
 *  resolves the global at call time, so a counting stand-in installed for the
 *  duration of the call observes exactly the copies that call made — the
 *  direct pin for "one copy per Map per batch", which is otherwise
 *  unobservable (intermediate copies are discarded inside the batch). */
function countMapCopies<T>(run: () => T): { value: T; copies: number } {
  const NativeMap = globalThis.Map;
  let copies = 0;
  const CountingMap = function CountingMap(
    entries?: Iterable<readonly [unknown, unknown]> | null,
  ) {
    copies += 1;
    return new NativeMap(entries);
  } as unknown as MapConstructor;
  globalThis.Map = CountingMap;
  try {
    const value = run();
    return { value, copies };
  } finally {
    globalThis.Map = NativeMap;
  }
}

function cellUpsert(revision: number, txHash: string): RevisionedSemanticsDelta {
  return { revision, delta: { type: 'cell_upsert', cell: cell(10, txHash) } };
}

function transactionUpsert(
  revision: number,
  txHash: string,
): RevisionedSemanticsDelta {
  return {
    revision,
    delta: { type: 'transaction_upsert', transaction: transaction(10, txHash) },
  };
}

describe('batch copy-on-write', () => {
  it('copies the cells Map once for the whole batch, not once per delta', () => {
    const seeded = applySemanticsDelta(emptySemanticsCache(), {
      type: 'cell_upsert',
      cell: cell(10, '0xseed'),
    });
    const { value: next, copies } = countMapCopies(() =>
      applyRevisionedSemanticsDeltas(seeded, [
        cellUpsert(1, '0xa'),
        cellUpsert(2, '0xb'),
        cellUpsert(3, '0xc'),
      ]));

    expect(copies).toBe(1);
    expect(next.cells.size).toBe(4);
    expect(next.revision).toBe(3);
    // The caller's cache is left exactly as it was.
    expect(seeded.cells.size).toBe(1);
    expect(next.cells).not.toBe(seeded.cells);
    for (const txHash of ['0xa', '0xb', '0xc']) {
      expect(next.cells.get(outPointKey({ tx_hash: txHash, index: 0 }))).toBeDefined();
    }
  });

  it('copies each touched Map once and leaves untouched ones alone', () => {
    const seeded = applyRevisionedSemanticsDeltas(emptySemanticsCache(), [
      cellUpsert(1, '0xseed'),
    ]);
    const { value: next, copies } = countMapCopies(() =>
      applyRevisionedSemanticsDeltas(seeded, [
        cellUpsert(2, '0xa'),
        transactionUpsert(3, '0xt1'),
        cellUpsert(4, '0xb'),
        transactionUpsert(5, '0xt2'),
        { revision: 6, delta: { type: 'census_replace', census: census(10) } },
      ]));

    expect(copies).toBe(2);
    expect(next.cells.size).toBe(3);
    expect(next.transactions.size).toBe(2);
    expect(next.census).not.toBeNull();
    expect(seeded.transactions.size).toBe(0);
  });

  it('a batch of only no-op deltas hands back the previous cache', () => {
    const seeded = applyRevisionedSemanticsDeltas(emptySemanticsCache(), [
      { revision: 1, delta: { type: 'source_status', source: ready } },
      cellUpsert(2, '0xcell'),
      transactionUpsert(3, '0xtx'),
      { revision: 4, delta: { type: 'census_replace', census: census(10) } },
    ]);

    const { value: next, copies } = countMapCopies(() =>
      applyRevisionedSemanticsDeltas(seeded, [
        // Every arm here is content-identical or targets an absent key: the
        // draft must never take a copy, so the caller sees `prev` itself.
        { revision: 4, delta: { type: 'source_status', source: structuredClone(ready) } },
        {
          revision: 4,
          delta: { type: 'cell_upsert', cell: reanchored(cell(10, '0xcell'), 20) },
        },
        {
          revision: 4,
          delta: {
            type: 'transaction_upsert',
            transaction: reanchored(transaction(10, '0xtx'), 20),
          },
        },
        // No `census_replace` here: that arm is a plain replacement now, so
        // a re-anchored census is a real write, not a no-op.
        {
          revision: 4,
          delta: { type: 'cell_remove', out_point: { tx_hash: '0xabsent', index: 0 } },
        },
        { revision: 4, delta: { type: 'transaction_remove', tx_hash: '0xabsent' } },
      ]));

    expect(copies).toBe(0);
    expect(next).toBe(seeded);
  });

  it('a no-op batch that advances the revision keeps every record identity', () => {
    const seeded = applyRevisionedSemanticsDeltas(emptySemanticsCache(), [
      cellUpsert(1, '0xcell'),
      { revision: 2, delta: { type: 'census_replace', census: census(10) } },
    ]);
    const next = applyRevisionedSemanticsDeltas(seeded, [{
      revision: 9,
      delta: { type: 'cell_upsert', cell: reanchored(cell(10, '0xcell'), 20) },
    }]);

    expect(next).not.toBe(seeded);
    expect(next.revision).toBe(9);
    expect(next.cells).toBe(seeded.cells);
    expect(next.transactions).toBe(seeded.transactions);
    expect(next.census).toBe(seeded.census);
  });
});

describe('client retention caps', () => {
  /** Pure defense against a server that ignores its own bounds
   *  (`enrichment.rs` caps at 512 cells / 2048 transactions): the client
   *  degrades by evicting the oldest insertion, never by growing forever. */
  function cellDeltas(from: number, count: number): RevisionedSemanticsDelta[] {
    const deltas: RevisionedSemanticsDelta[] = [];
    for (let i = from; i < from + count; i += 1) {
      deltas.push(cellUpsert(i + 1, `0xcell${i}`));
    }
    return deltas;
  }

  function cellKey(index: number): string {
    return outPointKey({ tx_hash: `0xcell${index}`, index: 0 });
  }

  it('sits at 4x what the server can ever ship', () => {
    // The server's own bounds are `cell_cap: 512` / `transaction_cap: 2048`
    // on `SemanticsProjection` (`crates/cknerv-core/src/enrichment.rs`,
    // asserted there by `default_caps_are_what_the_client_sizes_its_defense_against`).
    // The 4x margin is what makes these caps pure defense: reaching one means
    // a server bug or a host that is not cknerv, never a healthy stream.
    expect(MAX_RETAINED_CELLS).toBe(4 * 512);
    expect(MAX_RETAINED_TRANSACTIONS).toBe(4 * 2_048);
  });

  it('caps cells inside one oversized batch, dropping the oldest inserted', () => {
    const overflow = 8;
    const next = applyRevisionedSemanticsDeltas(
      emptySemanticsCache(),
      cellDeltas(0, MAX_RETAINED_CELLS + overflow),
    );

    expect(next.cells.size).toBe(MAX_RETAINED_CELLS);
    for (let i = 0; i < overflow; i += 1) {
      expect(next.cells.has(cellKey(i))).toBe(false);
    }
    expect(next.cells.has(cellKey(overflow))).toBe(true);
    expect(next.cells.has(cellKey(MAX_RETAINED_CELLS + overflow - 1))).toBe(true);
  });

  it('holds the cap across batches', () => {
    const filled = applyRevisionedSemanticsDeltas(
      emptySemanticsCache(),
      cellDeltas(0, MAX_RETAINED_CELLS),
    );
    expect(filled.cells.size).toBe(MAX_RETAINED_CELLS);
    expect(filled.cells.has(cellKey(0))).toBe(true);

    const next = applyRevisionedSemanticsDeltas(
      filled,
      cellDeltas(MAX_RETAINED_CELLS, 4),
    );
    expect(next.cells.size).toBe(MAX_RETAINED_CELLS);
    for (let i = 0; i < 4; i += 1) expect(next.cells.has(cellKey(i))).toBe(false);
    expect(next.cells.has(cellKey(4))).toBe(true);
    expect(next.cells.has(cellKey(MAX_RETAINED_CELLS + 3))).toBe(true);
    // The batch that evicted did not touch the caller's cache.
    expect(filled.cells.size).toBe(MAX_RETAINED_CELLS);
    expect(filled.cells.has(cellKey(0))).toBe(true);
  });

  it('the single-delta path enforces the same cap', () => {
    const filled = applyRevisionedSemanticsDeltas(
      emptySemanticsCache(),
      cellDeltas(0, MAX_RETAINED_CELLS),
    );
    const next = applySemanticsDelta(filled, {
      type: 'cell_upsert',
      cell: cell(10, '0xnewest'),
    });

    expect(next.cells.size).toBe(MAX_RETAINED_CELLS);
    expect(next.cells.has(cellKey(0))).toBe(false);
    expect(next.cells.has(outPointKey({ tx_hash: '0xnewest', index: 0 }))).toBe(true);
  });

  it('re-upserting a retained key evicts nothing (no growth, no reorder)', () => {
    const filled = applyRevisionedSemanticsDeltas(
      emptySemanticsCache(),
      cellDeltas(0, MAX_RETAINED_CELLS),
    );
    const moved = applySemanticsDelta(filled, {
      type: 'cell_upsert',
      cell: { ...cell(10, '0xcell0'), observed_at_block: 20 },
    });

    expect(moved.cells.size).toBe(MAX_RETAINED_CELLS);
    expect(moved.cells.get(cellKey(0))?.observed_at_block).toBe(20);
    expect(moved.cells.has(cellKey(1))).toBe(true);
  });

  it('caps transactions on their own, larger bound', () => {
    const overflow = 3;
    const deltas: RevisionedSemanticsDelta[] = [];
    for (let i = 0; i < MAX_RETAINED_TRANSACTIONS + overflow; i += 1) {
      deltas.push(transactionUpsert(i + 1, `0xtx${i}`));
    }
    const next = applyRevisionedSemanticsDeltas(emptySemanticsCache(), deltas);

    expect(next.transactions.size).toBe(MAX_RETAINED_TRANSACTIONS);
    for (let i = 0; i < overflow; i += 1) {
      expect(next.transactions.has(`0xtx${i}`)).toBe(false);
    }
    expect(next.transactions.has(`0xtx${overflow}`)).toBe(true);
    expect(
      next.transactions.has(`0xtx${MAX_RETAINED_TRANSACTIONS + overflow - 1}`),
    ).toBe(true);
    // Cells were never touched, so their cap never even looked.
    expect(next.cells.size).toBe(0);
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

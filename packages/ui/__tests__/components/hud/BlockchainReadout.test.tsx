import { emptyScriptCensus } from '@cknerv/cache';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, it, expect } from 'vitest';
import type {
  ActivityFeedRecord,
  AssetEcosystemRecord,
  ChainEntry,
  EnrichmentSourceStatus,
  ProtocolEraRecord,
  TransactionHorizonRecord,
} from '@cknerv/types';
import BlockchainReadout from '../../../src/components/hud/BlockchainReadout';
import type { CellsStats } from '../../../src/derives/cellsStats.derive';

afterEach(cleanup);

const chain: ChainEntry = {
  tip: 16204887, recent_blocks: [], recent_tx_hashes: [], total_blocks: 4217, total_txs: 9338,
  mempool: { pending: 312, proposed: 64, orphan: 0, total_tx_size: 0, total_tx_cycles: 0, min_fee_rate: 0 },
  epoch: { number: 11042, index: 842, length: 1800 }, median_time_ms: 0, difficulty: '0x0',
  chain_name: 'ckb', reorgs: 0, recent_block_intervals_ms: [8000, 7000], recent_block_tx_counts: [2, 3], recent_block_sizes: [500, 800],
  ibd: false, best_known_block: 16204887,
};

const cellsStats: CellsStats = {
  born: 28_431,
  live: 19_204,
  dead: 9_227,
  byKind: { wallet: 0, dex: 0, cf: 0, ckbloom: 0, generic: 19_204 },
  capacityShannons: 121_000_000_000_000_000,
  inView: 4_983,
  dataBearing: 1_545,
  byLock: { sighash: 3_200, multisig: 1_100, acp: 450, omnilock: 0, other: 233 },
  byAsset: { native: 3_500, sudt: 900, xudt: 350, dao: 200, spore: 33, other: 0 },
  scripts: emptyScriptCensus(),
};

const source: EnrichmentSourceStatus = {
  source: 'ckbadger',
  status: 'ready',
  capabilities: ['asset_ecosystem', 'dao_state', 'protocol_era', 'activity_feed', 'transaction_horizon', 'fork_watch'],
  validated_anchor: { block: 100, hash: '0xblock100' },
};

const assetEcosystem: AssetEcosystemRecord = {
  source: 'ckbadger',
  as_of: { block: 100, hash: '0xblock100' },
  updated_at_ms: Date.now(),
  total_live_capacity_shannons: '5776320963848791674',
  total_knowledge_bytes: 159_890_202,
  capacity_breakdown: [
    { category: 'dao', capacity_shannons: '837590809032221706', share_bps: 1450 },
    { category: 'other', capacity_shannons: '4938730154816569968', share_bps: 8550 },
  ],
  top_assets: [],
};

const activityFeed: ActivityFeedRecord = {
  source: 'ckbadger',
  as_of: { block: 100, hash: '0xblock100' },
  updated_at_ms: Date.now(),
  activities: [
    {
      tx_hash: `0x${'11'.repeat(32)}`,
      block: 100,
      timestamp_ms: Date.now(),
      category: 'script',
      label: '.bit Time Info',
      participant_count: 1,
    },
    {
      tx_hash: `0x${'22'.repeat(32)}`,
      block: 99,
      timestamp_ms: Date.now(),
      category: 'transfer',
      participant_count: 2,
    },
  ],
};

const protocolEra: ProtocolEraRecord = {
  source: 'ckbadger',
  as_of: { block: 100, hash: '0xblock100' },
  updated_at_ms: Date.now(),
  network: 'mainnet',
  indexed_tip_block: 100,
  indexed_tip_epoch: 11_042,
  current: {
    name: 'Mirana',
    edition_year: 2021,
    activation_epoch: 5_414,
    activation_block: 70,
  },
};

const transactionHorizon: TransactionHorizonRecord = {
  source: 'ckbadger',
  as_of: { block: 100, hash: '0xblock100' },
  updated_at_ms: Date.now(),
  current_hour: 12,
  current_day: 345,
  hourly_counts: [0, 6, 12],
  daily_counts: [300, 321, 345],
};

describe('BlockchainReadout', () => {
  it('renders the tip and key chain stats', () => {
    const { container } = render(
      <BlockchainReadout chain={chain} cellsStats={cellsStats} />,
    );
    expect(container.textContent).toContain('#16,204,887');
    expect(container.querySelector('[data-epoch-number]')?.textContent).toBe('#11,042');
    expect(container.querySelector('[data-epoch-progress]')?.textContent?.trim()).toBe('842 / 1,800');
    expect(container.textContent).not.toContain('11042.842/1800');
    expect(container.textContent).not.toContain('Blocks');
    expect(container.textContent).not.toContain('Txs');
    expect(container.textContent).not.toContain('Tps');
    expect(container.textContent).toContain('312 · 64');
    expect(container.textContent).toContain('COMMON KNOWLEDGE BASE');
    expect(container.textContent).toContain('共识记忆');
    expect(container.textContent).toContain('GALAXY WINDOW');
    expect(container.textContent).toContain('1.21 GB');
    expect(container.textContent).not.toContain('Interval');
    expect(container.textContent).not.toContain('NERVOS DAO');
    expect(container.textContent).not.toContain('ACTIVITY');
    expect(container.textContent).not.toContain('TX HORIZON');
    expect(container.querySelector('[data-protocol-era-state]')).toBeNull();
  });

  it('fuses protocol context into the canonical Epoch row', () => {
    const { container } = render(
      <BlockchainReadout
        chain={chain}
        cellsStats={cellsStats}
        enrichmentSource={source}
        protocolEra={protocolEra}
      />,
    );
    const badge = container.querySelector<HTMLElement>('[data-protocol-era-state="ready"]');

    expect(container.textContent).toContain('#11,042· MIRANA·21');
    expect(container.textContent).not.toContain('IDX');
    expect(badge?.dataset.protocolEraLabel).toBe('MIRANA·21');
    expect(badge?.title).toContain('epoch 5,414, block #70');
    expect(container.textContent).not.toContain('PROTOCOL ERA');
  });

  it('renders an optional bounded activity fingerprint', () => {
    const { container } = render(
      <BlockchainReadout
        chain={chain}
        cellsStats={cellsStats}
        enrichmentSource={source}
        activityFeed={activityFeed}
      />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('ACTIVITY');
    expect(text).toContain('LATEST 2 · AS OF #100');
    expect(text).toContain('SCRIPT 1 · CKB 1');
    expect(text).toContain('.bit Time Info');
    expect(text).toContain('2P');
    expect(container.querySelector<HTMLElement>(
      '[data-activity-category="script"]',
    )?.style.width).toBe('50%');
  });

  it('keeps the activity fingerprint but folds rows in a short viewport', () => {
    const { container } = render(
      <BlockchainReadout
        chain={chain}
        cellsStats={cellsStats}
        enrichmentSource={source}
        activityFeed={activityFeed}
        compactActivity
      />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('ACTIVITY');
    expect(text).toContain('LATEST 2 · AS OF #100');
    expect(text).toContain('SCRIPT 1 · CKB 1');
    expect(text).not.toContain('.bit Time Info');
    expect(container.querySelector('[data-activity-feed-compact="true"]')).not.toBeNull();
  });

  it('renders the hourly horizon without a TPS row', () => {
    const { container } = render(
      <BlockchainReadout
        chain={chain}
        cellsStats={cellsStats}
        enrichmentSource={source}
        transactionHorizon={transactionHorizon}
      />,
    );
    const text = container.textContent ?? '';
    expect(text).not.toContain('Tps');
    expect(text).toContain('TX HORIZON');
    expect(text).toContain('3/24H · AS OF #100');
    expect(text).toContain('HOUR 12');
    expect(text).toContain('DAY 345');
    expect(text).toContain('PEAK/H 12');
    expect(container.querySelectorAll('[data-transaction-hour-count]')).toHaveLength(3);
  });

  it('keeps a compact horizon before activity on short viewports', () => {
    const { container } = render(
      <BlockchainReadout
        chain={chain}
        cellsStats={cellsStats}
        enrichmentSource={source}
        transactionHorizon={transactionHorizon}
        activityFeed={activityFeed}
        compactActivity
      />,
    );
    const text = container.textContent ?? '';
    expect(text).not.toContain('Tps');
    expect(text).toContain('TX HORIZON');
    expect(text).toContain('H12/D345 · AS OF #100');
    expect(text.indexOf('TX HORIZON')).toBeLessThan(text.indexOf('ACTIVITY'));
    expect(text).not.toContain('NERVOS DAO');
    expect(text).not.toContain('INDEXED');
    expect(text).not.toContain('IDX');
    expect(text).not.toContain('CKBADGER');
    expect(container.querySelector('[data-transaction-horizon-state="ready"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-transaction-hour-count]')).toHaveLength(0);
  });

  it('orders capacity before horizon and activity', () => {
    const { container } = render(
      <BlockchainReadout
        chain={chain}
        cellsStats={cellsStats}
        enrichmentSource={source}
        assetEcosystem={assetEcosystem}
        transactionHorizon={transactionHorizon}
        activityFeed={activityFeed}
      />,
    );
    const text = container.textContent ?? '';
    const canonicalAt = text.indexOf('Reorgs');
    const chainCapacityAt = text.indexOf('CHAIN CAPACITY');
    const galaxyWindowAt = text.indexOf('GALAXY WINDOW');
    const horizonAt = text.indexOf('TX HORIZON');
    const activityAt = text.indexOf('ACTIVITY');

    expect(canonicalAt).toBeGreaterThanOrEqual(0);
    expect(canonicalAt).toBeLessThan(chainCapacityAt);
    expect(chainCapacityAt).toBeLessThan(galaxyWindowAt);
    expect(galaxyWindowAt).toBeLessThan(horizonAt);
    expect(horizonAt).toBeLessThan(activityAt);
    expect(text).not.toContain('NERVOS DAO');
  });
});

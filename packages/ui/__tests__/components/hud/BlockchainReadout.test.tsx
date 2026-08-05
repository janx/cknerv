import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, it, expect } from 'vitest';
import type {
  ActivityFeedRecord,
  ChainEntry,
  DaoStateRecord,
  EnrichmentSourceStatus,
  ProtocolEraRecord,
  TransactionHorizonRecord,
} from '@cknerv/types';
import BlockchainReadout from '../../../src/components/hud/BlockchainReadout';

afterEach(cleanup);

const chain: ChainEntry = {
  tip: 16204887, recent_blocks: [], recent_tx_hashes: [], total_blocks: 4217, total_txs: 9338,
  mempool: { pending: 312, proposed: 64, orphan: 0, total_tx_size: 0, total_tx_cycles: 0, min_fee_rate: 0 },
  epoch: { number: 11042, index: 842, length: 1800 }, median_time_ms: 0, difficulty: '0x0',
  chain_name: 'ckb', reorgs: 0, recent_block_intervals_ms: [8000, 7000], recent_block_tx_counts: [2, 3], recent_block_sizes: [500, 800],
  ibd: false, best_known_block: 16204887,
};

const source: EnrichmentSourceStatus = {
  source: 'ckbadger',
  status: 'ready',
  capabilities: ['dao_state', 'protocol_era', 'activity_feed', 'transaction_horizon', 'fork_watch'],
  validated_anchor: { block: 100, hash: '0xblock100' },
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

const daoState: DaoStateRecord = {
  source: 'ckbadger',
  as_of: { block: 100, hash: '0xblock100' },
  statistics_block: 99,
  updated_at_ms: Date.now(),
  total_deposited_shannons: '837703738002110308',
  total_depositors: 16_740,
  active_deposits: 22_659,
  pending_withdrawal_shannons: '77523020877862416',
  unclaimed_compensation_shannons: '81345902996799859',
  estimated_apc_bps: 201,
  deposit_change_24h_shannons: '141530599353229',
  depositors_change_24h: 5,
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
    const { container } = render(<BlockchainReadout chain={chain} />);
    expect(container.textContent).toContain('#16,204,887');
    expect(container.textContent).toContain('11042.842/1800');
    expect(container.textContent).toContain('312 · 64');
    expect(container.textContent).toContain('COMMON KNOWLEDGE BASE');
    expect(container.textContent).toContain('共识记忆');
    expect(container.textContent).not.toContain('Interval');
    expect(container.textContent).not.toContain('INDEXED FORK WATCH');
    expect(container.textContent).not.toContain('INDEXED NERVOS DAO');
    expect(container.textContent).not.toContain('INDEXED ACTIVITY');
    expect(container.textContent).not.toContain('INDEXED TX HORIZON');
    expect(container.querySelector('[data-protocol-era-state]')).toBeNull();
  });

  it('adds indexed protocol context inside the canonical Epoch row', () => {
    const { container } = render(
      <BlockchainReadout
        chain={chain}
        enrichmentSource={source}
        protocolEra={protocolEra}
      />,
    );
    const badge = container.querySelector<HTMLElement>('[data-protocol-era-state="ready"]');

    expect(container.textContent).toContain('11042.842/1800· IDX MIRANA·21');
    expect(badge?.dataset.protocolEraLabel).toBe('MIRANA·21');
    expect(badge?.title).toContain('epoch 5,414, block #70');
    expect(container.textContent).not.toContain('PROTOCOL ERA');
  });

  it('renders optional fixed-shape DAO context without inventing a ratio', () => {
    const { container } = render(
      <BlockchainReadout
        chain={chain}
        enrichmentSource={source}
        daoState={daoState}
      />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('INDEXED NERVOS DAO · #99');
    expect(text).toContain('FIXED SNAPSHOT · ANCHOR #100');
    expect(text).toContain('8.38 B CKB');
    expect(text).toContain('22,659');
    expect(text).toContain('2.01%');
    expect(text).toContain('+1.42 M CKB');
    expect(text).toContain('+5');
    expect(container.querySelector('[data-dao-state="ready"]')).not.toBeNull();
    expect(container.querySelector('[data-fill]')).toBeNull();
  });

  it('renders an optional bounded activity fingerprint', () => {
    const { container } = render(
      <BlockchainReadout
        chain={chain}
        enrichmentSource={source}
        activityFeed={activityFeed}
      />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('INDEXED ACTIVITY · LATEST 2 · #100');
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
        enrichmentSource={source}
        activityFeed={activityFeed}
        compactActivity
      />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('INDEXED ACTIVITY · LATEST 2 · #100');
    expect(text).toContain('SCRIPT 1 · CKB 1');
    expect(text).not.toContain('.bit Time Info');
    expect(container.querySelector('[data-activity-feed-compact="true"]')).not.toBeNull();
  });

  it('renders the indexed hourly fingerprint without replacing direct TPS', () => {
    const { container } = render(
      <BlockchainReadout
        chain={chain}
        enrichmentSource={source}
        transactionHorizon={transactionHorizon}
      />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('Tps 60s0.33');
    expect(text).toContain('INDEXED TX HORIZON · 3/24H · A#100');
    expect(text).toContain('HOUR 12');
    expect(text).toContain('DAY 345');
    expect(text).toContain('PEAK/H 12');
    expect(container.querySelectorAll('[data-transaction-hour-count]')).toHaveLength(3);
  });

  it('folds the indexed horizon into the direct TPS row on short viewports', () => {
    const { container } = render(
      <BlockchainReadout
        chain={chain}
        enrichmentSource={source}
        transactionHorizon={transactionHorizon}
        compactActivity
      />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('Tps 60s0.33· IDX H12/D345');
    expect(text).not.toContain('INDEXED TX HORIZON');
    expect(container.querySelector('[data-transaction-horizon-state="ready"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-transaction-hour-count]')).toHaveLength(0);
  });
});

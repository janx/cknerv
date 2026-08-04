import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, it, expect } from 'vitest';
import type {
  ActivityFeedRecord,
  ChainEntry,
  DaoStateRecord,
  EnrichmentSourceStatus,
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
  capabilities: ['dao_state', 'activity_feed'],
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

describe('BlockchainReadout', () => {
  it('renders the tip and key chain stats', () => {
    const { container } = render(<BlockchainReadout chain={chain} />);
    expect(container.textContent).toContain('#16,204,887');
    expect(container.textContent).toContain('11042.842/1800');
    expect(container.textContent).toContain('312 · 64');
    expect(container.textContent).toContain('COMMON KNOWLEDGE BASE');
    expect(container.textContent).toContain('共识记忆');
    expect(container.textContent).not.toContain('INDEXED NERVOS DAO');
    expect(container.textContent).not.toContain('INDEXED ACTIVITY');
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
});

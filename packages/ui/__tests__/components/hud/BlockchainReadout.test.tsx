import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, it, expect } from 'vitest';
import type { ChainEntry } from '@cknerv/types';
import BlockchainReadout from '../../../src/components/hud/BlockchainReadout';

afterEach(cleanup);

const chain: ChainEntry = {
  tip: 16204887, recent_blocks: [], recent_tx_hashes: [], total_blocks: 4217, total_txs: 9338,
  mempool: { pending: 312, proposed: 64, orphan: 0, total_tx_size: 0, total_tx_cycles: 0, min_fee_rate: 0 },
  epoch: { number: 11042, index: 842, length: 1800 }, median_time_ms: 0, difficulty: '0x0',
  chain_name: 'ckb', reorgs: 0, recent_block_intervals_ms: [8000, 7000], recent_block_tx_counts: [2, 3],
  ibd: false, best_known_block: 16204887,
};

describe('BlockchainReadout', () => {
  it('renders the tip and key chain stats', () => {
    const { container } = render(<BlockchainReadout chain={chain} />);
    expect(container.textContent).toContain('#16,204,887');
    expect(container.textContent).toContain('11042.842/1800');
    expect(container.textContent).toContain('312 · 64');
    expect(container.textContent).toContain('BLOCKCHAIN');
    expect(container.textContent).toContain('主链');
  });
});
